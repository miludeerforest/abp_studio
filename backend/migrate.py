from sqlalchemy import create_engine, text
import os

# 从环境变量读取数据库连接
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/db")
engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as conn:
        print("Migrating database...")
        conn.execute(text("ALTER TABLE video_queue ADD COLUMN IF NOT EXISTS user_id INTEGER;"))
        conn.commit()
        print("Migration successful.")
except Exception as e:
    print(f"Migration failed: {e}")
