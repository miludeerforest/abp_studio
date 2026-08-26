//! 统一错误类型：领域层与基础设施层共用的业务错误。
//!
//! 本 crate 保持框架无关；HTTP 序列化（axum `IntoResponse`）
//! 由 `abp-api` 通过 `AppError` newtype 完成，响应格式为
//! `{ "detail": "..." }` —— 与 FastAPI 一致，前端无需改动。

use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("database error")]
    /// 对外统一为 500；细节仅写日志。
    Database(#[from] sqlx::Error),
    #[error("internal server error")]
    /// 对外隐藏细节，内部通过 tracing 记录。
    Internal(#[source] anyhow::Error),
}

impl ApiError {
    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::Unauthorized(msg.into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Conflict(msg.into())
    }
    pub fn internal(err: impl Into<anyhow::Error>) -> Self {
        Self::Internal(err.into())
    }

    /// HTTP 状态码（供传输层使用）。
    pub fn http_status(&self) -> u16 {
        match self {
            ApiError::Unauthorized(_) => 401,
            ApiError::Forbidden(_) => 403,
            ApiError::NotFound(_) => 404,
            ApiError::BadRequest(_) => 400,
            ApiError::Conflict(_) => 409,
            ApiError::Database(_) | ApiError::Internal(_) => 500,
        }
    }

    /// FastAPI 兼容的错误响应体。
    pub fn body(&self) -> serde_json::Value {
        json!({ "detail": match self {
            // 500 对外不泄露内部细节
            ApiError::Internal(_) => "internal server error".to_string(),
            other => other.to_string(),
        }})
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
