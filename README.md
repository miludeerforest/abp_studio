# Banana Product - 智能商品场景生成系统

Banana Product 是一个基于 AI 的自动化商品场景生成与视频制作平台。它可以根据简单的商品图片，自动分析特征、生成多角度场景图，甚至一键生成营销短视频。

## ✨ 主要功能

*   **🎨 批量场景生成**：上传一张白底图，自动分析商品特征，生成 Front, Side, Top 等 9 种不同角度和场景的高质量营销图。
*   **📹 视频生成**：基于生成的图片，一键转换为动态视频（支持 Sora/Veo 等模型接口）。
*   **🎬 一镜到底 (Story Mode)**：自动编排分镜，生成连贯的故事性视频脚本和画面。
*   **👥 多用户管理**：内置完善的用户系统，支持多用户登录、权限隔离（管理员/普通用户）及用量统计。
*   **⚙️ 灵活配置**：支持自定义 API Endpoint 和模型参数，兼容 OpenAI 格式接口。

---

## 🚀 快速部署 (Installation)

本项目基于 Docker Compose 构建，支持一键部署。

### 1. 环境准备
确保服务器已安装：
*   [Docker](https://docs.docker.com/engine/install/)
*   [Docker Compose](https://docs.docker.com/compose/install/)

### 2. 获取代码
将项目代码下载/克隆到本地目录：
```bash
git clone <your-repo-url> auto_banana_product
cd auto_banana_product
```

### 3. 配置环境变量
复制示例配置文件并修改：
```bash
cp .env.example .env  # 如果没有example文件，请直接创建 .env
```
编辑 `.env` 文件，填入必要的 API Key：
```ini
# .env 示例

# 核心绘图模型配置 (OpenAI 兼容接口)
DEFAULT_API_URL=https://your-api-provider.com/v1
DEFAULT_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEFAULT_MODEL_NAME=gemini-3-pro-image-preview

# 视频生成模型配置
VIDEO_API_URL=http://your-video-api.com/v1
VIDEO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
VIDEO_MODEL_NAME=sora-video-portrait

# 初始管理员账号 (系统首次启动时创建/重置)
ADMIN_USER=admin
ADMIN_PASSWORD=your_secure_password
```

### 4. 启动服务
执行标准 Docker Compose 命令启动：
```bash
docker compose up -d --build
```
等待容器启动完成（首次构建可能需要几分钟）。

---

## 📖 使用教程 (User Guide)

### 1. 访问系统
服务启动后，默认通过以下端口访问（根据 `docker-compose.yml` 配置）：
*   **前端页面**: `http://localhost:33012` (或服务器 IP:33012)
*   **后端 API**: `http://localhost:33013` (仅供调试)

### 2. 登录系统
使用 `.env` 中配置的管理员账号登录：
*   **默认账号**: `admin` (或您设置的 `ADMIN_USER`)
*   **默认密码**: `***REDACTED_ADMIN_PASSWORD***` (或您设置的 `ADMIN_PASSWORD`)

### 3. 功能操作流程

#### A. 批量场景生成
1.  进入 **"批量场景生成"** 标签页。
2.  上传商品 **白底图** (Product) 和 **风格参考图** (Reference, 可选)。
3.  点击 **"智能分析"**，系统将自动拆解商品特征并生成 9 个拍摄脚本。
4.  确认脚本无误后，点击 **"开始生成"**。
5.  等待生成完成，点击图片可大图预览或保存。

#### B. 视频生成
1.  在生成的图片结果中，点击 **"转为视频"** 按钮。
2.  系统会自动跳转到 **"视频生成"** 标签页，并填入优化后的提示词。
3.  调整参数（如长宽比、运镜幅度），点击 **"生成视频"**。
4.  视频生成为后台异步任务，可在右侧 **"任务列表"** 查看进度。

#### C. 用户管理 (管理员仅可见)
1.  点击顶部导航栏右上角的 **"用户管理"** (User Management)。
2.  **添加用户**: 创建新的普通用户账号（Sub-users）。
3.  **重置密码**: 修改用户密码。
4.  **查看统计**: 查看每个用户的图片/视频生成数量统计。

---

## 🛠️ 维护与排错

### 查看日志
如果遇到问题，查看 Docker 容器日志：
```bash
# 查看后端日志
docker compose logs -f backend

# 查看前端构建日志
docker compose logs -f frontend
```

### 数据库迁移
系统启动时会自动检查数据库表结构。如果遇到 `502 Bad Gateway` 或数据库错误，请尝试重启后端容器以触发修复逻辑：
```bash
docker compose restart backend
```

---

## 📁 主要目录结构
```
auto_banana_product/
├── backend/            # Python FastAPI 后端
│   ├── main.py        # 核心业务逻辑
│   ├── Dockerfile     # 后端镜像构建文件
│   └── requirements.txt
├── frontend/           # React 前端
│   ├── src/           # 页面源代码
│   ├── Dockerfile     # 前端镜像构建文件
│   └── package.json
├── docker-compose.yml  # 容器编排配置
├── .env                # 配置文件 (不要提交到 Git)
└── .gitignore          # Git 忽略规则
```
