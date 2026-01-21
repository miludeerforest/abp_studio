"""
视频审查队列管理器
实现顺序执行视频审查任务，避免高并发导致的 API 失败
"""

import asyncio
import logging
from typing import Optional, Callable, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ReviewTask:
    """审查任务数据"""
    video_id: str
    video_path: str
    video_prompt: str
    db_session: Callable
    VideoQueueItem_model: Any


class ReviewQueueManager:
    """
    审查队列管理器 - 顺序执行审查任务
    """
    
    _instance: Optional['ReviewQueueManager'] = None
    
    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._is_running: bool = False
        self._worker_task: Optional[asyncio.Task] = None
        self._processing_count: int = 0
        self._completed_count: int = 0
        self._failed_count: int = 0
    
    @classmethod
    def get_instance(cls) -> 'ReviewQueueManager':
        """获取单例实例"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    async def add_task(self, task: ReviewTask) -> int:
        """
        添加审查任务到队列
        
        Returns:
            当前队列长度
        """
        await self._queue.put(task)
        queue_size = self._queue.qsize()
        logger.info(f"Review task added for video {task.video_id}, queue size: {queue_size}")
        
        # 确保 worker 正在运行
        if not self._is_running:
            self._start_worker()
        
        return queue_size
    
    def _start_worker(self):
        """启动队列处理 worker"""
        if self._worker_task is None or self._worker_task.done():
            self._is_running = True
            self._worker_task = asyncio.create_task(self._process_queue())
            logger.info("Review queue worker started")
    
    async def _process_queue(self):
        """处理队列中的任务（顺序执行）"""
        from video_reviewer import trigger_video_review
        
        while True:
            try:
                # 等待任务，超时后检查是否应该退出
                try:
                    task: ReviewTask = await asyncio.wait_for(
                        self._queue.get(),
                        timeout=60.0  # 60秒无任务后检查
                    )
                except asyncio.TimeoutError:
                    # 队列为空且等待超时，继续等待
                    if self._queue.empty():
                        logger.debug("Review queue empty, waiting for new tasks...")
                        continue
                    continue
                
                self._processing_count += 1
                logger.info(f"Processing review for video {task.video_id} (queue remaining: {self._queue.qsize()})")
                
                try:
                    # 顺序执行审查（使用 await 而不是 create_task）
                    await trigger_video_review(
                        video_id=task.video_id,
                        video_path=task.video_path,
                        video_prompt=task.video_prompt,
                        db_session=task.db_session,
                        VideoQueueItem_model=task.VideoQueueItem_model
                    )
                    self._completed_count += 1
                    logger.info(f"Review completed for video {task.video_id}")
                    
                except Exception as e:
                    self._failed_count += 1
                    logger.error(f"Review failed for video {task.video_id}: {e}")
                
                finally:
                    self._queue.task_done()
                    
                    # 短暂延迟以避免 API 限流
                    await asyncio.sleep(2.0)
                    
            except asyncio.CancelledError:
                logger.info("Review queue worker cancelled")
                break
            except Exception as e:
                logger.exception(f"Unexpected error in review queue worker: {e}")
                await asyncio.sleep(5.0)  # 错误后等待更长时间
    
    def get_status(self) -> dict:
        """获取队列状态"""
        return {
            "queue_size": self._queue.qsize(),
            "is_running": self._is_running,
            "processing_count": self._processing_count,
            "completed_count": self._completed_count,
            "failed_count": self._failed_count
        }
    
    async def shutdown(self):
        """关闭队列管理器"""
        self._is_running = False
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        logger.info("Review queue manager shutdown")


# 便捷函数
async def enqueue_video_review(
    video_id: str,
    video_path: str,
    video_prompt: str,
    db_session: Callable,
    VideoQueueItem_model: Any
) -> int:
    """
    将视频审查任务加入队列（顺序执行）
    
    Returns:
        当前队列长度
    """
    manager = ReviewQueueManager.get_instance()
    task = ReviewTask(
        video_id=video_id,
        video_path=video_path,
        video_prompt=video_prompt,
        db_session=db_session,
        VideoQueueItem_model=VideoQueueItem_model
    )
    return await manager.add_task(task)


def get_review_queue_status() -> dict:
    """获取审查队列状态"""
    manager = ReviewQueueManager.get_instance()
    return manager.get_status()
