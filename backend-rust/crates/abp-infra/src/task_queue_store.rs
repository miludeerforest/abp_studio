//! Compatibility facade for Python `queue_manager.py` keys and channels.

use crate::redis_store::{rerr, RedisStore};
use abp_core::ApiResult;
use redis::AsyncCommands;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

pub const GLOBAL_EVENTS_CHANNEL: &str = "events:global";

#[derive(Debug, Clone, Default, Serialize)]
pub struct QueueTypeStats {
    pub pending: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct QueueStats {
    pub video_gen: QueueTypeStats,
    pub image_gen: QueueTypeStats,
    pub story_chain: QueueTypeStats,
}

#[derive(Clone)]
pub struct TaskQueueStore {
    redis: RedisStore,
}

impl RedisStore {
    pub fn task_queue(&self) -> TaskQueueStore {
        TaskQueueStore::new(self.clone())
    }
}

impl TaskQueueStore {
    pub fn new(redis: RedisStore) -> Self {
        Self { redis }
    }

    pub async fn publish_event(&self, payload: &str) -> ApiResult<()> {
        self.redis.publish(GLOBAL_EVENTS_CHANNEL, payload).await?;
        if let Ok(value) = serde_json::from_str::<Value>(payload) {
            if let Some(user_id) = value
                .get("data")
                .and_then(|data| data.get("user_id"))
                .and_then(Value::as_i64)
            {
                self.redis
                    .publish(&format!("events:user:{user_id}"), payload)
                    .await?;
            }
        }
        Ok(())
    }

    pub async fn subscribe_global(&self) -> ApiResult<redis::aio::PubSub> {
        self.redis.subscribe(&[GLOBAL_EVENTS_CHANNEL]).await
    }

    pub async fn queue_stats(&self) -> ApiResult<QueueStats> {
        let mut connection = self.redis.conn.clone();
        let video_pending: i64 = connection.zcard("queue:video_gen").await.map_err(rerr)?;
        let image_pending: i64 = connection.zcard("queue:image_gen").await.map_err(rerr)?;
        let story_pending: i64 = connection.zcard("queue:story_chain").await.map_err(rerr)?;
        let raw_tasks: HashMap<String, String> = connection.hgetall("tasks").await.map_err(rerr)?;
        let mut processing: HashMap<String, i64> = HashMap::new();
        for task in raw_tasks
            .values()
            .filter_map(|raw| serde_json::from_str::<Value>(raw).ok())
        {
            if task.get("status").and_then(Value::as_str) == Some("processing") {
                if let Some(kind) = task.get("type").and_then(Value::as_str) {
                    *processing.entry(kind.to_string()).or_default() += 1;
                }
            }
        }
        let stats = |kind: &str, pending| QueueTypeStats {
            pending,
            processing: processing.get(kind).copied(),
        };
        Ok(QueueStats {
            video_gen: stats("video_gen", video_pending),
            image_gen: stats("image_gen", image_pending),
            story_chain: stats("story_chain", story_pending),
        })
    }

    pub async fn user_tasks(&self, user_id: i32) -> ApiResult<Vec<Value>> {
        let mut connection = self.redis.conn.clone();
        let task_ids: Vec<String> = connection
            .smembers(format!("user:{user_id}:tasks"))
            .await
            .map_err(rerr)?;
        if task_ids.is_empty() {
            return Ok(vec![]);
        }
        let raw_tasks: Vec<Option<String>> = redis::cmd("HMGET")
            .arg("tasks")
            .arg(&task_ids)
            .query_async(&mut connection)
            .await
            .map_err(rerr)?;
        let mut tasks = raw_tasks
            .into_iter()
            .flatten()
            .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
            .collect::<Vec<_>>();
        tasks.sort_by(|left, right| {
            right
                .get("created_at")
                .and_then(Value::as_str)
                .cmp(&left.get("created_at").and_then(Value::as_str))
        });
        Ok(tasks)
    }
}
