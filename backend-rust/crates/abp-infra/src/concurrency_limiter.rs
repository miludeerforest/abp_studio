//! Atomic Redis concurrency counters matching Python `ConcurrencyLimiter` keys.

use crate::redis_store::{rerr, RedisStore};
use abp_core::ApiResult;

const ACQUIRE_SCRIPT: &str = r#"
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then
  return 0
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
"#;

const RELEASE_SCRIPT: &str = r#"
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then
  redis.call('DEL', KEYS[1])
  return 0
end
return redis.call('DECR', KEYS[1])
"#;

#[derive(Clone)]
pub struct ConcurrencyLimiter {
    redis: RedisStore,
}

impl RedisStore {
    pub fn concurrency_limiter(&self) -> ConcurrencyLimiter {
        ConcurrencyLimiter::new(self.clone())
    }
}

impl ConcurrencyLimiter {
    pub fn new(redis: RedisStore) -> Self {
        Self { redis }
    }

    pub fn global_key(task_type: &str) -> String {
        format!("concurrent:{task_type}")
    }

    pub fn user_key(user_id: i32, task_type: &str) -> String {
        format!("user:{user_id}:concurrent:{task_type}")
    }

    pub async fn acquire_global(
        &self,
        task_type: &str,
        limit: i64,
        ttl_secs: i64,
    ) -> ApiResult<bool> {
        self.acquire(&Self::global_key(task_type), limit, ttl_secs)
            .await
    }

    pub async fn release_global(&self, task_type: &str) -> ApiResult<()> {
        self.release(&Self::global_key(task_type)).await
    }

    pub async fn acquire_user(
        &self,
        user_id: i32,
        task_type: &str,
        limit: i64,
        ttl_secs: i64,
    ) -> ApiResult<bool> {
        self.acquire(&Self::user_key(user_id, task_type), limit, ttl_secs)
            .await
    }

    pub async fn release_user(&self, user_id: i32, task_type: &str) -> ApiResult<()> {
        self.release(&Self::user_key(user_id, task_type)).await
    }

    async fn acquire(&self, key: &str, limit: i64, ttl_secs: i64) -> ApiResult<bool> {
        let mut connection = self.redis.conn.clone();
        let acquired: i64 = redis::Script::new(ACQUIRE_SCRIPT)
            .key(key)
            .arg(limit.max(1))
            .arg(ttl_secs.max(1))
            .invoke_async(&mut connection)
            .await
            .map_err(rerr)?;
        Ok(acquired == 1)
    }

    async fn release(&self, key: &str) -> ApiResult<()> {
        let mut connection = self.redis.conn.clone();
        let _: i64 = redis::Script::new(RELEASE_SCRIPT)
            .key(key)
            .invoke_async(&mut connection)
            .await
            .map_err(rerr)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::ConcurrencyLimiter;

    #[test]
    fn keys_match_python_contract() {
        assert_eq!(
            ConcurrencyLimiter::global_key("video_gen"),
            "concurrent:video_gen"
        );
        assert_eq!(
            ConcurrencyLimiter::user_key(42, "image_gen"),
            "user:42:concurrent:image_gen"
        );
    }
}
