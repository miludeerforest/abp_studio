//! `AppError` newtype：为 `abp_core::ApiError` 实现 axum 的
//! `IntoResponse`（孤儿规则要求的本 crate 包装）。

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug)]
pub struct AppError(pub abp_core::ApiError);

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        Self(abp_core::ApiError::Database(e))
    }
}

impl From<abp_core::ApiError> for AppError {
    fn from(e: abp_core::ApiError) -> Self {
        // 5xx 记录完整错误日志，对外只返回通用信息
        if matches!(e, abp_core::ApiError::Internal(_)) {
            tracing::error!(error = %e, "internal error");
        }
        Self(e)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

impl std::error::Error for AppError {}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.0.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut resp = (status, Json(json!({ "detail": self.0.body()["detail"] }))).into_response();
        if status == StatusCode::UNAUTHORIZED {
            resp.headers_mut().insert(
                "WWW-Authenticate",
                "Bearer".parse().expect("static header value"),
            );
        }
        resp
    }
}

impl AppError {
    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self(abp_core::ApiError::unauthorized(msg))
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self(abp_core::ApiError::forbidden(msg))
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self(abp_core::ApiError::not_found(msg))
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self(abp_core::ApiError::bad_request(msg))
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self(abp_core::ApiError::conflict(msg))
    }
    pub fn internal(err: impl Into<anyhow::Error>) -> Self {
        Self(abp_core::ApiError::internal(err))
    }
}

/// 传输层内直接使用 `ApiError::*` 构造（实际类型为 AppError）。
pub type ApiError = AppError;

/// 常用别名，handler 返回 `ApiResult<T>` 即可。
pub type ApiResult<T> = Result<T, AppError>;
