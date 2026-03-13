# API Request Examples

This document provides practical cURL examples for common API flows. These examples are for OpenClaw operators and future MCP reference.

> **Important:** Request bodies shown here are illustrative examples. Always cross-check against the live schema at `/openapi.json` for current field names, types, and required properties.

---

## Authentication

### Login

**Purpose:** Obtain a bearer token for authenticated API access.

**Method:** `POST`

**Path:** `/api/v1/login`

**Auth:** None (anonymous)

**Content-Type:** `application/x-www-form-urlencoded`

```bash
curl -X POST "<base-url>/api/v1/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=<username>" \
  -d "password=<password>"
```

**Response includes:** `access_token`, `token_type`, `username`, `role`, `user_id`

**Note:** If Cloudflare Turnstile is enabled in your deployment, include `turnstile_token` as an additional form field.

---

## User Profile

### Get Current Profile

**Purpose:** Retrieve the authenticated user's profile, including level and experience.

**Method:** `GET`

**Path:** `/api/v1/user/profile`

**Auth:** Bearer token required

```bash
curl -X GET "<base-url>/api/v1/user/profile" \
  -H "Authorization: Bearer <token>"
```

**Response includes:** `id`, `username`, `nickname`, `avatar`, `role`, `experience`, `level`, `level_name`, `level_progress`

---

## System Configuration

### Get Config

**Purpose:** Retrieve system configuration including API URLs, model names, and concurrency settings.

**Method:** `GET`

**Path:** `/api/v1/config`

**Auth:** Bearer token required

```bash
curl -X GET "<base-url>/api/v1/config" \
  -H "Authorization: Bearer <token>"
```

**Note:** The response schema is extensive. Check `/openapi.json` for the full `ConfigItem` definition.

---

## User Management (Admin)

### Get Users

**Purpose:** List all users with their roles and experience levels.

**Method:** `GET`

**Path:** `/api/v1/users`

**Auth:** Admin bearer token required

```bash
curl -X GET "<base-url>/api/v1/users" \
  -H "Authorization: Bearer <admin-token>"
```

**Response:** Array of user objects with `id`, `username`, `role`, `created_at`, `experience`, `level`, `level_name`

---

## Image Generation

### Analyze Product Image

**Purpose:** Analyze a product image and generate scene scripts for multiple angles.

**Method:** `POST`

**Path:** `/api/v1/analyze`

**Auth:** Bearer token required

**Content-Type:** `multipart/form-data`

```bash
curl -X POST "<base-url>/api/v1/analyze" \
  -H "Authorization: Bearer <token>" \
  -F "product_image=@/path/to/product.jpg" \
  -F "background_image=@/path/to/background.jpg" \
  -F "product_description=Organic green tea leaves" \
  -F "angle_names=01_Front_View,02_Side_View_45,03_Top_Down_View"
```

**Note:** Field names and required parameters may vary. Confirm with `/openapi.json`.

### Start Async Batch Generation

**Purpose:** Start an asynchronous batch image generation task.

**Method:** `POST`

**Path:** `/api/v1/batch-generate-async`

**Auth:** Bearer token required

```bash
curl -X POST "<base-url>/api/v1/batch-generate-async" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "product_image": "<base64-encoded-image>",
    "background_image": "<base64-encoded-image>",
    "scripts": [
      {"angle_name": "01_Front_View", "script": "A photorealistic front-view product shot..."},
      {"angle_name": "02_Side_View_45", "script": "A 3/4 angle product shot..."}
    ],
    "model": "gemini-3-pro-image-preview"
  }'
```

**Response:** Returns a `task_id` that can be used to poll status.

**Note:** Request body schema should be verified against `/openapi.json`.

---

## Video Queue

### Query Video Queue

**Purpose:** List video queue items with their status (pending, processing, done, error).

**Method:** `GET`

**Path:** `/api/v1/queue`

**Auth:** Bearer token required

```bash
curl -X GET "<base-url>/api/v1/queue" \
  -H "Authorization: Bearer <token>"
```

**Query Parameters:** `status`, `limit`, `offset` (check `/openapi.json` for available filters)

### Get Queue Item Status

**Purpose:** Check the status of a specific video queue item.

**Method:** `GET`

**Path:** `/api/v1/queue/{item_id}`

**Auth:** Bearer token required

```bash
curl -X GET "<base-url>/api/v1/queue/<item_id>" \
  -H "Authorization: Bearer <token>"
```

---

## Story Workflow

### Create Story Chain

**Purpose:** Start a story-driven generation chain.

**Method:** `POST`

**Path:** `/api/v1/story-chain`

**Auth:** Bearer token required

```bash
curl -X POST "<base-url>/api/v1/story-chain" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A product journey from factory to customer doorstep",
    "num_scenes": 5,
    "style": "cinematic"
  }'
```

**Note:** Request body structure varies. Always verify against `/openapi.json`.

### Create Story Fission

**Purpose:** Create a fission workflow for branching story generation.

**Method:** `POST`

**Path:** `/api/v1/story-fission`

**Auth:** Bearer token required

```bash
curl -X POST "<base-url>/api/v1/story-fission" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "base_prompt": "Product showcase in different environments",
    "branches": 3
  }'
```

---

## Gallery

### Query Gallery Images

**Purpose:** List saved images from the user's gallery.

**Method:** `GET`

**Path:** `/api/v1/gallery/images`

**Auth:** Bearer token required

```bash
curl -X GET "<base-url>/api/v1/gallery/images" \
  -H "Authorization: Bearer <token>"
```

**Query Parameters:** `limit`, `offset`, `category` (verify available filters in `/openapi.json`)

---

## Keyword Extraction

### Extract Keywords

**Purpose:** Extract keywords from text or product descriptions.

**Method:** `POST`

**Path:** `/api/v1/keywords`

**Auth:** Bearer token required

```bash
curl -X POST "<base-url>/api/v1/keywords" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Premium organic green tea sourced from highland plantations, rich in antioxidants",
    "language": "zh"
  }'
```

**Note:** This endpoint integrates with Feishu/Lark Bitable if configured. Check `/openapi.json` for exact request schema.

---

## Placeholder Reference

| Placeholder | Description |
|------------|-------------|
| `<base-url>` | The API base URL (e.g., `https://your-domain.com/api/v1` or `http://localhost:33013/api/v1`) |
| `<token>` | Bearer token obtained from login |
| `<admin-token>` | Bearer token for an admin user |
| `<username>` | Login username |
| `<password>` | Login password |
| `<item_id>` | Video queue item ID |
| `<base64-encoded-image>` | Base64-encoded image string |

---

## Safety Notes

- Never include real credentials, JWTs, or API keys in examples or logs
- The live `/openapi.json` is the authoritative source for request/response schemas
- Token lifetime is 24 hours; implement re-login logic for long sessions
- Some endpoints may have rate limiting; implement retry logic with exponential backoff

---

## Related Documentation

- Authentication reference: `auth.md`
- API catalog: `api-catalog.md`
- Skill reference: `../skill/SKILL.md`
- Live schema: `/openapi.json`
