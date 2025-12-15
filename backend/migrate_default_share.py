#!/usr/bin/env python3
"""
Migration script to update default share behavior.
1. Change is_shared default from FALSE to TRUE in both tables
2. Update existing records to is_shared=TRUE (optional, based on user preference)

Run this inside the backend container:
docker compose exec backend python migrate_default_share.py
"""

import os
import sys
from sqlalchemy import text

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import engine

def migrate():
    # Use begin() for auto-commit on success (SQLAlchemy 2.0 style)
    with engine.begin() as conn:
        # 1. Update saved_images table default
        try:
            conn.execute(text("""
                ALTER TABLE saved_images 
                ALTER COLUMN is_shared SET DEFAULT TRUE
            """))
            print("✅ Updated saved_images.is_shared default to TRUE")
        except Exception as e:
            print(f"⚠️ saved_images default update: {e}")
        
        # 2. Update video_queue table default
        try:
            conn.execute(text("""
                ALTER TABLE video_queue 
                ALTER COLUMN is_shared SET DEFAULT TRUE
            """))
            print("✅ Updated video_queue.is_shared default to TRUE")
        except Exception as e:
            print(f"⚠️ video_queue default update: {e}")
        
        # 3. Optionally update all existing records to is_shared=TRUE
        # Uncomment the following if you want ALL existing content to be shared
        
        try:
            result = conn.execute(text("""
                UPDATE saved_images SET is_shared = TRUE WHERE is_shared = FALSE
            """))
            print(f"✅ Updated {result.rowcount} existing images to is_shared=TRUE")
        except Exception as e:
            print(f"⚠️ saved_images update: {e}")
        
        try:
            result = conn.execute(text("""
                UPDATE video_queue SET is_shared = TRUE WHERE is_shared = FALSE
            """))
            print(f"✅ Updated {result.rowcount} existing videos to is_shared=TRUE")
        except Exception as e:
            print(f"⚠️ video_queue update: {e}")
        
        # 4. Update users.default_share to TRUE
        try:
            result = conn.execute(text("""
                UPDATE users SET default_share = TRUE WHERE default_share = FALSE OR default_share IS NULL
            """))
            print(f"✅ Updated {result.rowcount} users to default_share=TRUE")
        except Exception as e:
            print(f"⚠️ users default_share update: {e}")
        
        # 5. Update users table default value
        try:
            conn.execute(text("""
                ALTER TABLE users 
                ALTER COLUMN default_share SET DEFAULT TRUE
            """))
            print("✅ Updated users.default_share default to TRUE")
        except Exception as e:
            print(f"⚠️ users default update: {e}")
    
    print("✅ Migration completed successfully!")


if __name__ == "__main__":
    migrate()
