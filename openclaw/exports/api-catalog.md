# API Catalog

This document provides a human-readable summary of the verified ABP Studio API endpoints.

> **Note:** The live OpenAPI specification at `/openapi.json` remains the authoritative source for request/response schemas. This catalog is a reference companion for skill integration and operator browsing.

---

## Public

### Public Access

| Field | Value |
|-------|-------|
| **ID** | `public` |
| **Feature** | `publicGallery` |
| **Description** | Public-facing endpoints and unauthenticated gallery access. |
| **Methods** | `GET` |
| **Matchers** | `/api/v1/public/videos`, `/api/v1/public/config` |
| **Match Mode** | `prefix` |
| **Permissions** | `anonymous` |
| **OpenClaw** | `public:gallery:browse:v1` |

---

## Auth

### Authentication Login

| Field | Value |
|-------|-------|
| **ID** | `auth-login` |
| **Feature** | `authLogin` |
| **Description** | Login and token issuance endpoint. |
| **Methods** | `POST` |
| **Matchers** | `/api/v1/login` |
| **Match Mode** | `exact` |
| **Permissions** | `anonymous` |
| **OpenClaw** | `auth:session:login:v1` |

---

## Account

### Profile

| Field | Value |
|-------|-------|
| **ID** | `profile` |
| **Feature** | `profile` |
| **Description** | Current-user profile, avatar, and experience endpoints. |
| **Methods** | `GET`, `PUT`, `POST` |
| **Matchers** | `/api/v1/user/profile`, `/api/v1/user/avatar`, `/api/v1/user/experience/history` |
| **Match Mode** | `prefix` |
| **UI Route** | `profile` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `account:profile:manage:v1` |

---

## Settings

### Settings Config Models

| Field | Value |
|-------|-------|
| **ID** | `settings-config-models` |
| **Feature** | `settingsModels` |
| **Description** | System configuration and model selection metadata. |
| **Methods** | `GET`, `POST` |
| **Matchers** | `/api/v1/config`, `/api/v1/models` |
| **Match Mode** | `prefix` |
| **UI Route** | `settings` |
| **Permissions** | `authenticated`, `admin` |
| **OpenClaw** | `settings:models:configure:v1` |

---

## Users

### User Statistics

| Field | Value |
|-------|-------|
| **ID** | `users-stats` |
| **Feature** | `userStats` |
| **Description** | Usage, quota, and aggregate user statistics. |
| **Methods** | `GET`, `POST`, `PUT`, `DELETE` |
| **Matchers** | `/api/v1/users`, `/api/v1/stats` |
| **Match Mode** | `prefix` |
| **UI Route** | `users` |
| **Permissions** | `authenticated`, `admin` |
| **OpenClaw** | `users:stats:inspect:v1` |

---

## Admin

### Admin Monitoring

| Field | Value |
|-------|-------|
| **ID** | `admin-monitoring` |
| **Feature** | `adminMonitoring` |
| **Description** | Administrative live status, activities, and per-user task monitoring. |
| **Methods** | `GET`, `DELETE` |
| **Matchers** | `/api/v1/admin/live-status`, `/api/v1/admin/activities`, `/api/v1/admin/user/{user_id}/tasks` |
| **Match Mode** | `prefix` |
| **UI Route** | `monitor` |
| **Permissions** | `admin` |
| **OpenClaw** | `admin:monitoring:observe:v1` |

---

## Generation

### Image Generation

| Field | Value |
|-------|-------|
| **ID** | `image-generation` |
| **Feature** | `imageGeneration` |
| **Description** | Primary image generation and prompt-to-image workflows. |
| **Methods** | `POST`, `GET` |
| **Matchers** | `/api/v1/analyze`, `/api/v1/batch-generate`, `/api/v1/batch-generate-async`, `/api/v1/batch-generate-async/{task_id}`, `/api/v1/generate-video-prompt` |
| **Match Mode** | `prefix` |
| **UI Route** | `batch` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `generation:image:create:v1` |

### Simple Batch

| Field | Value |
|-------|-------|
| **ID** | `simple-batch` |
| **Feature** | `simpleBatch` |
| **Description** | Batch image generation from lightweight prompt sets. |
| **Methods** | `POST` |
| **Matchers** | `/api/v1/simple-batch-generate` |
| **Match Mode** | `exact` |
| **UI Route** | `simple-batch` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `generation:batch:create:v1` |

---

## Video

### Video Queue and Merge

| Field | Value |
|-------|-------|
| **ID** | `video-queue-merge` |
| **Feature** | `videoQueueMerge` |
| **Description** | Queue video jobs and merge generated video segments. |
| **Methods** | `GET`, `POST`, `PUT`, `DELETE` |
| **Matchers** | `/api/v1/queue`, `/api/v1/queue/{item_id}`, `/api/v1/queue/{item_id}/retry`, `/api/v1/queue/{item_id}/generate`, `/api/v1/merge-videos` |
| **Match Mode** | `prefix` |
| **UI Route** | `video` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `video:queue:process:v1` |

### Character Video

| Field | Value |
|-------|-------|
| **ID** | `character-video` |
| **Feature** | `characterVideo` |
| **Description** | Character-centric video generation and editing endpoints. |
| **Methods** | `POST` |
| **Matchers** | `/api/v1/character/generate` |
| **Match Mode** | `exact` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `video:character:render:v1` |

---

## Story

### Story Chain and Fission

| Field | Value |
|-------|-------|
| **ID** | `story-chain-fission` |
| **Feature** | `storyChainFission` |
| **Description** | Story-driven chain generation and fission branching endpoints. |
| **Methods** | `GET`, `POST` |
| **Matchers** | `/api/v1/story-chain`, `/api/v1/story-chain/{chain_id}`, `/api/v1/story-fission`, `/api/v1/story-fission/{fission_id}`, `/api/v1/story-fission/{fission_id}/branch/{branch_id}/retry`, `/api/v1/story-fission/{fission_id}/remerge`, `/api/v1/story-analyze`, `/api/v1/story-generate` |
| **Match Mode** | `prefix` |
| **UI Route** | `story` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `story:workflow:orchestrate:v1` |

---

## Assets

### Gallery

| Field | Value |
|-------|-------|
| **ID** | `gallery` |
| **Feature** | `gallery` |
| **Description** | Media gallery listing, filtering, preview, review, and asset management. |
| **Methods** | `GET`, `POST`, `DELETE` |
| **Matchers** | `/api/v1/gallery/images`, `/api/v1/gallery/videos`, `/api/v1/gallery/images/batch-delete`, `/api/v1/gallery/videos/batch-delete`, `/api/v1/gallery/images/batch-share`, `/api/v1/gallery/videos/batch-share`, `/api/v1/gallery/images/batch-download`, `/api/v1/gallery/videos/batch-download`, `/api/v1/gallery/videos/{video_id}/review` |
| **Match Mode** | `prefix` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `assets:gallery:manage:v1` |

---

## Analysis

### Keywords

| Field | Value |
|-------|-------|
| **ID** | `keywords` |
| **Feature** | `keywords` |
| **Description** | Keyword extraction and related text-analysis operations. |
| **Methods** | `GET`, `POST`, `DELETE` |
| **Matchers** | `/api/v1/keywords` |
| **Match Mode** | `prefix` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `analysis:keywords:extract:v1` |

---

## Verticals

### Mexico Beauty

| Field | Value |
|-------|-------|
| **ID** | `mexico-beauty` |
| **Feature** | `mexicoBeauty` |
| **Description** | Market-specific beauty generation flows for the Mexico station. |
| **Methods** | `POST` |
| **Matchers** | `/api/v1/mexico-beauty` |
| **Match Mode** | `prefix` |
| **UI Route** | `mexico-beauty` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `verticals:mexico-beauty:generate:v1` |

---

## Audio

### Voice Clone

| Field | Value |
|-------|-------|
| **ID** | `voice-clone` |
| **Feature** | `voiceClone` |
| **Description** | Voice cloning configuration, training, and synthesis operations. |
| **Methods** | `POST` |
| **Matchers** | `/api/v1/voice-clone` |
| **Match Mode** | `prefix` |
| **UI Route** | `voice-clone` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `audio:voice-clone:synthesize:v1` |

---

## Realtime

### WebSocket

| Field | Value |
|-------|-------|
| **ID** | `websocket` |
| **Feature** | `websocket` |
| **Description** | Real-time websocket status, streaming, and event delivery channels. |
| **Methods** | `GET` |
| **Matchers** | `/ws`, `/ws/{token}` |
| **Match Mode** | `prefix` |
| **Permissions** | `authenticated` |
| **OpenClaw** | `realtime:websocket:subscribe:v1` |
