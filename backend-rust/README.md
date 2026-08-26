# ABP Rust Backend

`backend-rust/` 是 ABP Studio 后端的 Rust 重构版。它与既有 Python/FastAPI 后端共享 PostgreSQL、Redis 和 uploads 契约，支持并行运行、灰度切换和快速回滚。

## Workspace

| Crate | 职责 |
|---|---|
| `abp-core` | 配置、领域实体、业务规则和统一错误 |
| `abp-infra` | SQLx 数据库、Redis、认证、并发限制和仓储 |
| `abp-ai` | provider 请求、SSE、媒体和 prompt 适配 |
| `abp-api` | Axum 路由、服务编排、WebSocket、静态 uploads |
| `abp-worker` | 独立的持久化任务、视频队列和恢复循环 |

架构细节见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 本地验证

```bash
cargo fmt --all -- --check
cargo test --workspace --locked
```

## Docker

```bash
# 只构建镜像，不改变正在运行的容器
docker compose build backend-rust backend-rust-worker

# 确认后按服务启动
docker compose up -d --build backend-rust backend-rust-worker
```

Rust API 默认监听 Compose 暴露的 `33014` 端口，健康检查入口为 `/healthz`。独立 worker 启动时，应让 API 设置 `DISABLE_BACKGROUND_WORKER=true`。

## 配置

Rust 版读取与 Python 版兼容的环境变量。真实配置只放在未提交的 `.env` 或部署平台 Secret 中；文档、测试和日志只能使用占位符。

必需/常用变量包括：`DATABASE_URL`、`SECRET_KEY`、`REDIS_*`、`UPLOADS_DIR`、`HOST`、`PORT`、`CORS_ORIGINS` 和管理员引导变量。

## 差分证据

- [`PARITY_MANIFEST.md`](PARITY_MANIFEST.md)：兼容路由和后台入口清单；
- [`PARITY_EVIDENCE.md`](PARITY_EVIDENCE.md)：脱敏后的验证方法和历史结果。

这些文档记录的是可复现的测试证据，不记录生产主机、凭据、私有代理或备份信息。
