"""
Migration script to add missing performance indexes.
Run this once to add indexes to existing tables.

Usage:
    python migrate_add_indexes.py
"""
import os
import sys
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/db")

def migrate():
    engine = create_engine(DATABASE_URL)
    
    indexes = [
        ("ix_video_queue_user_id", "video_queue", "user_id"),
        ("ix_video_queue_status", "video_queue", "status"),
        ("ix_video_queue_is_shared", "video_queue", "is_shared"),
        ("ix_saved_images_is_shared", "saved_images", "is_shared"),
    ]
    
    with engine.connect() as conn:
        for idx_name, table, column in indexes:
            try:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({column})"))
                print(f"✅ Created index {idx_name} on {table}.{column}")
            except Exception as e:
                print(f"⚠️  Index {idx_name}: {e}")
        conn.commit()
    
    print("\nDone! All indexes applied.")

if __name__ == "__main__":
    migrate()
