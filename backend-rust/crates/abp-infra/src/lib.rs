//! abp-infra — 基础设施层：认证、数据库仓储、Redis。
//!
//! 上层（abp-api）只依赖本 crate 暴露的仓储 trait / 结构体，
//! 不直接编写 SQL，保证数据访问可替换、可测试。

pub mod auth;
pub mod concurrency_limiter;
pub mod redis_store;
pub mod repo;
pub mod task_queue_store;

pub use concurrency_limiter::ConcurrencyLimiter;
pub use redis_store::RedisStore;
pub use repo::Db;
pub use task_queue_store::{QueueStats, QueueTypeStats, TaskQueueStore};

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// 建立连接池（等价 Python 端 SessionLocal 的角色）。
pub async fn init_pool(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(database_url)
        .await?;
    Ok(pool)
}
