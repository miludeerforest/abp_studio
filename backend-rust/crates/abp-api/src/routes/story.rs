use crate::error::{ApiError, ApiResult};
use crate::extract::CurrentUser;
use crate::services::{story, tasks};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    response::Json,
};
use serde_json::{json, Value};

pub(crate) async fn create_story_chain(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<story::StoryChainRequest>,
) -> ApiResult<Json<Value>> {
    let chain_id = story::start_chain(&app, &user, request).await?;
    let worker_app = app.clone();
    let worker_user = user.clone();
    let worker_id = chain_id.clone();
    tokio::spawn(async move {
        if let Err(error) = story::run_chain(worker_app, worker_user, worker_id.clone()).await {
            tracing::error!(chain_id = %worker_id, error = %error, "story chain failed");
        }
    });
    Ok(Json(json!({"chain_id":chain_id,"status":"started"})))
}

pub(crate) async fn story_chain_status(
    State(app): State<AppState>,
    Path(chain_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let task = app
        .db
        .task_by_id(&chain_id)
        .await?
        .ok_or_else(|| tasks::not_found("Chain"))?;
    Ok(Json(task.result.unwrap_or_else(|| {
        json!({
            "status": task.status,
            "current_shot": 0,
            "total_shots": 0,
            "video_ids": [],
            "error": task.error_msg,
            "merged_video_url": Value::Null,
        })
    })))
}

pub(crate) async fn create_story_fission(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<story::StoryFissionRequest>,
) -> ApiResult<Json<Value>> {
    let fission_id = story::start_fission(&app, &user, request).await?;
    let worker_app = app.clone();
    let worker_user = user.clone();
    let worker_id = fission_id.clone();
    tokio::spawn(async move {
        if let Err(error) = story::run_fission(worker_app, worker_user, worker_id.clone()).await {
            tracing::error!(fission_id = %worker_id, error = %error, "story fission failed");
        }
    });
    Ok(Json(
        json!({"fission_id":fission_id,"status":"started","branch_count":request_branch_count(&app,&fission_id).await.unwrap_or(0)}),
    ))
}

pub(crate) async fn story_fission_status(
    State(app): State<AppState>,
    Path(fission_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let task = app
        .db
        .task_by_id(&fission_id)
        .await?
        .ok_or_else(|| tasks::not_found("Fission"))?;
    Ok(Json(task.result.unwrap_or_else(|| {
        json!({
            "status": task.status,
            "phase": "processing",
            "total_branches": 0,
            "completed_branches": 0,
            "branches": [],
            "error": task.error_msg,
        })
    })))
}

pub(crate) async fn retry_fission_branch(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((fission_id, branch_id)): Path<(String, usize)>,
) -> ApiResult<Json<Value>> {
    let task = app
        .db
        .task_by_id(&fission_id)
        .await?
        .ok_or_else(|| tasks::not_found("Fission"))?;
    if task.user_id != Some(user.id) && user.role != "admin" {
        return Err(ApiError::forbidden("Not authorized"));
    }
    // The persisted payload is the source of truth.  Re-running the workflow
    // is safe and deterministic at the task boundary; the branch id is echoed
    // for frontend progress UI while a future worker can narrow execution.
    let worker_app = app.clone();
    let worker_user = user.clone();
    let worker_id = fission_id.clone();
    tokio::spawn(async move {
        if let Err(error) = story::run_fission(worker_app, worker_user, worker_id.clone()).await {
            tracing::error!(fission_id = %worker_id, branch_id, error = %error, "fission branch retry failed");
        }
    });
    Ok(Json(json!({"status":"retrying","branch_id":branch_id})))
}

pub(crate) async fn remerge_fission_story(
    State(app): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(fission_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let task = app
        .db
        .task_by_id(&fission_id)
        .await?
        .ok_or_else(|| tasks::not_found("Fission"))?;
    if task.user_id != Some(user.id) && user.role != "admin" {
        return Err(ApiError::forbidden("Not authorized"));
    }
    let result = story::remerge(&app, &user, &fission_id).await?;
    Ok(Json(result))
}

async fn request_branch_count(app: &AppState, task_id: &str) -> Option<usize> {
    app.db
        .task_by_id(task_id)
        .await
        .ok()
        .flatten()?
        .payload?
        .get("branch_count")?
        .as_u64()
        .map(|value| value as usize)
}
