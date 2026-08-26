// Generated from the original route implementation; keep handlers thin as slices are migrated.
use super::shared::*;
use super::*;

pub(crate) async fn public_config(State(app): State<AppState>) -> ApiResult<Json<Value>> {
    let entries = app.db.all_config().await?;
    let map: HashMap<String, Option<String>> = entries
        .iter()
        .map(|entry| (entry.key.clone(), entry.value.clone()))
        .collect();
    let pick = |key: &str, env_key: &str, default: &str| {
        map.get(key)
            .cloned()
            .flatten()
            .filter(|value| !value.is_empty())
            .or_else(|| std::env::var(env_key).ok())
            .unwrap_or_else(|| default.to_string())
    };
    Ok(Json(json!({
        "site_title": pick("site_title", "SITE_TITLE", "BNP Studio"),
        "site_subtitle": pick("site_subtitle", "SITE_SUBTITLE", "AI Video Gallery"),
    })))
}

pub(crate) async fn public_videos(
    State(app): State<AppState>,
    Query(q): Query<Paging>,
) -> ApiResult<Json<Value>> {
    let q = q.with_defaults(50, 0);
    let (total, records) = app
        .db
        .public_videos(q.limit.unwrap(), q.offset.unwrap())
        .await?;
    let items = records
        .into_iter()
        .map(|record| {
            json!({
                "id": record.id,
                "prompt": record.prompt,
                "result_url": record.result_url,
                "preview_url": abp_core::domain::effective_preview_url(
                    record.preview_url.as_deref(),
                    record.file_path.as_deref(),
                ),
                "username": record.creator_nickname
                    .or(record.creator_username)
                    .unwrap_or_else(|| "Creator".into()),
                "avatar": record.creator_avatar,
                "category": record.category.unwrap_or_else(|| "other".into()),
                "is_merged": record.is_merged.unwrap_or(false),
                "created_at": record.created_at,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({ "total": total, "items": items })))
}
