// Generated from the original route implementation; keep handlers thin as slices are migrated.
use super::*;
use abp_infra::repo::ActivityRecord;
use serde::Serialize;

#[derive(Serialize)]
struct LiveQueueStats {
    video_gen: abp_infra::QueueTypeStats,
    image_gen: abp_infra::QueueTypeStats,
    story_chain: abp_infra::QueueTypeStats,
    video_processing: i64,
    video_pending: i64,
    fission_active: i64,
    chain_active: i64,
    total_active: i64,
}

fn activity_json(activity: &ActivityRecord, prefer_nickname: bool) -> Value {
    let username = if prefer_nickname {
        activity
            .nickname
            .clone()
            .or_else(|| activity.username.clone())
            .unwrap_or_else(|| format!("用户 {}", activity.user_id.unwrap_or_default()))
    } else {
        activity
            .username
            .clone()
            .unwrap_or_else(|| "Unknown".into())
    };
    json!({
        "id": activity.id,
        "user_id": activity.user_id,
        "username": username,
        "action": activity.action,
        "details": activity.details,
        "created_at": activity.created_at,
    })
}

pub(crate) async fn live_status(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
) -> ApiResult<Json<Value>> {
    let usernames = app.ws.online_users().await;
    let now = Utc::now();
    let mut online_users = Vec::with_capacity(usernames.len());
    for username in usernames {
        if let Some(user) = app.db.user_by_username(&username).await? {
            online_users.push(json!({
                "user_id": user.id,
                "username": user.username,
                "role": user.role,
                "connected_at": now,
                "last_activity": now,
                "current_activity": "在线",
            }));
        }
    }

    let china_now = Utc::now().naive_utc() + chrono::Duration::hours(8);
    let activities_future = app
        .db
        .recent_activities_since(china_now - chrono::Duration::hours(12), 50);
    let counts_future = app.db.live_task_counts();
    let redis_future = async {
        match &app.redis {
            Some(redis) => redis
                .task_queue()
                .queue_stats()
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(error = %error, "read Redis queue stats failed");
                    abp_infra::QueueStats::default()
                }),
            None => abp_infra::QueueStats::default(),
        }
    };
    let (activities, counts, redis_stats) =
        tokio::join!(activities_future, counts_future, redis_future);
    let recent_activities = activities?
        .iter()
        .map(|activity| activity_json(activity, true))
        .collect::<Vec<_>>();
    let (video_processing, video_pending, fission_active, chain_active) = counts?;
    let queue_stats = LiveQueueStats {
        video_gen: redis_stats.video_gen,
        image_gen: redis_stats.image_gen,
        story_chain: redis_stats.story_chain,
        video_processing,
        video_pending,
        fission_active,
        chain_active,
        total_active: video_processing + fission_active + chain_active,
    };
    Ok(Json(json!({
        "online_users": online_users,
        "online_count": online_users.len(),
        "queue_stats": queue_stats,
        "recent_activities": recent_activities,
        "timestamp": now,
    })))
}

#[derive(Deserialize)]
pub(crate) struct ActivityQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

pub(crate) async fn list_activities(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
    Query(q): Query<ActivityQuery>,
) -> ApiResult<Json<Value>> {
    let items = app
        .db
        .recent_activities(q.limit.unwrap_or(50).clamp(1, 200), q.offset.unwrap_or(0))
        .await?;
    Ok(Json(json!(items
        .iter()
        .map(|activity| activity_json(activity, false))
        .collect::<Vec<_>>())))
}

pub(crate) async fn clear_activities(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
) -> ApiResult<Json<Value>> {
    let deleted_count = app.db.clear_activities().await?;
    Ok(Json(json!({
        "status": "success",
        "deleted_count": deleted_count,
    })))
}

pub(crate) async fn user_tasks(
    State(app): State<AppState>,
    AdminUser(_): AdminUser,
    Path(user_id): Path<i32>,
) -> ApiResult<Json<Value>> {
    let items = app.db.tasks_for_user(user_id, 50).await?;
    let redis_tasks = match &app.redis {
        Some(redis) => redis
            .task_queue()
            .user_tasks(user_id)
            .await
            .unwrap_or_else(|error| {
                tracing::warn!(user_id, error = %error, "read Redis user tasks failed");
                vec![]
            }),
        None => vec![],
    };
    let video_tasks = items
        .into_iter()
        .map(|item| {
            json!({
                "id": item.id,
                "filename": item.filename,
                "status": item.status,
                "created_at": item.created_at,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "user_id": user_id,
        "redis_tasks": redis_tasks,
        "video_tasks": video_tasks,
    })))
}
