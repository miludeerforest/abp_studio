"""
Migration script to add is_shared column to saved_images and video_queue tables.
Run this script once to update existing database schema.
"""
import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/db")

def migrate():
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as conn:
        # Add is_shared column to saved_images table
        try:
            conn.execute(text("""
                ALTER TABLE saved_images 
                ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE
            """))
            print("✅ Added is_shared column to saved_images table")
        except Exception as e:
            print(f"⚠️ saved_images migration: {e}")
        
        # Add is_shared column to video_queue table
        try:
            conn.execute(text("""
                ALTER TABLE video_queue 
                ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE
            """))
            print("✅ Added is_shared column to video_queue table")
        except Exception as e:
            print(f"⚠️ video_queue migration: {e}")
        
        conn.commit()
        print("✅ Migration completed successfully!")

if __name__ == "__main__":
    migrate()
