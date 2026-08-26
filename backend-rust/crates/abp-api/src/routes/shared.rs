//! Shared request/response helpers for route slices.
use super::*;

#[derive(Deserialize, Clone)]
pub(crate) struct Paging {
    pub(crate) limit: Option<i64>,
    pub(crate) offset: Option<i64>,
    pub(crate) category: Option<String>,
    pub(crate) view_mode: Option<String>,
    pub(crate) user_id: Option<i32>,
    pub(crate) start_date: Option<String>,
    pub(crate) end_date: Option<String>,
}

impl Paging {
    pub(crate) fn with_defaults(&self, dl: i64, dof: i64) -> Self {
        Self {
            limit: Some(self.limit.unwrap_or(dl).clamp(1, 500)),
            offset: Some(self.offset.unwrap_or(dof).max(0)),
            category: self.category.clone(),
            view_mode: self.view_mode.clone(),
            user_id: self.user_id,
            start_date: self.start_date.clone(),
            end_date: self.end_date.clone(),
        }
    }
}

pub(crate) fn parse_date(s: &Option<String>, plus_one_day: bool) -> Option<NaiveDateTime> {
    let s = s.as_deref()?;
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .map(|d| {
            if plus_one_day {
                d.succ_opt().unwrap_or(d)
            } else {
                d
            }
        })
        .and_then(|d| d.and_hms_opt(0, 0, 0))
}

pub(crate) fn video_json(v: &VideoQueueItem) -> Value {
    json!({
        "id": v.id, "filename": v.filename, "file_path": v.file_path,
        "prompt": v.prompt, "status": v.status, "result_url": v.result_url,
        "error_msg": v.error_msg, "user_id": v.user_id,
        "preview_url": v.effective_preview_url(),
        "category": v.category.clone().unwrap_or_else(|| "other".into()),
        "is_merged": v.is_merged.unwrap_or(false), "is_shared": v.is_shared,
        "created_at": v.created_at, "review_score": v.review_score,
        "review_status": v.review_status, "reviewed_at": v.reviewed_at,
    })
}

pub(crate) fn queue_json(v: &VideoQueueItem) -> Value {
    json!({
        "id": v.id, "filename": v.filename.clone().unwrap_or_default(),
        "prompt": v.prompt.clone().unwrap_or_default(), "status": v.status,
        "result_url": v.result_url, "error_msg": v.error_msg,
        "created_at": v.created_at, "preview_url": v.effective_preview_url(),
        "user_id": v.user_id, "retry_count": v.retry_count,
    })
}

pub(crate) fn queue_record_json(item: &VideoQueueItem) -> Value {
    json!({
        "prompt": item.prompt,
        "result_url": item.result_url,
        "error_msg": item.error_msg,
        "retry_count": item.retry_count,
        "id": item.id,
        "user_id": item.user_id,
        "last_retry_at": item.last_retry_at,
        "filename": item.filename,
        "file_path": item.file_path,
        "category": item.category,
        "_preview_url": item.preview_url,
        "review_score": item.review_score,
        "is_merged": item.is_merged,
        "review_result": item.review_result,
        "is_shared": item.is_shared,
        "review_status": item.review_status,
        "status": item.status,
        "created_at": item.created_at,
        "reviewed_at": item.reviewed_at,
    })
}
