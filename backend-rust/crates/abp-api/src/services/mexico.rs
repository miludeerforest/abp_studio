use crate::error::{ApiError, ApiResult};
use crate::services::{config, generation};
use crate::state::AppState;
use abp_ai::{extract_chat_text, ChatMessage, ChatRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagePromptItem {
    pub id: i32,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    #[serde(rename = "promptText")]
    pub prompt_text: String,
    pub rationale: String,
    #[serde(rename = "review_status", default)]
    pub review_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefinePromptRequest {
    pub original_prompt: ImagePromptItem,
    pub feedback: String,
    pub product_title: Option<String>,
    pub product_description: Option<String>,
    pub feedback_images: Option<Vec<String>>,
}

pub async fn text_module(
    app: &AppState,
    module: &str,
    user_text: &str,
    image: Option<&[u8]>,
) -> ApiResult<String> {
    let cfg = config::config_map(app).await?;
    let api_url = required(&cfg, "api_url")?;
    let api_key = required(&cfg, "api_key")?;
    let model = cfg
        .get("analysis_model_name")
        .cloned()
        .unwrap_or_else(|| "gemini-3-pro-preview".into());
    let system = prompt(module);
    let mut content = vec![json!({"type":"text","text":user_text})];
    if let Some(image) = image {
        let b64 = abp_ai::encode_base64(image);
        content.push(
            json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{b64}")}}),
        );
    }
    let request = ChatRequest {
        model,
        messages: vec![
            ChatMessage::text("system", system),
            ChatMessage::user_parts(content),
        ],
        temperature: Some(0.7),
        max_tokens: Some(4096),
        ..Default::default()
    };
    let response = app
        .ai
        .chat_json(&api_url, &api_key, &request, Duration::from_secs(180))
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    extract_chat_text(&response).ok_or_else(|| {
        ApiError::internal(anyhow::anyhow!(
            "Mexico Beauty provider returned empty text"
        ))
    })
}

pub async fn image_prompts(
    app: &AppState,
    title: &str,
    keywords: &str,
    description: &str,
    aspect_ratio: &str,
    target_language: &str,
    image: &[u8],
) -> ApiResult<Vec<ImagePromptItem>> {
    let region = match target_language {
        "th-TH" => "Thailand / Thai",
        "zh-CN" => "China / Simplified Chinese",
        "en-US" => "United States / American English",
        "id-ID" => "Indonesia / Indonesian",
        "vi-VN" => "Vietnam / Vietnamese",
        _ => "Mexico / Mexican Spanish",
    };
    let text = format!("Product Title: {title}\nKeywords: {keywords}\nDescription: {description}\nTarget market/language: {region}\nAspect ratio: {aspect_ratio}\nReturn ONLY a JSON array of exactly 10 objects with id, type, title, promptText, rationale. Preserve exact product identity and keep the same lighting/palette across the set.");
    let raw = text_module_with_prompt(app, "image_prompts", &text, Some(image)).await?;
    let value = parse_json(&raw)
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("failed to parse image prompts JSON")))?;
    let array = value
        .as_array()
        .cloned()
        .or_else(|| value.get("prompts").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let mut result = Vec::new();
    for (index, item) in array.into_iter().take(10).enumerate() {
        result.push(ImagePromptItem {
            id: item
                .get("id")
                .and_then(Value::as_i64)
                .unwrap_or(index as i64 + 1) as i32,
            kind: item
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or(if index < 2 {
                    "Main Image"
                } else {
                    "Detail/Scenario"
                })
                .into(),
            title: item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(&format!("Prompt {}", index + 1))
                .into(),
            prompt_text: wrap_prompt(
                title,
                keywords,
                description,
                item.get("promptText").and_then(Value::as_str).unwrap_or(""),
            ),
            rationale: item
                .get("rationale")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into(),
            review_status: None,
        });
    }
    if result.is_empty() {
        result.push(ImagePromptItem {
            id: 1,
            kind: "Main Image".into(),
            title: "Product showcase".into(),
            prompt_text: wrap_prompt(
                title,
                keywords,
                description,
                "Generate a premium commercial product scene.",
            ),
            rationale: "Fallback prompt".into(),
            review_status: None,
        });
    }
    Ok(result)
}

pub async fn refine_prompt(
    app: &AppState,
    request: &RefinePromptRequest,
) -> ApiResult<ImagePromptItem> {
    let user = format!("Product title: {}\nProduct description: {}\nCurrent prompt: {}\nFeedback: {}\nReturn ONLY JSON with id,type,title,promptText,rationale. Keep product identity and style locks.", request.product_title.as_deref().unwrap_or(""), request.product_description.as_deref().unwrap_or(""), request.original_prompt.prompt_text, request.feedback);
    let raw = text_module(app, "refine_prompt", &user, None).await?;
    let value = parse_json(&raw).unwrap_or_else(|| json!({}));
    Ok(ImagePromptItem {
        id: value
            .get("id")
            .and_then(Value::as_i64)
            .unwrap_or(request.original_prompt.id as i64) as i32,
        kind: value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or(&request.original_prompt.kind)
            .into(),
        title: value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(&request.original_prompt.title)
            .into(),
        prompt_text: wrap_prompt(
            request.product_title.as_deref().unwrap_or(""),
            "",
            request.product_description.as_deref().unwrap_or(""),
            value
                .get("promptText")
                .and_then(Value::as_str)
                .unwrap_or(&request.original_prompt.prompt_text),
        ),
        rationale: value
            .get("rationale")
            .and_then(Value::as_str)
            .unwrap_or("Refined based on user feedback")
            .into(),
        review_status: None,
    })
}

pub async fn generate_image(
    app: &AppState,
    user: &abp_core::domain::User,
    prompt_text: &str,
    aspect_ratio: &str,
    reference_image: &[u8],
) -> ApiResult<Value> {
    let cfg = config::config_map(app).await?;
    let api_url = required(&cfg, "api_url")?;
    let api_key = required(&cfg, "api_key")?;
    let model = cfg
        .get("model_name")
        .map(String::as_str)
        .unwrap_or("gemini-3-pro-image-preview");
    let final_prompt = format!("{prompt_text}\n\nFINAL RENDER INSTRUCTIONS: Preserve exact product identity, output strict {aspect_ratio}, no unwanted brands or watermarks.");
    let image = abp_ai::encode_base64(reference_image);
    let result = generation::generate_image(
        app,
        &[image],
        &final_prompt,
        "Generated",
        aspect_ratio,
        &api_url,
        &api_key,
        model,
    )
    .await;
    if let Some(error) = result.error {
        return Err(ApiError::bad_request(error));
    }
    let image_url = if let Some(value) = result.image_base64.clone() {
        format!("data:image/png;base64,{value}")
    } else {
        result.image_url.clone().unwrap_or_default()
    };
    let saved_url =
        generation::save_image_result(app, user, &result, "mexico_product", "mexico_product")
            .await?;
    Ok(json!({"image_url":image_url,"saved_url":saved_url}))
}

pub async fn sync_feishu(app: &AppState, module: &str, results: &[Value]) -> ApiResult<Value> {
    let cfg = config::config_map(app).await?;
    let app_id = required(&cfg, "feishu_app_id")?;
    let app_secret = required(&cfg, "feishu_app_secret")?;
    let app_token = required(&cfg, "feishu_app_token")?;
    let table_id = required(&cfg, "feishu_table_id")?;
    let token = app
        .ai
        .feishu_tenant_token(&app_id, &app_secret, Duration::from_secs(30))
        .await
        .map_err(|error| ApiError::bad_request(format!("飞书Token获取失败: {error}")))?;
    let records: Vec<Value> = results.iter().map(|item| json!({"fields":{"模块":module,"输入":item.get("input").cloned().unwrap_or_default(),"输出":item.get("output").or_else(||item.get("result")).cloned().unwrap_or_default(),"同步时间":chrono::Utc::now().timestamp_millis()}})).collect();
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
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let success = response.get("code").and_then(Value::as_i64).unwrap_or(-1) == 0;
    Ok(
        json!({"success":success,"synced_count":if success {records.len()} else {0},"failed_count":if success {0} else {records.len()},"message":if success {format!("成功同步 {} 条记录",records.len())} else {"飞书同步失败".to_string()}}),
    )
}

async fn text_module_with_prompt(
    app: &AppState,
    module: &str,
    user_text: &str,
    image: Option<&[u8]>,
) -> ApiResult<String> {
    let cfg = config::config_map(app).await?;
    let api_url = required(&cfg, "api_url")?;
    let api_key = required(&cfg, "api_key")?;
    let model = cfg
        .get("analysis_model_name")
        .cloned()
        .unwrap_or_else(|| "gemini-3-pro-preview".into());
    let mut content = vec![json!({"type":"text","text":user_text})];
    if let Some(image) = image {
        content.push(json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{}",abp_ai::encode_base64(image))}}));
    }
    let request = ChatRequest {
        model,
        messages: vec![
            ChatMessage::text("system", prompt(module)),
            ChatMessage::user_parts(content),
        ],
        temperature: Some(0.25),
        max_tokens: Some(8192),
        response_format: Some(json!({"type":"json_object"})),
        ..Default::default()
    };
    let value = app
        .ai
        .chat_json(&api_url, &api_key, &request, Duration::from_secs(180))
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    extract_chat_text(&value)
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("provider returned empty response")))
}

fn prompt(module: &str) -> &'static str {
    match module {
        "keyword" => include_str!("../../../../prompts/mexico_beauty_keyword.txt"),
        "title" => include_str!("../../../../prompts/mexico_beauty_title.txt"),
        "image" => include_str!("../../../../prompts/mexico_beauty_image.txt"),
        "description" => include_str!("../../../../prompts/mexico_beauty_description.txt"),
        "image_prompts" => include_str!("../../../../prompts/mexico_beauty_image_prompts.txt"),
        "refine_prompt" => include_str!("../../../../prompts/mexico_beauty_refine_prompt.txt"),
        _ => "You are a safe e-commerce creative assistant. Return concise useful output.",
    }
}

fn required(configs: &std::collections::HashMap<String, String>, key: &str) -> ApiResult<String> {
    configs
        .get(key)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request(format!("{key} is not configured")))
}
fn parse_json(text: &str) -> Option<Value> {
    let clean = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(clean).ok().or_else(|| {
        let start = clean.find(['[', '{'])?;
        let end = clean.rfind(['}', ']'])?;
        serde_json::from_str(&clean[start..=end]).ok()
    })
}
fn wrap_prompt(title: &str, keywords: &str, description: &str, body: &str) -> String {
    format!("[PRODUCT DNA ANCHOR]\nTitle: {title}\nKeywords: {keywords}\nDescription: {description}\n\n[STYLE LOCK]\nPhotorealistic commercial product photography, stable lighting and palette, product-first composition.\n\n[ANTI-DRIFT CONSTRAINTS]\nPreserve exact silhouette, proportions, materials, logo/label placement and key details.\n\n[TASK PROMPT]\n{body}\n\n[SET CONSISTENCY]\nKeep identical product identity and visual language across the full set.")
}
