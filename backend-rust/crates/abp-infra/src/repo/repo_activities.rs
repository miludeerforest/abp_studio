use super::Db;
use abp_core::ApiResult;
use chrono::NaiveDateTime;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct ActivityRecord {
    pub id: i32,
    pub user_id: Option<i32>,
    pub username: Option<String>,
    pub nickname: Option<String>,
    pub action: Option<String>,
    pub details: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}

impl Db {
    pub async fn log_activity(&self, user_id: i32, action: &str, details: &str) -> ApiResult<()> {
        sqlx::query(
            "INSERT INTO user_activities (user_id, action, details, created_at) VALUES ($1, $2, $3, NOW())",
        )
        .bind(user_id)
        .bind(action)
        .bind(details)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn recent_activities(
        &self,
        limit: i64,
        offset: i64,
    ) -> ApiResult<Vec<ActivityRecord>> {
        Ok(sqlx::query_as::<_, ActivityRecord>(
            r#"SELECT a.id, a.user_id, u.username, u.nickname, a.action, a.details, a.created_at
               FROM user_activities a
               LEFT JOIN users u ON u.id = a.user_id
               ORDER BY a.created_at DESC
               LIMIT $1 OFFSET $2"#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn recent_activities_since(
        &self,
        since: NaiveDateTime,
        limit: i64,
    ) -> ApiResult<Vec<ActivityRecord>> {
        Ok(sqlx::query_as::<_, ActivityRecord>(
            r#"SELECT a.id, a.user_id, u.username, u.nickname, a.action, a.details, a.created_at
               FROM user_activities a
               LEFT JOIN users u ON u.id = a.user_id
               WHERE a.created_at >= $1
               ORDER BY a.created_at DESC
               LIMIT $2"#,
        )
        .bind(since)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn clear_activities(&self) -> ApiResult<u64> {
        Ok(sqlx::query("DELETE FROM user_activities")
            .execute(&self.pool)
            .await?
            .rows_affected())
    }
}
