"""
WebSocket Connection Manager for real-time updates.
Handles:
- User connections (per-user channels)
- Admin connections (global broadcast)
- Redis Pub/Sub integration
"""
import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Set, Optional, Any
from fastapi import WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages WebSocket connections for real-time updates.
    
    Features:
    - Per-user connection tracking
    - Admin broadcast channel
    - Online user tracking
    - Redis Pub/Sub integration
    """
    
    def __init__(self):
        # user_id -> list of WebSocket connections
        self.user_connections: Dict[int, List[WebSocket]] = {}
        # Admin connections (for monitoring dashboard)
        self.admin_connections: List[WebSocket] = []
        # Currently online user IDs
        self.online_users: Set[int] = set()
        # Connection metadata (user_id -> {username, role, connected_at})
        self.connection_info: Dict[int, Dict[str, Any]] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()
    
    async def connect(
        self,
        websocket: WebSocket,
        user_id: int,
        username: str,
        is_admin: bool = False
    ):
        """
        Accept a new WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
            user_id: User's ID
            username: User's display name
            is_admin: Whether user has admin role
        """
        await websocket.accept()
        
        async with self._lock:
            # Add to user connections
            if user_id not in self.user_connections:
                self.user_connections[user_id] = []
            self.user_connections[user_id].append(websocket)
            
            # Add to admin connections if admin
            if is_admin:
                self.admin_connections.append(websocket)
            
            # Track online status
            self.online_users.add(user_id)
            self.connection_info[user_id] = {
                "username": username,
                "role": "admin" if is_admin else "user",
                "connected_at": datetime.now().isoformat(),
                "last_activity": datetime.now().isoformat()
            }
        
        logger.info(f"WebSocket connected: user {user_id} ({username})")
        
        # Notify admins of new connection
        await self.broadcast_to_admins({
            "type": "user_connected",
            "data": {
                "user_id": user_id,
                "username": username,
                "connected_at": datetime.now().isoformat()
            }
        })
    
    async def disconnect(self, websocket: WebSocket, user_id: int):
        """Handle WebSocket disconnection."""
        async with self._lock:
            # Remove from user connections
            if user_id in self.user_connections:
                if websocket in self.user_connections[user_id]:
                    self.user_connections[user_id].remove(websocket)
                
                # If no more connections for this user, mark as offline
                if not self.user_connections[user_id]:
                    del self.user_connections[user_id]
                    self.online_users.discard(user_id)
                    if user_id in self.connection_info:
                        del self.connection_info[user_id]
            
            # Remove from admin connections
            if websocket in self.admin_connections:
                self.admin_connections.remove(websocket)
        
        logger.info(f"WebSocket disconnected: user {user_id}")
        
        # Notify admins
        await self.broadcast_to_admins({
            "type": "user_disconnected",
            "data": {"user_id": user_id}
        })
    
    async def send_to_user(self, user_id: int, message: Dict[str, Any]):
        """
        Send a message to a specific user.
        
        Args:
            user_id: Target user's ID
            message: Message data to send
        """
        if user_id not in self.user_connections:
            return
        
        disconnected = []
        for websocket in self.user_connections[user_id]:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to user {user_id}: {e}")
                disconnected.append(websocket)
        
        # Clean up disconnected sockets
        for ws in disconnected:
            await self.disconnect(ws, user_id)
    
    async def broadcast_to_admins(self, message: Dict[str, Any]):
        """
        Broadcast a message to all admin connections.
        
        Args:
            message: Message data to broadcast
        """
        disconnected = []
        for websocket in self.admin_connections:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to broadcast to admin: {e}")
                disconnected.append(websocket)
        
        # Note: We don't remove admin connections here as they're also
        # in user_connections and will be cleaned up there
    
    async def broadcast_to_all(self, message: Dict[str, Any]):
        """Broadcast a message to all connected users."""
        for user_id in list(self.user_connections.keys()):
            await self.send_to_user(user_id, message)
    
    def get_online_users(self) -> List[Dict[str, Any]]:
        """Get list of currently online users with metadata."""
        return [
            {
                "user_id": user_id,
                **self.connection_info.get(user_id, {})
            }
            for user_id in self.online_users
        ]
    
    def get_online_count(self) -> int:
        """Get count of online users."""
        return len(self.online_users)
    
    def is_user_online(self, user_id: int) -> bool:
        """Check if a user is currently online."""
        return user_id in self.online_users
    
    async def update_user_activity(self, user_id: int, activity: str):
        """
        Update a user's current activity.
        Used for admin monitoring.
        
        Args:
            user_id: User's ID
            activity: Description of current activity
        """
        if user_id in self.connection_info:
            self.connection_info[user_id]["current_activity"] = activity
            self.connection_info[user_id]["last_activity"] = datetime.now().isoformat()
            
            # Notify admins
            await self.broadcast_to_admins({
                "type": "user_activity",
                "data": {
                    "user_id": user_id,
                    "activity": activity,
                    "timestamp": datetime.now().isoformat()
                }
            })


class RedisPubSubManager:
    """
    Manages Redis Pub/Sub for cross-instance message distribution.
    Required when running multiple backend instances.
    """
    
    def __init__(self, redis_url: str, connection_manager: ConnectionManager):
        self.redis_url = redis_url
        self.connection_manager = connection_manager
        self._redis: Optional[aioredis.Redis] = None
        self._pubsub: Optional[aioredis.client.PubSub] = None
        self._listener_task: Optional[asyncio.Task] = None
    
    async def connect(self):
        """Initialize Redis connection and start listening."""
        self._redis = aioredis.from_url(
            self.redis_url,
            encoding="utf-8",
            decode_responses=True
        )
        self._pubsub = self._redis.pubsub()
        
        # Subscribe to global events channel
        await self._pubsub.subscribe("events:global")
        
        # Start listener task
        self._listener_task = asyncio.create_task(self._listen())
        logger.info("Redis Pub/Sub connected")
    
    async def disconnect(self):
        """Clean up connections."""
        if self._listener_task:
            self._listener_task.cancel()
        if self._pubsub:
            await self._pubsub.unsubscribe()
            await self._pubsub.close()
        if self._redis:
            await self._redis.close()
    
    async def _listen(self):
        """Listen for Redis Pub/Sub messages and forward to WebSocket clients."""
        try:
            async for message in self._pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        await self._handle_message(data)
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON in Pub/Sub message: {message['data']}")
        except asyncio.CancelledError:
            logger.info("Pub/Sub listener cancelled")
        except Exception as e:
            logger.error(f"Pub/Sub listener error: {e}")
    
    async def _handle_message(self, message: Dict[str, Any]):
        """Route message to appropriate WebSocket clients."""
        msg_type = message.get("type")
        data = message.get("data", {})
        
        # Route based on message type
        if msg_type in ("task_created", "task_started", "task_progress", "task_completed", "task_failed"):
            # Send to task owner
            user_id = data.get("user_id")
            if user_id:
                await self.connection_manager.send_to_user(user_id, message)
            
            # Also send to all admins for monitoring
            await self.connection_manager.broadcast_to_admins(message)
        
        elif msg_type == "queue_update":
            # Broadcast queue updates to all users
            await self.connection_manager.broadcast_to_all(message)
        
        elif msg_type in ("user_connected", "user_disconnected", "user_activity"):
            # Admin-only events
            await self.connection_manager.broadcast_to_admins(message)
        
        else:
            # Default: broadcast to all admins
            await self.connection_manager.broadcast_to_admins(message)
    
    async def publish(self, channel: str, message: Dict[str, Any]):
        """Publish a message to a Redis channel."""
        if self._redis:
            await self._redis.publish(channel, json.dumps(message))
    
    async def subscribe_user(self, user_id: int):
        """Subscribe to a user-specific channel."""
        if self._pubsub:
            await self._pubsub.subscribe(f"events:user:{user_id}")


# Global instances
connection_manager = ConnectionManager()
pubsub_manager: Optional[RedisPubSubManager] = None


async def init_websocket_manager(redis_url: str = None):
    """Initialize the WebSocket and Pub/Sub managers."""
    global pubsub_manager
    
    # Use provided URL or resolve from env vars
    if redis_url is None:
        from queue_manager import resolve_redis_url
        redis_url = resolve_redis_url()
    
    pubsub_manager = RedisPubSubManager(redis_url, connection_manager)
    await pubsub_manager.connect()
    logger.info("WebSocket manager initialized")


async def shutdown_websocket_manager():
    """Clean up WebSocket manager resources."""
    global pubsub_manager
    if pubsub_manager:
        await pubsub_manager.disconnect()
        pubsub_manager = None
