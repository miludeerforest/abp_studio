"""
迁移脚本：为现有用户添加经验值和等级字段
运行方法：python migrate_user_experience.py
"""
import os
import sys

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")
engine = create_engine(DATABASE_URL)

def migrate():
    """执行数据库迁移"""
    with engine.connect() as conn:
        # 添加 User 表新字段
        print("正在迁移 users 表...")
        
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN experience INTEGER DEFAULT 0"))
            print("  ✓ 添加 'experience' 列")
        except Exception as e:
            if "duplicate" in str(e).lower() or "already exists" in str(e).lower():
                print("  - 'experience' 列已存在，跳过")
            else:
                print(f"  ! 'experience' 列添加失败: {e}")
        
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1"))
            print("  ✓ 添加 'level' 列")
        except Exception as e:
            if "duplicate" in str(e).lower() or "already exists" in str(e).lower():
                print("  - 'level' 列已存在，跳过")
            else:
                print(f"  ! 'level' 列添加失败: {e}")
        
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN exp_updated_at TIMESTAMP"))
            print("  ✓ 添加 'exp_updated_at' 列")
        except Exception as e:
            if "duplicate" in str(e).lower() or "already exists" in str(e).lower():
                print("  - 'exp_updated_at' 列已存在，跳过")
            else:
                print(f"  ! 'exp_updated_at' 列添加失败: {e}")
        
        # 创建 experience_logs 表
        print("\n正在创建 experience_logs 表...")
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS experience_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER,
                    video_id VARCHAR,
                    score INTEGER,
                    exp_change INTEGER,
                    exp_before INTEGER,
                    exp_after INTEGER,
                    level_before INTEGER,
                    level_after INTEGER,
                    created_at TIMESTAMP
                )
            """))
            print("  ✓ 创建 'experience_logs' 表")
        except Exception as e:
            if "already exists" in str(e).lower():
                print("  - 'experience_logs' 表已存在，跳过")
            else:
                print(f"  ! 'experience_logs' 表创建失败: {e}")
        
        # 创建索引
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_experience_logs_user_id ON experience_logs(user_id)"))
            print("  ✓ 创建 user_id 索引")
        except Exception as e:
            print(f"  - 索引创建: {e}")
        
        conn.commit()
    
    print("\n✅ 迁移完成！")

if __name__ == "__main__":
    print("=" * 50)
    print("用户经验值系统数据库迁移")
    print("=" * 50)
    migrate()
