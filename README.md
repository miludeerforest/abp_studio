# ABP Studio

ABP Studio 是一个面向电商与内容团队的 AI 生产平台，用于把商品图转化为营销场景图、短视频和可管理的内容资产。

> 本仓库同步的是源代码、配置模板和脱敏后的文档。生产环境的 `.env`、上传文件、数据库、构建产物、反向代理和备份配置不属于仓库内容。

## 当前架构

项目目前保留 Python/FastAPI 兼容后端，同时提供 Rust/Axum 重构版。两套后端可以共享同一 PostgreSQL、Redis 和上传目录，并行运行，便于灰度验证和回滚。

| 服务 | 实现 | Compose 服务 | 默认端口/入口 | 职责 |
|---|---|---|---|---|
| Frontend | React 19 + Vite + Nginx | `frontend` | `33012` | Web 界面和静态资源 |
| Legacy API | FastAPI + SQLAlchemy | `backend` | `33013` | 兼容实现和回滚目标 |
| Rust API | Axum + SQLx + Tokio | `backend-rust` | `33014` | 重构后的 HTTP/WebSocket API |
| Rust Worker | Tokio 独立进程 | `backend-rust-worker` | 无宿主机端口 | 持久化任务、视频队列和恢复循环 |

Rust workspace 位于 `backend-rust/`，包含：

- `abp-core`：领域模型、配置和业务规则；
- `abp-infra`：PostgreSQL、Redis、认证和按业务域拆分的仓储；
- `abp-ai`：provider、SSE、媒体和 prompt 适配；
- `abp-api`：Axum 路由、服务编排、WebSocket 和错误映射；
- `abp-worker`：可独立重启的后台任务/视频 worker。

详细设计见 [`backend-rust/ARCHITECTURE.md`](backend-rust/ARCHITECTURE.md)。

## 数据与兼容性

Rust 版遵循既有 Python API 契约，重点保持以下边界不变：

- JWT 使用同一 `SECRET_KEY`，现有用户和存量 bcrypt 哈希可继续使用；
- PostgreSQL 表结构以既有业务表为基线，启动迁移使用幂等 SQL；
- Redis key、队列、Pub/Sub 事件和上传目录保持兼容；
- API 响应字段、错误格式、分页结构和 WebSocket 入口保持兼容；
- Python 后端和 Rust 后端可以暂时并行运行，不要求数据迁移或重新注册用户。

### 请求路由说明

Docker Compose 只负责启动服务和端口映射。真正的公网 API、WebSocket、uploads 和前端路由由部署环境的反向代理决定，反向代理配置不保存在本仓库中。

因此，切换到 Rust API 前必须在目标环境中单独确认：

1. `/api/` 是否指向 Rust API 端口；
2. `/ws/` 是否允许 WebSocket 升级；
3. `/uploads/` 是否指向共享上传目录；
4. `/openapi.json` 是否指向预期的后端；
5. Python 端是否仍可作为回滚目标。

Rust API 提供：

```text
GET /healthz
GET /openapi.json
```

## 快速开始

### 1. 准备环境

需要：

- Docker 24+；
- Docker Compose v2+；
- 可访问的 PostgreSQL；
- 可访问的 Redis；
- 已配置的 AI、视频、语音或飞书 provider（按实际功能需要）。

### 2. 配置本地环境

```bash
git clone https://github.com/miludeerforest/abp_studio.git
cd abp_studio
cp .env.example .env
# 编辑 .env，填入本地或部署环境的真实值；不要提交 .env
```

### 3. 只校验 Compose 配置

```bash
docker compose config --quiet
```

该命令不会重启正在运行的服务。

### 4. 启动 Compose 服务

```bash
docker compose up -d --build
```

当前 Compose 文件会同时声明 Python API、Rust API、Rust worker 和前端。只更新单个服务时使用服务级命令，并先确认 `depends_on` 不会拉起不需要的依赖。

### 5. 启动 Rust 版服务

如果只需要构建镜像而不改变运行中的服务：

```bash
docker compose build backend-rust backend-rust-worker
```

确认后再按服务启动 Rust 版：

```bash
docker compose up -d --build backend-rust backend-rust-worker
```

启用独立 worker 时，建议让 Rust API 使用：

```text
DISABLE_BACKGROUND_WORKER=true
```

避免 API 内置循环和独立 worker 重复消费同一队列。更新单个 Rust 服务时，不要使用 `docker compose down`，也不要重建无关的主服务。

## 环境变量

`.env.example` 只包含变量名和占位值。Rust 版与 Python 版共用主要配置：

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串，Rust 版必需 |
| `SECRET_KEY` | JWT 签名密钥 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 首次启动管理员引导 |
| `FORCE_RESET_ADMIN_PASSWORD` | 是否在启动时重置已有管理员密码 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | Redis 连接 |
| `UPLOADS_DIR` | 上传目录，容器内通常为 `/app/uploads` |
| `HOST` / `PORT` | Rust API 监听地址和端口 |
| `CORS_ORIGINS` | Rust API 的允许来源 |
| `DISABLE_BACKGROUND_WORKER` | 是否关闭 Rust API 内置后台循环 |

管理员密码默认不会在每次重启时覆盖。只有显式设置 `FORCE_RESET_ADMIN_PASSWORD=true` 才会重置；完成恢复后应立即改回 `false`。

## 开发与验证

### Rust

```bash
cd backend-rust
cargo fmt --all -- --check
cargo test --workspace --locked
cargo run -p abp-api
cargo run -p abp-worker
```

需要执行 Redis 兼容测试时，使用隔离 Redis 数据库，并通过环境变量传入测试地址：

```bash
REDIS_TEST_URL='redis://<host>:<port>/<isolated-db>' cargo test --workspace --locked -- --ignored
```

不要把真实数据库地址、Token、API Key 或生产主机信息写入命令示例、测试报告或提交记录。

### Frontend

```bash
cd frontend
npm install
npm run build
npm run lint
npm run dev
```

前端默认使用同源 `/api/`、`/ws/` 和 `/uploads/` 路径；本地或生产环境应由反向代理把这些路径转发到选定的后端。

### 差分验证

Rust 目录下的 `tools/` 提供 Python/Rust 差分和隔离 smoke 工具。完整说明见：

- [`backend-rust/PARITY_EVIDENCE.md`](backend-rust/PARITY_EVIDENCE.md)
- [`backend-rust/PARITY_MANIFEST.md`](backend-rust/PARITY_MANIFEST.md)

差分测试应优先使用一次性数据库、Redis、uploads 目录和 provider stub，避免写入生产数据或消耗真实 provider 配额。

## 安全与同步边界

提交前确认：

```bash
git status --short --untracked-files=all
git diff --check
git check-ignore -v .env backend-rust/target frontend/dist
```

以下内容不得提交：

- `.env` 和任何真实环境变量文件；
- API Key、JWT、密码、私钥、云厂商 Token；
- PostgreSQL/Redis 数据、uploads、视频和图片；
- `target/`、`node_modules/`、`dist/`、`__pycache__/` 等构建或缓存目录；
- 生产主机名、内网 IP、管理面板路径、备份路径和反向代理私有配置。

## 目录结构

```text
.
├── backend/                 # Python/FastAPI 兼容后端
├── backend-rust/            # Rust workspace
│   ├── crates/abp-core/     # 领域层
│   ├── crates/abp-infra/    # 数据库、Redis、认证和仓储
│   ├── crates/abp-ai/      # provider 与媒体适配
│   ├── crates/abp-api/     # HTTP/WebSocket API
│   ├── crates/abp-worker/  # 独立后台 worker
│   ├── tools/              # 差分与隔离验证工具
│   └── crates/abp-api/migrations/ # 幂等基线迁移
├── frontend/               # React/Vite 前端
├── docker-compose.yml
├── .env.example
└── README.md
```

## 许可证

本项目使用 MIT License。
