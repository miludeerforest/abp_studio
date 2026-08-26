use futures_util::StreamExt;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_attempts: usize,
    pub base_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 4,
            base_delay: Duration::from_secs(2),
        }
    }
}

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider transport error: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("provider returned HTTP {status}: {body}")]
    Http { status: u16, body: String },
    #[error("provider response decode error: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("provider response did not contain usable content")]
    Empty,
    #[error("provider operation is not supported: {0}")]
    Unsupported(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: Value,
}

impl ChatMessage {
    pub fn text(role: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: Value::String(text.into()),
        }
    }

    pub fn user_parts(parts: Vec<Value>) -> Self {
        Self {
            role: "user".into(),
            content: Value::Array(parts),
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_format: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modalities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageGenerationRequest {
    pub model: String,
    pub prompt: String,
    pub n: u32,
    pub size: String,
}

#[derive(Debug, Clone, Default)]
pub struct MediaOutput {
    pub image_base64: Option<String>,
    pub media_url: Option<String>,
    pub raw_text: String,
}

#[derive(Clone)]
pub struct ProviderClient {
    http: Client,
    policy: RetryPolicy,
}

impl ProviderClient {
    pub fn new(http: Client) -> Self {
        Self {
            http,
            policy: RetryPolicy::default(),
        }
    }

    pub fn with_policy(http: Client, policy: RetryPolicy) -> Self {
        Self { http, policy }
    }

    pub fn http(&self) -> &Client {
        &self.http
    }

    pub async fn chat_json(
        &self,
        api_url: &str,
        api_key: &str,
        request: &ChatRequest,
        timeout: Duration,
    ) -> Result<Value, ProviderError> {
        let endpoint = chat_endpoint(api_url);
        let mut body = serde_json::to_value(request)?;
        body["stream"] = Value::Bool(false);
        self.post_json_with_retry(&endpoint, api_key, body, timeout)
            .await
    }

    pub async fn chat_text(
        &self,
        api_url: &str,
        api_key: &str,
        request: &ChatRequest,
        timeout: Duration,
    ) -> Result<String, ProviderError> {
        let response = self.chat_json(api_url, api_key, request, timeout).await?;
        extract_chat_text(&response).ok_or(ProviderError::Empty)
    }

    pub async fn chat_stream_text(
        &self,
        api_url: &str,
        api_key: &str,
        request: &ChatRequest,
        timeout: Duration,
    ) -> Result<String, ProviderError> {
        let endpoint = chat_endpoint(api_url);
        let mut body = serde_json::to_value(request)?;
        body["stream"] = Value::Bool(true);
        let mut last_error = None;
        for attempt in 0..self.policy.max_attempts {
            let result = self
                .stream_once(&endpoint, api_key, body.clone(), timeout)
                .await;
            match result {
                Ok(text) => return Ok(text),
                Err(error) if attempt + 1 < self.policy.max_attempts && error.retryable() => {
                    last_error = Some(error);
                    sleep(self.backoff(attempt)).await;
                }
                Err(error) => return Err(error),
            }
        }
        Err(last_error.unwrap_or(ProviderError::Empty))
    }

    /// Execute exactly one streaming provider request. Workflow runners use
    /// this when they own retry state and must avoid multiplying attempts.
    pub async fn chat_stream_text_once(
        &self,
        api_url: &str,
        api_key: &str,
        request: &ChatRequest,
        timeout: Duration,
    ) -> Result<String, ProviderError> {
        let endpoint = chat_endpoint(api_url);
        let mut body = serde_json::to_value(request)?;
        body["stream"] = Value::Bool(true);
        self.stream_once(&endpoint, api_key, body, timeout).await
    }

    pub async fn image_generate(
        &self,
        api_url: &str,
        api_key: &str,
        request: &ImageGenerationRequest,
        timeout: Duration,
    ) -> Result<MediaOutput, ProviderError> {
        let endpoint = image_endpoint(api_url);
        let response = self
            .post_json_with_retry(&endpoint, api_key, serde_json::to_value(request)?, timeout)
            .await?;
        let item = response
            .get("data")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .ok_or(ProviderError::Empty)?;
        Ok(MediaOutput {
            image_base64: item
                .get("b64_json")
                .and_then(Value::as_str)
                .map(str::to_owned),
            media_url: item.get("url").and_then(Value::as_str).map(str::to_owned),
            raw_text: response.to_string(),
        })
    }

    pub async fn list_models(
        &self,
        api_url: &str,
        api_key: &str,
        timeout: Duration,
    ) -> Result<Vec<String>, ProviderError> {
        let endpoint = models_endpoint(api_url);
        let value = self
            .get_json_with_retry(&endpoint, api_key, timeout)
            .await?;
        let models = value
            .get("data")
            .or_else(|| value.get("models"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(models
            .into_iter()
            .map(|item| {
                item.get("id")
                    .or_else(|| item.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| item.to_string())
            })
            .collect())
    }

    pub async fn verify_turnstile(
        &self,
        secret: &str,
        response_token: &str,
        timeout: Duration,
    ) -> Result<bool, ProviderError> {
        let response = self
            .http
            .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
            .timeout(timeout)
            .form(&[("secret", secret), ("response", response_token)])
            .send()
            .await?;
        let status = response.status();
        let value: Value = response.json().await?;
        if !status.is_success() {
            return Err(ProviderError::Http {
                status: status.as_u16(),
                body: value.to_string(),
            });
        }
        Ok(value
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false))
    }

    pub async fn feishu_tenant_token(
        &self,
        app_id: &str,
        app_secret: &str,
        timeout: Duration,
    ) -> Result<String, ProviderError> {
        let body = json!({"app_id": app_id, "app_secret": app_secret});
        let value = self
            .http
            .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
            .timeout(timeout)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await?;
        if value.get("code").and_then(Value::as_i64) != Some(0) {
            return Err(ProviderError::Http {
                status: 401,
                body: value.to_string(),
            });
        }
        value
            .get("tenant_access_token")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(ProviderError::Empty)
    }

    pub async fn feishu_batch_create(
        &self,
        app_token: &str,
        table_id: &str,
        tenant_token: &str,
        records: Value,
        timeout: Duration,
    ) -> Result<Value, ProviderError> {
        let url = format!(
            "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"
        );
        let response = self
            .http
            .post(url)
            .timeout(timeout)
            .bearer_auth(tenant_token)
            .json(&json!({"records": records}))
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }

    async fn post_json_with_retry(
        &self,
        endpoint: &str,
        api_key: &str,
        body: Value,
        timeout: Duration,
    ) -> Result<Value, ProviderError> {
        let mut last_error = None;
        for attempt in 0..self.policy.max_attempts {
            let response = self
                .http
                .post(endpoint)
                .timeout(timeout)
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await;
            match response {
                Ok(response) => {
                    let status = response.status();
                    let text = response.text().await?;
                    if status.is_success() {
                        return Ok(serde_json::from_str(&text)?);
                    }
                    let error = ProviderError::Http {
                        status: status.as_u16(),
                        body: text,
                    };
                    if attempt + 1 < self.policy.max_attempts && error.retryable() {
                        last_error = Some(error);
                        sleep(self.backoff(attempt)).await;
                        continue;
                    }
                    return Err(error);
                }
                Err(error) => {
                    let error = ProviderError::Transport(error);
                    if attempt + 1 < self.policy.max_attempts && error.retryable() {
                        last_error = Some(error);
                        sleep(self.backoff(attempt)).await;
                        continue;
                    }
                    return Err(error);
                }
            }
        }
        Err(last_error.unwrap_or(ProviderError::Empty))
    }

    async fn get_json_with_retry(
        &self,
        endpoint: &str,
        api_key: &str,
        timeout: Duration,
    ) -> Result<Value, ProviderError> {
        let mut last_error = None;
        for attempt in 0..self.policy.max_attempts {
            let response = self
                .http
                .get(endpoint)
                .timeout(timeout)
                .bearer_auth(api_key)
                .send()
                .await;
            match response {
                Ok(response) => {
                    let status = response.status();
                    let text = response.text().await?;
                    if status.is_success() {
                        return Ok(serde_json::from_str(&text)?);
                    }
                    let error = ProviderError::Http {
                        status: status.as_u16(),
                        body: text,
                    };
                    if attempt + 1 < self.policy.max_attempts && error.retryable() {
                        last_error = Some(error);
                        sleep(self.backoff(attempt)).await;
                        continue;
                    }
                    return Err(error);
                }
                Err(error) => {
                    let error = ProviderError::Transport(error);
                    if attempt + 1 < self.policy.max_attempts && error.retryable() {
                        last_error = Some(error);
                        sleep(self.backoff(attempt)).await;
                        continue;
                    }
                    return Err(error);
                }
            }
        }
        Err(last_error.unwrap_or(ProviderError::Empty))
    }

    async fn stream_once(
        &self,
        endpoint: &str,
        api_key: &str,
        body: Value,
        timeout: Duration,
    ) -> Result<String, ProviderError> {
        let response = self
            .http
            .post(endpoint)
            .timeout(timeout)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Http {
                status: status.as_u16(),
                body,
            });
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if content_type.contains("application/json") {
            let value: Value = response.json().await?;
            return extract_chat_text(&value).ok_or(ProviderError::Empty);
        }
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut full = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(index) = buffer.find('\n') {
                let line = buffer[..index].trim_end_matches('\r').to_string();
                buffer.drain(..=index);
                if let Some(data) = line.strip_prefix("data: ") {
                    if data.trim() == "[DONE]" {
                        return Ok(full);
                    }
                    if let Ok(value) = serde_json::from_str::<Value>(data) {
                        append_delta(&mut full, &value);
                    }
                }
            }
        }
        if !buffer.trim().is_empty() {
            if let Some(data) = buffer.trim().strip_prefix("data: ") {
                if let Ok(value) = serde_json::from_str::<Value>(data) {
                    append_delta(&mut full, &value);
                }
            }
        }
        if full.is_empty() {
            return Err(ProviderError::Empty);
        }
        Ok(full)
    }

    fn backoff(&self, attempt: usize) -> Duration {
        self.policy
            .base_delay
            .saturating_mul(2u32.saturating_pow(attempt as u32))
    }
}

impl ProviderError {
    pub fn retryable(&self) -> bool {
        match self {
            Self::Transport(_) => true,
            Self::Http { status, .. } => {
                matches!(*status, 408 | 425 | 429 | 500 | 502 | 503 | 504 | 524)
            }
            _ => false,
        }
    }

    pub fn is_timeout(&self) -> bool {
        matches!(self, Self::Transport(error) if error.is_timeout())
            || matches!(self, Self::Http { status: 524, .. })
    }
}

fn append_delta(target: &mut String, value: &Value) {
    let choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first());
    let Some(choice) = choice else { return };
    let delta = choice.get("delta").or_else(|| choice.get("message"));
    let Some(delta) = delta else { return };
    for key in ["reasoning_content", "content"] {
        if let Some(text) = delta.get(key).and_then(Value::as_str) {
            target.push_str(text);
        }
    }
    if let Some(images) = delta.get("images").and_then(Value::as_array) {
        for image in images {
            if let Some(url) = image
                .get("image_url")
                .and_then(|v| v.get("url"))
                .and_then(Value::as_str)
            {
                target.push_str(url);
            }
        }
    }
}

pub fn extract_chat_text(value: &Value) -> Option<String> {
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))?;
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => Some(
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(""),
        ),
        _ => Some(content.to_string()),
    }
}

pub fn extract_media(text: &str) -> MediaOutput {
    let markdown = Regex::new(r"!\[[^\]]*\]\((https?://[^)]+)\)").expect("valid regex");
    if let Some(url) = markdown.captures(text).and_then(|m| m.get(1)) {
        return MediaOutput {
            media_url: Some(url.as_str().trim_matches(['\'', '"', '.', ')']).to_string()),
            raw_text: text.to_string(),
            ..Default::default()
        };
    }
    let video_tag = Regex::new(r#"<video[^>]+src=[\"']([^\"']+)[\"'][^>]*>"#).expect("valid regex");
    if let Some(url) = video_tag.captures(text).and_then(|m| m.get(1)) {
        return MediaOutput {
            media_url: Some(url.as_str().to_string()),
            raw_text: text.to_string(),
            ..Default::default()
        };
    }
    let data_url = Regex::new(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]+)").expect("valid regex");
    if let Some(encoded) = data_url.captures(text).and_then(|m| m.get(1)) {
        return MediaOutput {
            image_base64: Some(encoded.as_str().to_string()),
            raw_text: text.to_string(),
            ..Default::default()
        };
    }
    let url = Regex::new(r#"https?://[^\s<>"'\\)]+\b"#).expect("valid regex");
    if let Some(url) = url.find(text) {
        return MediaOutput {
            media_url: Some(url.as_str().trim_matches(['\'', '"', '.', ')']).to_string()),
            raw_text: text.to_string(),
            ..Default::default()
        };
    }
    if text.len() > 1000
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=' | '\n' | '\r'))
    {
        return MediaOutput {
            image_base64: Some(text.trim().to_string()),
            raw_text: text.to_string(),
            ..Default::default()
        };
    }
    MediaOutput {
        raw_text: text.to_string(),
        ..Default::default()
    }
}

fn chat_endpoint(api_url: &str) -> String {
    if api_url.ends_with("/chat/completions") || api_url.contains(":generateContent") {
        api_url.to_string()
    } else {
        format!("{}/chat/completions", api_url.trim_end_matches('/'))
    }
}

fn models_endpoint(api_url: &str) -> String {
    let trimmed = api_url.trim_end_matches('/');
    if trimmed.ends_with("/models") {
        trimmed.to_string()
    } else if trimmed.ends_with("/chat/completions") {
        format!("{}/models", trimmed.trim_end_matches("/chat/completions"))
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/models")
    } else {
        format!("{trimmed}/v1/models")
    }
}

fn image_endpoint(api_url: &str) -> String {
    let trimmed = api_url.trim_end_matches('/');
    if trimmed.ends_with("/images/generations") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/images/generations")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_sse_content_and_reasoning() {
        let mut text = String::new();
        append_delta(
            &mut text,
            &json!({"choices":[{"delta":{"reasoning_content":"a","content":"b"}}]}),
        );
        assert_eq!(text, "ab");
    }

    #[test]
    fn extracts_media_variants() {
        assert_eq!(
            extract_media("![x](https://example.com/a.png)")
                .media_url
                .as_deref(),
            Some("https://example.com/a.png")
        );
        assert_eq!(
            extract_media("data:image/png;base64,AAAA").image_base64,
            Some("AAAA".into())
        );
    }

    #[test]
    fn normalizes_models_endpoint() {
        assert_eq!(
            models_endpoint("https://api.example/v1"),
            "https://api.example/v1/models"
        );
        assert_eq!(
            chat_endpoint("https://api.example"),
            "https://api.example/chat/completions"
        );
    }
}
