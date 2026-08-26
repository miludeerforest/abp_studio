//! Domain-specific PostgreSQL repositories.
//!
//! Each file implements a focused part of the `Db` facade so SQL remains
//! discoverable without recreating the old monolithic repository.

use sqlx::PgPool;

#[derive(Clone)]
pub struct Db {
    pub pool: PgPool,
}

impl Db {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(Debug, Clone)]
pub struct NewVideoItem {
    pub id: String,
    pub filename: String,
    pub file_path: String,
    pub prompt: String,
    pub user_id: Option<i32>,
    pub category: String,
    pub is_shared: bool,
    pub preview_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewSavedImage {
    pub user_id: i32,
    pub filename: String,
    pub file_path: String,
    pub url: String,
    pub prompt: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub category: String,
    pub is_shared: bool,
}

mod repo_activities;
pub use repo_activities::ActivityRecord;
mod repo_config;
mod repo_gallery;
mod repo_public;
pub use repo_public::PublicVideoRecord;
mod repo_queue;
mod repo_stats;
mod repo_tasks;
mod repo_users;
