use crate::error::ApiResult;
use crate::state::AppState;

/// Remove gallery rows whose persisted file no longer exists.  This is the
/// Rust equivalent of `cleanup_gallery.py`, kept as an explicit maintenance
/// operation instead of importing Python/SQLAlchemy into the worker image.
pub async fn cleanup_gallery(app: &AppState) -> ApiResult<u64> {
    let images = app.db.all_saved_images().await?;
    let mut deleted = 0;
    for image in images {
        if image.file_path.is_empty() {
            continue;
        }
        match tokio::fs::try_exists(&image.file_path).await {
            Ok(false) => {
                app.db.delete_image(image.id).await?;
                deleted += 1;
            }
            Ok(true) => {}
            Err(error) => {
                tracing::warn!(
                    image_id = image.id,
                    path = %image.file_path,
                    error = %error,
                    "gallery cleanup could not inspect file; preserving database row"
                );
            }
        }
    }
    Ok(deleted)
}
