//! WebSocket 连接管理器：等价 Python `websocket_manager.py`。
//!
//! - 每个连接以 token 认证，按 username 注册
//! - 支持定向推送（单用户）与全量广播
//! - 心跳 ping 由客户端消息回显处理

use abp_core::{ApiError, ApiResult};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// 发送到某个客户端的消息通道。
pub type SinkTx = mpsc::UnboundedSender<axum::extract::ws::Message>;

#[derive(Clone, Default)]
pub struct WsManager {
    inner: Arc<RwLock<HashMap<String, Vec<SinkTx>>>>,
}

impl WsManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册连接；返回句柄供断开时注销。
    pub async fn register(&self, username: &str, tx: SinkTx) {
        self.inner
            .write()
            .await
            .entry(username.to_string())
            .or_default()
            .push(tx);
    }

    pub async fn unregister(&self, username: &str, tx: &SinkTx) {
        let mut map = self.inner.write().await;
        if let Some(list) = map.get_mut(username) {
            list.retain(|t| !t.same_channel(tx));
            if list.is_empty() {
                map.remove(username);
            }
        }
    }

    /// 推送给单个用户的所有连接。
    pub async fn send_to_user(&self, username: &str, msg: &str) {
        let map = self.inner.read().await;
        if let Some(list) = map.get(username) {
            for tx in list {
                let _ = tx.send(axum::extract::ws::Message::Text(msg.into()));
            }
        }
    }

    /// 广播给所有在线连接。
    pub async fn broadcast(&self, msg: &str) {
        let map = self.inner.read().await;
        for list in map.values() {
            for tx in list {
                let _ = tx.send(axum::extract::ws::Message::Text(msg.into()));
            }
        }
    }

    pub async fn online_users(&self) -> Vec<String> {
        self.inner.read().await.keys().cloned().collect()
    }
}

/// 校验 WS 握手中的 token（/ws/{token}）。
pub fn validate_ws_token(token: &str, secret: &str) -> ApiResult<String> {
    abp_infra::auth::decode_token(token, secret)
        .map_err(|_: ApiError| ApiError::unauthorized("invalid websocket token"))
}
