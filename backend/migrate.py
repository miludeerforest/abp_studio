from sqlalchemy import create_engine, text
import os

DATABASE_URL = "postgresql://banana_db:S7pGzXX2JmaH38yX@1Panel-postgresql-SJJE:5432/banana_db"
engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as conn:
        print("Migrating database...")
        conn.execute(text("ALTER TABLE video_queue ADD COLUMN IF NOT EXISTS user_id INTEGER;"))
        conn.commit()
        print("Migration successful.")
except Exception as e:
    print(f"Migration failed: {e}")
