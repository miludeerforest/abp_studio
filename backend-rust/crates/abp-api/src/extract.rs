//! 认证提取器：`CurrentUser` / `AdminUser`
//! （等价 Python 端 `get_current_user` / `get_current_admin` 依赖）。

use crate::error::ApiError;
use crate::state::AppState;
use abp_core::domain::User;
use axum::{extract::FromRequestParts, http::request::Parts};

/// 从 Authorization 头解析当前登录用户。
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| abp_core::ApiError::unauthorized("Not authenticated"))?;
        let token = abp_infra::auth::bearer_token(header)?;
        let username = abp_infra::auth::decode_token(token, &state.settings.secret_key)?;
        let user =
            state.db.user_by_username(&username).await?.ok_or_else(|| {
                abp_core::ApiError::unauthorized("Could not validate credentials")
            })?;
        Ok(Self(user))
    }
}

/// 当前用户必须是管理员。
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let CurrentUser(user) = CurrentUser::from_request_parts(parts, state).await?;
        abp_infra::auth::require_admin(&user)?;
        Ok(Self(user))
    }
}
