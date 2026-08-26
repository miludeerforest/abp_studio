use super::Db;
use abp_core::ApiResult;
use sqlx::Row;

impl Db {
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

    pub async fn live_task_counts(&self) -> ApiResult<(i64, i64, i64, i64)> {
        Ok(sqlx::query_as::<_, (i64, i64, i64, i64)>(
            r#"SELECT
                (SELECT COUNT(*) FROM video_queue WHERE status = 'processing') AS video_processing,
                (SELECT COUNT(*) FROM video_queue WHERE status = 'pending') AS video_pending,
                (SELECT COUNT(*) FROM task_runs WHERE kind = 'story-fission' AND status IN ('processing','merging')) AS fission_active,
                (SELECT COUNT(*) FROM task_runs WHERE kind = 'story-chain' AND status IN ('processing','merging')) AS chain_active"#,
        )
        .fetch_one(&self.pool)
        .await?)
    }
}
