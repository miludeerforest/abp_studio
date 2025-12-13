#!/bin/bash
# auto_banana_product 每日备份脚本
# 使用 rclone 直接同步当天生成的视频和图片到 OneDrive
# 运行时间：每天凌晨 2:30

set -e

# 配置
SOURCE_VIDEO="/opt/1panel/docker/compose/auto_banana_product/backend/uploads/queue"
SOURCE_IMG="/opt/1panel/docker/compose/auto_banana_product/backend/uploads/gallery"
RCLONE_REMOTE="onedrive"
DEST_VIDEO="auto_banana_product/video"
DEST_IMG="auto_banana_product/img"
LOG_FILE="/var/log/auto_banana_backup.log"
TEMP_DIR="/tmp/banana_backup_$(date +%Y%m%d)"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "========== 开始备份 =========="

# 创建临时目录
mkdir -p "$TEMP_DIR/video" "$TEMP_DIR/img"

# 查找今天创建的视频文件 (.mp4)
log "查找今日视频文件..."
if [ -d "$SOURCE_VIDEO" ]; then
    find "$SOURCE_VIDEO" -name "*.mp4" -type f -mtime -1 -exec cp {} "$TEMP_DIR/video/" \;
    VIDEO_COUNT=$(ls -1 "$TEMP_DIR/video/"*.mp4 2>/dev/null | wc -l)
    log "找到 $VIDEO_COUNT 个今日视频文件"
else
    log "警告: 视频源目录不存在: $SOURCE_VIDEO"
fi

# 查找今天创建的图片文件
log "查找今日图片文件..."
if [ -d "$SOURCE_IMG" ]; then
    find "$SOURCE_IMG" \( -name "*.jpg" -o -name "*.png" -o -name "*.jpeg" -o -name "*.webp" \) -type f -mtime -1 -exec cp {} "$TEMP_DIR/img/" \;
    IMG_COUNT=$(ls -1 "$TEMP_DIR/img/"* 2>/dev/null | wc -l)
    log "找到 $IMG_COUNT 个今日图片文件"
else
    log "警告: 图片源目录不存在: $SOURCE_IMG"
fi

# 使用 rclone 上传视频
if [ "$(ls -A $TEMP_DIR/video 2>/dev/null)" ]; then
    log "上传视频到 OneDrive..."
    rclone copy "$TEMP_DIR/video" "$RCLONE_REMOTE:$DEST_VIDEO" --progress 2>&1 | tee -a "$LOG_FILE"
    log "视频上传完成"
else
    log "没有需要上传的视频"
fi

# 使用 rclone 上传图片
if [ "$(ls -A $TEMP_DIR/img 2>/dev/null)" ]; then
    log "上传图片到 OneDrive..."
    rclone copy "$TEMP_DIR/img" "$RCLONE_REMOTE:$DEST_IMG" --progress 2>&1 | tee -a "$LOG_FILE"
    log "图片上传完成"
else
    log "没有需要上传的图片"
fi

# 清理临时目录
rm -rf "$TEMP_DIR"

log "========== 备份完成 =========="
