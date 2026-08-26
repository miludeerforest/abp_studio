//! 数据仓储层：所有 SQL 集中在此，服务层不接触 SQL。
//!
//! 查询语义逐条对照 Python/SQLAlchemy 原实现，
//! 确保同一数据库上行为一致（零数据迁移）。

use abp_core::domain::{ExperienceLog, SavedImage, SystemConfigEntry, User, VideoQueueItem};
use abp_core::{ApiError, ApiResult};
use chrono::NaiveDateTime;
use sqlx::{PgPool, Row};

/// 数据访问门面：持有连接池。
#[derive(Clone)]
pub struct Db {
    pub pool: PgPool,
}

impl Db {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // ====================================================================
    // users
    // ====================================================================

    pub async fn user_by_username(&self, username: &str) -> ApiResult<Option<User>> {
        let u = sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE username = $1",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        Ok(u)
    }

    pub async fn user_by_id(&self, id: i32) -> ApiResult<Option<User>> {
        let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(u)
    }

    pub async fn list_users(&self) -> ApiResult<Vec<User>> {
        let rows = sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY id")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    pub async fn admin_ids(&self) -> ApiResult<Vec<i32>> {
        let rows = sqlx::query("SELECT id FROM users WHERE role = 'admin'")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(|r| r.get::<i32, _>(0)).collect())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_user(
        &self,
        user_id: i32,
        nickname: Option<&str>,
        avatar: Option<Option<&str>>,
        role: Option<&str>,
        hashed_password: Option<&str>,
        default_share: Option<bool>,
    ) -> ApiResult<()> {
        sqlx::query(
            r#"
            UPDATE users SET
                nickname = COALESCE($2, nickname),
                avatar = CASE WHEN $3 THEN $4 ELSE avatar END,
                role = COALESCE($5, role),
                hashed_password = COALESCE($6, hashed_password),
                default_share = COALESCE($7, default_share)
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .bind(nickname)
        .bind(avatar.is_some())
        .bind(avatar.flatten())
        .bind(role)
        .bind(hashed_password)
        .bind(default_share)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_user(&self, user_id: i32) -> ApiResult<bool> {
        let res = sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    /// 事务内加经验：读取旧值 → 计算新等级 → 写回 + 写流水。
    pub async fn grant_experience(
        &self,
        user_id: i32,
        amount: i32,
        reason: &str,
    ) -> ApiResult<(i32, i32)> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query("SELECT experience FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
        let old_exp: i64 = row.try_get::<i32, _>(0)? as i64;
        let new_exp = (old_exp + amount as i64).max(0);
        let (new_level, _) = abp_core::domain::calculate_level(new_exp);
        sqlx::query("UPDATE users SET experience = $2, level = $3, exp_updated_at = NOW() WHERE id = $1")
            .bind(user_id)
            .bind(new_exp as i32)
            .bind(new_level)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"
            INSERT INTO experience_logs
                (user_id, exp_change, exp_before, exp_after, level_before, level_after, reason, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            "#,
        )
        .bind(user_id)
        .bind(amount)
        .bind(old_exp as i32)
        .bind(new_exp as i32)
        .bind(abp_core::domain::calculate_level(old_exp).0)
        .bind(new_level)
        .bind(reason)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((new_exp as i32, new_level))
    }

    pub async fn experience_history(&self, user_id: i32, limit: i64) -> ApiResult<Vec<ExperienceLog>> {
        let rows = sqlx::query_as::<_, ExperienceLog>(
            "SELECT * FROM experience_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    // ====================================================================
    // system_config
    // ====================================================================

    pub async fn all_config(&self) -> ApiResult<Vec<SystemConfigEntry>> {
        let rows = sqlx::query_as::<_, SystemConfigEntry>(
            "SELECT key, value FROM system_config",
        )
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
    // saved_images (gallery)
    // ====================================================================

    #[allow(clippy::too_many_arguments)]
    pub async fn gallery_images(
        &self,
        viewer: &User,
        view_mode: &str,
        filter_user_id: Option<i32>,
        category: Option<&str>,
        start: Option<NaiveDateTime>,
        end_exclusive: Option<NaiveDateTime>,
        limit: i64,
        offset: i64,
    ) -> ApiResult<(i64, Vec<SavedImage>)> {
        // 可见性语义（与 Python 端一致）：
        // - 管理员 all：全部；管理员 user 模式：指定用户；否则：自己（+普通用户的公开图）
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
        // admin_all=true 时不过滤归属；scope_user 为空时回退到 viewer 自己
        let admin_all = is_admin && scope_user.is_none() && view_mode != "own" && view_mode != "user";
        let owner_id = scope_user.unwrap_or(viewer.id);
        // 普通用户额外可见他人公开图
        let include_shared = !is_admin;

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS c FROM saved_images
            WHERE ($1::bool
                   OR user_id = $2::int
                   OR ($3::bool AND is_shared))
              AND ($4::text IS NULL OR category = $4)
              AND ($5::timestamptz IS NULL OR created_at >= $5)
              AND ($6::timestamptz IS NULL OR created_at < $6)
            "#,
        )
        .bind(admin_all)
        .bind(owner_id)
        .bind(include_shared)
        .bind(category.filter(|c| !c.is_empty() && *c != "all"))
        .bind(start)
        .bind(end_exclusive)
        .fetch_one(&self.pool)
        .await?;
        let total: i64 = total_row.try_get(0)?;

        let items = sqlx::query_as::<_, SavedImage>(
            r#"
            SELECT * FROM saved_images
            WHERE ($1::bool
                   OR user_id = $2::int
                   OR ($3::bool AND is_shared))
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
        .bind(category.filter(|c| !c.is_empty() && *c != "all"))
        .bind(start)
        .bind(end_exclusive)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        Ok((total, items))
    }

    pub async fn usernames_by_ids(&self, ids: &[i32]) -> ApiResult<std::collections::HashMap<i32, String>> {
        if ids.is_empty() {
            return Ok(Default::default());
        }
        let rows = sqlx::query("SELECT id, username FROM users WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|r| (r.get::<i32, _>(0), r.get::<String, _>(1)))
            .collect())
    }

    /// 取图片（含 file_path），供删除文件使用。返回 (行, 是否可见)。
    pub async fn image_visible(&self, image_id: i32, viewer: &User) -> ApiResult<Option<SavedImage>> {
        let img = sqlx::query_as::<_, SavedImage>("SELECT * FROM saved_images WHERE id = $1")
            .bind(image_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(img.filter(|i| viewer.role == "admin" || i.user_id == viewer.id))
    }

    pub async fn delete_image(&self, image_id: i32) -> ApiResult<()> {
        sqlx::query("DELETE FROM saved_images WHERE id = $1")
            .bind(image_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_images_by_ids(&self, ids: &[i32], viewer: &User) -> ApiResult<Vec<i32>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let deleted: Vec<i32> = if viewer.role == "admin" {
            sqlx::query_scalar("DELETE FROM saved_images WHERE id = ANY($1) RETURNING id")
                .bind(ids)
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query_scalar(
                "DELETE FROM saved_images WHERE id = ANY($1) AND user_id = $2 RETURNING id",
            )
            .bind(ids)
            .bind(viewer.id)
            .fetch_all(&self.pool)
            .await?
        };
        Ok(deleted)
    }

    pub async fn set_image_shared(&self, image_id: i32, shared: bool, viewer: &User) -> ApiResult<bool> {
        let res = if viewer.role == "admin" {
            sqlx::query("UPDATE saved_images SET is_shared = $2 WHERE id = $1")
                .bind(image_id)
                .bind(shared)
                .execute(&self.pool)
                .await?
        } else {
            sqlx::query("UPDATE saved_images SET is_shared = $2 WHERE id = $1 AND user_id = $3")
                .bind(image_id)
                .bind(shared)
                .bind(viewer.id)
                .execute(&self.pool)
                .await?
        };
        Ok(res.rows_affected() > 0)
    }

    pub async fn share_all_images(&self, viewer: &User, shared: bool) -> ApiResult<u64> {
        let res = sqlx::query("UPDATE saved_images SET is_shared = $2 WHERE user_id = $1")
            .bind(viewer.id)
            .bind(shared)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }

    // ====================================================================
    // video_queue
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

    pub async fn insert_video(&self, item: &NewVideoItem) -> ApiResult<()> {
        sqlx::query(
            r#"
            INSERT INTO video_queue
                (id, filename, file_path, prompt, status, result_url, error_msg,
                 user_id, category, is_merged, is_shared, preview_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11)
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
        .execute(&self.pool)
        .await?;
        Ok(())
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
                retry_count = retry_count + 1, last_retry_at = NOW()
            WHERE id = $1 AND ($2 OR user_id = $3)
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
    // user_activities
    // ====================================================================

    pub async fn log_activity(&self, user_id: i32, action: &str, detail: &str) -> ApiResult<()> {
        sqlx::query("INSERT INTO user_activities (user_id, action, detail, created_at) VALUES ($1, $2, $3, NOW())")
            .bind(user_id)
            .bind(action)
            .bind(detail)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn recent_activities(&self, limit: i64, offset: i64) -> ApiResult<Vec<serde_json::Value>> {
        let rows = sqlx::query(
            r#"
            SELECT a.id, a.user_id, u.username, u.nickname, a.action, a.detail, a.created_at
            FROM user_activities a LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                serde_json::json!({
                    "id": r.get::<i32, _>("id"),
                    "user_id": r.get::<Option<i32>, _>("user_id"),
                    "username": r.get::<Option<String>, _>("username").unwrap_or_else(|| "Unknown".into()),
                    "nickname": r.get::<Option<String>, _>("nickname"),
                    "action": r.get::<String, _>("action"),
                    "detail": r.get::<Option<String>, _>("detail"),
                    "created_at": r.get::<Option<NaiveDateTime>, _>("created_at"),
                })
            })
            .collect())
    }

    pub async fn clear_activities(&self) -> ApiResult<u64> {
        let res = sqlx::query("DELETE FROM user_activities")
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }

    // ====================================================================
    // stats（管理员仪表盘）
    // ====================================================================

    pub async fn stats_snapshot(&self) -> ApiResult<serde_json::Value> {
        let user_stats = sqlx::query(
            r#"
            SELECT u.id, u.username, u.role,
                   COALESCE(i.cnt, 0) AS image_count,
                   COALESCE(v.cnt, 0) AS video_count,
                   COALESCE(it.cnt, 0) AS today_images,
                   COALESCE(vt.cnt, 0) AS today_videos
            FROM users u
            LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM saved_images GROUP BY user_id) i ON i.user_id = u.id
            LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM video_queue WHERE status IN ('done','archived') GROUP BY user_id) v ON v.user_id = u.id
            LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM saved_images WHERE created_at >= DATE_TRUNC('day', NOW()) GROUP BY user_id) it ON it.user_id = u.id
            LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM video_queue WHERE status IN ('done','archived') AND created_at >= DATE_TRUNC('day', NOW()) GROUP BY user_id) vt ON vt.user_id = u.id
            ORDER BY u.id
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let by_day = sqlx::query(
            r#"
            SELECT d::date AS day,
                   COALESCE((SELECT COUNT(*) FROM saved_images s WHERE s.created_at::date = d::date), 0) AS images,
                   COALESCE((SELECT COUNT(*) FROM video_queue v WHERE v.status IN ('done','archived') AND v.created_at::date = d::date), 0) AS videos
            FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') d
            ORDER BY d
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let user_stats_json: Vec<serde_json::Value> = user_stats
            .iter()
            .map(|r| {
                serde_json::json!({
                    "id": r.get::<i32, _>("id"),
                    "username": r.get::<String, _>("username"),
                    "role": r.get::<String, _>("role"),
                    "image_count": r.get::<i64, _>("image_count"),
                    "video_count": r.get::<i64, _>("video_count"),
                    "today_images": r.get::<i64, _>("today_images"),
                    "today_videos": r.get::<i64, _>("today_videos"),
                })
            })
            .collect();

        let mut by_day_json = vec![];
        for r in &by_day {
            let day: String = r.get::<chrono::NaiveDate, _>("day").to_string();
            let img: i64 = r.get("images");
            let vid: i64 = r.get("videos");
            if img > 0 {
                by_day_json.push(serde_json::json!({"date": day, "count": img, "type": "image"}));
            }
            if vid > 0 {
                by_day_json.push(serde_json::json!({"date": day, "count": vid, "type": "video"}));
            }
        }

        Ok(serde_json::json!({
            "user_stats": user_stats_json,
            "by_day": by_day_json,
            "by_week": [],
            "by_month": [],
        }))
    }
}

/// 新建视频队列项的入参。
pub struct NewVideoItem {
    pub id: String,
    pub filename: String,
    pub file_path: String,
    pub prompt: String,
    pub user_id: Option<i32>,
    pub category: String,
    pub is_shared: bool,
    pub preview_url: Option<String>,
}
