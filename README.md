# ABP Studio（智能商品场景生成系统）

## 项目简介
ABP Studio 是一个面向电商与内容团队的 AI 生产平台，用于把商品图自动转化为营销场景图与短视频素材。
系统提供从图片分析、文案生成、批量出图、视频生成到资源管理的一体化流程，支持多用户权限与运营管理。

## 核心能力
| 模块 | 说明 |
|---|---|
| 批量场景生成 | 上传商品图后自动分析并生成多角度营销场景图 |
| 视频生成 | 将图片任务一键加入视频队列并异步生成视频 |
| 一镜到底（Story） | 支持故事化生成链路，输出连贯视频内容 |
| 裂变模式 | 单图多分支生成并支持后续合并处理 |
| 画廊管理 | 图片/视频筛选、预览、删除、批量下载 |
| 多用户管理 | 用户权限、经验值、活动记录与监控 |

## 技术栈与架构
- 前端：React 19 + Vite
- 后端：FastAPI + SQLAlchemy
- 数据库：PostgreSQL（外部服务）
- 缓存/队列：Redis（外部服务）
- 容器编排：Docker Compose（当前 compose 文件包含 `backend` 和 `frontend` 两个服务）

默认端口：
- 前端：`33012`
- 后端 API：`33013`
- API 文档：`http://localhost:33013/docs`

## 快速开始（Docker）
### 1) 环境要求
- Docker 24+
- Docker Compose v2+
- 可用的 PostgreSQL 与 Redis 服务

### 2) 获取代码
```bash
git clone https://github.com/miludeerforest/abp_studio.git
cd abp_studio
```

### 3) 配置环境变量
```bash
cp .env.example .env
# 按需编辑 .env
```

### 4) 启动服务
```bash
docker compose up -d --build
```

### 5) 访问服务
- 前端：`http://localhost:33012`
- 后端：`http://localhost:33013`
- OpenAPI 文档：`http://localhost:33013/docs`

## 关键环境变量说明
以下字段建议在 `.env` 中优先确认：

| 变量 | 用途 | 示例/默认 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://user:password@hostname:5432/database_name` |
| `SECRET_KEY` | JWT 签名密钥 | `your-secret-key-change-this-in-production` |
| `ADMIN_USER` | 初始管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 初始管理员密码 | `your_secure_password_here` |
| `FORCE_RESET_ADMIN_PASSWORD` | 是否强制按 env 重置管理员密码 | `false` |
| `REDIS_HOST` | Redis 主机 | `redis_container_name` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `REDIS_PASSWORD` | Redis 密码 | `your_redis_password_here` |
| `REDIS_DB` | Redis DB 索引 | `0` |
| `DEFAULT_API_URL` | 图像生成 API 地址 | `https://your-api-provider.com/v1` |
| `DEFAULT_API_KEY` | 图像生成 API Key | `sk-your-api-key-here` |
| `DEFAULT_MODEL_NAME` | 图像生成模型名 | `gemini-2.0-flash-exp` |
| `VIDEO_API_URL` | 视频生成 API 地址 | `https://your-video-api.com/v1` |
| `VIDEO_API_KEY` | 视频生成 API Key | `sk-your-video-api-key-here` |
| `VIDEO_MODEL_NAME` | 视频生成模型名 | `sora2-portrait-15s` |

## 管理员密码策略
系统启动时的管理员密码行为如下：

1. **首次启动（管理员不存在）**：
   - 使用 `ADMIN_USER` / `ADMIN_PASSWORD` 创建管理员。
2. **后续启动（管理员已存在）**：
   - 默认**不覆盖**数据库中的现有管理员密码。
3. **强制重置**：
   - 仅当 `FORCE_RESET_ADMIN_PASSWORD=true` 时，启动阶段才会把管理员密码重置为 `ADMIN_PASSWORD`。
   - 重置后请立即把该开关改回 `false`，避免后续重启再次覆盖。

迁移提示：旧版本“每次启动覆盖密码”的行为已收敛为“默认不覆盖”。

## 常用运维命令
```bash
# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 重启服务
docker compose restart backend
docker compose restart frontend
docker compose restart

# 更新部署（示例）
git pull
docker compose up -d --build

# 停止服务
docker compose down
```

## 开发说明
### 前端
```bash
cd frontend
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

### 后端
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## 目录结构
```text
.
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── uploads/
│   └── ...
├── frontend/
│   ├── src/
│   ├── package.json
│   └── ...
├── docker-compose.yml
├── .env.example
└── README.md
```

## 安全建议
1. 生产环境务必更换 `SECRET_KEY`，并保证强随机性。
2. `ADMIN_PASSWORD`、`REDIS_PASSWORD` 使用高强度密码并定期轮换。
3. 对外暴露时请在反向代理层启用 HTTPS。
4. 避免把 `.env`、数据库备份、上传目录暴露到公网仓库。
5. `FORCE_RESET_ADMIN_PASSWORD` 仅用于恢复场景，恢复完成后及时关闭。

## 故障排查（FAQ）
1. **后端启动失败提示数据库连接错误**
   - 检查 `DATABASE_URL` 是否可达，用户名/密码/库名是否正确。
2. **登录失败或管理员密码不生效**
   - 先确认是否已有管理员账号；后续启动默认不覆盖密码。
   - 需要重置时将 `FORCE_RESET_ADMIN_PASSWORD=true` 并重启 backend。
3. **前端无法请求后端**
   - 检查 `33013` 是否正常监听；确认反向代理与 CORS 配置。
4. **视频队列卡住或长时间 pending**
   - 检查 Redis 可用性与视频 API 配置（`VIDEO_API_*`）。
5. **上传后文件不存在或无法预览**
   - 检查 `backend/uploads` 挂载与文件权限。
6. **WebSocket 状态更新异常**
   - 检查 Redis 与网络连通；反向代理是否放行升级头。
7. **构建失败**
   - 前端执行 `npm install` 后重试 `npm run build`；后端确认虚拟环境依赖齐全。

## 许可证
本项目使用 MIT License。
