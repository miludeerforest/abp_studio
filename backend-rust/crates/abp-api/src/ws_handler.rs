//! WebSocket 端点：/ws/{token}
//!
//! 协议与前端 `useWebSocket.js` 对齐：
//! - 服务端周期发送 `{"type":"ping"}`
//! - 客户端消息原样回显（保活）
//! - 队列状态变化通过 WsManager 推送

use crate::error::ApiError;
use crate::state::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};

pub async fn ws_upgrade(
    State(app): State<AppState>,
    Path(token): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let username = match crate::ws::validate_ws_token(&token, &app.settings.secret_key) {
        Ok(u) => u,
        Err(_) => return Err(ApiError::unauthorized("invalid websocket token")),
    };
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, app, username)))
}

async fn handle_socket(socket: WebSocket, app: AppState, username: String) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    app.ws.register(&username, tx.clone()).await;
    tracing::info!(%username, "ws connected");

    // Python protocol is client-driven: the frontend sends `ping` and the
    // server answers `pong`. Queue events continue to arrive through `rx`.
    loop {
        tokio::select! {
            // 下行：推送队列消息
            Some(msg) = rx.recv() => {
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
            // 上行：与 Python websocket_endpoint 保持一致。
            item = stream.next() => {
                match item {
                    Some(Ok(Message::Text(text))) => {
                        if text == "ping" {
                            if sink.send(Message::Text("pong".into())).await.is_err() {
                                break;
                            }
                        } else if let Some(activity) = text.strip_prefix("activity:") {
                            tracing::debug!(%username, %activity, "ws activity update");
                        }
                    }
                    Some(Ok(_)) => {}
                    _ => break,
                }
            }
        }
    }

    app.ws.unregister(&username, &tx).await;
    tracing::info!(%username, "ws disconnected");
}
