use super::Db;
use abp_core::ApiResult;
use chrono::NaiveDateTime;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct PublicVideoRecord {
    pub id: String,
    pub prompt: Option<String>,
    pub result_url: Option<String>,
    pub preview_url: Option<String>,
    pub file_path: Option<String>,
    pub creator_username: Option<String>,
    pub creator_nickname: Option<String>,
    pub creator_avatar: Option<String>,
    pub category: Option<String>,
    pub is_merged: Option<bool>,
    pub created_at: NaiveDateTime,
}

impl Db {
    pub async fn public_videos(
        &self,
        limit: i64,
        offset: i64,
    ) -> ApiResult<(i64, Vec<PublicVideoRecord>)> {
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM video_queue WHERE status IN ('done','archived') AND is_shared",
        )
        .fetch_one(&self.pool)
        .await?;
        let rows = sqlx::query_as::<_, PublicVideoRecord>(
            r#"SELECT v.id, v.prompt, v.result_url, v.preview_url, v.file_path,
                      u.username AS creator_username,
                      u.nickname AS creator_nickname,
                      u.avatar AS creator_avatar,
                      v.category, v.is_merged, v.created_at
               FROM video_queue v
               LEFT JOIN users u ON u.id = v.user_id
               WHERE v.status IN ('done','archived') AND v.is_shared
               ORDER BY v.created_at DESC
               LIMIT $1 OFFSET $2"#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        Ok((total, rows))
    }
}
