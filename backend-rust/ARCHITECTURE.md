# ABP Rust 后端架构

## 1. 目标

Rust 版本的目标不是另起一套业务，而是在保持既有 Python/FastAPI 契约的前提下，拆分单体后端的传输层、领域层、基础设施和 provider 边界：

- 保持现有用户、数据库、Redis、uploads 和 API 响应兼容；
- 将长期任务从 HTTP 进程中抽出，支持独立 worker 和重启恢复；
- 让领域规则可以在不启动 Web 服务的情况下测试；
- 允许 Python 和 Rust 在迁移期间并行运行，降低切换风险。

## 2. 分层与依赖

```text
                         +----------------------+
                         |       abp-worker     |
                         |  persisted workflows |
                         +----------+-----------+
                                    |
                                    v
+------------------+       +--------+---------+       +----------------+
|    abp-ai        |<------+      abp-api      +------>|   abp-infra    |
| provider/media   |       | Axum/WS/services  |       | SQLx/Redis/auth|
+------------------+       +--------+---------+       +--------+-------+
                                    |                         |
                                    v                         v
                              +-----+-----+             +-----+------+
                              |  abp-core  |             | PostgreSQL |
                              | domain    |             | Redis      |
                              +-----------+             | uploads    |
                                                        +------------+
```

实际依赖关系保持单向：

- `abp-core` 不依赖 Web 或数据库框架；
- `abp-infra` 依赖领域类型，负责外部存储和认证；
- `abp-ai` 封装 provider、SSE、媒体和 prompt 规则；
- `abp-api` 组合路由、服务、状态、WebSocket 和错误转换；
- `abp-worker` 复用 API 服务和基础设施，但作为独立进程运行。

## 3. 运行时进程

### Rust API：`abp-server`

启动流程：

1. 从环境变量加载配置；
2. 初始化 PostgreSQL 连接池；
3. 执行幂等基线 SQL；
4. 引导管理员账号；
5. 连接 Redis（Redis 不可用时保留降级能力并记录告警）；
6. 注册 API、WebSocket、`/uploads`、`/healthz` 和 `/openapi.json`；
7. 根据 `DISABLE_BACKGROUND_WORKER` 决定是否运行内置维护循环。

### 独立 worker：`abp-worker`

worker 负责：

- 恢复过期或中断的持久化任务；
- claim 待处理视频队列项；
- 执行 provider 调用、重试、状态更新和事件发布；
- 在需要时执行显式的 gallery 清理命令。

当独立 worker 运行时，应将 API 的 `DISABLE_BACKGROUND_WORKER` 设为 `true`，避免重复消费。

## 4. 数据兼容边界

### PostgreSQL

- 使用既有业务表：用户、配置、画廊、视频队列、活动和经验记录等；
- `crates/abp-api/migrations/0001_baseline.sql` 使用幂等建表语句，允许新环境初始化；
- 不在 Rust 版启动时删除、重命名或重置既有数据；
- 查询和响应映射在仓储/服务边界完成，避免把数据库细节泄露到传输层。

### Redis

- 保持既有队列 key、用户任务 key、统计 key 和 Pub/Sub channel；
- 队列 claim、并发限制和 release 使用原子操作；
- 事件 payload 与 Python 版保持兼容，便于前端 WebSocket 状态更新。

### uploads

Rust API、Python API 和 worker 使用同一 uploads 挂载点。路径只通过 `UPLOADS_DIR` 配置，不把宿主机私有路径写进源代码或文档。

## 5. HTTP 和 WebSocket 契约

Rust 路由按业务域拆分在 `crates/abp-api/src/routes/`，长任务服务位于 `crates/abp-api/src/services/`。主要兼容范围包括：

- 登录、用户、管理员和配置；
- gallery、分享、批量下载和视频 review；
- queue、批量生成和视频处理；
- story chain/fission、重试和 remerge；
- keywords、Excel、Feishu 和 Mexico Beauty；
- voice clone、character、WebSocket 和 uploads。

错误在 API 层统一转换为与旧版兼容的 JSON 结构；领域层不直接依赖 HTTP 类型。

## 6. Provider 边界

`abp-ai` 统一处理：

- OpenAI-compatible chat/image 请求；
- Gemini-compatible 请求；
- 视频 provider 和重试分类；
- SSE 内容提取；
- 图片、视频、音频和 prompt 预处理。

测试使用本地 stub 或一次性隔离资源。真实 API Key、provider URL 和生产配置只从运行时环境注入。

## 7. 部署与回滚原则

Compose 支持 Python API、Rust API、Rust worker 和前端并行运行。更新 Rust 代码时建议按以下顺序：

1. `docker compose config --quiet` 校验配置；
2. `cargo test --workspace --locked` 和 `cargo fmt --all -- --check`；
3. `docker compose build backend-rust backend-rust-worker`，只构建镜像；
4. 对 Rust API 执行健康检查和只读差分验证；
5. 再按服务执行 `docker compose up -d --build ...`；
6. 确认外部反向代理的 API、WebSocket、uploads 和 OpenAPI 路由；
7. 保留 Python 服务作为回滚目标，出现异常时先恢复路由，再处理容器生命周期。

不要使用 `docker compose down` 作为普通更新步骤，也不要把生产反向代理、主机路径、备份位置或凭据写入仓库。

## 8. 当前验证范围

当前 Rust workspace 已包含：

- core 领域规则单元测试；
- auth、并发限制和 Redis 兼容测试；
- provider JSON/SSE、重试和非重试错误测试；
- API/worker 编译入口；
- Python/Rust 只读和隔离写入差分工具。

具体数字和运行方法见 [`PARITY_EVIDENCE.md`](PARITY_EVIDENCE.md) 与 [`PARITY_MANIFEST.md`](PARITY_MANIFEST.md)。验证报告是测试证据，不等于对任何生产环境持续可用性的保证。
