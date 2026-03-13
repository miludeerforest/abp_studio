# Auto Banana Product API Skill

## Purpose
This skill helps OpenClaw understand, inspect, and call the Auto Banana Product project APIs.

It is designed around two sources of truth:
1. The live runtime schema at `/openapi.json`
2. The structured local export at `../exports/api-catalog.json`

Use the live schema for request/response details and the exported catalog for feature grouping, permissions hints, and OpenClaw-oriented metadata.

## Source of Truth
- Live schema: `/openapi.json`
- Structured export: `../exports/api-catalog.json`
- Human-oriented in-app reference: the admin-only `API 工作台` page inside the frontend

## Base URL and Deployment Guidance
This project is deployed behind Docker and 1Panel OpenResty.

Preferred access pattern:
- Use the same-origin site entrypoint or the public reverse-proxy domain handled by OpenResty
- Prefer the externally exposed domain over hardcoded Docker internal addresses or container names
- Avoid hardcoding local internal ports unless the operator explicitly configures them for local-only use

Recommended rule:
- If OpenClaw is operating against the deployed site, call the public base URL and relative paths
- If OpenClaw is operating on the same host for local development, use the operator-provided local base URL deliberately

## Authentication
### Login
Use:
- `POST /api/v1/login`

Request style:
- `application/x-www-form-urlencoded`
- Fields:
  - `username`
  - `password`
  - `turnstile_token` (optional depending on deployment and Cloudflare Turnstile configuration)

Response includes:
- `access_token`
- `token_type`
- `username`
- `role`
- `user_id`

### Authenticated Calls
For authenticated endpoints, send:
- `Authorization: Bearer <access_token>`

Permissions are feature-dependent. The exported catalog includes hints such as:
- `anonymous`
- `authenticated`
- `admin`

## Feature Groups
The current verified feature groups are:
- `public`
- `auth`
- `account`
- `settings`
- `users`
- `admin`
- `generation`
- `video`
- `story`
- `assets`
- `analysis`
- `verticals`
- `audio`
- `realtime`

Typical mapped capabilities include:
- public config and public videos
- login and session bootstrap
- current-user profile and avatar management
- system configuration and model lookup
- user management and statistics
- admin live monitoring and activity review
- image generation and prompt analysis
- simple batch image generation
- video queue, retry, generate, and merge operations
- story chain and story fission workflows
- gallery listing, review, share, delete, and download operations
- keyword extraction workflows
- Mexico beauty workflow endpoints
- voice clone workflows
- character video generation
- websocket status/update channels

## Recommended Usage Pattern
When OpenClaw needs to use this project, follow this order:

1. Read `../exports/api-catalog.json`
   - Identify the relevant feature group
   - Identify permission hints
   - Identify the most likely endpoint family

2. Confirm details from `/openapi.json`
   - Request method
   - Path parameters
   - Query parameters
   - Request body schema
   - Content type

3. Authenticate if required
   - Login through `POST /api/v1/login`
   - Reuse bearer token for subsequent calls

4. Execute same-origin or reverse-proxy-safe requests
   - Prefer the public OpenResty entrypoint or configured site base URL
   - Avoid coupling the skill to Docker-internal networking assumptions

5. Treat the in-app API workbench as a human validation tool
   - It is useful for operators and debugging
   - The machine-oriented source should remain `../exports/api-catalog.json` plus `/openapi.json`

## Safety and Constraints
- Do not assume anonymous access for endpoints outside the explicitly public group
- Do not assume admin access unless authenticated as an admin user
- Do not hardcode secrets, passwords, API keys, or JWTs into the skill
- Do not hardcode Docker internal ports as the default deployment assumption
- Prefer relative paths or operator-configured base URLs
- Use the exported catalog for feature intent, not as the sole request schema source
- Use `/openapi.json` for live request shape confirmation

## Known Special Cases
- WebSocket endpoints are reference-only in the catalog and should not be treated as standard HTTP fetch calls
- Login uses form fields rather than a JSON login body
- Some deployments may enable Cloudflare Turnstile, making `turnstile_token` relevant for login
- Admin password behavior is environment-driven on startup; later runtime behavior depends on the database state and reset policy
- Public and authenticated routes coexist; permission hints in the catalog should be respected before calling endpoints blindly

## Suggested OpenClaw Behavior
OpenClaw should use this project in two layers:

### Layer 1: Skill Layer
Use this skill to:
- understand the feature map
- locate likely endpoints
- understand auth expectations
- choose the right path family before making a call

### Layer 2: Future MCP Layer
A future MCP server for this project should expose tools such as:
- list feature groups
- list endpoints for a feature group
- inspect an endpoint schema
- execute an authenticated project API call

## Next Step for MCP Upgrade
A minimal MCP upgrade should eventually expose tools equivalent to:
- `list_api_groups`
- `list_feature_endpoints`
- `get_api_operation`
- `call_project_api`
- optional `login_project_admin`

That MCP should consume:
- `../exports/api-catalog.json`
- the live `/openapi.json`
- an operator-provided base URL

## Operator Notes
If the operator changes deployment topology, auth policy, or reverse-proxy routing, update:
- the OpenClaw base URL configuration
- the exported API catalog if feature mapping changes
- any login assumptions involving Turnstile or admin reset policy