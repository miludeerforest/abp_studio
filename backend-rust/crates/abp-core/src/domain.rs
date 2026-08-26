//! 领域模型：与既有 PostgreSQL 表结构一一对应（schema 不变，零迁移成本）。

use chrono::NaiveDateTime;
use serde::Serialize;

/// users 表
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: i32,
    pub username: String,
    pub nickname: Option<String>,
    pub avatar: Option<String>,
    #[serde(skip_serializing)]
    pub hashed_password: String,
    /// 'admin' | 'user'
    pub role: String,
    /// 创作内容默认同步公开画廊（历史行可能为 NULL）
    pub default_share: Option<bool>,
    pub created_at: Option<NaiveDateTime>,
    pub experience: i32,
    pub level: i32,
    pub exp_updated_at: Option<NaiveDateTime>,
}

impl User {
    pub fn display_name(&self) -> &str {
        self.nickname.as_deref().unwrap_or(&self.username)
    }
}

/// system_config 表（key-value 配置）
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SystemConfigEntry {
    pub key: String,
    pub value: Option<String>,
}

/// saved_images 表 — 画廊图片
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SavedImage {
    pub id: i32,
    pub user_id: i32,
    pub filename: String,
    /// 本地磁盘路径（如 /app/uploads/gallery/...），不对外序列化
    #[serde(skip_serializing)]
    pub file_path: String,
    pub url: String,
    pub prompt: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub category: Option<String>,
    pub is_shared: bool,
    pub created_at: Option<NaiveDateTime>,
}

/// video_queue 表 — 视频队列项
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct VideoQueueItem {
    pub id: String,
    pub filename: Option<String>,
    /// 本地磁盘路径，不对外序列化
    #[serde(skip_serializing)]
    pub file_path: Option<String>,
    pub prompt: Option<String>,
    /// pending | processing | done | error
    pub status: String,
    pub result_url: Option<String>,
    pub error_msg: Option<String>,
    pub user_id: Option<i32>,
    pub category: Option<String>,
    pub is_merged: Option<bool>,
    pub is_shared: bool,
    pub created_at: Option<NaiveDateTime>,
    pub preview_url: Option<String>,
    pub retry_count: i32,
    pub last_retry_at: Option<NaiveDateTime>,
    pub review_score: Option<i32>,
    pub review_result: Option<String>,
    pub review_status: Option<String>,
    pub reviewed_at: Option<NaiveDateTime>,
}

pub fn effective_preview_url(preview_url: Option<&str>, file_path: Option<&str>) -> Option<String> {
    if let Some(preview) = preview_url.filter(|value| !value.is_empty()) {
        return Some(preview.to_string());
    }
    file_path.map(|path| match path.strip_prefix("/app/uploads") {
        Some("") => "/uploads".to_string(),
        Some(rest) => format!("/uploads{rest}"),
        None => path.to_string(),
    })
}

impl VideoQueueItem {
    /// 与 Python 端 `preview_url` property 一致的派生逻辑：
    /// 显式 preview_url 优先；否则由 /app/uploads 路径推导出 Web URL。
    pub fn effective_preview_url(&self) -> Option<String> {
        effective_preview_url(self.preview_url.as_deref(), self.file_path.as_deref())
    }
}

/// user_activities 表 — 操作审计
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct UserActivity {
    pub id: i32,
    pub user_id: i32,
    pub action: String,
    pub detail: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}

/// image_logs 表 — 图片生成计数日志
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ImageGenerationLog {
    pub id: i32,
    pub user_id: i32,
    pub count: i32,
    pub created_at: Option<NaiveDateTime>,
}

/// experience_logs 表 — 经验值流水（列与 migrate_user_experience.py 一致）。
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ExperienceLog {
    pub id: i32,
    pub user_id: i32,
    pub video_id: Option<String>,
    pub score: Option<i32>,
    pub exp_change: Option<i32>,
    pub exp_before: Option<i32>,
    pub exp_after: Option<i32>,
    pub level_before: Option<i32>,
    pub level_after: Option<i32>,
    // Python schema has no free-form reason column; keep the persisted contract exact.
    pub created_at: Option<NaiveDateTime>,
}

/// Persisted long-running workflow state.  This replaces the Python process-local
/// dictionaries used by batch/story/fission tasks and survives restarts.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TaskRecord {
    pub id: String,
    pub kind: String,
    pub user_id: Option<i32>,
    pub status: String,
    pub progress: i32,
    pub payload: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub error_msg: Option<String>,
    pub retry_count: i32,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
    pub heartbeat_at: Option<NaiveDateTime>,
}

/// 修仙等级体系（27 级）：与 Python 端 `LEVEL_THRESHOLDS` 完全一致。
/// (level, min_exp, max_exp, name)
pub const LEVEL_THRESHOLDS: &[(i32, i64, i64, &str)] = &[
    // 凡人境
    (1, 0, 99, "凡人前期"),
    (2, 100, 249, "凡人中期"),
    (3, 250, 499, "凡人后期"),
    // 练气境
    (4, 500, 899, "练气前期"),
    (5, 900, 1399, "练气中期"),
    (6, 1400, 1999, "练气后期"),
    // 筑基境
    (7, 2000, 2699, "筑基前期"),
    (8, 2700, 3599, "筑基中期"),
    (9, 3600, 4999, "筑基后期"),
    // 结丹境
    (10, 5000, 6499, "结丹前期"),
    (11, 6500, 8199, "结丹中期"),
    (12, 8200, 9999, "结丹后期"),
    // 元婴境
    (13, 10000, 12499, "元婴前期"),
    (14, 12500, 15199, "元婴中期"),
    (15, 15200, 17999, "元婴后期"),
    // 化神境
    (16, 18000, 21999, "化神前期"),
    (17, 22000, 25999, "化神中期"),
    (18, 26000, 29999, "化神后期"),
    // 炼虚境
    (19, 30000, 36999, "炼虚前期"),
    (20, 37000, 43499, "炼虚中期"),
    (21, 43500, 49999, "炼虚后期"),
    // 合体境
    (22, 50000, 59999, "合体前期"),
    (23, 60000, 69999, "合体中期"),
    (24, 70000, 79999, "合体后期"),
    // 大乘境
    (25, 80000, 94999, "大乘前期"),
    (26, 95000, 109999, "大乘中期"),
    (27, 110000, i64::MAX, "大乘后期"),
];

/// 根据经验值计算等级（与 Python `calculate_level` 一致）。
pub fn calculate_level(experience: i64) -> (i32, &'static str) {
    for &(lvl, min, max, name) in LEVEL_THRESHOLDS {
        if (min..=max).contains(&experience) {
            return (lvl, name);
        }
    }
    (27, "大乘后期")
}

/// 当前等级进度百分比 0-100（与 Python `get_level_progress` 一致）。
pub fn level_progress(experience: i64) -> f64 {
    let (level, _) = calculate_level(experience);
    for &(lvl, min, max, _) in LEVEL_THRESHOLDS {
        if lvl == level {
            if max == i64::MAX {
                return 100.0;
            }
            return (experience - min) as f64 / (max - min + 1) as f64 * 100.0;
        }
    }
    0.0
}

/// 根据视频审查评分计算经验值变化（与 Python `calculate_exp_change` 一致）。
pub fn exp_change_for_review_score(score: i32) -> i32 {
    if score >= 8 {
        20
    } else if score >= 5 {
        10
    } else {
        -5
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(preview: Option<&str>, file: Option<&str>) -> VideoQueueItem {
        VideoQueueItem {
            id: "t".into(),
            filename: None,
            file_path: file.map(|s| s.to_string()),
            prompt: None,
            status: "pending".into(),
            result_url: None,
            error_msg: None,
            user_id: None,
            category: None,
            is_merged: None,
            is_shared: true,
            created_at: None,
            preview_url: preview.map(|s| s.to_string()),
            retry_count: 0,
            last_retry_at: None,
            review_score: None,
            review_result: None,
            review_status: None,
            reviewed_at: None,
        }
    }

    #[test]
    fn preview_url_prefers_explicit() {
        let item = video(Some("preview"), Some("/app/uploads/queue/a.mp4"));
        assert_eq!(item.effective_preview_url().as_deref(), Some("preview"));
    }

    #[test]
    fn preview_url_derives_from_file_path() {
        let item = video(Some(""), Some("/app/uploads/queue/b.mp4"));
        assert_eq!(
            item.effective_preview_url().as_deref(),
            Some("/uploads/queue/b.mp4")
        );
        let item2 = video(None, Some("/app/uploads/x.png"));
        assert_eq!(
            item2.effective_preview_url().as_deref(),
            Some("/uploads/x.png")
        );
    }

    #[test]
    fn preview_url_none_when_absent() {
        let item = video(None, None);
        assert_eq!(item.effective_preview_url(), None);
    }

    #[test]
    fn password_hash_never_serialized() {
        let u = User {
            id: 1,
            username: "alice".into(),
            nickname: None,
            avatar: None,
            hashed_password: "$2b$12$secret".into(),
            role: "user".into(),
            default_share: Some(true),
            created_at: None,
            experience: 0,
            level: 1,
            exp_updated_at: None,
        };
        let json = serde_json::to_value(&u).unwrap();
        assert!(json.get("hashed_password").is_none());
        assert_eq!(json["username"], "alice");
    }

    #[test]
    fn level_boundaries() {
        assert_eq!(calculate_level(0), (1, "凡人前期"));
        assert_eq!(calculate_level(99), (1, "凡人前期"));
        assert_eq!(calculate_level(100), (2, "凡人中期"));
        assert_eq!(calculate_level(499), (3, "凡人后期"));
        assert_eq!(calculate_level(500), (4, "练气前期"));
        assert_eq!(calculate_level(110_000), (27, "大乘后期"));
        assert_eq!(calculate_level(1_000_000), (27, "大乘后期"));
    }

    #[test]
    fn level_progress_bounds() {
        assert!(level_progress(0) >= 0.0 && level_progress(0) < 1.0);
        assert_eq!(level_progress(110_000), 100.0);
        // (150-100)/(249-100+1) = 1/3
        assert!((level_progress(150) - 100.0 / 3.0).abs() < 1e-6);
        // 与 Python 公式一致：(exp-min)/(max-min+1)*100
        assert_eq!(level_progress(99), 99.0);
    }

    #[test]
    fn exp_change_rules() {
        assert_eq!(exp_change_for_review_score(8), 20);
        assert_eq!(exp_change_for_review_score(5), 10);
        assert_eq!(exp_change_for_review_score(1), -5);
    }
}
