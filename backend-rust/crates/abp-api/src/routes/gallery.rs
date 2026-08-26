// Generated from the original route implementation; keep handlers thin as slices are migrated.
use super::shared::*;
use super::*;

// ============================================================================
// 画廊
// ============================================================================

pub(crate) async fn gallery_images(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Query(q): Query<Paging>,
) -> ApiResult<Json<Value>> {
    let q = q.with_defaults(50, 0);
    let (total, items) = app
        .db
        .gallery_images(
            &u,
            q.view_mode.as_deref().unwrap_or("own"),
            q.user_id,
            q.category.as_deref(),
            parse_date(&q.start_date, false),
            parse_date(&q.end_date, true),
            q.limit.unwrap(),
            q.offset.unwrap(),
        )
        .await?;
    let ids: Vec<i32> = items.iter().map(|i| i.user_id).collect::<Vec<_>>();
    let names = app.db.usernames_by_ids(&ids).await?;
    let out: Vec<Value> = items
        .iter()
        .map(|i| {
            json!({
                "id": i.id,
                "user_id": i.user_id,
                "username": names.get(&i.user_id).cloned().unwrap_or_else(|| "Unknown".into()),
                "filename": i.filename,
                "file_path": i.file_path,
                "url": i.url,
                "prompt": i.prompt,
                "width": i.width,
                "height": i.height,
                "category": i.category.clone().unwrap_or_else(|| "other".into()),
                "is_shared": i.is_shared,
                "created_at": i.created_at,
            })
        })
        .collect();
    Ok(Json(json!({ "total": total, "items": out })))
}

pub(crate) async fn gallery_videos(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Query(q): Query<Paging>,
) -> ApiResult<Json<Value>> {
    let q = q.with_defaults(20, 0);
    let (total, items) = app
        .db
        .gallery_videos(
            &u,
            q.view_mode.as_deref().unwrap_or("own"),
            q.user_id,
            q.category.as_deref(),
            parse_date(&q.start_date, false),
            parse_date(&q.end_date, true),
            q.limit.unwrap(),
            q.offset.unwrap(),
        )
        .await?;
    let ids: Vec<i32> = items.iter().filter_map(|v| v.user_id).collect();
    let names = app.db.usernames_by_ids(&ids).await?;
    let out: Vec<Value> = items
        .iter()
        .map(|v| {
            let mut j = video_json(v);
            j["username"] = json!(v
                .user_id
                .and_then(|id| names.get(&id).cloned())
                .unwrap_or_else(|| "Unknown".into()));
            j
        })
        .collect();
    Ok(Json(json!({ "total": total, "items": out })))
}

#[derive(Deserialize)]
pub(crate) struct IdsBody {
    ids: Vec<i32>,
}

#[derive(Deserialize)]
pub(crate) struct VideoIdsBody {
    ids: Vec<String>,
}

pub(crate) async fn delete_image(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(image_id): Path<i32>,
) -> ApiResult<Json<Value>> {
    let img = app
        .db
        .image_visible(image_id, &u)
        .await?
        .ok_or_else(|| ApiError::not_found("Image not found"))?;
    if img.file_path.starts_with(&app.settings.uploads_dir) {
        let _ = tokio::fs::remove_file(&img.file_path).await;
    }
    app.db.delete_image(image_id).await?;
    Ok(Json(json!({"status":"deleted"})))
}

pub(crate) async fn batch_delete_images(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Json(body): Json<IdsBody>,
) -> ApiResult<Json<Value>> {
    let mut deleted = 0usize;
    for id in body.ids {
        if let Some(image) = app.db.image_visible(id, &_admin).await? {
            if image.file_path.starts_with(&app.settings.uploads_dir) {
                let _ = tokio::fs::remove_file(&image.file_path).await;
            }
            app.db.delete_image(id).await?;
            deleted += 1;
        }
    }
    Ok(Json(json!({"deleted":deleted})))
}

pub(crate) async fn batch_delete_videos(
    State(app): State<AppState>,
    AdminUser(admin): AdminUser,
    Json(body): Json<VideoIdsBody>,
) -> ApiResult<Json<Value>> {
    let mut deleted = 0usize;
    for id in body.ids {
        if let Some(video) = app.db.video_by_id(&id).await? {
            if let Some(path) = video.file_path.clone() {
                if path.starts_with(&app.settings.uploads_dir) {
                    let _ = tokio::fs::remove_file(path).await;
                }
            }
            if let Some(url) = video.result_url.as_deref() {
                let path = crate::services::media::uploads_path(&app, url);
                let _ = tokio::fs::remove_file(path).await;
            }
            if app.db.delete_video(&id, &admin).await?.is_some() {
                deleted += 1;
            }
        }
    }
    Ok(Json(json!({"deleted":deleted})))
}

pub(crate) async fn share_image(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Path(image_id): Path<i32>,
) -> ApiResult<Json<Value>> {
    let shared = app
        .db
        .toggle_image_shared(image_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Image not found"))?;
    Ok(Json(json!({"id":image_id,"is_shared":shared})))
}

#[derive(Deserialize)]
pub(crate) struct ShareMany {
    ids: Vec<i32>,
    is_shared: bool,
}

pub(crate) async fn batch_share_images(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Json(body): Json<ShareMany>,
) -> ApiResult<Json<Value>> {
    let updated = app.db.batch_share_images(&body.ids, body.is_shared).await?;
    Ok(Json(json!({"updated":updated,"is_shared":body.is_shared})))
}

#[derive(Deserialize)]
pub(crate) struct ShareManyVideos {
    ids: Vec<String>,
    is_shared: bool,
}

pub(crate) async fn share_video(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Path(video_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let shared = app
        .db
        .toggle_video_shared(&video_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Video not found"))?;
    Ok(Json(json!({"id":video_id,"is_shared":shared})))
}

pub(crate) async fn batch_share_videos(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Json(body): Json<ShareManyVideos>,
) -> ApiResult<Json<Value>> {
    let updated = app.db.batch_share_videos(&body.ids, body.is_shared).await?;
    Ok(Json(json!({"updated":updated,"is_shared":body.is_shared})))
}

#[derive(Deserialize)]
pub(crate) struct ShareAll {
    is_shared: bool,
    #[serde(default)]
    skip_count: i64,
}

pub(crate) async fn share_all_images(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Json(body): Json<ShareAll>,
) -> ApiResult<Json<Value>> {
    let updated = app
        .db
        .share_all_images_admin(body.is_shared, body.skip_count)
        .await?;
    Ok(Json(json!({"updated":updated,"is_shared":body.is_shared})))
}

pub(crate) async fn share_all_videos(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Json(body): Json<ShareAll>,
) -> ApiResult<Json<Value>> {
    let updated = app
        .db
        .share_all_videos_admin(body.is_shared, body.skip_count)
        .await?;
    Ok(Json(json!({"updated":updated,"is_shared":body.is_shared})))
}
pub(crate) async fn get_review(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(video_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let v = app
        .db
        .video_by_id(&video_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Video not found"))?;
    if user.role != "admin" && v.user_id != Some(user.id) && !v.is_shared {
        return Err(ApiError::forbidden("Access denied"));
    }
    let details = v
        .review_result
        .map(|raw| serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({"raw": raw})));
    Ok(Json(json!({
        "video_id": video_id,
        "review_score": v.review_score,
        "review_status": v.review_status,
        "reviewed_at": v.reviewed_at,
        "details": details,
    })))
}

pub(crate) async fn post_review(
    State(app): State<AppState>,
    AdminUser(_admin): AdminUser,
    Path(video_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let item = app
        .db
        .video_by_id(&video_id)
        .await?
        .ok_or_else(|| ApiError::not_found("video not found"))?;
    if item.status != "done" {
        return Err(ApiError::bad_request(
            "Video must be completed before review",
        ));
    }
    let local_path = std::path::Path::new(&app.settings.uploads_dir)
        .join("queue")
        .join(format!("video_{video_id}.mp4"));
    if !tokio::fs::try_exists(&local_path).await.unwrap_or(false) {
        return Err(ApiError::bad_request("Video file not found locally"));
    }
    let worker_app = app.clone();
    let worker_id = video_id.clone();
    tokio::spawn(async move {
        if let Err(error) = crate::services::review::review_video(&worker_app, &worker_id).await {
            tracing::warn!(video_id = %worker_id, error = %error, "manual video review failed");
        }
    });
    Ok(Json(
        json!({ "message": "review started", "video_id": video_id }),
    ))
}

#[derive(Deserialize)]
pub(crate) struct DownloadIds {
    ids: Vec<Value>,
}

pub(crate) async fn batch_download_images(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<DownloadIds>,
) -> ApiResult<impl IntoResponse> {
    let mut files = Vec::new();
    for raw_id in body.ids {
        let Some(id) = raw_id
            .as_i64()
            .and_then(|value| i32::try_from(value).ok())
            .or_else(|| raw_id.as_str().and_then(|value| value.parse().ok()))
        else {
            continue;
        };
        if let Some(image) = app.db.image_visible(id, &user).await? {
            files.push((image.filename, image.file_path));
        }
    }
    if files.is_empty() {
        return Err(ApiError::bad_request("No downloadable images selected"));
    }
    let bytes = crate::services::archive::zip_files(files).await?;
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        "application/zip".parse().expect("static content type"),
    );
    response.headers_mut().insert(
        axum::http::header::CONTENT_DISPOSITION,
        "attachment; filename=gallery_images.zip"
            .parse()
            .expect("static disposition"),
    );
    Ok(response)
}

pub(crate) async fn batch_download_videos(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<DownloadIds>,
) -> ApiResult<impl IntoResponse> {
    let mut files = Vec::new();
    for raw_id in body.ids {
        let Some(id) = raw_id
            .as_str()
            .map(str::to_string)
            .or_else(|| raw_id.as_i64().map(|value| value.to_string()))
        else {
            continue;
        };
        if let Some(video) = app.db.video_by_id(&id).await? {
            if video.status != "done" && video.status != "archived" {
                continue;
            }
            if user.role != "admin" && video.user_id != Some(user.id) && !video.is_shared {
                continue;
            }
            if let Some(path) = video.file_path {
                files.push((video.filename.unwrap_or_else(|| format!("{id}.mp4")), path));
            }
        }
    }
    if files.is_empty() {
        return Err(ApiError::bad_request("No downloadable videos selected"));
    }
    let bytes = crate::services::archive::zip_files(files).await?;
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        "application/zip".parse().expect("static content type"),
    );
    response.headers_mut().insert(
        axum::http::header::CONTENT_DISPOSITION,
        "attachment; filename=gallery_videos.zip"
            .parse()
            .expect("static disposition"),
    );
    Ok(response)
}
