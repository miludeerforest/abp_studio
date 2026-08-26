use abp_infra::{ConcurrencyLimiter, RedisStore};
use redis::AsyncCommands;
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

fn redis_url() -> String {
    std::env::var("REDIS_TEST_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/15".into())
}

async fn raw_connection() -> redis::aio::MultiplexedConnection {
    redis::Client::open(redis_url())
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires an isolated Redis database; run with REDIS_TEST_URL=redis://127.0.0.1:6379/15"]
async fn python_task_queue_keys_stats_and_user_lookup_match() {
    let mut connection = raw_connection().await;
    let size: i64 = redis::cmd("DBSIZE")
        .query_async(&mut connection)
        .await
        .unwrap();
    assert_eq!(size, 0, "REDIS_TEST_URL must point to an empty isolated DB");

    let task_id = Uuid::new_v4().to_string();
    let task = json!({
        "id": task_id,
        "type": "video_gen",
        "status": "processing",
        "user_id": 42,
        "created_at": "2026-01-01T00:00:00",
    })
    .to_string();
    let _: () = connection.hset("tasks", &task_id, task).await.unwrap();
    let _: () = connection
        .zadd("queue:video_gen", &task_id, 1)
        .await
        .unwrap();
    let _: () = connection.sadd("user:42:tasks", &task_id).await.unwrap();

    let store = RedisStore::connect(&redis_url())
        .await
        .unwrap()
        .task_queue();
    let stats = store.queue_stats().await.unwrap();
    assert_eq!(stats.video_gen.pending, 1);
    assert_eq!(stats.video_gen.processing, Some(1));
    assert_eq!(stats.image_gen.pending, 0);
    assert_eq!(store.user_tasks(42).await.unwrap()[0]["id"], task_id);

    let _: () = redis::cmd("FLUSHDB")
        .query_async(&mut connection)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires an isolated Redis database; run with REDIS_TEST_URL=redis://127.0.0.1:6379/15"]
async fn concurrency_is_atomic_expiring_and_never_negative() {
    let mut connection = raw_connection().await;
    let size: i64 = redis::cmd("DBSIZE")
        .query_async(&mut connection)
        .await
        .unwrap();
    assert_eq!(size, 0, "REDIS_TEST_URL must point to an empty isolated DB");

    let redis = RedisStore::connect(&redis_url()).await.unwrap();
    let limiter = redis.concurrency_limiter();
    let kind = format!("test-{}", Uuid::new_v4());
    let mut handles = Vec::new();
    for _ in 0..10 {
        let limiter = limiter.clone();
        let kind = kind.clone();
        handles.push(tokio::spawn(async move {
            limiter.acquire_global(&kind, 2, 30).await.unwrap()
        }));
    }
    let mut acquired = 0;
    for handle in handles {
        acquired += usize::from(handle.await.unwrap());
    }
    assert_eq!(acquired, 2);

    let key = ConcurrencyLimiter::global_key(&kind);
    let count: i64 = connection.get(&key).await.unwrap();
    let ttl: i64 = connection.ttl(&key).await.unwrap();
    assert_eq!(count, 2);
    assert!(ttl > 0 && ttl <= 30);

    limiter.release_global(&kind).await.unwrap();
    limiter.release_global(&kind).await.unwrap();
    limiter.release_global(&kind).await.unwrap();
    let count: Option<i64> = connection.get(&key).await.unwrap();
    assert_eq!(count, None);

    assert!(limiter.acquire_user(42, &kind, 1, 1).await.unwrap());
    assert!(!limiter.acquire_user(42, &kind, 1, 1).await.unwrap());
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert!(limiter.acquire_user(42, &kind, 1, 1).await.unwrap());
    limiter.release_user(42, &kind).await.unwrap();

    let _: () = redis::cmd("FLUSHDB")
        .query_async(&mut connection)
        .await
        .unwrap();
}
