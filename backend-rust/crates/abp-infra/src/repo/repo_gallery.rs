use super::{Db, NewSavedImage};
use abp_core::domain::{SavedImage, User};
use abp_core::ApiResult;
use chrono::NaiveDateTime;
use sqlx::Row;

impl Db {
    pub async fn insert_saved_image(&self, image: &NewSavedImage) -> ApiResult<SavedImage> {
        Ok(sqlx::query_as::<_, SavedImage>(
            r#"INSERT INTO saved_images
                (user_id, filename, file_path, url, prompt, width, height, category, is_shared)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               RETURNING *"#,
        )
        .bind(image.user_id)
        .bind(&image.filename)
        .bind(&image.file_path)
        .bind(&image.url)
        .bind(&image.prompt)
        .bind(image.width)
        .bind(image.height)
        .bind(&image.category)
        .bind(image.is_shared)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn all_saved_images(&self) -> ApiResult<Vec<SavedImage>> {
        Ok(
            sqlx::query_as::<_, SavedImage>("SELECT * FROM saved_images")
                .fetch_all(&self.pool)
                .await?,
        )
    }

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
        let admin_all =
            is_admin && scope_user.is_none() && view_mode != "own" && view_mode != "user";
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

    pub async fn usernames_by_ids(
        &self,
        ids: &[i32],
    ) -> ApiResult<std::collections::HashMap<i32, String>> {
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
    pub async fn image_visible(
        &self,
        image_id: i32,
        viewer: &User,
    ) -> ApiResult<Option<SavedImage>> {
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

    pub async fn set_image_shared(
        &self,
        image_id: i32,
        shared: bool,
        viewer: &User,
    ) -> ApiResult<bool> {
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

    pub async fn toggle_image_shared(&self, image_id: i32) -> ApiResult<Option<bool>> {
        Ok(sqlx::query_scalar(
            "UPDATE saved_images SET is_shared = NOT is_shared WHERE id = $1 RETURNING is_shared",
        )
        .bind(image_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn batch_share_images(&self, ids: &[i32], shared: bool) -> ApiResult<u64> {
        Ok(
            sqlx::query("UPDATE saved_images SET is_shared = $2 WHERE id = ANY($1)")
                .bind(ids)
                .bind(shared)
                .execute(&self.pool)
                .await?
                .rows_affected(),
        )
    }

    pub async fn share_all_images_admin(&self, shared: bool, skip: i64) -> ApiResult<u64> {
        Ok(sqlx::query("UPDATE saved_images SET is_shared = $1 WHERE id IN (SELECT id FROM saved_images ORDER BY created_at DESC OFFSET $2)")
            .bind(shared)
            .bind(skip.max(0))
            .execute(&self.pool)
            .await?
            .rows_affected())
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
}
