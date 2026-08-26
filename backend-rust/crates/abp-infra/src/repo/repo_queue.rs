use super::{Db, NewVideoItem};
use abp_core::domain::{User, VideoQueueItem};
use abp_core::{ApiError, ApiResult};
use chrono::NaiveDateTime;
use sqlx::Row;

impl Db {
    // ====================================================================

    /// 公平调度排序的队列视图（与 Python `/api/v1/queue` 一致）。
    pub async fn queue_view(&self, viewer: &User) -> ApiResult<Vec<VideoQueueItem>> {
        let admin_ids = self.admin_ids().await?;
        let items = sqlx::query_as::<_, VideoQueueItem>(
            r#"
            SELECT v.* FROM video_queue v
            WHERE v.status != 'archived'
              AND ($1 OR v.user_id = $2)
            ORDER BY (CASE WHEN v.user_id = ANY($3) THEN 0 ELSE 600 END)
                     - EXTRACT(EPOCH FROM (NOW() - v.created_at)) ASC
            "#,
        )
        .bind(viewer.role == "admin")
        .bind(viewer.id)
        .bind(&admin_ids)
        .fetch_all(&self.pool)
        .await?;
        Ok(items)
    }

    pub async fn pending_video_items(&self, limit: i64) -> ApiResult<Vec<VideoQueueItem>> {
        Ok(sqlx::query_as::<_, VideoQueueItem>(
            "SELECT * FROM video_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn queue_items_for_clear(
        &self,
        viewer: &User,
        status: Option<&str>,
    ) -> ApiResult<Vec<VideoQueueItem>> {
        Ok(sqlx::query_as::<_, VideoQueueItem>(
            "SELECT * FROM video_queue WHERE ($1 OR user_id = $2) AND ($3::text IS NULL OR status = $3)",
        )
        .bind(viewer.role == "admin")
        .bind(viewer.id)
        .bind(status)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn tasks_for_user(&self, user_id: i32, limit: i64) -> ApiResult<Vec<VideoQueueItem>> {
        Ok(sqlx::query_as::<_, VideoQueueItem>(
            "SELECT * FROM video_queue WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    /// 画廊视频视图：仅已完成（done/archived），权限语义与图片一致。
    #[allow(clippy::too_many_arguments)]
    pub async fn gallery_videos(
        &self,
        viewer: &User,
        view_mode: &str,
        filter_user_id: Option<i32>,
        category: Option<&str>,
        start: Option<NaiveDateTime>,
        end_exclusive: Option<NaiveDateTime>,
        limit: i64,
        offset: i64,
    ) -> ApiResult<(i64, Vec<VideoQueueItem>)> {
        let is_admin = viewer.role == "admin";
        let scope_user: Option<i32> = if is_admin {
            match view_mode {
                "user" => filter_user_id,
                "all" => None,
                _ => Some(viewer.id),
            }
        } else {
            None
        };
        let admin_all =
            is_admin && scope_user.is_none() && view_mode != "own" && view_mode != "user";
        let owner_id = scope_user.unwrap_or(viewer.id);
        let include_shared = !is_admin;
        let cat = category.filter(|c| !c.is_empty() && *c != "all");

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS c FROM video_queue
            WHERE status IN ('done','archived')
              AND ($1::bool OR user_id = $2::int OR ($3::bool AND is_shared))
              AND ($4::text IS NULL OR category = $4)
              AND ($5::timestamptz IS NULL OR created_at >= $5)
              AND ($6::timestamptz IS NULL OR created_at < $6)
            "#,
        )
        .bind(admin_all)
        .bind(owner_id)
        .bind(include_shared)
        .bind(cat)
        .bind(start)
        .bind(end_exclusive)
        .fetch_one(&self.pool)
        .await?;
        let total: i64 = total_row.try_get(0)?;

        let items = sqlx::query_as::<_, VideoQueueItem>(
            r#"
            SELECT * FROM video_queue
            WHERE status IN ('done','archived')
              AND ($1::bool OR user_id = $2::int OR ($3::bool AND is_shared))
              AND ($4::text IS NULL OR category = $4)
              AND ($5::timestamptz IS NULL OR created_at >= $5)
              AND ($6::timestamptz IS NULL OR created_at < $6)
            ORDER BY created_at DESC
            LIMIT $7 OFFSET $8
            "#,
        )
        .bind(admin_all)
        .bind(owner_id)
        .bind(include_shared)
        .bind(cat)
        .bind(start)
        .bind(end_exclusive)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        Ok((total, items))
    }

    pub async fn video_by_id(&self, id: &str) -> ApiResult<Option<VideoQueueItem>> {
        let v = sqlx::query_as::<_, VideoQueueItem>("SELECT * FROM video_queue WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(v)
    }

    pub async fn insert_video(&self, item: &NewVideoItem) -> ApiResult<VideoQueueItem> {
        Ok(sqlx::query_as::<_, VideoQueueItem>(
            r#"
            INSERT INTO video_queue
                (id, filename, file_path, prompt, status, result_url, error_msg,
                 user_id, category, is_merged, is_shared, preview_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11)
            RETURNING *
            "#,
        )
        .bind(&item.id)
        .bind(&item.filename)
        .bind(&item.file_path)
        .bind(&item.prompt)
        .bind("pending")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(item.user_id)
        .bind(&item.category)
        .bind(item.is_shared)
        .bind(&item.preview_url)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn update_video_status(
        &self,
        id: &str,
        status: &str,
        result_url: Option<&str>,
        error_msg: Option<&str>,
    ) -> ApiResult<()> {
        sqlx::query(
            "UPDATE video_queue SET status = $2, result_url = $3, error_msg = $4, last_retry_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(result_url)
        .bind(error_msg)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn increment_video_retry(&self, id: &str) -> ApiResult<bool> {
        let rows = sqlx::query(
            "UPDATE video_queue SET retry_count = retry_count + 1, last_retry_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(rows > 0)
    }

    pub async fn reset_video_retry(&self, id: &str) -> ApiResult<bool> {
        Ok(sqlx::query(
            "UPDATE video_queue SET retry_count = 0, last_retry_at = NULL WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            > 0)
    }

    pub async fn fail_video(&self, id: &str, error_msg: &str) -> ApiResult<bool> {
        Ok(
            sqlx::query("UPDATE video_queue SET status = 'error', error_msg = $2 WHERE id = $1")
                .bind(id)
                .bind(error_msg)
                .execute(&self.pool)
                .await?
                .rows_affected()
                > 0,
        )
    }

    pub async fn set_video_result(
        &self,
        id: &str,
        status: &str,
        result_url: Option<&str>,
        error_msg: Option<&str>,
        preview_url: Option<&str>,
    ) -> ApiResult<()> {
        sqlx::query(
            "UPDATE video_queue SET status = $2, result_url = $3, error_msg = $4, preview_url = COALESCE($5, preview_url), last_retry_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(result_url)
        .bind(error_msg)
        .bind(preview_url)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_video_merged(&self, id: &str) -> ApiResult<bool> {
        let rows = sqlx::query("UPDATE video_queue SET is_merged = TRUE WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(rows > 0)
    }

    pub async fn update_review(
        &self,
        id: &str,
        status: &str,
        score: Option<i32>,
        result: Option<&str>,
    ) -> ApiResult<()> {
        sqlx::query(
            "UPDATE video_queue SET review_status = $2, review_score = $3, review_result = $4, reviewed_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(score)
        .bind(result)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn toggle_video_shared(&self, id: &str) -> ApiResult<Option<bool>> {
        Ok(sqlx::query_scalar(
            "UPDATE video_queue SET is_shared = NOT is_shared WHERE id = $1 RETURNING is_shared",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn batch_share_videos(&self, ids: &[String], shared: bool) -> ApiResult<u64> {
        Ok(
            sqlx::query("UPDATE video_queue SET is_shared = $2 WHERE id = ANY($1)")
                .bind(ids)
                .bind(shared)
                .execute(&self.pool)
                .await?
                .rows_affected(),
        )
    }

    pub async fn share_all_videos_admin(&self, shared: bool, skip: i64) -> ApiResult<u64> {
        Ok(sqlx::query("UPDATE video_queue SET is_shared = $1 WHERE status IN ('done','archived') AND id IN (SELECT id FROM video_queue WHERE status IN ('done','archived') ORDER BY created_at DESC OFFSET $2)")
            .bind(shared)
            .bind(skip.max(0))
            .execute(&self.pool)
            .await?
            .rows_affected())
    }

    pub async fn update_video_fields(
        &self,
        id: &str,
        status: Option<&str>,
        result_url: Option<&str>,
        error_msg: Option<&str>,
    ) -> ApiResult<bool> {
        let rows = sqlx::query(
            "UPDATE video_queue SET status = COALESCE($2, status), result_url = COALESCE($3, result_url), error_msg = COALESCE($4, error_msg) WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(result_url)
        .bind(error_msg)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(rows > 0)
    }

    pub async fn recover_stale_video_items(&self, cutoff: NaiveDateTime) -> ApiResult<u64> {
        Ok(sqlx::query(
            "UPDATE video_queue SET status = CASE WHEN retry_count >= 3 THEN 'error' ELSE 'pending' END, error_msg = CASE WHEN retry_count >= 3 THEN '任务超时且已达最大重试次数' ELSE error_msg END WHERE status = 'processing' AND COALESCE(last_retry_at, created_at) < $1",
        )
        .bind(cutoff)
        .execute(&self.pool)
        .await?
        .rows_affected())
    }

    pub async fn cleanup_video_items(&self, cutoff: NaiveDateTime) -> ApiResult<u64> {
        Ok(sqlx::query(
            "DELETE FROM video_queue WHERE created_at < $1 AND status NOT IN ('done','archived') AND COALESCE(filename, '') NOT LIKE 'story_chain%' AND COALESCE(filename, '') NOT LIKE 'story_fission%'",
        )
        .bind(cutoff)
        .execute(&self.pool)
        .await?
        .rows_affected())
    }

    pub async fn delete_video(&self, id: &str, viewer: &User) -> ApiResult<Option<VideoQueueItem>> {
        let existing = self.video_by_id(id).await?;
        let visible = existing.filter(|v| viewer.role == "admin" || v.user_id == Some(viewer.id));
        if visible.is_some() {
            sqlx::query("DELETE FROM video_queue WHERE id = $1")
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        Ok(visible)
    }

    pub async fn retry_video(&self, id: &str, viewer: &User) -> ApiResult<VideoQueueItem> {
        let item = sqlx::query_as::<_, VideoQueueItem>(
            r#"
            UPDATE video_queue
            SET status = 'pending', error_msg = NULL, result_url = NULL,
                retry_count = 0, last_retry_at = NULL
            WHERE id = $1 AND status = 'error' AND ($2 OR user_id = $3)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(viewer.role == "admin")
        .bind(viewer.id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("queue item {id} not found")))?;
        Ok(item)
    }

    // ====================================================================
}
