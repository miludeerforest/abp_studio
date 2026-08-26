// Generated from the original route implementation; keep handlers thin as slices are migrated.
use super::*;

// ============================================================================
// 登录
// ============================================================================

#[derive(Deserialize)]
pub struct LoginForm {
    pub username: String,
    pub password: String,
    pub turnstile_token: Option<String>,
}

pub(crate) async fn login(
    State(app): State<AppState>,
    axum::Form(form): axum::Form<LoginForm>,
) -> ApiResult<Json<Value>> {
    let secret = std::env::var("TURNSTILE_SECRET_KEY").unwrap_or_default();
    if let (Some(token), false) = (&form.turnstile_token, secret.is_empty()) {
        if !verify_turnstile(&app, token, &secret).await {
            return Err(ApiError::bad_request("人机验证失败，请重试"));
        }
    }
    let user = app
        .db
        .user_by_username(&form.username)
        .await?
        .ok_or_else(|| ApiError::unauthorized("用户名或密码错误"))?;
    if !abp_infra::auth::verify_password(&form.password, &user.hashed_password) {
        return Err(ApiError::unauthorized("用户名或密码错误"));
    }
    let token = abp_infra::auth::create_access_token(
        &user.username,
        &app.settings.secret_key,
        app.settings.access_token_expire_minutes,
    )?;
    Ok(Json(json!({
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role,
        "user_id": user.id,
    })))
}

pub(crate) async fn verify_turnstile(app: &AppState, token: &str, secret: &str) -> bool {
    let body = [("secret", secret), ("response", token)];
    match app
        .http
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .form(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) => resp
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.get("success").and_then(Value::as_bool))
            .unwrap_or(false),
        Err(e) => {
            tracing::error!(error = %e, "turnstile verify failed");
            false
        }
    }
}
