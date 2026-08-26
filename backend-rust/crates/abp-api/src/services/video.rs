use crate::error::{ApiError, ApiResult, AppError};
use crate::services::{config, media};
use crate::state::AppState;
use abp_ai::{extract_media, ChatMessage, ChatRequest, ProviderError};
use abp_core::domain::VideoQueueItem;
use serde_json::json;
use std::path::Path;
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;

#[derive(Debug, Error)]
enum VideoGenerationError {
    #[error(transparent)]
    Core(#[from] abp_core::ApiError),
    #[error(transparent)]
    App(#[from] AppError),
    #[error(transparent)]
    Provider(#[from] ProviderError),
}

impl VideoGenerationError {
    fn retryable(&self) -> bool {
        match self {
            Self::Provider(error) => error.retryable() && !error.is_timeout(),
            Self::Core(_) | Self::App(_) => false,
        }
    }

    fn into_app_error(self) -> AppError {
        match self {
            Self::Core(error) => error.into(),
            Self::App(error) => error,
            Self::Provider(error) => ApiError::bad_request(error.to_string()),
        }
    }
}
pub async fn generate_with_retry(app: AppState, item_id: String) -> ApiResult<()> {
    let limiter = app.redis.as_ref().map(|redis| redis.concurrency_limiter());
    if let Some(limiter) = &limiter {
        let configs = config::config_map(&app).await?;
        let limit = configs
            .get("max_concurrent_video")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(3);
        let started = tokio::time::Instant::now();
        loop {
            if limiter.acquire_global("video_gen", limit, 30).await? {
                break;
            }
            if started.elapsed() >= Duration::from_secs(600) {
                app.db
                    .update_video_status(&item_id, "pending", None, Some("队列繁忙，等待重试"))
                    .await?;
                return Err(ApiError::conflict("视频生成队列繁忙，请稍后重试"));
            }
            sleep(Duration::from_secs(5)).await;
        }
    }

    let result = run_generation_attempts(&app, &item_id).await;
    if let Some(limiter) = limiter {
        if let Err(error) = limiter.release_global("video_gen").await {
            tracing::warn!(item_id, error = %error, "release video concurrency slot failed");
        }
    }
    result
}

async fn run_generation_attempts(app: &AppState, item_id: &str) -> ApiResult<()> {
    let item = app
        .db
        .video_by_id(item_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Item not found"))?;
    let user_id = item.user_id;
    let retry_count = item.retry_count;
    let max_attempts = 3;
    if retry_count >= max_attempts {
        let message = format!("重试次数已达上限 ({max_attempts}次)");
        app.db.fail_video(item_id, &message).await?;
        return Err(ApiError::bad_request(message));
    }
    if retry_count > 0 {
        if let Some(last_retry_at) = item.last_retry_at {
            let elapsed = (chrono::Local::now().naive_local() - last_retry_at).num_seconds();
            if elapsed < 120 {
                app.db
                    .update_video_status(item_id, "pending", None, None)
                    .await?;
                return Ok(());
            }
        }
    }
    for attempt in (retry_count + 1)..=max_attempts {
        app.db.increment_video_retry(item_id).await?;
        match generate_once(app, item_id).await {
            Ok(()) => {
                app.db.reset_video_retry(item_id).await?;
                return Ok(());
            }
            Err(error) if attempt < max_attempts && error.retryable() => {
                let delay = if attempt == 1 { 60 } else { 90 };
                tracing::warn!(
                    item_id,
                    attempt,
                    error = %error,
                    retry_in_seconds = delay,
                    "video generation attempt failed; retrying"
                );
                sleep(Duration::from_secs(delay)).await;
            }
            Err(error) => {
                let message = error.to_string();
                app.db.fail_video(item_id, &message).await?;
                publish_event(
                    app,
                    "video_failed",
                    json!({"video_id": item_id, "user_id": user_id, "error": message}),
                )
                .await;
                return Err(error.into_app_error());
            }
        }
    }
    unreachable!("video retry loop always returns")
}

async fn generate_once(app: &AppState, item_id: &str) -> Result<(), VideoGenerationError> {
    let item = app
        .db
        .video_by_id(item_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Item not found"))?;
    app.db
        .update_video_status(item_id, "processing", None, None)
        .await?;
    publish_event(
        app,
        "video_processing",
        json!({"video_id": item_id, "user_id": item.user_id}),
    )
    .await;
    let configs = config::config_map(app).await?;
    let api_url = configs
        .get("video_api_url")
        .cloned()
        .or_else(|| std::env::var("VIDEO_API_URL").ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("Missing Video API Config"))?;
    let api_key = configs
        .get("video_api_key")
        .cloned()
        .or_else(|| std::env::var("VIDEO_API_KEY").ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("Missing Video API Config"))?;
    let model = configs
        .get("video_model_name")
        .cloned()
        .or_else(|| std::env::var("VIDEO_MODEL_NAME").ok())
        .unwrap_or_else(|| "sora-video-portrait".into());
    let input_path = item
        .file_path
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("Source file not found"))?;
    let bytes = tokio::fs::read(input_path)
        .await
        .map_err(|error| ApiError::bad_request(format!("Source file not found: {error}")))?;
    let image_b64 = abp_ai::encode_base64(&bytes);
    let prompt =
        abp_ai::prompt::optimize_for_model(&item.prompt.clone().unwrap_or_default(), &model);
    let request = ChatRequest {
        model,
        messages: vec![ChatMessage::user_parts(vec![
            json!({"type":"text","text":format!("Generate a video based on this image: {prompt}")}),
            json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{image_b64}")}}),
        ])],
        stream: Some(true),
        ..Default::default()
    };
    let text = app
        .ai
        .chat_stream_text_once(&api_url, &api_key, &request, Duration::from_secs(900))
        .await?;
    let output = extract_media(&text);
    let result_url = if let Some(url) = output.media_url {
        download_video(app, item_id, &url).await?.unwrap_or(url)
    } else if let Some(base64) = output.image_base64 {
        let bytes = abp_ai::decode_data_or_base64(&base64)
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        let filename = format!("video_{item_id}.mp4");
        let path = Path::new(&app.settings.uploads_dir)
            .join("queue")
            .join(&filename);
        tokio::fs::write(&path, bytes).await.map_err(|error| {
            ApiError::internal(anyhow::anyhow!("save generated video: {error}"))
        })?;
        format!("/uploads/queue/{filename}")
    } else {
        return Err(
            ApiError::bad_request(format!("视频生成失败：{}", detect_api_error_cn(&text))).into(),
        );
    };
    let local_path = result_url
        .starts_with("/uploads/")
        .then(|| media::uploads_path(app, &result_url));
    let preview_name = format!("video_{item_id}_thumb.jpg");
    let preview_url = match &local_path {
        Some(path) => media::thumbnail(app, path, &preview_name).await?,
        None => None,
    };
    app.db
        .set_video_result(
            item_id,
            "done",
            Some(&result_url),
            None,
            preview_url.as_deref(),
        )
        .await?;
    if let Some(review_path) = local_path {
        let review_app = app.clone();
        let review_id = item_id.to_string();
        tokio::spawn(async move {
            if let Err(error) = crate::services::review::review_video(&review_app, &review_id).await
            {
                tracing::warn!(video_id = %review_id, path = %review_path.display(), error = %error, "video review failed");
            }
        });
    }
    publish_event(
        app,
        "video_completed",
        json!({"video_id":item_id,"user_id":item.user_id,"result_url":result_url}),
    )
    .await;
    if let Some(user_id) = item.user_id {
        let _ = app
            .db
            .log_activity(
                user_id,
                "video_gen_complete",
                &format!("视频生成完成：{item_id}"),
            )
            .await;
    }
    Ok(())
}

async fn download_video(
    app: &AppState,
    item_id: &str,
    url: &str,
) -> Result<Option<String>, VideoGenerationError> {
    for attempt in 1..=3 {
        let response = app
            .http
            .get(url)
            .timeout(Duration::from_secs(300))
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                let bytes = response.bytes().await.map_err(|error| {
                    ApiError::bad_request(format!("read generated video: {error}"))
                })?;
                let filename = format!("video_{item_id}.mp4");
                let path = Path::new(&app.settings.uploads_dir)
                    .join("queue")
                    .join(&filename);
                tokio::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))
                    .await
                    .map_err(|error| {
                        ApiError::internal(anyhow::anyhow!("create video directory: {error}"))
                    })?;
                tokio::fs::write(&path, &bytes).await.map_err(|error| {
                    ApiError::internal(anyhow::anyhow!("save generated video: {error}"))
                })?;
                return Ok(Some(format!("/uploads/queue/{filename}")));
            }
            Ok(response) => tracing::warn!(
                item_id,
                attempt,
                status = %response.status(),
                "generated video download returned non-success status"
            ),
            Err(error) => tracing::warn!(
                item_id,
                attempt,
                error = %error,
                "generated video download failed"
            ),
        }
        if attempt < 3 {
            sleep(Duration::from_secs(2)).await;
        }
    }
    tracing::warn!(
        item_id,
        url,
        "keeping remote generated video URL after download retries"
    );
    Ok(None)
}

pub async fn recover_zombies(app: &AppState) -> ApiResult<u64> {
    let cutoff = chrono::Local::now().naive_local() - chrono::Duration::minutes(5);
    Ok(app.db.recover_stale_video_items(cutoff).await?)
}

pub async fn cleanup_expired(app: &AppState) -> ApiResult<u64> {
    let configs = config::config_map(app).await?;
    let days = configs
        .get("cache_retention_days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7);
    if days <= 0 {
        return Ok(0);
    }
    Ok(app
        .db
        .cleanup_video_items(chrono::Local::now().naive_local() - chrono::Duration::days(days))
        .await?)
}

fn detect_api_error_cn(content: &str) -> String {
    let lower = content.to_ascii_lowercase();
    if ["content policy", "policy violation", "nsfw", "safety"]
        .iter()
        .any(|key| lower.contains(key))
    {
        return "内容审核未通过：请更换图片或提示词后重试".into();
    }
    if ["rate limit", "too many requests", "quota", "429"]
        .iter()
        .any(|key| lower.contains(key))
    {
        return "API请求频率超限，稍后将自动重试".into();
    }
    if ["timeout", "timed out", "524"]
        .iter()
        .any(|key| lower.contains(key))
    {
        return "视频生成服务处理超时".into();
    }
    format!(
        "视频生成服务返回错误：{}",
        content.chars().take(120).collect::<String>()
    )
}

async fn publish_event(app: &AppState, event_type: &str, data: serde_json::Value) {
    let Some(redis) = &app.redis else { return };
    let message = serde_json::json!({
        "type": event_type,
        "data": data,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    if let Err(error) = redis.task_queue().publish_event(&message.to_string()).await {
        tracing::debug!(event_type, error = %error, "Redis event publish skipped");
    }
}

#[allow(dead_code)]
fn _keep_item_type(_: &VideoQueueItem) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_provider_errors_retry_but_timeouts_do_not() {
        let transient = VideoGenerationError::Provider(ProviderError::Http {
            status: 503,
            body: "busy".into(),
        });
        let timeout = VideoGenerationError::Provider(ProviderError::Http {
            status: 524,
            body: "timeout".into(),
        });
        assert!(transient.retryable());
        assert!(!timeout.retryable());
    }

    #[test]
    fn application_validation_errors_do_not_retry() {
        let error = VideoGenerationError::App(ApiError::bad_request("invalid input"));
        assert!(!error.retryable());
    }
}
