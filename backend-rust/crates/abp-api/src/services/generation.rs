use crate::error::{ApiError, ApiResult};
use crate::services::{config, media};
use crate::state::AppState;
use abp_ai::{extract_chat_text, extract_media, ChatMessage, ChatRequest, ImageGenerationRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptItem {
    pub angle_name: String,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeResponse {
    pub product_description: String,
    pub environment_analysis: String,
    pub placement_mode: String,
    pub scripts: Vec<ScriptItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryShot {
    pub shot: i32,
    pub prompt: String,
    pub duration: i32,
    pub description: String,
    #[serde(rename = "shotStory")]
    pub shot_story: String,
    #[serde(rename = "heroSubject")]
    pub hero_subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryAnalysisResponse {
    pub shots: Vec<StoryShot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageResult {
    pub angle_name: String,
    pub image_base64: Option<String>,
    pub image_url: Option<String>,
    pub video_prompt: Option<String>,
    pub error: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub async fn analyze_product(
    app: &AppState,
    product_bytes: &[u8],
    reference_bytes: &[u8],
    category: &str,
    product_name: Option<&str>,
    requested_count: usize,
    api_url: Option<&str>,
    api_key: Option<&str>,
    model: Option<&str>,
) -> ApiResult<AnalyzeResponse> {
    let cfg = config::config_map(app).await?;
    let api_url = api_url
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| cfg.get("api_url").cloned())
        .or_else(|| std::env::var("DEFAULT_API_URL").ok())
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let api_key = api_key
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| cfg.get("api_key").cloned())
        .or_else(|| std::env::var("DEFAULT_API_KEY").ok())
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let model = model
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| cfg.get("analysis_model_name").cloned())
        .unwrap_or_else(|| "gemini-3-pro-preview".to_string());
    let product = abp_ai::encode_base64(product_bytes);
    let reference = abp_ai::encode_base64(reference_bytes);
    let count = requested_count.clamp(1, 20);
    let identity = product_name.unwrap_or("the product shown in image 1");
    let prompt = format!(
        "Analyze the product in image 1 and the scene reference in image 2. Category: {category}. User product name: {identity}. Return ONLY JSON with product_description, environment_analysis, placement_mode, and scripts. scripts must contain exactly {count} objects with angle_name and script. Each script must be a specific commercial photography brief that preserves the product and replicates the reference environment."
    );
    let request = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage::text(
                "system",
                "You are a professional product photographer and prompt engineer. Preserve exact product identity and never invent labels or features.",
            ),
            ChatMessage::user_parts(vec![
                json!({"type":"text","text":prompt}),
                image_part(&product),
                image_part(&reference),
            ]),
        ],
        temperature: Some(0.4),
        max_tokens: Some(4096),
        response_format: Some(json!({"type":"json_object"})),
        ..Default::default()
    };
    let raw = app
        .ai
        .chat_json(&api_url, &api_key, &request, Duration::from_secs(300))
        .await
        .map_err(provider_error)?;
    let text = extract_chat_text(&raw).unwrap_or_else(|| raw.to_string());
    let mut parsed: AnalyzeResponse = parse_json_value(&text)?;
    normalize_scripts(&mut parsed.scripts, count);
    Ok(parsed)
}

#[allow(clippy::too_many_arguments)]
pub async fn story_analyze(
    app: &AppState,
    image_bytes: &[u8],
    topic: &str,
    category: &str,
    shot_count: usize,
    api_url: Option<&str>,
    api_key: Option<&str>,
    model: Option<&str>,
) -> ApiResult<StoryAnalysisResponse> {
    let (api_url, api_key, model) = resolve_analysis_config(app, api_url, api_key, model).await?;
    let b64 = abp_ai::encode_base64(image_bytes);
    let count = shot_count.clamp(1, 20);
    let prompt = format!(
        "Create a continuous safe product storyboard for topic '{topic}', category '{category}', with exactly {count} shots. Return ONLY a JSON array. Each item must have shot, prompt, duration (15), description, shotStory, heroSubject. Preserve the same hero product in every shot and include real environmental motion."
    );
    let request = ChatRequest {
        model,
        messages: vec![ChatMessage::text("system", "You are a cinematic storyboard director. Avoid unsafe content and real-person identity claims."), ChatMessage::user_parts(vec![json!({"type":"text","text":prompt}), image_part(&b64)])],
        max_tokens: Some(8192),
        ..Default::default()
    };
    let value = app
        .ai
        .chat_json(&api_url, &api_key, &request, Duration::from_secs(120))
        .await
        .map_err(provider_error)?;
    let text = extract_chat_text(&value).unwrap_or_else(|| value.to_string());
    let mut shots: Vec<StoryShot> = parse_json_value(&text)?;
    normalize_shots(&mut shots, count);
    Ok(StoryAnalysisResponse { shots })
}

pub async fn video_prompt(
    app: &AppState,
    image_bytes: &[u8],
    api_url: Option<&str>,
    api_key: Option<&str>,
    model: Option<&str>,
) -> ApiResult<String> {
    let (api_url, api_key, model) = resolve_analysis_config(app, api_url, api_key, model).await?;
    let b64 = abp_ai::encode_base64(image_bytes);
    let request = ChatRequest {
        model,
        messages: vec![ChatMessage::text("system", "You are a cinematic video director. Return one 60-80 word English prompt only, with a gentle camera movement and at least two real motion elements."), ChatMessage::user_parts(vec![json!({"type":"text","text":"Analyze this product image and write a cinematic video prompt."}), image_part(&b64)])],
        max_tokens: Some(300),
        ..Default::default()
    };
    app.ai
        .chat_text(&api_url, &api_key, &request, Duration::from_secs(90))
        .await
        .map_err(provider_error)
}

#[allow(clippy::too_many_arguments)]
pub async fn generate_image(
    app: &AppState,
    image_b64_list: &[String],
    prompt: &str,
    angle_name: &str,
    aspect_ratio: &str,
    api_url: &str,
    api_key: &str,
    model: &str,
) -> ImageResult {
    let result = async {
        let output = if model.to_ascii_lowercase().contains("imagen") {
            let request = ImageGenerationRequest {
                model: model.to_string(),
                prompt: prompt.to_string(),
                n: 1,
                size: size_for_ratio(aspect_ratio).to_string(),
            };
            app.ai.image_generate(api_url, api_key, &request, Duration::from_secs(300)).await.map_err(provider_error)?
        } else {
            let mut parts = vec![json!({"type":"text","text":prompt})];
            parts.extend(image_b64_list.iter().map(|image| image_part(image)));
            let request = ChatRequest {
                model: model.to_string(),
                messages: vec![ChatMessage::text("system", "Create a photorealistic commercial product image. Preserve every product detail and return only the generated image."), ChatMessage::user_parts(parts)],
                temperature: Some(0.3),
                max_tokens: Some(4096),
                stream: Some(true),
                ..Default::default()
            };
            let text = app.ai.chat_stream_text(api_url, api_key, &request, Duration::from_secs(600)).await.map_err(provider_error)?;
            extract_media(&text)
        };
        Ok::<ImageResult, crate::error::AppError>(ImageResult {
            angle_name: angle_name.to_string(),
            image_base64: output.image_base64,
            image_url: output.media_url,
            video_prompt: Some(prompt.to_string()),
            error: None,
        })
    }
    .await;
    result.unwrap_or_else(|error| ImageResult {
        angle_name: angle_name.to_string(),
        image_base64: None,
        image_url: None,
        video_prompt: Some(prompt.to_string()),
        error: Some(error.to_string()),
    })
}

pub async fn save_image_result(
    app: &AppState,
    user: &abp_core::domain::User,
    result: &ImageResult,
    category: &str,
    prefix: &str,
) -> ApiResult<Option<String>> {
    let bytes = media::decode_provider_media(
        app,
        result.image_base64.as_deref(),
        result.image_url.as_deref(),
    )
    .await?;
    let Some(bytes) = bytes else { return Ok(None) };
    let (url, _, _) = media::save_gallery_image(
        app,
        user,
        &bytes,
        result.video_prompt.as_deref().unwrap_or(&result.angle_name),
        category,
        prefix,
    )
    .await?;
    Ok(Some(url))
}

async fn resolve_analysis_config(
    app: &AppState,
    api_url: Option<&str>,
    api_key: Option<&str>,
    model: Option<&str>,
) -> ApiResult<(String, String, String)> {
    let cfg = config::config_map(app).await?;
    let url = api_url
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("api_url").map(String::as_str))
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let key = api_key
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("api_key").map(String::as_str))
        .ok_or_else(|| ApiError::bad_request("Missing API Configuration"))?;
    let model = model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| cfg.get("analysis_model_name").map(String::as_str))
        .unwrap_or("gemini-3-pro-preview");
    Ok((url.to_string(), key.to_string(), model.to_string()))
}

fn image_part(base64: &str) -> Value {
    json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{base64}")}})
}

fn size_for_ratio(aspect_ratio: &str) -> &'static str {
    match aspect_ratio {
        "9:16" => "768x1344",
        "16:9" => "1344x768",
        "4:5" => "896x1120",
        "3:4" => "896x1152",
        _ => "1024x1024",
    }
}

fn provider_error(error: abp_ai::ProviderError) -> ApiError {
    ApiError::bad_request(error.to_string())
}

fn parse_json_value<T: for<'de> Deserialize<'de>>(text: &str) -> ApiResult<T> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(cleaned).or_else(|_| {
        let start = cleaned
            .find(['{', '['])
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("AI response has no JSON")))?;
        let end = cleaned.rfind(['}', ']']).ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!("AI response has incomplete JSON"))
        })?;
        serde_json::from_str(&cleaned[start..=end])
            .map_err(|error| ApiError::internal(anyhow::anyhow!("parse AI JSON: {error}")))
    })
}

fn normalize_scripts(scripts: &mut Vec<ScriptItem>, count: usize) {
    if scripts.is_empty() {
        scripts.extend((0..count).map(|index| ScriptItem {
            angle_name: format!("Auto Generated {}", index + 1),
            script: "Professional product photography in a clean commercial scene.".into(),
        }));
    }
    let original = scripts.clone();
    for index in scripts.len()..count {
        let mut item = original[index % original.len()].clone();
        item.angle_name = format!("{} (Var {})", item.angle_name, index + 1);
        scripts.push(item);
    }
    scripts.truncate(count);
}

fn normalize_shots(shots: &mut Vec<StoryShot>, count: usize) {
    if shots.is_empty() {
        shots.extend((0..count).map(|index| StoryShot { shot: index as i32 + 1, prompt: "A fully visible product in a cinematic commercial scene with gentle environmental motion.".into(), duration: 15, description: format!("镜头 {}", index + 1), shot_story: "连续叙事镜头".into(), hero_subject: Some("the product shown in the reference image".into()) }));
    }
    let original = shots.clone();
    for index in shots.len()..count {
        let mut item = original[index % original.len()].clone();
        item.shot = index as i32 + 1;
        shots.push(item);
    }
    shots.truncate(count);
    for (index, shot) in shots.iter_mut().enumerate() {
        shot.shot = index as i32 + 1;
    }
}
