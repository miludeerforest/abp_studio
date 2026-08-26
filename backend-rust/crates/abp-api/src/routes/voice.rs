use crate::error::{ApiError, ApiResult};
use crate::extract::CurrentUser;
use crate::services::{config, multipart};
use crate::state::AppState;
use abp_ai::{extract_chat_text, ChatMessage, ChatRequest};
use axum::{
    extract::{Multipart, State},
    response::Json,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ScriptSegment {
    pub id: i32,
    #[serde(rename = "timeRange")]
    pub time_range: String,
    #[serde(rename = "targetContent")]
    pub target_content: String,
    pub chinese: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SynthesizeRequest {
    pub segments: Vec<ScriptSegment>,
    #[serde(default = "default_voice")]
    pub voice_name: String,
    #[serde(default = "default_language")]
    pub target_lang: String,
}
fn default_voice() -> String {
    "Kore".into()
}
fn default_language() -> String {
    "th-TH".into()
}

pub(crate) async fn analyze_video(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let video = form
        .file("video")
        .ok_or_else(|| ApiError::bad_request("video is required"))?;
    let target_lang = form.text_or("target_lang", "th-TH");
    let duration = form.text_or("video_duration", "0");
    let cfg = config::config_map(&app).await?;
    let api_url = cfg
        .get("voice_clone_api_url")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("api_url"))
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("API配置缺失，请在系统设置中配置API密钥"))?;
    let api_key = cfg
        .get("voice_clone_api_key")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("api_key"))
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("API配置缺失，请在系统设置中配置API密钥"))?;
    let model = cfg
        .get("voice_clone_analysis_model")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("analysis_model_name"))
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "gemini-3-pro-preview".into());
    let language = match target_lang.as_str() {
        "es-ES" => "Spanish",
        "en-US" => "English",
        "ja-JP" => "Japanese",
        "ko-KR" => "Korean",
        _ => "Thai",
    };
    let prompt = format!("Analyze this video ({duration}s) and create a safe, brand-masked voiceover script in {language} ({target_lang}) with Chinese translation. Return ONLY JSON with segments (id,timeRange,targetContent,chinese), flaggedWords, detectedSourceLanguage. Never repeat brand names or risky claims.");
    let request = ChatRequest {
        model,
        messages: vec![ChatMessage::user_parts(vec![
            json!({"type":"video_url","video_url":{"url":format!("data:{};base64,{}",video.content_type.as_deref().unwrap_or("video/mp4"),STANDARD.encode(&video.bytes))}}),
            json!({"type":"text","text":prompt}),
        ])],
        response_format: Some(json!({"type":"json_object"})),
        max_tokens: Some(4096),
        ..Default::default()
    };
    let value = app
        .ai
        .chat_json(&api_url, &api_key, &request, Duration::from_secs(180))
        .await
        .map_err(|error| ApiError::bad_request(format!("视频分析失败: {error}")))?;
    let text = extract_chat_text(&value).unwrap_or_else(|| value.to_string());
    let parsed =
        parse_json(&text).ok_or_else(|| ApiError::internal(anyhow::anyhow!("无法解析AI响应")))?;
    let mut segments: Vec<ScriptSegment> =
        serde_json::from_value(parsed.get("segments").cloned().unwrap_or_else(|| json!([])))
            .map_err(|error| {
                ApiError::internal(anyhow::anyhow!("parse voice segments: {error}"))
            })?;
    let flagged = parsed
        .get("flaggedWords")
        .cloned()
        .unwrap_or_else(|| json!([]));
    if let Some(words) = flagged.as_array() {
        for segment in &mut segments {
            for word in words {
                if word.get("category").and_then(Value::as_str) == Some("brand") {
                    if let Some(value) = word.get("word").and_then(Value::as_str) {
                        segment.target_content = segment.target_content.replace(value, "---");
                        segment.chinese = segment.chinese.replace(value, "某品牌");
                    }
                }
            }
        }
    }
    tracing::info!(username=%user.username, segments=segments.len(), "voice clone analysis completed");
    Ok(Json(
        json!({"segments":segments,"flaggedWords":flagged,"detectedSourceLanguage":parsed.get("detectedSourceLanguage")}),
    ))
}

pub(crate) async fn synthesize_speech(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<SynthesizeRequest>,
) -> ApiResult<Json<Value>> {
    let cfg = config::config_map(&app).await?;
    let api_url = cfg
        .get("voice_clone_api_url")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("api_url"))
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("API配置缺失，请在系统设置中配置API密钥"))?;
    let api_key = cfg
        .get("voice_clone_api_key")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("api_key"))
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("API配置缺失，请在系统设置中配置API密钥"))?;
    let model = cfg
        .get("voice_clone_tts_model")
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_default();
    let mut combined = Vec::new();
    let mut durations = Vec::new();
    for segment in &request.segments {
        let text = segment.target_content.trim();
        if text.is_empty() {
            durations.push(0.0);
            continue;
        }
        let chat = ChatRequest {
            model: model.clone(),
            messages: vec![ChatMessage::text("user", text)],
            modalities: Some(vec!["audio".into()]),
            audio: Some(json!({"voice":request.voice_name.to_lowercase(),"format":"pcm16"})),
            ..Default::default()
        };
        let value = app
            .ai
            .chat_json(&api_url, &api_key, &chat, Duration::from_secs(120))
            .await
            .map_err(|error| ApiError::bad_request(format!("语音合成失败: {error}")))?;
        let audio = find_audio(&value).unwrap_or_default();
        let bytes = STANDARD.decode(audio).unwrap_or_default();
        durations.push(bytes.len() as f64 / (24000.0 * 2.0));
        combined.extend(bytes);
    }
    tracing::info!(username=%user.username, segments=request.segments.len(), "voice synthesis completed");
    Ok(Json(
        json!({"audio_base64":STANDARD.encode(combined),"segment_durations":durations}),
    ))
}

fn find_audio(value: &Value) -> Option<String> {
    let message = value.get("choices")?.as_array()?.first()?.get("message")?;
    message
        .get("audio")
        .and_then(|v| v.get("data"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            message
                .get("audio_content")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            message
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| {
                    parts
                        .iter()
                        .find_map(|part| {
                            part.get("inlineData")
                                .and_then(|v| v.get("data"))
                                .and_then(Value::as_str)
                                .or_else(|| {
                                    part.get("audio")
                                        .and_then(|v| v.get("data"))
                                        .and_then(Value::as_str)
                                })
                        })
                        .map(str::to_string)
                })
        })
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
