//! 全局共享状态。

/// 全局共享状态：数据库、配置、WS 管理器、HTTP 客户端。
#[derive(Clone)]
pub struct AppState {
    pub db: abp_infra::Db,
    pub settings: std::sync::Arc<abp_core::Settings>,
    /// 实时连接管理器（WS 在线用户 → 推送通道）
    pub ws: crate::ws::WsManager,
    /// 外部 AI API 客户端（连接池复用）
    pub http: reqwest::Client,
    /// Shared provider/media client with deterministic retry policy.
    pub ai: std::sync::Arc<abp_ai::ProviderClient>,
    /// Optional Redis event bridge; the API remains usable when Redis is unavailable during local development.
    pub redis: Option<std::sync::Arc<abp_infra::RedisStore>>,
}
