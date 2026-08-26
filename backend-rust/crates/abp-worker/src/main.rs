//! Dedicated restart-safe worker for persisted workflows and video queue items.
//!
//! The API can still run the same loop for a single-container deployment, but
//! production deployments should run this binary as a separate service and
//! set `DISABLE_BACKGROUND_WORKER=true` on the API.

use abp_api::state::AppState;
use abp_core::Settings;
use std::sync::Arc;
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();
    let cleanup_gallery_only = std::env::args().any(|arg| arg == "--cleanup-gallery");
    let settings = Settings::from_env()?;
    let pool = abp_infra::init_pool(&settings.database_url).await?;
    let baseline = include_str!("../../abp-api/migrations/0001_baseline.sql");
    sqlx::raw_sql(baseline).execute(&pool).await?;
    let http = reqwest::Client::new();
    let redis = match abp_infra::RedisStore::connect(&settings.redis_url()).await {
        Ok(store) => Some(Arc::new(store)),
        Err(error) => {
            tracing::warn!(error = %error, "worker running without Redis event bridge");
            None
        }
    };
    let state = AppState {
        db: abp_infra::Db::new(pool),
        settings: Arc::new(settings),
        ws: abp_api::ws::WsManager::new(),
        ai: Arc::new(abp_ai::ProviderClient::new(http.clone())),
        http,
        redis,
    };
    if cleanup_gallery_only {
        match abp_api::services::maintenance::cleanup_gallery(&state).await {
            Ok(deleted) => tracing::info!(deleted, "gallery cleanup complete"),
            Err(error) => {
                tracing::error!(error = %error, "gallery cleanup failed");
                return Err(error.into());
            }
        }
        return Ok(());
    }

    tracing::info!("abp-worker started");
    loop {
        if let Err(error) = abp_api::services::tasks::resume_stale(&state).await {
            tracing::warn!(error = %error, "workflow recovery cycle failed");
        }
        match state.db.pending_video_items(3).await {
            Ok(items) => {
                for item in items {
                    if state
                        .db
                        .update_video_status(&item.id, "processing", None, None)
                        .await
                        .is_err()
                    {
                        continue;
                    }
                    let worker_state = state.clone();
                    tokio::spawn(async move {
                        if let Err(error) = abp_api::services::video::generate_with_retry(
                            worker_state,
                            item.id.clone(),
                        )
                        .await
                        {
                            tracing::warn!(item_id = %item.id, error = %error, "video worker task failed");
                        }
                    });
                }
            }
            Err(error) => tracing::warn!(error = %error, "read pending video queue failed"),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}
