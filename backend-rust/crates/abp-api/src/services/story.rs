use crate::error::{ApiError, ApiResult};
use crate::services::{config, generation, media, tasks, video};
use crate::state::AppState;
use abp_ai::{extract_chat_text, ChatMessage, ChatRequest};
use abp_core::domain::User;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryChainRequest {
    pub initial_image_url: String,
    pub shots: Vec<Value>,
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub model_name: Option<String>,
    pub visual_style: Option<String>,
    pub visual_style_prompt: Option<String>,
    pub camera_movement: Option<String>,
    pub camera_movement_prompt: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryFissionRequest {
    pub initial_image_url: String,
    #[serde(default = "default_topic")]
    pub topic: String,
    #[serde(default = "default_branch_count")]
    pub branch_count: usize,
    pub visual_style: Option<String>,
    pub visual_style_prompt: Option<String>,
    pub camera_movement: Option<String>,
    pub camera_movement_prompt: Option<String>,
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub model_name: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FissionBranch {
    pub branch_id: usize,
    pub scene_name: String,
    pub theme: String,
    pub product_focus: Option<String>,
    pub image_prompt: String,
    pub video_prompt: String,
    pub camera_movement: Option<String>,
}

fn default_category() -> String {
    "other".into()
}
fn default_topic() -> String {
    "产品多角度展示".into()
}
fn default_branch_count() -> usize {
    3
}

pub async fn start_chain(
    app: &AppState,
    user: &User,
    request: StoryChainRequest,
) -> ApiResult<String> {
    let task = tasks::create(
        app,
        "story-chain",
        user.id,
        serde_json::to_value(request).unwrap_or_default(),
    )
    .await?;
    Ok(task.id)
}

pub async fn start_fission(
    app: &AppState,
    user: &User,
    request: StoryFissionRequest,
) -> ApiResult<String> {
    let task = tasks::create(
        app,
        "story-fission",
        user.id,
        serde_json::to_value(request).unwrap_or_default(),
    )
    .await?;
    Ok(task.id)
}

pub async fn run_chain(app: AppState, user: User, task_id: String) -> ApiResult<()> {
    let task = load_task(&app, &task_id, "story-chain").await?;
    let request: StoryChainRequest = serde_json::from_value(task.payload.unwrap_or_default())
        .map_err(|error| ApiError::bad_request(format!("invalid story chain payload: {error}")))?;
    let total = request.shots.len();
    let mut status = json!({
        "status": "processing",
        "current_shot": 0,
        "total_shots": total,
        "video_ids": [],
        "error": Value::Null,
        "merged_video_url": Value::Null,
    });
    update_task(&app, &task_id, "processing", 0, &status, None).await?;
    let mut current_image = resolve_image(&app, &request.initial_image_url).await?;
    let mut video_ids = Vec::new();
    let mut paths = Vec::<PathBuf>::new();

    for (index, shot) in request.shots.iter().enumerate() {
        let shot_number = index + 1;
        let prompt = shot
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or("Create a cinematic product scene")
            .to_string();
        let input_name = format!("chain_{task_id}_shot_{shot_number}_input.jpg");
        let input_path = write_queue_file(&app, &input_name, &current_image).await?;
        let item_id = uuid::Uuid::new_v4().to_string();
        app.db
            .insert_video(&abp_infra::repo::NewVideoItem {
                id: item_id.clone(),
                filename: input_name,
                file_path: input_path.to_string_lossy().into_owned(),
                prompt,
                user_id: Some(user.id),
                category: request.category.clone(),
                is_shared: user.default_share.unwrap_or(true),
                preview_url: None,
            })
            .await?;
        video_ids.push(item_id.clone());
        app.db
            .update_video_status(&item_id, "processing", None, None)
            .await?;
        video::generate_with_retry(app.clone(), item_id.clone()).await?;
        let item = app
            .db
            .video_by_id(&item_id)
            .await?
            .ok_or_else(|| ApiError::not_found("story video task not found"))?;
        if item.status != "done" {
            let error = item
                .error_msg
                .unwrap_or_else(|| "shot generation failed".into());
            status["status"] = json!("failed");
            status["error"] = json!(format!("Shot {shot_number}: {error}"));
            status["video_ids"] = json!(video_ids);
            update_task(
                &app,
                &task_id,
                "failed",
                progress(shot_number, total),
                &status,
                Some(&error),
            )
            .await?;
            return Ok(());
        }
        let result_url = item.result_url.clone().ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!("completed story item has no result_url"))
        })?;
        let video_path = media::uploads_path(&app, &result_url);
        if tokio::fs::try_exists(&video_path).await.unwrap_or(false) {
            paths.push(video_path.clone());
            if shot_number < total {
                if let Some(frame) = media::extract_last_frame(
                    &app,
                    &video_path,
                    &format!("chain_{task_id}_shot_{shot_number}_last.jpg"),
                )
                .await?
                {
                    current_image = tokio::fs::read(frame).await.map_err(|error| {
                        ApiError::bad_request(format!("read extracted frame: {error}"))
                    })?;
                }
            }
        }
        status["current_shot"] = json!(shot_number);
        status["video_ids"] = json!(video_ids);
        update_task(
            &app,
            &task_id,
            "processing",
            progress(shot_number, total.saturating_add(1)),
            &status,
            None,
        )
        .await?;
    }

    if !paths.is_empty() {
        let output_name = format!("story_chain_{task_id}.mp4");
        let merged_url = media::merge_videos(&app, &paths, &output_name).await?;
        let merged_id = uuid::Uuid::new_v4().to_string();
        let merged_path = media::uploads_path(&app, &merged_url);
        app.db
            .insert_video(&abp_infra::repo::NewVideoItem {
                id: merged_id.clone(),
                filename: output_name,
                file_path: merged_path.to_string_lossy().into_owned(),
                prompt: format!("Story Chain {task_id} Complete"),
                user_id: Some(user.id),
                category: request.category,
                is_shared: user.default_share.unwrap_or(true),
                preview_url: None,
            })
            .await?;
        app.db
            .set_video_result(&merged_id, "done", Some(&merged_url), None, None)
            .await?;
        app.db.mark_video_merged(&merged_id).await?;
        status["merged_video_url"] = json!(merged_url);
    }
    status["status"] = json!("completed");
    status["current_shot"] = json!(total);
    update_task(&app, &task_id, "completed", 100, &status, None).await
}

pub async fn run_fission(app: AppState, user: User, task_id: String) -> ApiResult<()> {
    let task = load_task(&app, &task_id, "story-fission").await?;
    let request: StoryFissionRequest = serde_json::from_value(task.payload.unwrap_or_default())
        .map_err(|error| {
            ApiError::bad_request(format!("invalid story fission payload: {error}"))
        })?;
    let original = resolve_image(&app, &request.initial_image_url).await?;
    let branches = analyze_branches(&app, &request, &original).await?;
    let mut status = json!({
        "status":"processing",
        "phase":"generating_images",
        "total_branches":branches.len(),
        "completed_branches":0,
        "branches": branches.iter().map(|branch| json!({
            "branch_id": branch.branch_id,
            "scene_name": branch.scene_name,
            "theme": branch.theme,
            "image_prompt": branch.image_prompt,
            "video_prompt": branch.video_prompt,
            "camera_movement": branch.camera_movement,
            "status":"pending"
        })).collect::<Vec<_>>(),
        "merged_video_url": Value::Null,
        "error": Value::Null,
    });
    update_task(&app, &task_id, "processing", 0, &status, None).await?;
    let mut video_paths = Vec::new();
    for (index, branch) in branches.iter().enumerate() {
        let branch_bytes = if index == 0 {
            original.clone()
        } else {
            let cfg = config::config_map(&app).await?;
            let api_url = request
                .api_url
                .as_deref()
                .or_else(|| cfg.get("api_url").map(String::as_str))
                .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
            let api_key = request
                .api_key
                .as_deref()
                .or_else(|| cfg.get("api_key").map(String::as_str))
                .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
            let model = cfg
                .get("model_name")
                .map(String::as_str)
                .unwrap_or("gemini-3-pro-image-preview");
            let image = abp_ai::encode_base64(&original);
            let result = generation::generate_image(
                &app,
                &[image],
                &branch.image_prompt,
                &format!("Branch_{}", branch.branch_id),
                "1:1",
                api_url,
                api_key,
                model,
            )
            .await;
            media::decode_provider_media(
                &app,
                result.image_base64.as_deref(),
                result.image_url.as_deref(),
            )
            .await?
            .ok_or_else(|| ApiError::bad_request("branch image generation returned no media"))?
        };
        let image_name = format!("fission_{task_id}_branch_{}.jpg", branch.branch_id);
        let image_path = write_queue_file(&app, &image_name, &branch_bytes).await?;
        let _ = media::save_gallery_image(
            &app,
            &user,
            &branch_bytes,
            &branch.image_prompt,
            &request.category,
            "fission",
        )
        .await?;
        let item_id = uuid::Uuid::new_v4().to_string();
        app.db
            .insert_video(&abp_infra::repo::NewVideoItem {
                id: item_id.clone(),
                filename: image_name,
                file_path: image_path.to_string_lossy().into_owned(),
                prompt: format!(
                    "{} Camera: {}",
                    branch.video_prompt,
                    branch.camera_movement.clone().unwrap_or_default()
                ),
                user_id: Some(user.id),
                category: request.category.clone(),
                is_shared: user.default_share.unwrap_or(true),
                preview_url: None,
            })
            .await?;
        video::generate_with_retry(app.clone(), item_id.clone()).await?;
        let item = app
            .db
            .video_by_id(&item_id)
            .await?
            .ok_or_else(|| ApiError::not_found("fission video task not found"))?;
        let branch_index = index;
        if item.status == "done" {
            let url = item.result_url.clone().unwrap_or_default();
            let path = media::uploads_path(&app, &url);
            if tokio::fs::try_exists(&path).await.unwrap_or(false) {
                video_paths.push(path.clone());
            }
            status["branches"][branch_index]["status"] = json!("done");
            status["branches"][branch_index]["video_url"] = json!(url);
            status["branches"][branch_index]["local_video_path"] = json!(path.to_string_lossy());
            status["completed_branches"] = json!(index + 1);
        } else {
            status["branches"][branch_index]["status"] = json!("error");
            status["branches"][branch_index]["error"] = json!(item.error_msg);
        }
        status["phase"] = json!("generating_videos");
        update_task(
            &app,
            &task_id,
            "processing",
            progress(index + 1, branches.len().saturating_add(1)),
            &status,
            None,
        )
        .await?;
    }
    if !video_paths.is_empty() {
        let output_name = format!("story_fission_{task_id}.mp4");
        let merged_url = media::merge_videos(&app, &video_paths, &output_name).await?;
        let merged_id = uuid::Uuid::new_v4().to_string();
        let merged_path = media::uploads_path(&app, &merged_url);
        app.db
            .insert_video(&abp_infra::repo::NewVideoItem {
                id: merged_id.clone(),
                filename: output_name,
                file_path: merged_path.to_string_lossy().into_owned(),
                prompt: format!("Story Fission {task_id} - {}", request.topic),
                user_id: Some(user.id),
                category: request.category,
                is_shared: user.default_share.unwrap_or(true),
                preview_url: None,
            })
            .await?;
        app.db
            .set_video_result(&merged_id, "done", Some(&merged_url), None, None)
            .await?;
        app.db.mark_video_merged(&merged_id).await?;
        status["merged_video_url"] = json!(merged_url);
    }
    status["status"] = json!("completed");
    status["phase"] = json!("done");
    update_task(&app, &task_id, "completed", 100, &status, None).await
}

pub async fn remerge(app: &AppState, _user: &User, task_id: &str) -> ApiResult<Value> {
    let task = load_task(app, task_id, "story-fission").await?;
    let mut status = task.result.unwrap_or_default();
    let branches = status
        .get("branches")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut paths = Vec::new();
    for branch in branches {
        if branch.get("status").and_then(Value::as_str) != Some("done") {
            continue;
        }
        if let Some(path) = branch.get("local_video_path").and_then(Value::as_str) {
            let path = PathBuf::from(path);
            if tokio::fs::try_exists(&path).await.unwrap_or(false) {
                paths.push(path);
            }
        }
    }
    if paths.is_empty() {
        return Err(ApiError::bad_request("No successful videos to merge"));
    }
    let output_name = format!("story_fission_{task_id}.mp4");
    let merged_url = media::merge_videos(app, &paths, &output_name).await?;
    status["merged_video_url"] = json!(merged_url);
    status["status"] = json!("completed");
    update_task(app, task_id, "completed", 100, &status, None).await?;
    Ok(json!({"status":"remerging","video_count":paths.len()}))
}

async fn analyze_branches(
    app: &AppState,
    request: &StoryFissionRequest,
    original: &[u8],
) -> ApiResult<Vec<FissionBranch>> {
    let configs = config::config_map(app).await?;
    let api_url = request
        .api_url
        .as_deref()
        .or_else(|| configs.get("api_url").map(String::as_str))
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let api_key = request
        .api_key
        .as_deref()
        .or_else(|| configs.get("api_key").map(String::as_str))
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let model = configs
        .get("analysis_model_name")
        .map(String::as_str)
        .unwrap_or("gemini-3-pro-preview");
    let image = abp_ai::encode_base64(original);
    let count = request.branch_count.clamp(1, 9);
    let prompt = format!("Analyze this product image and return ONLY JSON array with exactly {count} branches. Each branch has branch_id, scene_name, theme, product_focus, image_prompt, video_prompt, camera_movement. Topic: {}. Preserve product identity and keep all content safe.", request.topic);
    let chat = ChatRequest {
        model: model.into(),
        messages: vec![ChatMessage::user_parts(vec![
            json!({"type":"text","text":prompt}),
            json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{image}")}}),
        ])],
        response_format: Some(json!({"type":"json_object"})),
        max_tokens: Some(4096),
        ..Default::default()
    };
    let value = app
        .ai
        .chat_json(api_url, api_key, &chat, Duration::from_secs(180))
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    let text = extract_chat_text(&value).unwrap_or_else(|| value.to_string());
    let clean = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let mut branches: Vec<FissionBranch> = serde_json::from_str(clean)
        .or_else(|_| {
            let value: Value = serde_json::from_str(clean).map_err(|_| ())?;
            serde_json::from_value(value.get("branches").cloned().unwrap_or_else(|| json!([])))
                .map_err(|_| ())
        })
        .map_err(|_| ApiError::internal(anyhow::anyhow!("failed to parse fission branches")))?;
    if branches.is_empty() {
        branches = (0..count).map(|index| FissionBranch { branch_id:index+1, scene_name:format!("Branch {}",index+1), theme:"Product showcase".into(), product_focus:None, image_prompt:"Create a distinct commercial product scene while preserving exact product identity.".into(), video_prompt:"Gentle cinematic product motion with ambient particles and shifting highlights.".into(), camera_movement:Some("slow push-in".into()) }).collect();
    }
    branches.truncate(count);
    for (index, branch) in branches.iter_mut().enumerate() {
        branch.branch_id = index + 1;
    }
    Ok(branches)
}

async fn resolve_image(app: &AppState, source: &str) -> ApiResult<Vec<u8>> {
    if source.starts_with("data:") {
        return abp_ai::decode_data_or_base64(source)
            .map_err(|error| ApiError::bad_request(error.to_string()));
    }
    if source.starts_with("/uploads/")
        || source.starts_with("/app/uploads/")
        || source.starts_with('/')
    {
        return tokio::fs::read(media::uploads_path(app, source))
            .await
            .map_err(|error| ApiError::bad_request(format!("image not found: {error}")));
    }
    let response = app
        .http
        .get(source)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    if !response.status().is_success() {
        return Err(ApiError::bad_request(format!(
            "image download returned {}",
            response.status()
        )));
    }
    Ok(response
        .bytes()
        .await
        .map_err(|error| ApiError::bad_request(format!("read image response: {error}")))?
        .to_vec())
}

async fn write_queue_file(app: &AppState, name: &str, bytes: &[u8]) -> ApiResult<PathBuf> {
    let dir = Path::new(&app.settings.uploads_dir).join("queue");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("create queue directory: {error}")))?;
    let path = dir.join(name);
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("write queue file: {error}")))?;
    Ok(path)
}

async fn load_task(
    app: &AppState,
    id: &str,
    kind: &str,
) -> ApiResult<abp_core::domain::TaskRecord> {
    let task = app
        .db
        .task_by_id(id)
        .await?
        .ok_or_else(|| tasks::not_found(kind))?;
    if task.kind != kind {
        return Err(tasks::not_found(kind));
    }
    Ok(task)
}

async fn update_task(
    app: &AppState,
    id: &str,
    status: &str,
    progress: i32,
    result: &Value,
    error: Option<&str>,
) -> ApiResult<()> {
    app.db
        .update_task(id, status, progress, Some(result), error, true)
        .await
        .map(|_| ())
        .map_err(Into::into)
}

fn progress(done: usize, total: usize) -> i32 {
    if total == 0 {
        100
    } else {
        ((done as f64 / total as f64) * 100.0).round() as i32
    }
}
