//! Generic Redis connection, namespaced KV, and channel primitives.

use abp_core::{ApiError, ApiResult};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;

#[inline]
pub(crate) fn rerr(error: redis::RedisError) -> ApiError {
    ApiError::internal(anyhow::anyhow!("redis error: {error}"))
}

#[derive(Clone)]
pub struct RedisStore {
    pub(crate) client: redis::Client,
    pub(crate) conn: ConnectionManager,
    prefix: String,
}

impl RedisStore {
    pub async fn connect(url: &str) -> ApiResult<Self> {
        let client = redis::Client::open(url).map_err(rerr)?;
        let conn = ConnectionManager::new(client.clone()).await.map_err(rerr)?;
        Ok(Self {
            client,
            conn,
            prefix: "abp".into(),
        })
    }

    pub fn key(&self, key: &str) -> String {
        format!("{}:{key}", self.prefix)
    }

    pub async fn set(&self, key: &str, value: &str, ttl_secs: Option<u64>) -> ApiResult<()> {
        let mut connection = self.conn.clone();
        if let Some(ttl) = ttl_secs {
            let _: () = connection
                .set_ex(self.key(key), value, ttl)
                .await
                .map_err(rerr)?;
        } else {
            let _: () = connection.set(self.key(key), value).await.map_err(rerr)?;
        }
        Ok(())
    }

    pub async fn get(&self, key: &str) -> ApiResult<Option<String>> {
        let mut connection = self.conn.clone();
        connection.get(self.key(key)).await.map_err(rerr)
    }

    pub async fn del(&self, key: &str) -> ApiResult<()> {
        let mut connection = self.conn.clone();
        let _: () = connection.del(self.key(key)).await.map_err(rerr)?;
        Ok(())
    }

    pub async fn publish(&self, channel: &str, payload: &str) -> ApiResult<()> {
        let mut connection = self.conn.clone();
        let _: () = connection.publish(channel, payload).await.map_err(rerr)?;
        Ok(())
    }

    pub async fn subscribe(&self, channels: &[&str]) -> ApiResult<redis::aio::PubSub> {
        let mut pubsub = self.client.get_async_pubsub().await.map_err(rerr)?;
        for channel in channels {
            pubsub.subscribe(*channel).await.map_err(rerr)?;
        }
        Ok(pubsub)
    }
}
