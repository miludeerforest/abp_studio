# ABP Studio - 智能商品场景生成系统

基于 AI 的自动化商品场景生成与视频制作平台。上传商品图片，自动分析特征、生成多角度场景图，一键生成营销短视频。

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🎨 **批量场景生成** | 上传白底图，自动生成 9 种不同角度的营销场景图 |
| 📹 **视频生成** | 图片一键转换动态视频（支持 Sora/Veo） |
| 🎬 **一镜到底** | 自动编排分镜，生成连贯故事视频 |
| 💥 **裂变模式** | 单图生成多分支场景，自动合成完整视频 |
| 👥 **多用户管理** | 用户权限隔离、用量统计 |

---

## 🚀 快速部署

### 1. 环境要求
- Docker & Docker Compose

### 2. 部署步骤

```bash
# 克隆项目
git clone <your-repo-url> auto_banana_product
cd auto_banana_product

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入配置

# 启动服务
docker compose up -d --build
```

### 3. 必填配置 (.env)

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `SECRET_KEY` | JWT 密钥 (`openssl rand -hex 32`) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 管理员账号密码 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis 配置 |

> **API 配置**可在登录后通过「系统设置」页面配置

---

## 📖 使用指南

### 访问地址
- **前端**: `http://localhost:33012`
- **后端 API**: `http://localhost:33013`

### 操作流程

**场景生成**: 上传商品图 → 智能分析 → 生成脚本 → 批量生成图片

**视频生成**: 选择图片 → 点击"转为视频" → 队列处理 → 预览下载

**故事模式**: 上传图片 → 输入主题 → 生成分镜 → 合成视频

**批量下载**: 画廊 → 批量管理 → 选择多个 → 📦下载 → ZIP打包

---

## 🛠️ 维护

```bash
# 查看日志
docker compose logs -f backend

# 重启服务
docker compose restart backend
docker compose restart frontend
```

---

## 📁 目录结构

```
auto_banana_product/
├── backend/           # FastAPI 后端
├── frontend/          # React 前端
├── docker-compose.yml # 容器编排
├── .env               # 配置文件
└── uploads/           # 上传文件目录
```

---

## 📝 更新日志

### v1.6.0 (2025-01-07)
- ✨ **批量下载**: 画廊支持批量选择图片/视频打包为ZIP下载
- 🔧 视频下载修复: 确保下载MP4而非预览图

### v1.5.0 (2025-12-31)
- 🔍 AI视频质量审查 (多维度评分)
- 🖼️ 浮动画廊 (右侧抽屉式)
- 📅 日期筛选功能

### v1.4.0 (2025-12-14)
- 🌐 公开画廊 (无登录访问)
- 👤 用户档案管理
- 🔐 Turnstile人机验证

### v1.3.0 (2025-12-13)
- 💥 裂变生成模式
- 📊 实时监控增强

---

## 📜 License

MIT License
