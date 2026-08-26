use super::Db;
use abp_core::domain::SystemConfigEntry;
use abp_core::ApiResult;

impl Db {
    // ====================================================================

    pub async fn all_config(&self) -> ApiResult<Vec<SystemConfigEntry>> {
        let rows = sqlx::query_as::<_, SystemConfigEntry>("SELECT key, value FROM system_config")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    pub async fn set_config(&self, key: &str, value: &str) -> ApiResult<()> {
        sqlx::query(
            "INSERT INTO system_config (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ====================================================================
}
