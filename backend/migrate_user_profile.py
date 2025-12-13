#!/usr/bin/env python3
"""
Migration script to add nickname, avatar, and default_share columns to users table.
Run this inside the backend container:
docker compose exec backend python migrate_user_profile.py
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
        # Add nickname column
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR"))
            print("✅ Added nickname column to users table")
        except Exception as e:
            print(f"⚠️ nickname column: {e}")
        
        # Add avatar column
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR"))
            print("✅ Added avatar column to users table")
        except Exception as e:
            print(f"⚠️ avatar column: {e}")
        
        # Add default_share column
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_share BOOLEAN DEFAULT FALSE"))
            print("✅ Added default_share column to users table")
        except Exception as e:
            print(f"⚠️ default_share column: {e}")
    
    print("✅ Migration completed successfully!")

if __name__ == "__main__":
    migrate()
