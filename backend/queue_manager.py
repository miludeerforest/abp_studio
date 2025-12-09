"""
Redis-based Task Queue Manager for distributed task processing.
Supports:
- Task enqueueing/dequeuing
- Progress tracking
- Real-time status updates via Redis Pub/Sub
"""
import json
import uuid
import asyncio
import logging
import socket
import os
from datetime import datetime
from typing import Optional, Dict, Any, List
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)


def resolve_redis_url() -> str:
    """
    Build Redis URL from environment variables.
    Resolves hostname to IP to avoid Docker DNS issues.
    """
    # Check for direct URL first (backward compatibility)
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        return redis_url
    
    # Build from separate env vars
    host = os.getenv("REDIS_HOST", "redis")
    port = os.getenv("REDIS_PORT", "6379")
    password = os.getenv("REDIS_PASSWORD", "")
    db = os.getenv("REDIS_DB", "0")
    
    # Resolve hostname to IP to avoid DNS issues with some Redis clients
    try:
        resolved_ip = socket.gethostbyname(host)
        logger.info(f"Resolved Redis host {host} -> {resolved_ip}")
        host = resolved_ip
    except socket.gaierror as e:
        logger.warning(f"Could not resolve {host}, using as-is: {e}")
    
    # Build URL
    if password:
        return f"redis://:{password}@{host}:{port}/{db}"
    else:
        return f"redis://{host}:{port}/{db}"


class TaskQueue:
    """
    Redis-based task queue supporting multiple task types and real-time updates.
    """
    
    def __init__(self, redis_url: str = "redis://redis:6379/0"):
        self.redis_url = redis_url
        self._redis: Optional[aioredis.Redis] = None
        
    async def connect(self):
        """Initialize Redis connection."""
        if not self._redis:
            self._redis = aioredis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            logger.info(f"Connected to Redis at {self.redis_url}")
    
    async def disconnect(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            self._redis = None
    
    @property
    def redis(self) -> aioredis.Redis:
        if not self._redis:
            raise RuntimeError("Redis not connected. Call connect() first.")
        return self._redis
    
    # --- Task Management ---
    
    async def enqueue(
        self,
        task_type: str,
        payload: Dict[str, Any],
        user_id: int,
        priority: int = 0
    ) -> str:
        """
        Add a task to the queue.
        
        Args:
            task_type: Type of task (e.g., "video_gen", "image_gen", "story_chain")
            payload: Task-specific data
            user_id: Owner of the task
            priority: Higher priority = processed first (default 0)
        
        Returns:
            task_id: Unique identifier for the task
        """
        task_id = str(uuid.uuid4())
        task = {
            "id": task_id,
            "type": task_type,
            "status": "pending",
            "user_id": user_id,
            "payload": payload,
            "priority": priority,
            "progress": 0,
            "created_at": datetime.now().isoformat(),
            "started_at": None,
            "completed_at": None,
            "error": None
        }
        
        # Store task details
        await self.redis.hset("tasks", task_id, json.dumps(task))
        
        # Add to queue (sorted set with priority as score)
        queue_key = f"queue:{task_type}"
        score = priority * 1000000000 + int(datetime.now().timestamp())
        await self.redis.zadd(queue_key, {task_id: score})
        
        # Track user's active tasks
        await self.redis.sadd(f"user:{user_id}:tasks", task_id)
        
        # Publish event for real-time updates
        await self.publish_event("task_created", task)
        
        logger.info(f"Enqueued task {task_id} of type {task_type} for user {user_id}")
        return task_id
    
    async def dequeue(self, task_type: str) -> Optional[Dict[str, Any]]:
        """
        Get the next task from the queue.
        
        Returns:
            Task dict if available, None otherwise
        """
        queue_key = f"queue:{task_type}"
        
        # Get highest priority task (highest score first)
        result = await self.redis.zpopmax(queue_key)
        if not result:
            return None
        
        task_id = result[0][0]
        task_json = await self.redis.hget("tasks", task_id)
        if not task_json:
            return None
        
        task = json.loads(task_json)
        task["status"] = "processing"
        task["started_at"] = datetime.now().isoformat()
        
        await self.redis.hset("tasks", task_id, json.dumps(task))
        await self.publish_event("task_started", task)
        
        return task
    
    async def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task by ID."""
        task_json = await self.redis.hget("tasks", task_id)
        if task_json:
            return json.loads(task_json)
        return None
    
    async def update_progress(
        self,
        task_id: str,
        progress: int,
        status: Optional[str] = None,
        message: Optional[str] = None
    ):
        """
        Update task progress.
        
        Args:
            task_id: Task identifier
            progress: Progress percentage (0-100)
            status: Optional new status
            message: Optional progress message
        """
        task = await self.get_task(task_id)
        if not task:
            return
        
        task["progress"] = progress
        if status:
            task["status"] = status
        if message:
            task["message"] = message
        
        await self.redis.hset("tasks", task_id, json.dumps(task))
        
        # Publish progress event
        await self.publish_event("task_progress", {
            "task_id": task_id,
            "progress": progress,
            "status": task["status"],
            "message": message,
            "user_id": task["user_id"]
        })
    
    async def complete_task(
        self,
        task_id: str,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ):
        """Mark task as completed or failed."""
        task = await self.get_task(task_id)
        if not task:
            return
        
        task["completed_at"] = datetime.now().isoformat()
        task["progress"] = 100 if not error else task["progress"]
        task["status"] = "failed" if error else "completed"
        task["error"] = error
        task["result"] = result
        
        await self.redis.hset("tasks", task_id, json.dumps(task))
        
        # Publish completion event
        event_type = "task_failed" if error else "task_completed"
        await self.publish_event(event_type, task)
        
        logger.info(f"Task {task_id} {task['status']}")
    
    # --- User Task Management ---
    
    async def get_user_tasks(
        self,
        user_id: int,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get all tasks for a user."""
        task_ids = await self.redis.smembers(f"user:{user_id}:tasks")
        tasks = []
        
        for task_id in task_ids:
            task = await self.get_task(task_id)
            if task:
                if status is None or task["status"] == status:
                    tasks.append(task)
        
        return sorted(tasks, key=lambda x: x["created_at"], reverse=True)
    
    async def get_user_concurrent_count(self, user_id: int) -> int:
        """Get number of active (pending/processing) tasks for a user."""
        tasks = await self.get_user_tasks(user_id)
        return sum(1 for t in tasks if t["status"] in ("pending", "processing"))
    
    # --- Queue Statistics ---
    
    async def get_queue_stats(self) -> Dict[str, Any]:
        """Get overall queue statistics."""
        stats = {
            "video_gen": {
                "pending": await self.redis.zcard("queue:video_gen"),
            },
            "image_gen": {
                "pending": await self.redis.zcard("queue:image_gen"),
            },
            "story_chain": {
                "pending": await self.redis.zcard("queue:story_chain"),
            }
        }
        
        # Count processing tasks
        all_tasks = await self.redis.hgetall("tasks")
        for task_json in all_tasks.values():
            task = json.loads(task_json)
            if task["status"] == "processing":
                task_type = task["type"]
                if task_type in stats:
                    stats[task_type]["processing"] = stats[task_type].get("processing", 0) + 1
        
        return stats
    
    # --- Pub/Sub for Real-time Updates ---
    
    async def publish_event(self, event_type: str, data: Dict[str, Any]):
        """Publish event for real-time updates."""
        message = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.now().isoformat()
        }
        
        # Publish to global channel
        await self.redis.publish("events:global", json.dumps(message))
        
        # Publish to user-specific channel
        if "user_id" in data:
            await self.redis.publish(f"events:user:{data['user_id']}", json.dumps(message))
    
    async def subscribe(self, channels: List[str]):
        """Subscribe to channels for real-time events."""
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(*channels)
        return pubsub


class ConcurrencyLimiter:
    """
    Redis-based concurrency limiter for global and per-user limits.
    """
    
    def __init__(self, redis: aioredis.Redis):
        self.redis = redis
        self.global_limit = int(os.getenv("MAX_GLOBAL_CONCURRENT", "10"))
        self.user_limit = int(os.getenv("MAX_USER_CONCURRENT", "3"))
    
    async def can_acquire_global(self, task_type: str) -> bool:
        """Check if we can start a new task globally."""
        key = f"concurrent:{task_type}"
        current = await self.redis.get(key) or 0
        return int(current) < self.global_limit
    
    async def acquire_global(self, task_type: str, timeout: int = 300) -> bool:
        """Acquire a global execution slot."""
        key = f"concurrent:{task_type}"
        
        # Use INCR with expiry for atomic increment
        current = await self.redis.incr(key)
        await self.redis.expire(key, timeout)
        
        if current > self.global_limit:
            await self.redis.decr(key)
            return False
        return True
    
    async def release_global(self, task_type: str):
        """Release a global execution slot."""
        key = f"concurrent:{task_type}"
        await self.redis.decr(key)
    
    async def can_acquire_user(self, user_id: int, task_type: str) -> bool:
        """Check if a user can start a new task."""
        key = f"user:{user_id}:concurrent:{task_type}"
        current = await self.redis.get(key) or 0
        return int(current) < self.user_limit
    
    async def acquire_user(self, user_id: int, task_type: str, timeout: int = 300) -> bool:
        """Acquire a user execution slot."""
        key = f"user:{user_id}:concurrent:{task_type}"
        
        current = await self.redis.incr(key)
        await self.redis.expire(key, timeout)
        
        if current > self.user_limit:
            await self.redis.decr(key)
            return False
        return True
    
    async def release_user(self, user_id: int, task_type: str):
        """Release a user execution slot."""
        key = f"user:{user_id}:concurrent:{task_type}"
        await self.redis.decr(key)


# Singleton instance
task_queue: Optional[TaskQueue] = None
concurrency_limiter: Optional[ConcurrencyLimiter] = None


async def get_task_queue() -> TaskQueue:
    """Get or create the global TaskQueue instance."""
    global task_queue
    if task_queue is None:
        redis_url = resolve_redis_url()
        task_queue = TaskQueue(redis_url)
        await task_queue.connect()
    return task_queue


async def get_concurrency_limiter() -> ConcurrencyLimiter:
    """Get or create the global ConcurrencyLimiter instance."""
    global concurrency_limiter
    if concurrency_limiter is None:
        queue = await get_task_queue()
        concurrency_limiter = ConcurrencyLimiter(queue.redis)
    return concurrency_limiter
