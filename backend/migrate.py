from sqlalchemy import create_engine, text
import os

DATABASE_URL = "postgresql://YOUR_USER:YOUR_PASSWORD_HERE@YOUR_HOST_HERE:5432/banana_db"
engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as conn:
        print("Migrating database...")
        conn.execute(text("ALTER TABLE video_queue ADD COLUMN IF NOT EXISTS user_id INTEGER;"))
        conn.commit()
        print("Migration successful.")
except Exception as e:
    print(f"Migration failed: {e}")
