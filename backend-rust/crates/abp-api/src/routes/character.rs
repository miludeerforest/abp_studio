use crate::error::{ApiError, ApiResult};
use crate::extract::CurrentUser;
use crate::services::config;
use crate::state::AppState;
use abp_ai::{ChatMessage, ChatRequest};
use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub(crate) struct CharacterVideoRequest {
    pub video_base64: String,
    #[serde(default)]
    pub prompt: String,
}

pub(crate) async fn generate(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<CharacterVideoRequest>,
) -> ApiResult<Response> {
    let cfg = config::config_map(&app).await?;
    let api_url = cfg
        .get("video_api_url")
        .cloned()
        .or_else(|| std::env::var("VIDEO_API_URL").ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("Video API not configured"))?;
    let api_key = cfg
        .get("video_api_key")
        .cloned()
        .or_else(|| std::env::var("VIDEO_API_KEY").ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("Video API not configured"))?;
    let model = cfg
        .get("video_model_name")
        .cloned()
        .unwrap_or_else(|| "sora2-portrait-15s".into());
    let mut parts = vec![json!({"type":"video_url","video_url":{"url":request.video_base64}})];
    if !request.prompt.trim().is_empty() {
        parts.push(json!({"type":"text","text":request.prompt}));
    }
    let chat = ChatRequest {
        model,
        messages: vec![ChatMessage::user_parts(parts)],
        stream: Some(true),
        ..Default::default()
    };
    let target_url = if api_url.ends_with("/chat/completions") {
        api_url
    } else {
        format!("{}/chat/completions", api_url.trim_end_matches('/'))
    };
    let upstream = app
        .http
        .post(target_url)
        .timeout(std::time::Duration::from_secs(900))
        .bearer_auth(api_key)
        .json(&chat)
        .send()
        .await
        .map_err(|error| ApiError::bad_request(format!("API Error: {error}")))?;
    let body = if upstream.status().is_success() {
        Body::from_stream(upstream.bytes_stream())
    } else {
        let status = upstream.status().as_u16();
        let detail = upstream.text().await.unwrap_or_default();
        Body::from(format!(
            "data: {}\n\n",
            json!({"error":format!("API Error: {status}"),"detail":detail})
        ))
    };
    let mut response = body.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-cache"));
    response
        .headers_mut()
        .insert("connection", HeaderValue::from_static("keep-alive"));
    response
        .headers_mut()
        .insert("x-accel-buffering", HeaderValue::from_static("no"));
    Ok(response)
}
