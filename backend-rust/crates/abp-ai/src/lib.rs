//! Shared AI/provider and media primitives used by every migrated workflow.
//!
//! This crate deliberately knows nothing about Axum or PostgreSQL.  Route
//! handlers and workers pass provider requests in, receive typed/structured
//! results, and persist their own task state through `abp-infra`.

pub mod client;
pub mod media;
pub mod prompt;

pub use client::{
    extract_chat_text, extract_media, ChatMessage, ChatRequest, ImageGenerationRequest,
    MediaOutput, ProviderClient, ProviderError, RetryPolicy,
};
pub use media::{
    compress_image, decode_data_or_base64, encode_base64, image_dimensions, media_extension,
};
