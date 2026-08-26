use super::Db;
use abp_core::domain::{ExperienceLog, User};
use abp_core::ApiResult;
use sqlx::Row;

impl Db {
    // ====================================================================

    pub async fn user_by_username(&self, username: &str) -> ApiResult<Option<User>> {
        let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;
        Ok(u)
    }

    pub async fn create_user(
        &self,
        username: &str,
        hashed_password: &str,
        role: &str,
    ) -> ApiResult<User> {
        Ok(sqlx::query_as::<_, User>(
            "INSERT INTO users (username, hashed_password, role, default_share, created_at) VALUES ($1,$2,$3,TRUE,NOW()) RETURNING *",
        )
        .bind(username)
        .bind(hashed_password)
        .bind(role)
        .fetch_one(&self.pool)
        .await?)
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

    pub async fn update_admin_user(
        &self,
        user_id: i32,
        username: Option<&str>,
        role: Option<&str>,
        hashed_password: Option<&str>,
    ) -> ApiResult<()> {
        sqlx::query(
            "UPDATE users SET username = COALESCE($2, username), role = COALESCE($3, role), hashed_password = COALESCE($4, hashed_password) WHERE id = $1",
        )
        .bind(user_id)
        .bind(username)
        .bind(role)
        .bind(hashed_password)
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
        video_id: Option<&str>,
        score: Option<i32>,
    ) -> ApiResult<(i32, i32)> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query("SELECT experience FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
        let old_exp: i64 = row.try_get::<i32, _>(0)? as i64;
        let new_exp = (old_exp + amount as i64).max(0);
        let (new_level, _) = abp_core::domain::calculate_level(new_exp);
        sqlx::query(
            "UPDATE users SET experience = $2, level = $3, exp_updated_at = NOW() WHERE id = $1",
        )
        .bind(user_id)
        .bind(new_exp as i32)
        .bind(new_level)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO experience_logs
                (user_id, video_id, score, exp_change, exp_before, exp_after, level_before, level_after, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            "#,
        )
        .bind(user_id)
        .bind(video_id)
        .bind(score)
        .bind(amount)
        .bind(old_exp as i32)
        .bind(new_exp as i32)
        .bind(abp_core::domain::calculate_level(old_exp).0)
        .bind(new_level)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((new_exp as i32, new_level))
    }

    pub async fn experience_history(
        &self,
        user_id: i32,
        limit: i64,
    ) -> ApiResult<Vec<ExperienceLog>> {
        let rows = sqlx::query_as::<_, ExperienceLog>(
            "SELECT id, user_id, video_id, score, exp_change, exp_before, exp_after, level_before, level_after, created_at FROM experience_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    // ====================================================================
}
