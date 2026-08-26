//! abp-server — Rust 版后端入口。
//!
//! 架构：abp-core（领域） ← abp-infra（仓储/认证/Redis） ← abp-api（HTTP/WS）。
//! 与 Python/FastAPI 版共用同一 PostgreSQL / Redis / uploads 目录，
//! 可并行部署、灰度切换。

use abp_api::state::AppState;
use abp_core::Settings;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();

    let settings = Settings::from_env()?;
    tracing::info!("starting abp-server on {}:{}", settings.host, settings.port);

    // 数据库
    let pool = abp_infra::init_pool(&settings.database_url).await?;
    // 基线 schema（幂等 CREATE TABLE IF NOT EXISTS），与 Python 端模型一致
    let baseline = include_str!("../migrations/0001_baseline.sql");
    sqlx::raw_sql(baseline).execute(&pool).await?;
    let db = abp_infra::Db::new(pool);

    // 管理员账号引导
    bootstrap_admin(&db, &settings).await?;

    let http = reqwest::Client::new();
    let ai = std::sync::Arc::new(abp_ai::ProviderClient::new(http.clone()));
    let redis = match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        abp_infra::RedisStore::connect(&settings.redis_url()),
    )
    .await
    {
        Ok(Ok(store)) => {
            tracing::info!("connected to Redis event bridge");
            Some(std::sync::Arc::new(store))
        }
        Ok(Err(error)) => {
            tracing::warn!(error = %error, "Redis unavailable; continuing without event bridge");
            None
        }
        Err(_) => {
            tracing::warn!("Redis connection timed out; continuing without event bridge");
            None
        }
    };
    let state = AppState {
        db,
        settings: std::sync::Arc::new(settings.clone()),
        ws: abp_api::ws::WsManager::new(),
        http,
        ai,
        redis,
    };

    if !std::env::var("DISABLE_BACKGROUND_WORKER")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        let maintenance_state = state.clone();
        tokio::spawn(async move {
            loop {
                if let Err(error) =
                    abp_api::services::video::recover_zombies(&maintenance_state).await
                {
                    tracing::warn!(error = %error, "video zombie recovery failed");
                }
                if let Err(error) =
                    abp_api::services::video::cleanup_expired(&maintenance_state).await
                {
                    tracing::warn!(error = %error, "video cleanup failed");
                }
                if let Err(error) = abp_api::services::tasks::resume_stale(&maintenance_state).await
                {
                    tracing::warn!(error = %error, "workflow task recovery failed");
                }
                if let Ok(items) = maintenance_state.db.pending_video_items(3).await {
                    for item in items {
                        if maintenance_state
                            .db
                            .update_video_status(&item.id, "processing", None, None)
                            .await
                            .is_ok()
                        {
                            let worker_app = maintenance_state.clone();
                            tokio::spawn(async move {
                                if let Err(error) = abp_api::services::video::generate_with_retry(
                                    worker_app,
                                    item.id.clone(),
                                )
                                .await
                                {
                                    tracing::warn!(item_id = %item.id, error = %error, "pending video worker failed");
                                }
                            });
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            }
        });
    }

    // CORS：默认放开（与前端同源部署时无影响）
    let cors = if settings.cors_origins.trim() == "*" {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins: Vec<axum::http::HeaderValue> = settings
            .cors_origins
            .split(',')
            .filter_map(|o| o.trim().parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
    };

    // 静态资源：/uploads/** 直接从磁盘提供（与 Python 端一致）
    let uploads_service =
        ServeDir::new(&settings.uploads_dir).append_index_html_on_directories(false);

    let app = abp_api::routes::router(state)
        .nest_service("/uploads", uploads_service)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = format!("{}:{}", settings.host, settings.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

/// 启动时确保管理员存在；FORCE_RESET_ADMIN_PASSWORD=true 时强制重置密码。
async fn bootstrap_admin(db: &abp_infra::Db, s: &Settings) -> anyhow::Result<()> {
    match db.user_by_username(&s.admin_user).await? {
        Some(user) => {
            if s.force_reset_admin_password {
                let hashed = abp_infra::auth::hash_password(&s.admin_password)?;
                db.update_user(user.id, None, None, None, Some(&hashed), None)
                    .await?;
                tracing::info!(username = %user.username, "admin password reset from env");
            }
        }
        None => {
            let hashed = abp_infra::auth::hash_password(&s.admin_password)?;
            sqlx::query(
                "INSERT INTO users (username, nickname, hashed_password, role, default_share, created_at)
                 VALUES ($1, $2, $3, 'admin', TRUE, NOW())",
            )
            .bind(&s.admin_user)
            .bind("Administrator")
            .bind(&hashed)
            .execute(&db.pool)
            .await?;
            tracing::info!(username = %s.admin_user, "admin user created");
        }
    }
    Ok(())
}
