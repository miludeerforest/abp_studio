use crate::error::{ApiError, ApiResult};
use crate::extract::CurrentUser;
use crate::services::{config, excel};
use crate::state::AppState;
use abp_ai::{extract_chat_text, ChatMessage, ChatRequest};
use axum::{
    extract::{Path, State},
    http::{header, HeaderValue},
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub(crate) struct KeywordAnalyzeRequest {
    pub title: String,
    pub prompt: Option<String>,
}
#[derive(Debug, Deserialize)]
pub(crate) struct KeywordHistorySaveRequest {
    pub titles: Vec<Value>,
}
#[derive(Debug, Deserialize)]
pub(crate) struct FeishuSyncRequest {
    pub titles: Vec<Value>,
}

pub(crate) async fn analyze_single(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<KeywordAnalyzeRequest>,
) -> ApiResult<Json<Value>> {
    let system = "You are a professional e-commerce title analyst. Return ONLY valid JSON: {\"translation\":\"中文翻译\",\"keywords\":\"Keyword1, Keyword2, Keyword3, Keyword4\"}. Translate the title to fluent Chinese and extract four root keywords in the original language.";
    let user = format!(
        "Analyze this product title:\n\n{}\n{}",
        request.title,
        request.prompt.unwrap_or_default()
    );
    let text = call_text(&app, "analysis_model_name", system, &user, Vec::new()).await?;
    let value = parse_json(&text).unwrap_or_else(
        || json!({"translation":text.chars().take(200).collect::<String>(),"keywords":""}),
    );
    let translation = value
        .get("translation")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let keywords = value
        .get("keywords")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(Json(json!({"translation":translation,"keywords":keywords})))
}

pub(crate) async fn save_history(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<KeywordHistorySaveRequest>,
) -> ApiResult<Json<Value>> {
    let record = json!({"created_at":chrono::Utc::now().to_rfc3339(),"count":request.titles.len(),"titles":request.titles});
    app.db.save_keyword_history(user.id, &record).await?;
    Ok(Json(json!({"success":true})))
}

pub(crate) async fn get_history(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        json!({"records":app.db.keyword_history(user.id, 50).await?}),
    ))
}

pub(crate) async fn delete_history(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(index): Path<i64>,
) -> ApiResult<Json<Value>> {
    if !app.db.delete_keyword_history(user.id, index).await? {
        return Err(ApiError::not_found("History record not found"));
    }
    Ok(Json(json!({"success":true})))
}

pub(crate) async fn clear_history(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<Json<Value>> {
    app.db.clear_keyword_history(user.id).await?;
    Ok(Json(json!({"success":true})))
}

pub(crate) async fn export_excel(
    CurrentUser(_user): CurrentUser,
    Json(request): Json<KeywordHistorySaveRequest>,
) -> ApiResult<Response> {
    let bytes = excel::keyword_workbook(&request.titles)?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let disposition = format!("attachment; filename=keywords_{timestamp}.xlsx; filename*=UTF-8''%E6%A0%B8%E5%BF%83%E8%AF%8D%E6%8F%90%E5%8F%96_{timestamp}.xlsx");
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)
            .map_err(|error| ApiError::internal(anyhow::anyhow!("content disposition: {error}")))?,
    );
    Ok(response)
}

pub(crate) async fn sync_feishu(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<FeishuSyncRequest>,
) -> ApiResult<Json<Value>> {
    let cfg = config::config_map(&app).await?;
    let app_id = required(&cfg, "feishu_app_id")?;
    let app_secret = required(&cfg, "feishu_app_secret")?;
    let app_token = required(&cfg, "feishu_app_token")?;
    let table_id = required(&cfg, "feishu_table_id")?;
    let token = app
        .ai
        .feishu_tenant_token(&app_id, &app_secret, Duration::from_secs(30))
        .await
        .map_err(|error| ApiError::bad_request(format!("飞书认证失败: {error}")))?;
    let records: Vec<Value> = request.titles.iter().filter(|item| item.get("status").and_then(Value::as_str).map(|v| v == "completed").unwrap_or(true)).map(|item| json!({"fields":{"标题":item.get("original").cloned().unwrap_or_default(),"中文翻译":item.get("translation").cloned().unwrap_or_default(),"核心大词":item.get("keywords").cloned().unwrap_or_default(),"同步时间":chrono::Utc::now().timestamp_millis()}})).collect();
    if records.is_empty() {
        return Err(ApiError::bad_request("没有已完成的记录可以同步"));
    }
    let response = app
        .ai
        .feishu_batch_create(
            &app_token,
            &table_id,
            &token,
            Value::Array(records.clone()),
            Duration::from_secs(60),
        )
        .await
        .map_err(|error| ApiError::bad_request(format!("飞书同步失败: {error}")))?;
    if response.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        return Err(ApiError::bad_request(format!(
            "飞书同步失败: {}",
            response.get("msg").cloned().unwrap_or_default()
        )));
    }
    Ok(Json(
        json!({"success":true,"synced_count":records.len(),"message":format!("成功同步 {} 条记录到飞书多维表格",records.len())}),
    ))
}

async fn call_text(
    app: &AppState,
    model_key: &str,
    system: &str,
    user_text: &str,
    images: Vec<String>,
) -> ApiResult<String> {
    let cfg = config::config_map(app).await?;
    let api_url = required(&cfg, "api_url")?;
    let api_key = required(&cfg, "api_key")?;
    let model = cfg
        .get(model_key)
        .cloned()
        .unwrap_or_else(|| "gemini-3-pro-preview".into());
    let mut parts = vec![json!({"type":"text","text":user_text})];
    parts.extend(images.into_iter().map(|image| json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{image}")}})));
    let request = ChatRequest {
        model,
        messages: vec![
            ChatMessage::text("system", system),
            ChatMessage::user_parts(parts),
        ],
        temperature: Some(0.3),
        max_tokens: Some(2048),
        ..Default::default()
    };
    let value = app
        .ai
        .chat_json(&api_url, &api_key, &request, Duration::from_secs(90))
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    extract_chat_text(&value)
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("provider returned empty text")))
}

fn required(configs: &std::collections::HashMap<String, String>, key: &str) -> ApiResult<String> {
    configs
        .get(key)
        .cloned()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request(format!("{key} is not configured")))
}
fn parse_json(text: &str) -> Option<Value> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(cleaned).ok().or_else(|| {
        let start = cleaned.find('{')?;
        let end = cleaned.rfind('}')?;
        serde_json::from_str(&cleaned[start..=end]).ok()
    })
}
