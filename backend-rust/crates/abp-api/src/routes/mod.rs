//! HTTP routes split by bounded context.
//!
//! Handlers validate transport input and delegate to `abp-infra`/domain code;
//! long-running generation and review workers will live outside this module.

use crate::error::{ApiError, ApiResult};
use crate::extract::{AdminUser, CurrentUser};
use crate::state::AppState;
use abp_core::domain::{User, VideoQueueItem};
use axum::{
    extract::{Multipart, Path, Query, State},
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use chrono::{NaiveDate, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(crate) mod admin;
pub(crate) mod auth;
pub(crate) mod character;
pub(crate) mod config;
pub(crate) mod gallery;
pub mod generation;
pub(crate) mod keywords;
pub(crate) mod mexico;
pub(crate) mod public;
pub(crate) mod queue;
pub(crate) mod shared;
pub(crate) mod story;
pub(crate) mod users;
pub(crate) mod voice;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/openapi.json", get(openapi))
        .route("/api/v1/public/config", get(public::public_config))
        .route("/api/v1/public/videos", get(public::public_videos))
        .route("/api/v1/login", post(auth::login))
        .route(
            "/api/v1/user/profile",
            get(users::get_profile).put(users::update_profile),
        )
        .route("/api/v1/user/avatar", post(users::upload_avatar))
        .route(
            "/api/v1/user/experience/history",
            get(users::experience_history),
        )
        .route(
            "/api/v1/users",
            get(users::list_users).post(users::create_user),
        )
        .route(
            "/api/v1/users/{user_id}",
            put(users::update_user).delete(users::delete_user),
        )
        .route("/api/v1/stats", get(config::stats))
        .route(
            "/api/v1/config",
            get(config::get_config).post(config::update_config),
        )
        .route("/api/v1/models", post(config::list_models))
        .route("/api/v1/analyze", post(generation::analyze))
        .route("/api/v1/batch-generate", post(generation::batch_generate))
        .route(
            "/api/v1/batch-generate-async",
            post(generation::batch_generate_async),
        )
        .route(
            "/api/v1/batch-generate-async/{task_id}",
            get(generation::batch_status),
        )
        .route(
            "/api/v1/simple-batch-generate",
            post(generation::simple_batch_generate),
        )
        .route("/api/v1/story-analyze", post(generation::story_analyze))
        .route(
            "/api/v1/generate-video-prompt",
            post(generation::generate_video_prompt),
        )
        .route("/api/v1/story-generate", post(generation::story_generate))
        .route("/api/v1/merge-videos", post(generation::merge_videos))
        .route(
            "/api/v1/keywords/analyze-single",
            post(keywords::analyze_single),
        )
        .route(
            "/api/v1/keywords/history",
            get(keywords::get_history)
                .post(keywords::save_history)
                .delete(keywords::clear_history),
        )
        .route(
            "/api/v1/keywords/history/{index}",
            delete(keywords::delete_history),
        )
        .route(
            "/api/v1/keywords/export-excel",
            post(keywords::export_excel),
        )
        .route("/api/v1/keywords/sync-feishu", post(keywords::sync_feishu))
        .route(
            "/api/v1/mexico-beauty/keyword-analysis-single",
            post(mexico::keyword_analysis_single),
        )
        .route(
            "/api/v1/mexico-beauty/title-optimization-single",
            post(mexico::title_optimization_single),
        )
        .route(
            "/api/v1/mexico-beauty/image-prompt-single",
            post(mexico::image_prompt_single),
        )
        .route(
            "/api/v1/mexico-beauty/description-single",
            post(mexico::description_single),
        )
        .route(
            "/api/v1/mexico-beauty/image-prompts-batch",
            post(mexico::image_prompts_batch),
        )
        .route(
            "/api/v1/mexico-beauty/refine-prompt",
            post(mexico::refine_prompt),
        )
        .route(
            "/api/v1/mexico-beauty/generate-image",
            post(mexico::generate_image),
        )
        .route(
            "/api/v1/mexico-beauty/sync-feishu",
            post(mexico::sync_feishu),
        )
        .route(
            "/api/v1/mexico-beauty/sync-description-feishu",
            post(mexico::sync_description_feishu),
        )
        .route("/api/v1/character/generate", post(character::generate))
        .route(
            "/api/v1/voice-clone/analyze-video",
            post(voice::analyze_video),
        )
        .route(
            "/api/v1/voice-clone/synthesize-speech",
            post(voice::synthesize_speech),
        )
        .route("/api/v1/story-chain", post(story::create_story_chain))
        .route(
            "/api/v1/story-chain/{chain_id}",
            get(story::story_chain_status),
        )
        .route("/api/v1/story-fission", post(story::create_story_fission))
        .route(
            "/api/v1/story-fission/{fission_id}",
            get(story::story_fission_status),
        )
        .route(
            "/api/v1/story-fission/{fission_id}/branch/{branch_id}/retry",
            post(story::retry_fission_branch),
        )
        .route(
            "/api/v1/story-fission/{fission_id}/remerge",
            post(story::remerge_fission_story),
        )
        .route("/api/v1/gallery/images", get(gallery::gallery_images))
        .route(
            "/api/v1/gallery/images/{image_id}",
            delete(gallery::delete_image),
        )
        .route(
            "/api/v1/gallery/images/batch-delete",
            post(gallery::batch_delete_images),
        )
        .route(
            "/api/v1/gallery/images/batch-download",
            post(gallery::batch_download_images),
        )
        .route(
            "/api/v1/gallery/images/{image_id}/share",
            post(gallery::share_image),
        )
        .route(
            "/api/v1/gallery/images/batch-share",
            post(gallery::batch_share_images),
        )
        .route(
            "/api/v1/gallery/images/share-all",
            post(gallery::share_all_images),
        )
        .route("/api/v1/gallery/videos", get(gallery::gallery_videos))
        .route(
            "/api/v1/gallery/videos/batch-delete",
            post(gallery::batch_delete_videos),
        )
        .route(
            "/api/v1/gallery/videos/batch-download",
            post(gallery::batch_download_videos),
        )
        .route(
            "/api/v1/gallery/videos/batch-share",
            post(gallery::batch_share_videos),
        )
        .route(
            "/api/v1/gallery/videos/share-all",
            post(gallery::share_all_videos),
        )
        .route(
            "/api/v1/gallery/videos/{video_id}/share",
            post(gallery::share_video),
        )
        .route(
            "/api/v1/gallery/videos/{video_id}/review",
            get(gallery::get_review).post(gallery::post_review),
        )
        .route(
            "/api/v1/queue",
            get(queue::list_queue)
                .post(queue::add_queue)
                .delete(queue::clear_queue),
        )
        .route(
            "/api/v1/queue/{item_id}",
            axum::routing::delete(queue::delete_queue_item).put(queue::update_queue_item),
        )
        .route(
            "/api/v1/queue/{item_id}/retry",
            post(queue::retry_queue_item),
        )
        .route(
            "/api/v1/queue/{item_id}/generate",
            post(queue::generate_queue_item),
        )
        .route("/api/v1/admin/live-status", get(admin::live_status))
        .route(
            "/api/v1/admin/activities",
            get(admin::list_activities).delete(admin::clear_activities),
        )
        .route("/api/v1/admin/user/{user_id}/tasks", get(admin::user_tasks))
        .route("/ws/{token}", get(crate::ws_handler::ws_upgrade))
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok", "service": "abp-rust" }))
}

async fn openapi() -> impl IntoResponse {
    let value: Value = serde_json::from_str(include_str!("../../../../openapi.json"))
        .expect("generated Rust OpenAPI document must be valid JSON");
    Json(value)
}
