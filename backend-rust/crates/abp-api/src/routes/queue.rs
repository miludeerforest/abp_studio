//! Queue transport and task lifecycle endpoints.  Actual provider work runs
//! in `services::video`, outside the request future.

use super::shared::{queue_json, queue_record_json};
use crate::error::{ApiError, ApiResult};
use crate::extract::{AdminUser, CurrentUser};
use crate::services::{config, multipart, video};
use crate::state::AppState;
use axum::{
    extract::{Multipart, Path, Query, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path as FilePath;

pub(crate) async fn list_queue(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
) -> ApiResult<Json<Value>> {
    let items = app.db.queue_view(&u).await?;
    Ok(Json(json!(items
        .iter()
        .map(queue_json)
        .collect::<Vec<_>>())))
}

pub(crate) async fn add_queue(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let prompt = form.text_or("prompt", "Product video");
    let category = form.text_or("category", "other");
    let (bytes, original_name) = if let Some(file) = form.file("file") {
        (
            file.bytes.clone(),
            file.filename.clone().unwrap_or_else(|| "image.png".into()),
        )
    } else if let Some(url) = form.optional_text("image_url") {
        let response = app
            .http
            .get(&url)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|error| {
                ApiError::bad_request(format!("Failed to fetch image URL: {error}"))
            })?;
        if !response.status().is_success() {
            return Err(ApiError::bad_request(format!(
                "Failed to fetch image URL: {}",
                response.status()
            )));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiError::bad_request(format!("Failed to read image URL: {error}")))?;
        (
            bytes.to_vec(),
            url.rsplit('/').next().unwrap_or("image.png").to_string(),
        )
    } else {
        return Err(ApiError::bad_request(
            "Either file or image_url must be provided",
        ));
    };
    if bytes.is_empty() {
        return Err(ApiError::bad_request("Uploaded file is empty"));
    }
    let item_id = uuid::Uuid::new_v4().simple().to_string();
    let filename = original_name
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("image.png")
        .to_string();
    let stored_filename = format!("{}_{}", chrono::Utc::now().timestamp(), filename);
    let directory = FilePath::new(&app.settings.uploads_dir).join("queue");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("create queue directory: {error}")))?;
    let path = directory.join(&stored_filename);
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("write queue input: {error}")))?;
    let item = app
        .db
        .insert_video(&abp_infra::repo::NewVideoItem {
            id: item_id.clone(),
            filename: filename.clone(),
            file_path: path.to_string_lossy().into_owned(),
            prompt: prompt.clone(),
            user_id: Some(u.id),
            category: category.clone(),
            is_shared: u.default_share.unwrap_or(true),
            preview_url: None,
        })
        .await?;
    app.db
        .log_activity(
            u.id,
            "video_gen_start",
            &format!(
                "开始生成视频 | 类目: {category} | 提示词: {}",
                prompt.chars().take(50).collect::<String>()
            ),
        )
        .await
        .ok();
    Ok(Json(queue_record_json(&item)))
}

#[derive(Debug, Deserialize)]
pub(crate) struct QueueUpdate {
    pub status: Option<String>,
    pub result_url: Option<String>,
    pub error_msg: Option<String>,
}

pub(crate) async fn update_queue_item(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Path(item_id): Path<String>,
    Json(body): Json<QueueUpdate>,
) -> ApiResult<Json<Value>> {
    if !app
        .db
        .update_video_fields(
            &item_id,
            body.status.as_deref(),
            body.result_url.as_deref(),
            body.error_msg.as_deref(),
        )
        .await?
    {
        return Err(ApiError::not_found("Item not found"));
    }
    let item = app
        .db
        .video_by_id(&item_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Item not found"))?;
    Ok(Json(queue_record_json(&item)))
}

pub(crate) async fn generate_queue_item(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Path(item_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let item = app
        .db
        .video_by_id(&item_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Item not found"))?;
    if item.status == "processing" {
        return Err(ApiError::conflict("Task is already being processed"));
    }
    let configs = config::config_map(&app).await?;
    let configured = configs
        .get("video_api_url")
        .is_some_and(|value| !value.is_empty())
        && configs
            .get("video_api_key")
            .is_some_and(|value| !value.is_empty());
    if !configured {
        app.db
            .update_video_status(&item_id, "error", None, Some("Missing Video API Config"))
            .await?;
        return Err(ApiError::bad_request("Missing Video API Config"));
    }
    app.db
        .update_video_status(&item_id, "processing", None, None)
        .await?;
    let worker_app = app.clone();
    let worker_id = item_id.clone();
    tokio::spawn(async move {
        if let Err(error) = video::generate_with_retry(worker_app, worker_id.clone()).await {
            tracing::error!(item_id = %worker_id, error = %error, "queue generation failed");
        }
    });
    Ok(Json(
        json!({"status":"processing","message":"Video generation started in background"}),
    ))
}

pub(crate) async fn delete_queue_item(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(item_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let removed = app
        .db
        .delete_video(&item_id, &u)
        .await?
        .ok_or_else(|| ApiError::not_found("Item not found"))?;
    if let Some(path) = removed.file_path {
        if path.starts_with(&app.settings.uploads_dir) {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
    Ok(Json(json!({"status":"deleted"})))
}

pub(crate) async fn retry_queue_item(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(item_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let existing = app
        .db
        .video_by_id(&item_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Item not found"))?;
    if existing.status != "error" {
        return Err(ApiError::bad_request("Only failed items can be retried"));
    }
    if u.role != "admin" && existing.user_id != Some(u.id) {
        return Err(ApiError::forbidden("您只能重试自己的任务"));
    }
    let item = app.db.retry_video(&item_id, &u).await?;
    let configs = config::config_map(&app).await?;
    let configured = configs
        .get("video_api_url")
        .is_some_and(|value| !value.is_empty())
        && configs
            .get("video_api_key")
            .is_some_and(|value| !value.is_empty());
    if !configured {
        return Err(ApiError::bad_request("Video API not configured"));
    }
    let worker_app = app.clone();
    let worker_id = item_id.clone();
    tokio::spawn(async move {
        if let Err(error) = video::generate_with_retry(worker_app, worker_id.clone()).await {
            tracing::error!(item_id = %worker_id, error = %error, "queue retry failed");
        }
    });
    Ok(Json(json!({"status":"retrying","item_id":item.id})))
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct ClearQueueQuery {
    pub status: Option<String>,
}

pub(crate) async fn clear_queue(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Query(query): Query<ClearQueueQuery>,
) -> ApiResult<Json<Value>> {
    let mut items = app
        .db
        .queue_items_for_clear(&u, query.status.as_deref())
        .await?;
    let count = items.len();
    for item in items.drain(..) {
        if matches!(item.status.as_str(), "done" | "archived") && item.result_url.is_some() {
            let _ = app
                .db
                .update_video_status(&item.id, "archived", item.result_url.as_deref(), None)
                .await;
        } else {
            let _ = app.db.delete_video(&item.id, &u).await;
            if let Some(path) = item.file_path {
                if path.starts_with(&app.settings.uploads_dir) {
                    let _ = tokio::fs::remove_file(path).await;
                }
            }
        }
    }
    Ok(Json(json!({"status":"cleared","count":count})))
}

#[allow(dead_code)]
pub(crate) async fn recover_queue(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
) -> ApiResult<Json<Value>> {
    let recovered = video::recover_zombies(&app).await?;
    Ok(Json(json!({"recovered":recovered})))
}

#[allow(dead_code)]
async fn _config_for_queue(app: &AppState) -> ApiResult<std::collections::HashMap<String, String>> {
    config::config_map(app).await
}
