// Generated from the original route implementation; keep handlers thin as slices are migrated.
use super::shared::*;
use super::*;

// ============================================================================
// 个人资料
// ============================================================================

pub(crate) async fn get_profile(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
) -> ApiResult<Json<Value>> {
    let exp = u.experience as i64;
    let (level, level_name) = abp_core::domain::calculate_level(exp);
    let _ = &app;
    Ok(Json(json!({
        "id": u.id,
        "username": u.username,
        "nickname": u.nickname.clone().unwrap_or_else(|| u.username.clone()),
        "avatar": u.avatar,
        "role": u.role,
        "default_share": u.default_share.unwrap_or(true),
        "created_at": u.created_at,
        "experience": u.experience,
        "level": level,
        "level_name": level_name,
        "level_progress": (abp_core::domain::level_progress(exp) * 10.0).round() / 10.0,
    })))
}

#[derive(Deserialize)]
pub(crate) struct UpdateProfile {
    nickname: Option<String>,
    password: Option<String>,
    default_share: Option<bool>,
}

pub(crate) async fn update_profile(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Json(body): Json<UpdateProfile>,
) -> ApiResult<Json<Value>> {
    let hashed = match body
        .password
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(p) => Some(abp_infra::auth::hash_password(p)?),
        None => None,
    };
    app.db
        .update_user(
            u.id,
            body.nickname.as_deref(),
            None,
            None,
            hashed.as_deref(),
            body.default_share,
        )
        .await?;
    Ok(Json(json!({
        "message": "Profile updated successfully",
        "nickname": body.nickname,
        "default_share": body.default_share,
    })))
}

pub(crate) async fn upload_avatar(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    mut multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let mut saved_url: Option<String> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad_request(format!("multipart error: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let ct = field
            .content_type()
            .unwrap_or("image/jpeg")
            .split(';')
            .next()
            .unwrap_or("image/jpeg")
            .to_string();
        let allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        if !allowed.contains(&ct.as_str()) {
            return Err(ApiError::bad_request(
                "Invalid file type. Only JPEG, PNG, GIF, WebP allowed.",
            ));
        }
        let ext = match ct.as_str() {
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            _ => "jpg",
        };
        let filename = format!("avatar_{}_{}.{}", u.id, Utc::now().timestamp(), ext);
        let dir = format!("{}/avatars", app.settings.uploads_dir);
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| ApiError::internal(anyhow::anyhow!("mkdir failed: {e}")))?;
        let path = format!("{dir}/{filename}");
        let data = field
            .bytes()
            .await
            .map_err(|e| ApiError::bad_request(format!("read upload failed: {e}")))?;
        tokio::fs::write(&path, &data)
            .await
            .map_err(|e| ApiError::internal(anyhow::anyhow!("write avatar failed: {e}")))?;
        saved_url = Some(format!("/uploads/avatars/{filename}"));
        break;
    }
    let url = saved_url.ok_or_else(|| ApiError::bad_request("missing file field"))?;
    app.db
        .update_user(u.id, None, Some(Some(&url)), None, None, None)
        .await?;
    Ok(Json(
        json!({ "message": "Avatar uploaded successfully", "avatar": url }),
    ))
}

pub(crate) async fn experience_history(
    State(app): State<AppState>,
    CurrentUser(u): CurrentUser,
    Query(q): Query<Paging>,
) -> ApiResult<Json<Value>> {
    let limit = q.limit.unwrap_or(20).clamp(1, 100);
    let logs = app.db.experience_history(u.id, limit).await?;
    let items = logs
        .into_iter()
        .map(|log| {
            json!({
                "video_id": log.video_id,
                "score": log.score,
                "exp_change": log.exp_change,
                "exp_before": log.exp_before,
                "exp_after": log.exp_after,
                "level_before": log.level_before,
                "level_after": log.level_after,
                "created_at": log.created_at,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!(items)))
}

// ============================================================================
// 用户管理（admin）
// ============================================================================

pub(crate) async fn list_users(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
) -> ApiResult<Json<Value>> {
    let users = app.db.list_users().await?;
    let items: Vec<Value> = users
        .iter()
        .map(|u| {
            let (level, level_name) = if u.experience < 0 {
                (0, "🐸 蛤蟆")
            } else {
                let (level, name) = abp_core::domain::calculate_level(u.experience as i64);
                (level, name)
            };
            json!({
                "id": u.id,
                "username": u.username,
                "role": u.role,
                "created_at": u.created_at,
                "experience": u.experience,
                "level": level,
                "level_name": level_name,
            })
        })
        .collect();
    Ok(Json(json!(items)))
}

#[derive(Deserialize)]
pub(crate) struct UserCreate {
    username: String,
    password: String,
    #[serde(default = "default_user_role")]
    role: String,
}

fn default_user_role() -> String {
    "user".into()
}

pub(crate) async fn create_user(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
    Json(body): Json<UserCreate>,
) -> ApiResult<impl IntoResponse> {
    if body.username.trim().is_empty() || body.password.is_empty() {
        return Err(ApiError::bad_request("username and password required"));
    }
    if app.db.user_by_username(&body.username).await?.is_some() {
        return Err(ApiError::bad_request("Username already registered"));
    }
    let hashed = abp_infra::auth::hash_password(&body.password)?;
    let user = app
        .db
        .create_user(&body.username, &hashed, &body.role)
        .await?;
    Ok(Json(admin_user_mutation_json(&user)))
}

pub(crate) fn admin_user_mutation_json(user: &User) -> Value {
    json!({
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "created_at": user.created_at,
        "experience": user.experience,
        "level": user.level,
        "level_name": Value::Null,
    })
}

#[derive(Deserialize)]
pub(crate) struct UserUpdate {
    username: Option<String>,
    password: Option<String>,
    role: Option<String>,
}

pub(crate) async fn update_user(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
    Path(user_id): Path<i32>,
    Json(body): Json<UserUpdate>,
) -> ApiResult<Json<Value>> {
    let hashed = match body.password.as_deref().filter(|p| !p.is_empty()) {
        Some(p) => Some(abp_infra::auth::hash_password(p)?),
        None => None,
    };
    app.db
        .update_admin_user(
            user_id,
            body.username.as_deref(),
            body.role.as_deref(),
            hashed.as_deref(),
        )
        .await?;
    let user = app
        .db
        .user_by_id(user_id)
        .await?
        .ok_or_else(|| ApiError::not_found("User not found"))?;
    Ok(Json(admin_user_mutation_json(&user)))
}

pub(crate) async fn delete_user(
    State(app): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(user_id): Path<i32>,
) -> ApiResult<Json<Value>> {
    if admin.id == user_id {
        return Err(ApiError::bad_request("Cannot delete yourself"));
    }
    if let Some(target) = app.db.user_by_id(user_id).await? {
        if target.role == "admin" {
            return Err(ApiError::bad_request("Cannot delete admin users"));
        }
    }
    if !app.db.delete_user(user_id).await? {
        return Err(ApiError::not_found("User not found"));
    }
    Ok(Json(json!({"message":"User deleted successfully"})))
}
