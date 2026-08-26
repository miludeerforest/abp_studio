use crate::error::{ApiError, ApiResult};
use crate::extract::CurrentUser;
use crate::services::{mexico, multipart};
use crate::state::AppState;
use axum::{
    extract::{Multipart, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub(crate) struct KeywordRequest {
    pub title: String,
}
#[derive(Debug, Deserialize)]
pub(crate) struct FeishuRequest {
    pub module: String,
    pub results: Vec<Value>,
}
#[derive(Debug, Deserialize)]
pub(crate) struct DescriptionFeishuRequest {
    pub product_title: String,
    pub prompts: Vec<Value>,
}

pub(crate) async fn keyword_analysis_single(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<KeywordRequest>,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        json!({"result": mexico::text_module(&app, "keyword", &request.title, None).await?}),
    ))
}

pub(crate) async fn title_optimization_single(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let title = form.text_or("title", "");
    let image = form.file("image").map(|file| file.bytes.as_slice());
    Ok(Json(
        json!({"result": mexico::text_module(&app, "title", &format!("Competitor Title: {title}"), image).await?}),
    ))
}

pub(crate) async fn image_prompt_single(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let image = form
        .file("image")
        .ok_or_else(|| ApiError::bad_request("image is required"))?;
    Ok(Json(
        json!({"result": mexico::text_module(&app, "image", "Analyze this product image and generate visual prompts and marketing copy.", Some(&image.bytes)).await?}),
    ))
}

pub(crate) async fn description_single(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let image = form
        .file("image")
        .ok_or_else(|| ApiError::bad_request("image is required"))?;
    let title = form.text_or("title", "");
    Ok(Json(
        json!({"result": mexico::text_module(&app, "description", &format!("Product Title: {title}\nGenerate usage instructions (Modo de Uso)."), Some(&image.bytes)).await?}),
    ))
}

pub(crate) async fn image_prompts_batch(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let image = form
        .file("image")
        .ok_or_else(|| ApiError::bad_request("image is required"))?;
    let prompts = mexico::image_prompts(
        &app,
        &form.text_or("title", ""),
        &form.text_or("keywords", ""),
        &form.text_or("description", ""),
        &form.text_or("aspect_ratio", "1:1"),
        &form.text_or("target_language", "es-MX"),
        &image.bytes,
    )
    .await?;
    Ok(Json(json!({"prompts":prompts})))
}

pub(crate) async fn refine_prompt(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<mexico::RefinePromptRequest>,
) -> ApiResult<Json<mexico::ImagePromptItem>> {
    Ok(Json(mexico::refine_prompt(&app, &request).await?))
}

pub(crate) async fn generate_image(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let form = multipart::collect(multipart).await?;
    let image = form
        .file("reference_image")
        .ok_or_else(|| ApiError::bad_request("reference_image is required"))?;
    Ok(Json(
        mexico::generate_image(
            &app,
            &user,
            &form.text_or("prompt_text", ""),
            &form.text_or("aspect_ratio", "1:1"),
            &image.bytes,
        )
        .await?,
    ))
}

pub(crate) async fn sync_feishu(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<FeishuRequest>,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        mexico::sync_feishu(&app, &request.module, &request.results).await?,
    ))
}

pub(crate) async fn sync_description_feishu(
    State(app): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<DescriptionFeishuRequest>,
) -> ApiResult<Json<Value>> {
    let mut prompts = request.prompts.clone();
    for prompt in &mut prompts {
        if let Some(object) = prompt.as_object_mut() {
            object.insert("input".into(), Value::String(request.product_title.clone()));
        }
    }
    Ok(Json(
        mexico::sync_feishu(&app, "description", &prompts).await?,
    ))
}
