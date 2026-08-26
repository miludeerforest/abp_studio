use crate::error::ApiResult;
use crate::state::AppState;
use std::collections::HashMap;

/// Resolve persisted configuration first, then environment, then the supplied
/// default.  This is the single configuration boundary used by migrated
/// provider workflows.
pub async fn config_map(app: &AppState) -> ApiResult<HashMap<String, String>> {
    Ok(app
        .db
        .all_config()
        .await?
        .into_iter()
        .filter_map(|entry| entry.value.map(|value| (entry.key, value)))
        .collect())
}

pub async fn setting(app: &AppState, key: &str, env_key: &str, default: &str) -> ApiResult<String> {
    let configs = config_map(app).await?;
    Ok(configs
        .get(key)
        .cloned()
        .or_else(|| std::env::var(env_key).ok())
        .unwrap_or_else(|| default.to_string()))
}

pub fn optional_config(
    configs: &HashMap<String, String>,
    key: &str,
    env_key: &str,
) -> Option<String> {
    configs
        .get(key)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var(env_key)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}
