use crate::error::{ApiError, ApiResult};
use crate::services::{config, media};
use crate::state::AppState;
use abp_ai::{extract_chat_text, ChatMessage, ChatRequest};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

const REVIEW_PROMPT: &str = r#"请使用简体中文评估这些视频关键帧的电商质量。每项 1-10 分，返回 ONLY JSON：
{"ai_score":1,"consistency_score":1,"physics_score":1,"ecommerce_score":1,"hook_score":1,"platform_risk":1,"overall_score":1,"recommendation":"pass|warning|reject","summary":"中文总结","issues":["中文问题"],"strengths":["中文优点"]}
电商钩子（皮肤问题前后对比等）不应被误判为违规，真正的暴力、血腥、色情和危险内容才降低平台安全分。"#;

pub async fn review_video(app: &AppState, video_id: &str) -> ApiResult<()> {
    let cfg = config::config_map(app).await?;
    if !cfg
        .get("review_enabled")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return Ok(());
    }
    let api_url = cfg
        .get("review_api_url")
        .cloned()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| ApiError::bad_request("Review API not configured"))?;
    let api_key = cfg
        .get("review_api_key")
        .cloned()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| ApiError::bad_request("Review API not configured"))?;
    let model = cfg
        .get("review_model_name")
        .cloned()
        .unwrap_or_else(|| "gpt-4o".into());
    let item = app
        .db
        .video_by_id(video_id)
        .await?
        .ok_or_else(|| ApiError::not_found("video not found"))?;
    let result_url = item
        .result_url
        .clone()
        .ok_or_else(|| ApiError::bad_request("video has no result"))?;
    let path = media::uploads_path(app, &result_url);
    let frames = extract_frames(app, &path).await?;
    if frames.is_empty() {
        return Err(ApiError::bad_request("无法从视频提取帧"));
    }
    app.db
        .update_review(video_id, "processing", None, None)
        .await?;
    let mut content = vec![
        json!({"type":"text","text":format!("视频生成提示词：{}\n\n{}",item.prompt.unwrap_or_default(),REVIEW_PROMPT)}),
    ];
    content.extend(frames.into_iter().map(|frame|json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{frame}")}})));
    let request = ChatRequest {
        model,
        messages: vec![ChatMessage::user_parts(content)],
        temperature: Some(0.3),
        max_tokens: Some(2000),
        response_format: Some(json!({"type":"json_object"})),
        ..Default::default()
    };
    let value = app
        .ai
        .chat_json(&api_url, &api_key, &request, Duration::from_secs(180))
        .await
        .map_err(|error| ApiError::bad_request(format!("审查API请求失败: {error}")))?;
    let text = extract_chat_text(&value).unwrap_or_else(|| value.to_string());
    let review = parse_json(&text)
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("审查响应 JSON 无法解析")))?;
    let score = review
        .get("overall_score")
        .and_then(Value::as_i64)
        .map(|value| value.clamp(1, 10) as i32);
    let recommendation = review
        .get("recommendation")
        .and_then(Value::as_str)
        .unwrap_or("warning");
    app.db
        .update_review(video_id, "done", score, Some(&review.to_string()))
        .await?;
    if let (Some(user_id), Some(score)) = (item.user_id, score) {
        let change = abp_core::domain::exp_change_for_review_score(score);
        let _ = app
            .db
            .grant_experience(user_id, change, Some(video_id), Some(score))
            .await;
    }
    tracing::info!(video_id, ?score, recommendation, "video review completed");
    Ok(())
}

async fn extract_frames(app: &AppState, path: &Path) -> ApiResult<Vec<String>> {
    let directory = Path::new(&app.settings.uploads_dir).join("review_frames");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("create review frame dir: {error}")))?;
    let prefix = directory.join(format!("frame_{}", uuid::Uuid::new_v4().simple()));
    let pattern = format!("{}_%03d.jpg", prefix.to_string_lossy());
    let args = vec![
        "-y".into(),
        "-i".into(),
        path.to_string_lossy().into_owned(),
        "-vf".into(),
        "fps=1/2".into(),
        "-frames:v".into(),
        "8".into(),
        "-q:v".into(),
        "2".into(),
        pattern,
    ];
    media::run_ffmpeg(&args).await?;
    let mut frames = Vec::new();
    for index in 1..=8 {
        let frame = format!("{}_{index:03}.jpg", prefix.to_string_lossy());
        if let Ok(bytes) = tokio::fs::read(&frame).await {
            frames.push(abp_ai::encode_base64(&bytes));
            let _ = tokio::fs::remove_file(frame).await;
        }
    }
    Ok(frames)
}
fn parse_json(text: &str) -> Option<Value> {
    let clean = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(clean).ok().or_else(|| {
        let s = clean.find('{')?;
        let e = clean.rfind('}')?;
        serde_json::from_str(&clean[s..=e]).ok()
    })
}
