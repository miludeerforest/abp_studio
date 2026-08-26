//! Image/story generation HTTP surface.  Provider calls and media persistence
//! are delegated to `services::generation`; this module owns only transport
//! validation and task authorization.

use super::shared::queue_record_json;
use crate::error::{ApiError, ApiResult};
use crate::extract::CurrentUser;
use crate::services::{config, generation, media, multipart, tasks};
use crate::state::AppState;
use abp_core::domain::User;
use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::Json,
};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub(crate) struct MergeRequest {
    pub video_ids: Vec<String>,
}

pub(crate) async fn analyze(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<generation::AnalyzeResponse>> {
    let form = multipart::collect(multipart).await?;
    let product = form
        .file("product_img")
        .ok_or_else(|| ApiError::bad_request("product_img is required"))?;
    let reference = form
        .file("ref_img")
        .ok_or_else(|| ApiError::bad_request("ref_img is required"))?;
    let count = form
        .text_or("gen_count", "9")
        .parse::<usize>()
        .unwrap_or(9)
        .clamp(1, 20);
    let response = generation::analyze_product(
        &app,
        &product.bytes,
        &reference.bytes,
        &form.text_or("category", "other"),
        form.optional_text("custom_product_name").as_deref(),
        count,
        form.optional_text("api_url").as_deref(),
        form.optional_text("gemini_api_key").as_deref(),
        form.optional_text("model_name").as_deref(),
    )
    .await?;
    Ok(Json(response))
}

pub(crate) async fn batch_generate(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let form = multipart::collect(multipart).await?;
    let product = form
        .file("product_img")
        .ok_or_else(|| ApiError::bad_request("product_img is required"))?;
    let reference = form
        .file("ref_img")
        .ok_or_else(|| ApiError::bad_request("ref_img is required"))?;
    let scripts = parse_scripts(&form.text_or("scripts", "[]"))?;
    let aspect_ratio = form.text_or("aspect_ratio", "1:1");
    let category = form.text_or("category", "other");
    let api_url = form.optional_text("api_url");
    let api_key = form.optional_text("gemini_api_key");
    let model = form.optional_text("model_name");
    let mut results = run_image_batch(
        &app,
        &user,
        product.bytes.clone(),
        reference.bytes.clone(),
        scripts,
        api_url.as_deref(),
        api_key.as_deref(),
        model.as_deref(),
        &aspect_ratio,
        &category,
    )
    .await?;
    normalize_batch_results(&mut results);
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "status": "completed",
            "total_generated": results.len(),
            "results": results,
        })),
    ))
}

pub(crate) async fn batch_generate_async(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let form = multipart::collect(multipart).await?;
    let product = form
        .file("product_img")
        .ok_or_else(|| ApiError::bad_request("product_img is required"))?;
    let reference = form
        .file("ref_img")
        .ok_or_else(|| ApiError::bad_request("ref_img is required"))?;
    let scripts = parse_scripts(&form.text_or("scripts", "[]"))?;
    let payload = json!({
        "product_b64": abp_ai::encode_base64(&product.bytes),
        "ref_b64": abp_ai::encode_base64(&reference.bytes),
        "scripts": scripts,
        "api_url": form.optional_text("api_url"),
        "model_name": form.optional_text("model_name"),
        "aspect_ratio": form.text_or("aspect_ratio", "1:1"),
        "category": form.text_or("category", "other"),
    });
    let task = tasks::create(&app, "batch-generate", user.id, payload).await?;
    let task_id = task.id.clone();
    let worker_app = app.clone();
    let worker_user = user.clone();
    tokio::spawn(async move {
        if let Err(error) = run_persisted_batch(worker_app, worker_user, task_id.clone()).await {
            tracing::error!(task_id = %task_id, error = %error, "batch task failed");
        }
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(
            json!({"task_id": task.id, "status": "started", "total_requested": scripts_len(&task)}),
        ),
    ))
}

pub(crate) async fn batch_status(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(task_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let task = app
        .db
        .task_by_id(&task_id)
        .await?
        .ok_or_else(|| tasks::not_found("batch"))?;
    if task.user_id != Some(user.id) && user.role != "admin" {
        return Err(ApiError::forbidden("Not authorized"));
    }
    let result = task.result.unwrap_or_else(|| json!({}));
    let mut results = result.get("results").cloned().unwrap_or_else(|| json!([]));
    if let Some(items) = results.as_array_mut() {
        for item in items {
            if let Some(object) = item.as_object_mut() {
                object.remove("result_index");
                object.remove("saved_url");
                if let Some(Value::String(image)) = object.get_mut("image_base64") {
                    if !image.starts_with("data:") {
                        *image = format!("data:image/png;base64,{image}");
                    }
                }
            }
        }
    }
    let total_requested = task
        .payload
        .as_ref()
        .and_then(|payload| payload.get("scripts"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let completed_count = result
        .get("completed_count")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or_else(|| results.as_array().map(Vec::len).unwrap_or(0));
    Ok(Json(json!({
        "status": task.status,
        "total_requested": total_requested,
        "completed_count": completed_count,
        "results": results,
        "error": task.error_msg,
    })))
}

pub(crate) async fn simple_batch_generate(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let form = multipart::collect(multipart).await?;
    let files: Vec<Vec<u8>> = form
        .files("product_imgs")
        .map(|file| {
            abp_ai::compress_image(&file.bytes, 800, 75).unwrap_or_else(|_| file.bytes.clone())
        })
        .collect();
    if files.is_empty() {
        return Err(ApiError::bad_request("请上传1张产品图"));
    }
    if files.len() > 1 {
        return Err(ApiError::bad_request(
            "当前仅支持单张图片生成，多图融合功能暂不可用",
        ));
    }
    let count = form.text_or("gen_count", "3").parse::<usize>().unwrap_or(3);
    if !(1..=9).contains(&count) {
        return Err(ApiError::bad_request("生成数量必须在1-9之间"));
    }
    let configs = config::config_map(&app).await?;
    let api_url = configs
        .get("api_url")
        .cloned()
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let api_key = configs
        .get("api_key")
        .cloned()
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let model = configs
        .get("model_name")
        .cloned()
        .unwrap_or_else(|| "gemini-3-pro-image-preview".into());
    let mut prompt = form.text_or("prompt", "Create a professional product scene.");
    if let Some(style) = form.optional_text("scene_style_prompt") {
        prompt = format!("{prompt}. Visual style: {style}");
    }
    let aspect_ratio = form.text_or("aspect_ratio", "1:1");
    let category = form.text_or("category", "other");
    let image = abp_ai::encode_base64(&files[0]);
    let limit = configs
        .get("max_concurrent_image")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .clamp(1, count);
    let app_ref = app.clone();
    let user_ref = user.clone();
    let results: Vec<Value> = stream::iter(0..count)
        .map(|index| {
            let app = app_ref.clone();
            let user = user_ref.clone();
            let image = image.clone();
            let prompt = prompt.clone();
            let api_url = api_url.clone();
            let api_key = api_key.clone();
            let model = model.clone();
            let aspect_ratio = aspect_ratio.clone();
            let category = category.clone();
            async move {
                let result = generation::generate_image(
                    &app,
                    &[image],
                    &prompt,
                    &format!("Result_{}", index + 1),
                    &aspect_ratio,
                    &api_url,
                    &api_key,
                    &model,
                )
                .await;
                let saved =
                    generation::save_image_result(&app, &user, &result, &category, "simple_batch")
                        .await
                        .ok()
                        .flatten();
                let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
                value["result_index"] = json!(index);
                value["saved_url"] = json!(saved);
                value
            }
        })
        .buffer_unordered(limit)
        .collect()
        .await;
    let saved_count = results
        .iter()
        .filter(|value| value.get("saved_url").and_then(Value::as_str).is_some())
        .count();
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "status": "completed",
            "input_images": files.len(),
            "total_generated": results.len(),
            "saved_to_gallery": saved_count,
            "results": results,
        })),
    ))
}

pub(crate) async fn story_analyze(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<generation::StoryAnalysisResponse>> {
    let form = multipart::collect(multipart).await?;
    let image = form
        .file("image")
        .ok_or_else(|| ApiError::bad_request("image is required"))?;
    let shots = form
        .text_or("shot_count", "5")
        .parse::<usize>()
        .unwrap_or(5);
    Ok(Json(
        generation::story_analyze(
            &app,
            &image.bytes,
            &form.text_or("topic", "一个产品的故事"),
            &form.text_or("category", "other"),
            shots,
            form.optional_text("api_url").as_deref(),
            form.optional_text("gemini_api_key").as_deref(),
            form.optional_text("model_name").as_deref(),
        )
        .await?,
    ))
}

pub(crate) async fn generate_video_prompt(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let image = form
        .file("image")
        .ok_or_else(|| ApiError::bad_request("image is required"))?;
    let prompt = generation::video_prompt(
        &app,
        &image.bytes,
        form.optional_text("api_url").as_deref(),
        form.optional_text("gemini_api_key").as_deref(),
        form.optional_text("model_name").as_deref(),
    )
    .await?;
    Ok(Json(json!({"video_prompt": prompt})))
}

pub(crate) async fn story_generate(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let image = form
        .file("image")
        .ok_or_else(|| ApiError::bad_request("image is required"))?;
    let shots: Vec<generation::StoryShot> = serde_json::from_str(&form.text_or("shots_json", "[]"))
        .map_err(|error| ApiError::bad_request(format!("Invalid JSON: {error}")))?;
    let configs = config::config_map(&app).await?;
    let api_url = form
        .optional_text("api_url")
        .or_else(|| configs.get("api_url").cloned())
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let api_key = form
        .optional_text("gemini_api_key")
        .or_else(|| configs.get("api_key").cloned())
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let model = form
        .optional_text("model_name")
        .or_else(|| configs.get("model_name").cloned())
        .unwrap_or_else(|| "gemini-3-pro-image-preview".into());
    let original = abp_ai::encode_base64(&image.bytes);
    let hero = shots
        .iter()
        .find(|shot| shot.shot == 1)
        .and_then(|shot| shot.hero_subject.clone())
        .unwrap_or_default();
    let mut current = original.clone();
    let mut results = Vec::with_capacity(shots.len());
    for shot in shots {
        let prompt = format!(
            "Main hero subject: {hero}. {}. Maintain continuity with the previous frame and keep the product fully visible.",
            shot.prompt
        );
        let result = generation::generate_image(
            &app,
            &[current.clone(), original.clone()],
            &prompt,
            &format!("Shot {}", shot.shot),
            "16:9",
            &api_url,
            &api_key,
            &model,
        )
        .await;
        if let Some(next) = result.image_base64.clone() {
            current = next;
        }
        let image_base64 = result.image_base64.map(|image| {
            if image.starts_with("data:") {
                image
            } else {
                format!("data:image/png;base64,{image}")
            }
        });
        results.push(json!({
            "shot": shot.shot,
            "image_base64": image_base64,
            "prompt": shot.prompt,
            "description": shot.description,
            "shotStory": shot.shot_story,
        }));
    }
    Ok(Json(json!({"status":"completed","results":results})))
}

pub(crate) async fn merge_videos(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    axum::Json(request): axum::Json<MergeRequest>,
) -> ApiResult<Json<Value>> {
    let mut inputs = Vec::<PathBuf>::new();
    let mut names = Vec::new();
    for id in &request.video_ids {
        let Some(item) = app.db.video_by_id(id).await? else {
            continue;
        };
        if item.status != "done" || item.user_id != Some(user.id) && user.role != "admin" {
            continue;
        }
        let Some(result_url) = item.result_url else {
            continue;
        };
        let path = media::uploads_path(&app, &result_url);
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            inputs.push(path);
            names.push(item.filename.unwrap_or_else(|| id.clone()));
        }
    }
    if inputs.len() < 2 {
        return Err(ApiError::bad_request(
            "Need at least 2 valid video files to merge",
        ));
    }
    let timestamp = chrono::Utc::now().timestamp();
    let output_name = format!("merged_{timestamp}.mp4");
    let result_url = media::merge_videos(&app, &inputs, &output_name).await?;
    let id = uuid::Uuid::new_v4().to_string();
    app.db
        .insert_video(&abp_infra::repo::NewVideoItem {
            id: id.clone(),
            filename: output_name,
            file_path: media::uploads_path(&app, &result_url)
                .to_string_lossy()
                .into_owned(),
            prompt: format!("Merged Video: {}", names.join(", ")),
            user_id: Some(user.id),
            category: "other".into(),
            is_shared: user.default_share.unwrap_or(true),
            preview_url: None,
        })
        .await?;
    app.db
        .update_video_status(&id, "done", Some(&result_url), None)
        .await?;
    let item = app
        .db
        .video_by_id(&id)
        .await?
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("merged item not found")))?;
    Ok(Json(queue_record_json(&item)))
}

pub async fn run_persisted_batch(app: AppState, user: User, task_id: String) -> ApiResult<()> {
    let task = app
        .db
        .task_by_id(&task_id)
        .await?
        .ok_or_else(|| tasks::not_found("batch"))?;
    let payload = task
        .payload
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("batch task payload missing")))?;
    let payload: Value = payload;
    let product = payload
        .get("product_b64")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("product payload missing")))?;
    let reference = payload
        .get("ref_b64")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("reference payload missing")))?;
    let product = abp_ai::decode_data_or_base64(product)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let reference = abp_ai::decode_data_or_base64(reference)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    app.db
        .update_task(&task_id, "processing", 0, None, None, true)
        .await
        .map_err(ApiError::from)?;
    let scripts: Vec<generation::ScriptItem> =
        serde_json::from_value(payload.get("scripts").cloned().unwrap_or_else(|| json!([])))
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let category = payload
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or("other");
    let aspect_ratio = payload
        .get("aspect_ratio")
        .and_then(Value::as_str)
        .unwrap_or("1:1");
    let api_url = payload.get("api_url").and_then(Value::as_str);
    let model = payload.get("model_name").and_then(Value::as_str);
    let results = run_image_batch(
        &app,
        &user,
        product,
        reference,
        scripts,
        api_url,
        None,
        model,
        aspect_ratio,
        category,
    )
    .await?;
    let result = json!({"status":"completed","total_generated":results.len(),"results":results});
    app.db
        .update_task(&task_id, "completed", 100, Some(&result), None, true)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

fn normalize_batch_results(results: &mut [Value]) {
    for item in results {
        if let Some(object) = item.as_object_mut() {
            object.remove("result_index");
            object.remove("saved_url");
            if let Some(Value::String(image)) = object.get_mut("image_base64") {
                if !image.starts_with("data:") {
                    *image = format!("data:image/png;base64,{image}");
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_image_batch(
    app: &AppState,
    user: &User,
    product: Vec<u8>,
    reference: Vec<u8>,
    scripts: Vec<generation::ScriptItem>,
    api_url: Option<&str>,
    api_key: Option<&str>,
    model: Option<&str>,
    aspect_ratio: &str,
    category: &str,
) -> ApiResult<Vec<Value>> {
    let configs = config::config_map(app).await?;
    let api_url = api_url
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| configs.get("api_url").cloned())
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let api_key = api_key
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| api_key.map(str::to_string))
        .or_else(|| configs.get("api_key").cloned())
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let model = model
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| configs.get("model_name").cloned())
        .unwrap_or_else(|| "gemini-3-pro-image-preview".into());
    let product = abp_ai::encode_base64(&product);
    let reference = abp_ai::encode_base64(&reference);
    let limit = configs
        .get("max_concurrent_image")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(3)
        .clamp(1, scripts.len().max(1));
    let app_ref = app.clone();
    let user_ref = user.clone();
    let values: Vec<Value> = stream::iter(scripts.into_iter().enumerate())
        .map(|(index, script)| {
            let app = app_ref.clone();
            let user = user_ref.clone();
            let product = product.clone();
            let reference = reference.clone();
            let api_url = api_url.clone();
            let api_key = api_key.clone();
            let model = model.clone();
            let aspect_ratio = aspect_ratio.to_string();
            let category = category.to_string();
            async move {
                let prompt = format!("{} --ar {}", script.script, aspect_ratio);
                let result = generation::generate_image(
                    &app,
                    &[product, reference],
                    &prompt,
                    &script.angle_name,
                    &aspect_ratio,
                    &api_url,
                    &api_key,
                    &model,
                )
                .await;
                let saved = generation::save_image_result(&app, &user, &result, &category, "gen")
                    .await
                    .ok()
                    .flatten();
                let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
                value["result_index"] = json!(index);
                value["saved_url"] = json!(saved);
                value
            }
        })
        .buffer_unordered(limit)
        .collect()
        .await;
    Ok(values)
}

fn parse_scripts(raw: &str) -> ApiResult<Vec<generation::ScriptItem>> {
    serde_json::from_str(raw)
        .map_err(|error| ApiError::bad_request(format!("Invalid scripts JSON: {error}")))
}

fn scripts_len(task: &abp_core::domain::TaskRecord) -> usize {
    task.payload
        .as_ref()
        .and_then(|payload| payload.get("scripts"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}
