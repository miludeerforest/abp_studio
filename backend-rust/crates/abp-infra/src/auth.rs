//! 认证：bcrypt 密码校验（兼容 passlib 存量哈希）+ JWT 签发/验证。
//!
//! 与 Python 端保持同一 SECRET_KEY / 算法（HS256）/ 载荷结构
//! （`sub = username`, `exp`），因此旧 token 在迁移期依然有效。

use abp_core::domain::User;
use abp_core::{ApiError, ApiResult};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// subject: username
    pub sub: String,
    /// expiry (unix seconds)
    pub exp: i64,
}

/// 校验明文密码是否匹配 bcrypt 哈希。
pub fn verify_password(plain: &str, hashed: &str) -> bool {
    bcrypt::verify(plain, hashed).unwrap_or(false)
}

/// 生成 bcrypt 哈希（cost=12，与 passlib 默认强度同级）。
pub fn hash_password(plain: &str) -> ApiResult<String> {
    bcrypt::hash(plain, 12)
        .map_err(|e| ApiError::internal(anyhow::anyhow!("bcrypt hash failed: {e}")))
}

/// 签发访问令牌。
pub fn create_access_token(username: &str, secret: &str, expire_minutes: i64) -> ApiResult<String> {
    let claims = Claims {
        sub: username.to_string(),
        exp: (Utc::now() + Duration::minutes(expire_minutes)).timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| ApiError::internal(anyhow::anyhow!("jwt encode failed: {e}")))
}

/// 解码并校验令牌，返回用户名。
pub fn decode_token(token: &str, secret: &str) -> ApiResult<String> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::unauthorized("Could not validate credentials"))?;
    Ok(data.claims.sub)
}

/// 从 Authorization: Bearer <token> 提取 token。
pub fn bearer_token(header_value: &str) -> ApiResult<&str> {
    header_value
        .strip_prefix("Bearer ")
        .ok_or_else(|| ApiError::unauthorized("Missing bearer token"))
}

/// 角色检查：管理员。
pub fn require_admin(user: &User) -> ApiResult<()> {
    if user.role != "admin" {
        return Err(ApiError::forbidden("Not authorized"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_roundtrip() {
        let h = hash_password("s3cret!").unwrap();
        assert!(verify_password("s3cret!", &h));
        assert!(!verify_password("wrong", &h));
    }

    #[test]
    fn jwt_roundtrip() {
        let tok = create_access_token("alice", "k3y", 5).unwrap();
        assert_eq!(decode_token(&tok, "k3y").unwrap(), "alice");
        assert!(decode_token(&tok, "bad-key").is_err());
    }

    #[test]
    fn expired_jwt_rejected() {
        // 手工构造已过期 token
        use jsonwebtoken::{encode as enc, EncodingKey, Header};
        let claims = Claims {
            sub: "bob".into(),
            exp: Utc::now().timestamp() - 3600,
        };
        let tok = enc(&Header::default(), &claims, &EncodingKey::from_secret(b"k")).unwrap();
        assert!(decode_token(&tok, "k").is_err());
    }

    #[test]
    fn bearer_parsing() {
        assert_eq!(bearer_token("Bearer abc").unwrap(), "abc");
        assert!(bearer_token("abc").is_err());
    }
}
