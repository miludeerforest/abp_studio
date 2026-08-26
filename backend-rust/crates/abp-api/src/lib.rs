//! abp-api — 传输层（axum）：路由、认证中间件、WebSocket、静态资源。

pub mod error;
pub mod extract;
pub mod routes;
pub mod services;
pub mod state;
pub mod ws;
pub mod ws_handler;

pub use error::AppError;
pub use state::AppState;
