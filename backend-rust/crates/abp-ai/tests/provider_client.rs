use abp_ai::{ChatMessage, ChatRequest, ProviderClient, ProviderError, RetryPolicy};
use reqwest::Client;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

async fn stub_provider(
    responses: Vec<(u16, &'static str, &'static str)>,
) -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let request_count = requests.clone();
    tokio::spawn(async move {
        for (status, content_type, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let _ = socket.read(&mut request).await.unwrap();
            request_count.fetch_add(1, Ordering::SeqCst);
            let reason = match status {
                200 => "OK",
                400 => "Bad Request",
                503 => "Service Unavailable",
                _ => "Error",
            };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    });
    (format!("http://{address}/v1"), requests)
}

fn test_request() -> ChatRequest {
    ChatRequest {
        model: "test-model".into(),
        messages: vec![ChatMessage::text("user", "hello")],
        ..Default::default()
    }
}

fn client(max_attempts: usize) -> ProviderClient {
    ProviderClient::with_policy(
        Client::new(),
        RetryPolicy {
            max_attempts,
            base_delay: Duration::ZERO,
        },
    )
}

#[tokio::test]
async fn chat_text_accepts_json_provider_response() {
    let (url, requests) = stub_provider(vec![(
        200,
        "application/json",
        r#"{"choices":[{"message":{"content":"hello-json"}}]}"#,
    )])
    .await;
    let text = client(1)
        .chat_text(&url, "secret", &test_request(), Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(text, "hello-json");
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn stream_chat_parses_sse_provider_response() {
    let (url, _) = stub_provider(vec![(
        200,
        "text/event-stream",
        "data: {\"choices\":[{\"delta\":{\"content\":\"hello \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"sse\"}}]}\n\ndata: [DONE]\n\n",
    )])
    .await;
    let text = client(1)
        .chat_stream_text(&url, "secret", &test_request(), Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(text, "hello sse");
}

#[tokio::test]
async fn retryable_http_error_is_retried() {
    let (url, requests) = stub_provider(vec![
        (503, "application/json", r#"{"error":"busy"}"#),
        (
            200,
            "application/json",
            r#"{"choices":[{"message":{"content":"recovered"}}]}"#,
        ),
    ])
    .await;
    let text = client(2)
        .chat_text(&url, "secret", &test_request(), Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(text, "recovered");
    assert_eq!(requests.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn non_retryable_http_error_is_not_retried() {
    let (url, requests) =
        stub_provider(vec![(400, "application/json", r#"{"error":"invalid"}"#)]).await;
    let error = client(3)
        .chat_text(&url, "secret", &test_request(), Duration::from_secs(2))
        .await
        .unwrap_err();
    assert!(matches!(error, ProviderError::Http { status: 400, .. }));
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}
