use super::Db;
use abp_core::domain::TaskRecord;
use abp_core::ApiResult;
use chrono::NaiveDateTime;
use serde_json::Value;

impl Db {
    pub async fn create_task(
        &self,
        id: &str,
        kind: &str,
        user_id: Option<i32>,
        payload: Option<&Value>,
    ) -> ApiResult<TaskRecord> {
        let task = sqlx::query_as::<_, TaskRecord>(
            r#"
            INSERT INTO task_runs (id, kind, user_id, status, progress, payload, heartbeat_at)
            VALUES ($1, $2, $3, 'pending', 0, $4, NOW())
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(kind)
        .bind(user_id)
        .bind(payload)
        .fetch_one(&self.pool)
        .await?;
        Ok(task)
    }

    pub async fn task_by_id(&self, id: &str) -> ApiResult<Option<TaskRecord>> {
        Ok(
            sqlx::query_as::<_, TaskRecord>("SELECT * FROM task_runs WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_task(
        &self,
        id: &str,
        status: &str,
        progress: i32,
        result: Option<&Value>,
        error_msg: Option<&str>,
        heartbeat: bool,
    ) -> ApiResult<bool> {
        let rows = sqlx::query(
            r#"
            UPDATE task_runs SET
                status = $2,
                progress = $3,
                result = COALESCE($4, result),
                error_msg = $5,
                updated_at = NOW(),
                heartbeat_at = CASE WHEN $6 THEN NOW() ELSE heartbeat_at END
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(status)
        .bind(progress.clamp(0, 100))
        .bind(result)
        .bind(error_msg)
        .bind(heartbeat)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(rows > 0)
    }

    pub async fn increment_task_retry(&self, id: &str) -> ApiResult<bool> {
        let rows = sqlx::query(
            "UPDATE task_runs SET retry_count = retry_count + 1, updated_at = NOW(), heartbeat_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(rows > 0)
    }

    /// Recover tasks left in `processing` by a process restart.  The worker
    /// can then claim them again; callers decide whether the retry budget is
    /// exhausted and should become `failed`.
    pub async fn recover_stale_tasks(&self, cutoff: NaiveDateTime) -> ApiResult<u64> {
        Ok(sqlx::query(
            // Keep updated_at stale so the same recovery cycle can claim the row
            // through stale_pending_tasks instead of waiting another minute.
            "UPDATE task_runs SET status = 'pending', updated_at = heartbeat_at, heartbeat_at = heartbeat_at WHERE status = 'processing' AND heartbeat_at < $1",
        )
        .bind(cutoff)
        .execute(&self.pool)
        .await?
        .rows_affected())
    }

    pub async fn stale_pending_tasks(&self, cutoff: NaiveDateTime) -> ApiResult<Vec<TaskRecord>> {
        Ok(sqlx::query_as::<_, TaskRecord>(
            "SELECT * FROM task_runs WHERE status = 'pending' AND updated_at < $1 ORDER BY created_at LIMIT 20",
        )
        .bind(cutoff)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn claim_task(&self, id: &str) -> ApiResult<bool> {
        Ok(sqlx::query("UPDATE task_runs SET status = 'processing', updated_at = NOW(), heartbeat_at = NOW() WHERE id = $1 AND status = 'pending'")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected() > 0)
    }

    pub async fn save_keyword_history(&self, user_id: i32, record: &Value) -> ApiResult<()> {
        sqlx::query("INSERT INTO keyword_histories (user_id, record) VALUES ($1, $2)")
            .bind(user_id)
            .bind(record)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn keyword_history(&self, user_id: i32, limit: i64) -> ApiResult<Vec<Value>> {
        let rows = sqlx::query("SELECT record FROM keyword_histories WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2")
            .bind(user_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        use sqlx::Row;
        Ok(rows.into_iter().map(|row| row.get("record")).collect())
    }

    pub async fn delete_keyword_history(&self, user_id: i32, index: i64) -> ApiResult<bool> {
        let id: Option<i32> = sqlx::query_scalar("SELECT id FROM keyword_histories WHERE user_id = $1 ORDER BY created_at DESC, id DESC OFFSET $2 LIMIT 1")
            .bind(user_id)
            .bind(index.max(0))
            .fetch_optional(&self.pool)
            .await?;
        let Some(id) = id else { return Ok(false) };
        Ok(sqlx::query("DELETE FROM keyword_histories WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected()
            > 0)
    }

    pub async fn clear_keyword_history(&self, user_id: i32) -> ApiResult<u64> {
        Ok(
            sqlx::query("DELETE FROM keyword_histories WHERE user_id = $1")
                .bind(user_id)
                .execute(&self.pool)
                .await?
                .rows_affected(),
        )
    }
}
