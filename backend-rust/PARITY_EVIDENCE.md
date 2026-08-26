# Python → Rust 差分验证证据

本文档只记录可复现的验证方法和脱敏结果，不记录真实 Token、API Key、数据库地址、生产主机、内网 IP、面板路径或备份位置。

## 验证层级

### 1. Workspace 测试

```bash
cd backend-rust
cargo fmt --all -- --check
cargo test --workspace --locked
```

覆盖领域规则、认证、并发限制、provider JSON/SSE、重试分类和 Rust API/worker 编译入口。

Redis 兼容测试需要隔离 Redis 数据库：

```bash
REDIS_TEST_URL='redis://<host>:<port>/<isolated-db>' \
  cargo test --workspace --locked -- --ignored
```

### 2. 只读差分 smoke

差分工具对 Python 和 Rust 的只读响应比较状态码及规范化后的 JSON 结构。动态时间和独立进程产生的连接计数应在 harness 中归一化。

```bash
python3 tools/differential_smoke.py \
  --python '<python-base-url>' \
  --rust '<rust-base-url>' \
  --token "$TOKEN"
```

现有记录：**14/14 只读检查通过**。覆盖公开配置、公开视频、用户资料、经验、统计、用户、gallery、queue、管理员状态、任务和活动等契约。

### 3. 隔离写入/provider smoke

写入验证必须使用一次性 PostgreSQL、Redis、uploads 目录和 provider stub，不能连接生产数据库或使用真实 provider 配额。

```bash
python3 tools/differential_write_smoke.py \
  --python '<isolated-python-url>' \
  --rust '<isolated-rust-url>' \
  --admin-password "$PARITY_ADMIN_PASSWORD"
```

现有记录：**88/88 隔离检查通过**，包含 queue、story chain/fission、retry/remerge、video review、经验记录、provider 重试和响应契约。

### 4. worker 与 Redis 事件

`tools/run_isolated_parity.sh` 会组合调用 Redis 事件和恢复检查，重点覆盖：

- `video_processing`、`video_completed`、`video_failed` 事件；
- 用户频道和全局频道的 fan-out；
- stale task 的重启恢复；
- story/video 任务的状态持久化和产物检查；
- disposable 资源的清理。

## 历史修复类别

差分过程中曾修复或确认以下兼容边界：

- 生产基线中不存在的字段不能被 Rust 查询；
- 经验历史、活动和管理员响应不能暴露旧版没有的字段；
- queue 创建、重试、story remerge 的状态码、文件名和 UUID 需要保持一致；
- provider 的 4xx、5xx、超时和可重试错误必须分类；
- Redis key、channel、TTL、原子 claim 和 release 需要与 Python 版一致；
- worker 重启后必须能够恢复 stale 任务。

## 解释和边界

- `PARITY_MANIFEST.md` 是路由/入口清单；
- 本文件中的数字是历史运行记录，代码变更后必须重新执行相应检查；
- 通过差分测试不代表 provider、数据库、Redis 或部署环境永远可用；
- 生产流量切换由外部反向代理和部署平台负责，相关私有配置不进入 Git；
- 测试日志只能使用占位符，不能复制真实请求头、Token、密码、URL 参数或文件路径。
