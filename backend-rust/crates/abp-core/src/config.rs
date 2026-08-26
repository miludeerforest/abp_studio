//! 应用配置：从环境变量加载（与原 Python 后端 `.env` 完全兼容）。

use std::env;

#[derive(Debug, Clone)]
pub struct Settings {
    /// PostgreSQL 连接串（DATABASE_URL）
    pub database_url: String,
    /// JWT 签名密钥
    pub secret_key: String,
    /// JWT 有效期（分钟）
    pub access_token_expire_minutes: i64,
    /// 初始管理员用户名
    pub admin_user: String,
    /// 初始管理员密码
    pub admin_password: String,
    /// 启动时强制按 env 重置管理员密码
    pub force_reset_admin_password: bool,
    /// Redis 配置
    pub redis_host: String,
    pub redis_port: u16,
    pub redis_password: Option<String>,
    pub redis_db: u8,
    /// 上传文件根目录（容器内 /app/uploads）
    pub uploads_dir: String,
    /// 服务监听地址/端口
    pub host: String,
    pub port: u16,
    /// 允许的跨域来源（逗号分隔，"*" 表示全部）
    pub cors_origins: String,
}

impl Settings {
    /// 从进程环境变量构建；缺失的关键项返回错误。
    pub fn from_env() -> anyhow::Result<Self> {
        let _ = dotenvy::dotenv();
        Ok(Self {
            database_url: require_env("DATABASE_URL")?,
            secret_key: env::var("SECRET_KEY")
                .unwrap_or_else(|_| "your-secret-key-change-this-in-production".into()),
            access_token_expire_minutes: env::var("ACCESS_TOKEN_EXPIRE_MINUTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1440),
            admin_user: env::var("ADMIN_USER").unwrap_or_else(|_| "admin".into()),
            admin_password: env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin123".into()),
            force_reset_admin_password: env::var("FORCE_RESET_ADMIN_PASSWORD")
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            redis_host: env::var("REDIS_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            redis_port: env::var("REDIS_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(6379),
            redis_password: env::var("REDIS_PASSWORD").ok().filter(|s| !s.is_empty()),
            redis_db: env::var("REDIS_DB")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            uploads_dir: env::var("UPLOADS_DIR").unwrap_or_else(|_| "./uploads".into()),
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8000),
            cors_origins: env::var("CORS_ORIGINS").unwrap_or_else(|_| "*".into()),
        })
    }

    /// Redis URL：redis://[:password@]host:port/db
    pub fn redis_url(&self) -> String {
        match &self.redis_password {
            Some(p) => format!(
                "redis://:{p}@{}:{}/{}",
                self.redis_host, self.redis_port, self.redis_db
            ),
            None => format!(
                "redis://{}:{}/{}",
                self.redis_host, self.redis_port, self.redis_db
            ),
        }
    }
}

fn require_env(key: &str) -> anyhow::Result<String> {
    env::var(key).map_err(|_| anyhow::anyhow!("missing required environment variable: {key}"))
}
