# Python → Rust 兼容路由清单

> 本文档由 `tools/generate_parity_manifest.py` 生成的路由清单整理而来。它描述源代码和测试覆盖，不包含任何生产凭据或私有部署信息。

## 当前结论

- Python/FastAPI 兼容业务路由：**76** 条；
- Rust 路由清单已覆盖对应业务域，并额外提供 `/healthz` 与 `/openapi.json` 等运维入口；
- 现有差分记录显示 76 条业务路由已完成只读 parity 检查；
- provider、写入、媒体产物、Redis 事件和 worker 恢复检查通过隔离工具执行；
- 代码、配置或数据库契约变更后，必须重新执行相关 smoke，而不能只依赖旧记录。

## 按业务域统计

| 业务域 | 路由数 | 缺失 | 需差分 | 已差分 |
|---|---:|---:|---:|---:|
| `admin` | 3 | 0 | 0 | 3 |
| `auth-users` | 14 | 0 | 0 | 14 |
| `character` | 1 | 0 | 0 | 1 |
| `gallery` | 15 | 0 | 0 | 15 |
| `generation` | 8 | 0 | 0 | 8 |
| `keywords` | 6 | 0 | 0 | 6 |
| `mexico-beauty` | 9 | 0 | 0 | 9 |
| `other` | 1 | 0 | 0 | 1 |
| `public` | 2 | 0 | 0 | 2 |
| `queue-media` | 8 | 0 | 0 | 8 |
| `story` | 8 | 0 | 0 | 8 |
| `voice-clone` | 1 | 0 | 0 | 1 |

## 路由明细

| ID | 方法 | 路径 | Python 函数 | Rust 状态 | 认证 |
|---|---|---|---|---|---|
| R-001 | `GET` | `/api/v1/public/videos` | `get_public_videos` (L541) | **parity-tested** | `public` |
| R-002 | `GET` | `/api/v1/public/config` | `get_public_config` (L576) | **parity-tested** | `public` |
| R-003 | `POST` | `/api/v1/login` | `login` (L619) | **parity-tested** | `public` |
| R-004 | `GET` | `/api/v1/user/profile` | `get_user_profile` (L686) | **parity-tested** | `bearer-user` |
| R-005 | `PUT` | `/api/v1/user/profile` | `update_user_profile` (L707) | **parity-tested** | `bearer-user` |
| R-006 | `POST` | `/api/v1/user/avatar` | `upload_avatar` (L723) | **parity-tested** | `bearer-user` |
| R-007 | `GET` | `/api/v1/user/experience/history` | `get_experience_history` (L756) | **parity-tested** | `bearer-user` |
| R-008 | `GET` | `/api/v1/users` | `get_users` (L808) | **parity-tested** | `admin` |
| R-009 | `POST` | `/api/v1/users` | `create_user` (L836) | **parity-tested** | `admin` |
| R-010 | `PUT` | `/api/v1/users/{user_id}` | `update_user` (L848) | **parity-tested** | `admin` |
| R-011 | `DELETE` | `/api/v1/users/{user_id}` | `delete_user` (L866) | **parity-tested** | `admin` |
| R-012 | `GET` | `/api/v1/stats` | `get_stats` (L886) | **parity-tested** | `admin` |
| R-013 | `GET` | `/api/v1/config` | `get_config` (L964) | **parity-tested** | `bearer-token` |
| R-014 | `POST` | `/api/v1/config` | `update_config` (L1027) | **parity-tested** | `bearer-token` |
| R-015 | `POST` | `/api/v1/models` | `get_models` (L1048) | **parity-tested** | `bearer-token` |
| R-016 | `POST` | `/api/v1/analyze` | `analyze_endpoint` (L1543) | **parity-tested** | `bearer-token` |
| R-017 | `POST` | `/api/v1/batch-generate` | `batch_generate_workflow` (L1865) | **parity-tested** | `bearer-user` |
| R-018 | `POST` | `/api/v1/batch-generate-async` | `batch_generate_workflow_async` (L1899) | **parity-tested** | `bearer-user` |
| R-019 | `GET` | `/api/v1/batch-generate-async/{task_id}` | `get_batch_generate_async_status` (L1954) | **parity-tested** | `bearer-user` |
| R-020 | `POST` | `/api/v1/simple-batch-generate` | `simple_batch_generate` (L2222) | **parity-tested** | `bearer-user` |
| R-021 | `POST` | `/api/v1/story-analyze` | `analyze_storyboard_endpoint` (L2412) | **parity-tested** | `bearer-token` |
| R-022 | `POST` | `/api/v1/generate-video-prompt` | `generate_video_prompt_endpoint` (L2660) | **parity-tested** | `bearer-token` |
| R-023 | `POST` | `/api/v1/story-generate` | `generate_story_endpoint` (L2760) | **parity-tested** | `bearer-token` |
| R-024 | `GET` | `/api/v1/gallery/images` | `get_gallery_images` (L2881) | **parity-tested** | `bearer-user` |
| R-025 | `DELETE` | `/api/v1/gallery/images/{image_id}` | `delete_gallery_image` (L2964) | **parity-tested** | `bearer-user` |
| R-026 | `POST` | `/api/v1/gallery/images/batch-delete` | `batch_delete_images` (L2993) | **parity-tested** | `admin` |
| R-027 | `POST` | `/api/v1/gallery/videos/batch-delete` | `batch_delete_videos` (L3017) | **parity-tested** | `admin` |
| R-028 | `GET` | `/api/v1/gallery/videos` | `get_gallery_videos` (L3048) | **parity-tested** | `bearer-user` |
| R-029 | `GET` | `/api/v1/gallery/videos/{video_id}/review` | `get_video_review` (L3149) | **parity-tested** | `bearer-user` |
| R-030 | `POST` | `/api/v1/gallery/videos/{video_id}/review` | `trigger_video_review_api` (L3179) | **parity-tested** | `admin` |
| R-031 | `POST` | `/api/v1/gallery/images/{image_id}/share` | `toggle_share_image` (L3217) | **parity-tested** | `admin` |
| R-032 | `POST` | `/api/v1/gallery/videos/{video_id}/share` | `toggle_share_video` (L3234) | **parity-tested** | `admin` |
| R-033 | `POST` | `/api/v1/gallery/images/batch-share` | `batch_share_images` (L3259) | **parity-tested** | `admin` |
| R-034 | `POST` | `/api/v1/gallery/videos/batch-share` | `batch_share_videos` (L3275) | **parity-tested** | `admin` |
| R-035 | `POST` | `/api/v1/gallery/images/share-all` | `share_all_images` (L3296) | **parity-tested** | `admin` |
| R-036 | `POST` | `/api/v1/gallery/videos/share-all` | `share_all_videos` (L3312) | **parity-tested** | `admin` |
| R-037 | `POST` | `/api/v1/gallery/images/batch-download` | `batch_download_images` (L3337) | **parity-tested** | `bearer-user` |
| R-038 | `POST` | `/api/v1/gallery/videos/batch-download` | `batch_download_videos` (L3381) | **parity-tested** | `bearer-user` |
| R-039 | `GET` | `/api/v1/queue` | `get_queue` (L3463) | **parity-tested** | `bearer-user` |
| R-040 | `POST` | `/api/v1/queue` | `add_to_queue` (L3506) | **parity-tested** | `bearer-user` |
| R-041 | `PUT` | `/api/v1/queue/{item_id}` | `update_queue_item` (L3585) | **parity-tested** | `bearer-token` |
| R-042 | `POST` | `/api/v1/merge-videos` | `merge_videos_endpoint` (L3611) | **parity-tested** | `bearer-user` |
| R-043 | `DELETE` | `/api/v1/queue/{item_id}` | `delete_queue_item` (L3708) | **parity-tested** | `bearer-user` |
| R-044 | `POST` | `/api/v1/queue/{item_id}/retry` | `retry_queue_item` (L3733) | **parity-tested** | `bearer-token` |
| R-045 | `DELETE` | `/api/v1/queue` | `clear_queue` (L3771) | **parity-tested** | `bearer-user` |
| R-046 | `POST` | `/api/v1/queue/{item_id}/generate` | `generate_queue_item_endpoint` (L4288) | **parity-tested** | `bearer-token` |
| R-047 | `POST` | `/api/v1/story-chain` | `create_story_chain` (L5158) | **parity-tested** | `bearer-user` |
| R-048 | `GET` | `/api/v1/story-chain/{chain_id}` | `get_story_chain_status` (L5175) | **parity-tested** | `inspect` |
| R-049 | `POST` | `/api/v1/story-fission` | `create_story_fission` (L6289) | **parity-tested** | `bearer-user` |
| R-050 | `GET` | `/api/v1/story-fission/{fission_id}` | `get_story_fission_status` (L6308) | **parity-tested** | `inspect` |
| R-051 | `POST` | `/api/v1/story-fission/{fission_id}/branch/{branch_id}/retry` | `retry_fission_branch` (L6322) | **parity-tested** | `bearer-user` |
| R-052 | `POST` | `/api/v1/story-fission/{fission_id}/remerge` | `remerge_fission_story` (L6404) | **parity-tested** | `bearer-user` |
| R-053 | `WEBSOCKET` | `/ws/{token}` | `websocket_endpoint` (L6556) | **parity-tested** | `bearer-token` |
| R-054 | `GET` | `/api/v1/admin/live-status` | `get_admin_live_status` (L6606) | **parity-tested** | `admin` |
| R-055 | `DELETE` | `/api/v1/admin/activities` | `clear_activities` (L6695) | **parity-tested** | `admin` |
| R-056 | `GET` | `/api/v1/admin/user/{user_id}/tasks` | `get_user_tasks_admin` (L6710) | **parity-tested** | `admin` |
| R-057 | `GET` | `/api/v1/admin/activities` | `get_all_activities` (L6744) | **parity-tested** | `admin` |
| R-058 | `POST` | `/api/v1/character/generate` | `generate_character_video` (L6809) | **parity-tested** | `bearer-user` |
| R-059 | `POST` | `/api/v1/keywords/analyze-single` | `analyze_single_keyword` (L6907) | **parity-tested** | `bearer-token` |
| R-060 | `POST` | `/api/v1/keywords/history` | `save_keyword_history` (L7008) | **parity-tested** | `bearer-token` |
| R-061 | `GET` | `/api/v1/keywords/history` | `get_keyword_history` (L7026) | **parity-tested** | `bearer-token` |
| R-062 | `DELETE` | `/api/v1/keywords/history/{index}` | `delete_keyword_history` (L7031) | **parity-tested** | `bearer-token` |
| R-063 | `DELETE` | `/api/v1/keywords/history` | `clear_keyword_history` (L7039) | **parity-tested** | `bearer-token` |
| R-064 | `POST` | `/api/v1/keywords/export-excel` | `export_keywords_excel` (L7045) | **parity-tested** | `bearer-token` |
| R-065 | `POST` | `/api/v1/keywords/sync-feishu` | `sync_keywords_to_feishu` (L7179) | **parity-tested** | `bearer-token` |
| R-066 | `POST` | `/api/v1/mexico-beauty/keyword-analysis-single` | `mexico_keyword_analysis_single` (L7439) | **parity-tested** | `bearer-token` |
| R-067 | `POST` | `/api/v1/mexico-beauty/title-optimization-single` | `mexico_title_optimization_single` (L7477) | **parity-tested** | `bearer-token` |
| R-068 | `POST` | `/api/v1/mexico-beauty/image-prompt-single` | `mexico_image_prompt_single` (L7527) | **parity-tested** | `bearer-token` |
| R-069 | `POST` | `/api/v1/mexico-beauty/description-single` | `mexico_description_single` (L7573) | **parity-tested** | `bearer-token` |
| R-070 | `POST` | `/api/v1/mexico-beauty/image-prompts-batch` | `mexico_image_prompts_batch` (L7637) | **parity-tested** | `bearer-token` |
| R-071 | `POST` | `/api/v1/mexico-beauty/refine-prompt` | `mexico_refine_prompt` (L7939) | **parity-tested** | `bearer-token` |
| R-072 | `POST` | `/api/v1/mexico-beauty/generate-image` | `mexico_generate_image` (L8151) | **parity-tested** | `bearer-user` |
| R-073 | `POST` | `/api/v1/mexico-beauty/sync-feishu` | `mexico_beauty_sync_feishu` (L8374) | **parity-tested** | `bearer-token` |
| R-074 | `POST` | `/api/v1/mexico-beauty/sync-description-feishu` | `sync_description_to_feishu` (L8506) | **parity-tested** | `bearer-token` |
| R-075 | `POST` | `/api/v1/voice-clone/analyze-video` | `voice_clone_analyze_video` (L8620) | **parity-tested** | `bearer-user` |
| R-076 | `POST` | `/api/v1/voice-clone/synthesize-speech` | `voice_clone_synthesize_speech` (L8781) | **parity-tested** | `bearer-user` |

## 后台 worker / 非 HTTP 入口

| 来源 | Rust 入口 | 验证重点 |
|---|---|---|
| Python queue manager / video background loop | `abp-worker` + `services/video.rs` | queue claim、生成、重试、状态和事件 |
| Python review queue / reviewer | `services/review.rs` | provider review、评分、经验和持久化 |
| Python story orchestration | `services/story.rs` | chain/fission、retry、remerge 和产物 |
| Python zombie recovery | `services/tasks.rs` / `services/video.rs` | stale task 重启恢复 |
| Python gallery cleanup | `abp-worker -- --cleanup-gallery` | 删除没有对应文件的 gallery 记录 |

worker 使用同一 PostgreSQL、Redis 和 uploads 契约，但必须通过运行时环境注入连接信息。

## 数据与外部边界

Rust 版需要兼容以下边界：

- PostgreSQL：用户、配置、活动、经验、gallery 和视频队列表；
- Redis：队列、统计、TTL、并发限制和 Pub/Sub；
- uploads：图片、视频、音频等资源目录；
- OpenAI/Gemini-compatible provider、视频、语音和 Feishu API；
- Cloudflare Turnstile 等外部验证服务。

真实地址、密钥、Token、数据库备份和部署主机配置不得写入清单。

## 维护命令

```bash
cd backend-rust
python3 tools/generate_parity_manifest.py

# 生成后检查：
git diff --check
git status --short --untracked-files=all
```

生成的清单应只包含路由、模块和测试状态；如出现绝对宿主机路径、真实 URL 参数或凭据，应先脱敏再提交。
