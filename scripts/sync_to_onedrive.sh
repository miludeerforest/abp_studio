#!/bin/bash
#
# Auto Banana Product - OneDrive Sync Script
# Syncs uploads (gallery, queue) to OneDrive every 7 days
#
# Usage: ./sync_to_onedrive.sh
# Cron:  0 3 */7 * * /opt/1panel/docker/compose/auto_banana_product/scripts/sync_to_onedrive.sh >> /var/log/abp_sync.log 2>&1
#

# Configuration
SOURCE_DIR="/opt/1panel/docker/compose/auto_banana_product/backend/uploads"
DEST_DIR="/mnt/onedrive/auto_banana_product_backup"
LOG_FILE="/var/log/abp_sync.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
    echo "[$DATE] $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "[$DATE] ${RED}ERROR: $1${NC}" | tee -a "$LOG_FILE"
}

success() {
    echo -e "[$DATE] ${GREEN}SUCCESS: $1${NC}" | tee -a "$LOG_FILE"
}

# Check if source exists
if [ ! -d "$SOURCE_DIR" ]; then
    error "Source directory does not exist: $SOURCE_DIR"
    exit 1
fi

# Check if OneDrive is mounted
if ! mountpoint -q /mnt/onedrive 2>/dev/null; then
    log "OneDrive not mounted as mountpoint, checking if accessible..."
    if [ ! -d "/mnt/onedrive" ]; then
        error "OneDrive mount point does not exist: /mnt/onedrive"
        exit 1
    fi
fi

# Create destination directory if not exists
mkdir -p "$DEST_DIR/gallery" 2>/dev/null
mkdir -p "$DEST_DIR/queue" 2>/dev/null

log "Starting sync to OneDrive..."
log "Source: $SOURCE_DIR"
log "Destination: $DEST_DIR"

# Sync gallery (images)
log "Syncing gallery (images)..."
rsync -av --progress --delete \
    "$SOURCE_DIR/gallery/" \
    "$DEST_DIR/gallery/" 2>&1 | tee -a "$LOG_FILE"

GALLERY_STATUS=$?

# Sync queue (videos)
log "Syncing queue (videos)..."
rsync -av --progress --delete \
    "$SOURCE_DIR/queue/" \
    "$DEST_DIR/queue/" 2>&1 | tee -a "$LOG_FILE"

QUEUE_STATUS=$?

# Summary
if [ $GALLERY_STATUS -eq 0 ] && [ $QUEUE_STATUS -eq 0 ]; then
    success "Sync completed successfully!"
    
    # Count files
    GALLERY_COUNT=$(find "$SOURCE_DIR/gallery" -type f 2>/dev/null | wc -l)
    QUEUE_COUNT=$(find "$SOURCE_DIR/queue" -type f 2>/dev/null | wc -l)
    
    log "Gallery: $GALLERY_COUNT files"
    log "Queue: $QUEUE_COUNT files"
else
    error "Sync completed with errors (gallery: $GALLERY_STATUS, queue: $QUEUE_STATUS)"
    exit 1
fi

log "Done!"
