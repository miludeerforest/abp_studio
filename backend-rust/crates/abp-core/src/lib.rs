//! abp-core — 领域层：配置、错误、领域模型。
//!
//! 该 crate 不依赖 Web/IO 框架（axum/redis/tokio 运行时），
//! 领域规则可被纯单元测试覆盖；sqlx 仅用于 FromRow 行映射 derive。

pub mod config;
pub mod domain;
pub mod error;

pub use config::Settings;
pub use error::{ApiError, ApiResult};
