# ABP Studio Frontend

这是 ABP Studio 的 React 19 + Vite 前端。页面通过同源路径调用后端，不在源码中保存 provider 密钥或数据库凭据。

## 目录约定

- `src/App.jsx`：登录态、主导航和页面容器；
- `src/Settings.jsx`：系统配置管理；
- `src/*Generator.jsx`：图片、视频、批量、故事和语音相关工作流；
- `src/FloatingGallery.jsx`、`src/Gallery.jsx`：资源展示和下载；
- `src/hooks/`：WebSocket 等跨页面逻辑；
- `src/theme.css`：全局设计令牌、焦点状态、滚动条和动效降级；
- `nginx.conf`：容器内静态资源与 OpenAPI 入口配置。

## API 路径

前端默认使用以下同源路径：

```text
/api/v1/*
/ws/*
/uploads/*
/openapi.json
```

Docker Compose 中 Python API 和 Rust API 可以同时运行。到底由哪一个后端承接公网请求，取决于部署环境的反向代理配置；切换后端时必须同时验证 HTTP、WebSocket、uploads 和 OpenAPI 路径。

## 本地开发

```bash
npm install
npm run dev
```

## 构建与检查

```bash
npm run build
npm run lint
npm run preview
```

`dist/`、`node_modules/` 和本地 `.env` 文件均不应提交到 Git。

## 生产构建

生产容器由上层 Docker Compose 构建：

```bash
docker compose build frontend
docker compose up -d frontend
```

只更新前端时使用服务级命令，不要为了前端变更执行 `docker compose down` 或重启无关后端服务。
