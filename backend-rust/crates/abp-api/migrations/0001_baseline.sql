-- 0001_baseline.sql — Rust 后端基线 schema（与 Python/SQLAlchemy 模型一致，幂等）。
-- 已有数据库上执行无副作用；全新部署时创建全部表。

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR UNIQUE,
    nickname VARCHAR,
    avatar VARCHAR,
    default_share BOOLEAN DEFAULT TRUE,
    hashed_password VARCHAR NOT NULL,
    role VARCHAR DEFAULT 'user',
    created_at TIMESTAMP DEFAULT NOW(),
    experience INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    exp_updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);

CREATE TABLE IF NOT EXISTS image_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_image_logs_user_id ON image_logs (user_id);

CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR PRIMARY KEY,
    value VARCHAR
);

CREATE TABLE IF NOT EXISTS video_queue (
    id VARCHAR PRIMARY KEY,
    filename VARCHAR,
    file_path VARCHAR,
    prompt VARCHAR,
    status VARCHAR DEFAULT 'pending',
    result_url VARCHAR,
    error_msg VARCHAR,
    user_id INTEGER,
    category VARCHAR DEFAULT 'other',
    is_merged BOOLEAN DEFAULT FALSE,
    is_shared BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    preview_url VARCHAR,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP,
    review_score INTEGER,
    review_result TEXT,
    review_status VARCHAR,
    reviewed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_video_queue_status ON video_queue (status);
CREATE INDEX IF NOT EXISTS ix_video_queue_user_id ON video_queue (user_id);

CREATE TABLE IF NOT EXISTS saved_images (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    filename VARCHAR,
    file_path VARCHAR,
    url VARCHAR,
    prompt VARCHAR,
    width INTEGER,
    height INTEGER,
    category VARCHAR DEFAULT 'other',
    is_shared BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_saved_images_user_id ON saved_images (user_id);

CREATE TABLE IF NOT EXISTS user_activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    action VARCHAR,
    details TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_user_activities_user_id ON user_activities (user_id);
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_activities' AND column_name = 'detail'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_activities' AND column_name = 'details'
    ) THEN
        ALTER TABLE user_activities RENAME COLUMN detail TO details;
    END IF;
END $$;

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
);
CREATE INDEX IF NOT EXISTS ix_experience_logs_user_id ON experience_logs (user_id);


-- Persisted async workflow state for generation/story/fission and restart recovery.
CREATE TABLE IF NOT EXISTS task_runs (
    id VARCHAR PRIMARY KEY,
    kind VARCHAR NOT NULL,
    user_id INTEGER,
    status VARCHAR NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    payload JSONB,
    result JSONB,
    error_msg TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    heartbeat_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_task_runs_user_id ON task_runs (user_id);
CREATE INDEX IF NOT EXISTS ix_task_runs_status ON task_runs (status);

-- Keyword history was process-local in Python; Rust persists it per user.
CREATE TABLE IF NOT EXISTS keyword_histories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    record JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_keyword_histories_user_id ON keyword_histories (user_id);
