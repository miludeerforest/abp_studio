# Auto Banana Product Authentication Reference

## Purpose
This document provides a human-readable authentication reference for OpenClaw and operators working with the Auto Banana Product API. It covers login procedures, token handling, admin initialization policies, and deployment-specific guidance.

## Login Endpoint

### Endpoint
```
POST /api/v1/login
```

### Content Type
```
application/x-www-form-urlencoded
```

## Request Format

Submit credentials as form fields (not JSON body):

| Field | Required | Description |
|-------|----------|-------------|
| `username` | Yes | Login username |
| `password` | Yes | Login password |
| `turnstile_token` | No | Cloudflare Turnstile verification token (if enabled) |

### Example Request (cURL)
```bash
curl -X POST "https://your-domain/api/v1/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=your_password" \
  -d "turnstile_token=optional_token_value"
```

### Example Request (JavaScript)
```javascript
const formData = new URLSearchParams();
formData.append('username', 'admin');
formData.append('password', 'your_password');

const response = await fetch('/api/v1/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: formData
});
```

## Response Fields

Successful login returns JSON with:

| Field | Type | Description |
|-------|------|-------------|
| `access_token` | string | JWT bearer token for authenticated requests |
| `token_type` | string | Always `"bearer"` |
| `username` | string | Authenticated user's login name |
| `role` | string | User role: `"admin"` or `"user"` |
| `user_id` | integer | Internal user ID |

### Example Response
```json
{
  "access_token": "<access_token>",
  "token_type": "bearer",
  "username": "admin",
  "role": "admin",
  "user_id": 1
}
```

### Error Responses

| Status | Message | Cause |
|--------|---------|-------|
| 400 | 人机验证失败，请重试 | Turnstile verification failed |
| 401 | 用户名或密码错误 | Invalid credentials |

## Bearer Token Usage

For all authenticated API calls, include the access token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Example (cURL)
```bash
curl -X GET "https://your-domain/api/v1/user/profile" \
  -H "Authorization: Bearer <access_token>"
```

### Example (JavaScript)
```javascript
const response = await fetch('/api/v1/user/profile', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

### Token Lifetime
Tokens expire after 24 hours (1440 minutes). Implement token refresh or re-login logic for long-running sessions.

## Turnstile Notes

Cloudflare Turnstile is optional and deployment-dependent:

1. **When Enabled**: The frontend will obtain a Turnstile token and send it with login requests. If verification fails, login is rejected with a 400 error.

2. **When Disabled**: Omit the `turnstile_token` field entirely. The backend only validates Turnstile when both the token is provided AND `TURNSTILE_SECRET_KEY` is configured in the environment.

3. **Server-Side**: Requires `TURNSTILE_SECRET_KEY` environment variable to be set for validation to occur.

## Admin Initialization and Reset Policy

### First Startup
When no admin user exists in the database:
- Creates admin using `ADMIN_USER` and `ADMIN_PASSWORD` from environment variables
- Default values: `admin` / `change_this_password` if not configured

### Subsequent Startups
When an admin user already exists:
- **Default behavior**: Password is preserved from the database
- **Force reset**: Set `FORCE_RESET_ADMIN_PASSWORD=true` to reset the password to `ADMIN_PASSWORD` on startup

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|--------|
| `ADMIN_USER` | Initial admin username | `admin` |
| `ADMIN_PASSWORD` | Initial admin password | `change_this_password` |
| `FORCE_RESET_ADMIN_PASSWORD` | Force password reset on startup | `false` |

### Security Recommendations
1. Set strong passwords in production
2. After using force reset, change `FORCE_RESET_ADMIN_PASSWORD` back to `false`
3. Never commit actual credentials to version control

## Deployment and Base URL Guidance

### Preferred Access Pattern
This project typically deploys behind Docker and 1Panel OpenResty.

1. **Use the public domain**: Call the externally exposed domain via OpenResty reverse proxy
2. **Same-origin requests**: When the frontend and backend share a domain, use relative paths like `/api/v1/login`
3. **Avoid internal addresses**: Do not hardcode Docker internal ports (e.g., `:33013`) unless explicitly configured for local-only access

### Example Base URLs
- Production: `https://your-domain.com/api/v1/login`
- Local development: `http://localhost:33013/api/v1/login` (operator-configured)
- Same-origin: `/api/v1/login` (from frontend)

## Safety Notes

### Do Not
- Include actual passwords, API keys, or JWT tokens in documentation or logs
- Assume admin access without proper authentication
- Hardcode secrets in code or configuration files committed to repositories
- Expose `.env` files or database backups publicly

### Do
- Use strong, unique passwords for admin accounts
- Enable HTTPS in production environments
- Rotate secrets periodically
- Verify token expiration handling in client applications
- Check the live `/openapi.json` for current endpoint schemas

## Related Documentation
- API endpoint catalog: `api-catalog.json`
- OpenAPI schema: `/openapi.json` (live)
- Skill reference: `../skill/SKILL.md`