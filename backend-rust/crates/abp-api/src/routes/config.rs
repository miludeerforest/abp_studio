// Generated from the original route implementation; keep handlers thin as slices are migrated.
use super::*;

// ============================================================================
// 统计 / 配置
// ============================================================================

pub(crate) async fn stats(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
) -> ApiResult<Json<Value>> {
    Ok(Json(app.db.stats_snapshot().await?))
}

/// 配置键 → 环境变量回退表（与 Python `get_config` defaults 一致）。
const CONFIG_DEFAULTS: &[(&str, &str, &str)] = &[
    (
        "api_url",
        "DEFAULT_API_URL",
        "https://generativelanguage.googleapis.com",
    ),
    ("api_key", "DEFAULT_API_KEY", ""),
    (
        "model_name",
        "DEFAULT_MODEL_NAME",
        "gemini-3-pro-image-preview",
    ),
    ("video_api_url", "VIDEO_API_URL", ""),
    ("video_api_key", "VIDEO_API_KEY", ""),
    (
        "video_model_name",
        "VIDEO_MODEL_NAME",
        "sora-video-portrait",
    ),
    ("app_url", "APP_URL", "http://localhost:33012"),
    (
        "analysis_model_name",
        "DEFAULT_ANALYSIS_MODEL_NAME",
        "gemini-3-pro-preview",
    ),
    ("site_title", "SITE_TITLE", "Banana Product"),
    ("site_subtitle", "SITE_SUBTITLE", ""),
    ("cache_retention_days", "CACHE_RETENTION_DAYS", "7"),
    ("max_concurrent_image", "MAX_CONCURRENT_IMAGE", "5"),
    ("max_concurrent_video", "MAX_CONCURRENT_VIDEO", "3"),
    ("max_concurrent_story", "MAX_CONCURRENT_STORY", "2"),
    ("max_concurrent_per_user", "MAX_CONCURRENT_PER_USER", "2"),
    (
        "gemini_flash_api_url",
        "GEMINI_FLASH_API_URL",
        "https://generativelanguage.googleapis.com",
    ),
    ("gemini_flash_api_key", "GEMINI_FLASH_API_KEY", ""),
    (
        "gemini_flash_model_name",
        "GEMINI_FLASH_MODEL_NAME",
        "gemini-2.0-flash",
    ),
    (
        "gemini_tts_api_url",
        "GEMINI_TTS_API_URL",
        "https://generativelanguage.googleapis.com",
    ),
    ("gemini_tts_api_key", "GEMINI_TTS_API_KEY", ""),
    (
        "gemini_tts_model_name",
        "GEMINI_TTS_MODEL_NAME",
        "gemini-2.5-flash-preview-tts",
    ),
    ("review_api_url", "REVIEW_API_URL", ""),
    ("review_api_key", "REVIEW_API_KEY", ""),
    ("review_model_name", "REVIEW_MODEL_NAME", "gpt-4o"),
    ("review_enabled", "REVIEW_ENABLED", "false"),
    ("feishu_app_id", "FEISHU_APP_ID", ""),
    ("feishu_app_secret", "FEISHU_APP_SECRET", ""),
    ("feishu_app_token", "FEISHU_APP_TOKEN", ""),
    ("feishu_table_id", "FEISHU_TABLE_ID", ""),
    (
        "feishu_description_app_token",
        "FEISHU_DESCRIPTION_APP_TOKEN",
        "",
    ),
    (
        "feishu_description_table_id",
        "FEISHU_DESCRIPTION_TABLE_ID",
        "",
    ),
    ("content_review_enabled", "CONTENT_REVIEW_ENABLED", "false"),
    ("content_review_api_url", "CONTENT_REVIEW_API_URL", ""),
    ("content_review_api_key", "CONTENT_REVIEW_API_KEY", ""),
    ("content_review_model", "CONTENT_REVIEW_MODEL", ""),
    ("thai_dubbing_url", "THAI_DUBBING_URL", ""),
    ("voice_clone_api_url", "VOICE_CLONE_API_URL", ""),
    ("voice_clone_api_key", "VOICE_CLONE_API_KEY", ""),
    (
        "voice_clone_analysis_model",
        "VOICE_CLONE_ANALYSIS_MODEL",
        "",
    ),
    ("voice_clone_tts_model", "VOICE_CLONE_TTS_MODEL", ""),
];

pub(crate) async fn get_config(
    State(app): State<AppState>,
    CurrentUser(_): CurrentUser,
) -> ApiResult<Json<Value>> {
    Ok(Json(Value::Object(build_config(&app).await?)))
}

/// 组装完整配置（DB 覆盖 → env 回退 → 默认值）。
pub(crate) async fn build_config(app: &AppState) -> ApiResult<serde_json::Map<String, Value>> {
    let entries = app.db.all_config().await?;
    let map: HashMap<String, String> = entries
        .into_iter()
        .filter_map(|e| e.value.map(|v| (e.key, v)))
        .collect();
    let mut out = serde_json::Map::new();
    for (key, env_k, default) in CONFIG_DEFAULTS {
        let v = map
            .get(*key)
            .cloned()
            .unwrap_or_else(|| std::env::var(env_k).unwrap_or_else(|_| default.to_string()));
        let v = if *key == "review_enabled" || *key == "content_review_enabled" {
            Value::Bool(v.eq_ignore_ascii_case("true"))
        } else if *key == "thai_dubbing_url" && (v.is_empty() || v.eq_ignore_ascii_case("null")) {
            Value::Null
        } else if key.ends_with("_days") || key.starts_with("max_concurrent") {
            v.parse::<i64>()
                .map(Value::from)
                .unwrap_or(Value::String(v))
        } else {
            Value::String(v)
        };
        out.insert(key.to_string(), v);
    }
    Ok(out)
}

pub(crate) async fn update_config(
    State(app): State<AppState>,
    CurrentUser(_): CurrentUser,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let Value::Object(obj) = body else {
        return Err(ApiError::bad_request("config must be an object"));
    };
    for (key, value) in &obj {
        if value.is_null() {
            continue;
        }
        let persisted = match value {
            Value::Bool(value) => value.to_string(),
            Value::String(value) => value.clone(),
            other => other.to_string(),
        };
        app.db.set_config(key, &persisted).await?;
    }
    // FastAPI returns the validated request object; null optional values stay null.
    Ok(Json(Value::Object(obj)))
}

#[derive(Deserialize)]
pub(crate) struct ModelsRequest {
    api_url: String,
    api_key: String,
}

/// 代理上游 /v1/models 列表（供设置页选择模型）。
pub(crate) async fn list_models(
    State(app): State<AppState>,
    CurrentUser(_): CurrentUser,
    Json(body): Json<ModelsRequest>,
) -> ApiResult<Json<Value>> {
    match app
        .ai
        .list_models(
            &body.api_url,
            &body.api_key,
            std::time::Duration::from_secs(20),
        )
        .await
    {
        Ok(models) => Ok(Json(json!({"models": models}))),
        Err(error) => Ok(Json(json!({"models": [], "error": error.to_string()}))),
    }
}
