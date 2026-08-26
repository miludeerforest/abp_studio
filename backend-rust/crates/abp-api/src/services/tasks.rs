use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use abp_core::domain::TaskRecord;
use serde_json::{json, Value};
use uuid::Uuid;

pub async fn create(
    app: &AppState,
    kind: &str,
    user_id: i32,
    payload: Value,
) -> ApiResult<TaskRecord> {
    app.db
        .create_task(
            &Uuid::new_v4().to_string(),
            kind,
            Some(user_id),
            Some(&payload),
        )
        .await
        .map_err(ApiError::from)
}

pub fn public_status(task: &TaskRecord) -> Value {
    json!({
        "task_id": task.id,
        "kind": task.kind,
        "status": task.status,
        "progress": task.progress,
        "result": task.result,
        "error": task.error_msg,
        "retry_count": task.retry_count,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    })
}

/// Resume stale persisted workflows after a process restart. Claiming is
/// atomic, so multiple Rust instances cannot execute the same task twice.
pub async fn resume_stale(app: &AppState) -> ApiResult<u64> {
    let cutoff = chrono::Local::now().naive_local() - chrono::Duration::minutes(1);
    app.db
        .recover_stale_tasks(cutoff)
        .await
        .map_err(ApiError::from)?;
    let pending = app
        .db
        .stale_pending_tasks(cutoff)
        .await
        .map_err(ApiError::from)?;
    let mut resumed = 0u64;
    for task in pending {
        if !app.db.claim_task(&task.id).await.map_err(ApiError::from)? {
            continue;
        }
        let Some(user_id) = task.user_id else {
            continue;
        };
        let Some(user) = app.db.user_by_id(user_id).await.map_err(ApiError::from)? else {
            continue;
        };
        let worker_app = app.clone();
        let worker_id = task.id.clone();
        match task.kind.as_str() {
            "batch-generate" => {
                tokio::spawn(async move {
                    if let Err(error) = crate::routes::generation::run_persisted_batch(
                        worker_app,
                        user,
                        worker_id.clone(),
                    )
                    .await
                    {
                        tracing::error!(task_id = %worker_id, error = %error, "resumed batch task failed");
                    }
                });
                resumed += 1;
            }
            "story-chain" => {
                tokio::spawn(async move {
                    if let Err(error) =
                        crate::services::story::run_chain(worker_app, user, worker_id.clone()).await
                    {
                        tracing::error!(task_id = %worker_id, error = %error, "resumed story chain failed");
                    }
                });
                resumed += 1;
            }
            "story-fission" => {
                tokio::spawn(async move {
                    if let Err(error) =
                        crate::services::story::run_fission(worker_app, user, worker_id.clone())
                            .await
                    {
                        tracing::error!(task_id = %worker_id, error = %error, "resumed story fission failed");
                    }
                });
                resumed += 1;
            }
            _ => {
                let _ = app
                    .db
                    .update_task(
                        &task.id,
                        "failed",
                        task.progress,
                        None,
                        Some("unknown task kind"),
                        true,
                    )
                    .await;
            }
        }
    }
    Ok(resumed)
}

pub fn not_found(kind: &str) -> ApiError {
    ApiError::not_found(format!("{kind} task not found"))
}
