use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use abp_ai::{decode_data_or_base64, image_dimensions, media_extension};
use abp_core::domain::User;
use abp_infra::repo::NewSavedImage;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use uuid::Uuid;

pub async fn save_gallery_image(
    app: &AppState,
    user: &User,
    bytes: &[u8],
    prompt: &str,
    category: &str,
    prefix: &str,
) -> ApiResult<(String, Option<i32>, Option<i32>)> {
    let directory = Path::new(&app.settings.uploads_dir).join("gallery");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| {
            ApiError::internal(anyhow::anyhow!("create gallery directory: {error}"))
        })?;
    let extension = media_extension(bytes, "png");
    let filename = format!(
        "{prefix}_{}_{}.{}",
        user.id,
        Uuid::new_v4().simple(),
        extension
    );
    let path = directory.join(&filename);
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("write gallery image: {error}")))?;
    let (width, height) = image_dimensions(bytes)
        .map(|(width, height)| (i32::try_from(width).ok(), i32::try_from(height).ok()))
        .unwrap_or((None, None));
    let file_path = path.to_string_lossy().into_owned();
    let url = format!("/uploads/gallery/{filename}");
    app.db
        .insert_saved_image(&NewSavedImage {
            user_id: user.id,
            filename: filename.clone(),
            file_path,
            url: url.clone(),
            prompt: Some(prompt.to_string()),
            width,
            height,
            category: category.to_string(),
            is_shared: user.default_share.unwrap_or(true),
        })
        .await?;
    Ok((format!("/uploads/gallery/{filename}"), width, height))
}

pub async fn decode_provider_media(
    app: &AppState,
    base64_value: Option<&str>,
    url: Option<&str>,
) -> ApiResult<Option<Vec<u8>>> {
    if let Some(value) = base64_value {
        return decode_data_or_base64(value)
            .map(Some)
            .map_err(|error| ApiError::bad_request(error.to_string()));
    }
    let Some(url) = url else { return Ok(None) };
    let response = app
        .http
        .get(url)
        .timeout(std::time::Duration::from_secs(90))
        .send()
        .await
        .map_err(|error| ApiError::bad_request(format!("download provider media: {error}")))?;
    if !response.status().is_success() {
        return Err(ApiError::bad_request(format!(
            "download provider media returned {}",
            response.status()
        )));
    }
    Ok(Some(
        response
            .bytes()
            .await
            .map_err(|error| ApiError::bad_request(format!("read provider media: {error}")))?
            .to_vec(),
    ))
}

pub fn uploads_path(app: &AppState, url_or_path: &str) -> PathBuf {
    if let Some(rest) = url_or_path.strip_prefix("/uploads/") {
        Path::new(&app.settings.uploads_dir).join(rest)
    } else {
        PathBuf::from(url_or_path)
    }
}

pub async fn run_ffmpeg(args: &[String]) -> ApiResult<()> {
    let output = Command::new("ffmpeg")
        .args(args)
        .output()
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("start ffmpeg: {error}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(ApiError::internal(anyhow::anyhow!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )))
    }
}

pub async fn merge_videos(
    app: &AppState,
    paths: &[PathBuf],
    output_name: &str,
) -> ApiResult<String> {
    if paths.is_empty() {
        return Err(ApiError::bad_request(
            "No valid videos selected for merging",
        ));
    }
    let queue_dir = Path::new(&app.settings.uploads_dir).join("queue");
    tokio::fs::create_dir_all(&queue_dir)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("create queue directory: {error}")))?;
    let list_path = queue_dir.join(format!("{output_name}.concat.txt"));
    let contents = paths
        .iter()
        .map(|path| format!("file '{}'\n", path.display()))
        .collect::<String>();
    tokio::fs::write(&list_path, contents)
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("write concat list: {error}")))?;
    let output_path = queue_dir.join(output_name);
    let args = vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list_path.to_string_lossy().into_owned(),
        "-c".into(),
        "copy".into(),
        output_path.to_string_lossy().into_owned(),
    ];
    run_ffmpeg(&args).await?;
    Ok(format!("/uploads/queue/{output_name}"))
}

pub async fn thumbnail(
    app: &AppState,
    input: &Path,
    output_name: &str,
) -> ApiResult<Option<String>> {
    let queue_dir = Path::new(&app.settings.uploads_dir).join("queue");
    let output = queue_dir.join(output_name);
    let args = vec![
        "-y".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-ss".into(),
        "00:00:00.500".into(),
        "-vframes".into(),
        "1".into(),
        "-q:v".into(),
        "2".into(),
        output.to_string_lossy().into_owned(),
    ];
    match run_ffmpeg(&args).await {
        Ok(()) => Ok(Some(format!("/uploads/queue/{output_name}"))),
        Err(error) => {
            tracing::warn!(error = %error, "thumbnail generation failed");
            Ok(None)
        }
    }
}

pub async fn extract_last_frame(
    app: &AppState,
    input: &Path,
    output_name: &str,
) -> ApiResult<Option<PathBuf>> {
    let output = Path::new(&app.settings.uploads_dir)
        .join("queue")
        .join(output_name);
    let args = vec![
        "-y".into(),
        "-sseof".into(),
        "-0.5".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-update".into(),
        "1".into(),
        "-q:v".into(),
        "2".into(),
        output.to_string_lossy().into_owned(),
    ];
    match run_ffmpeg(&args).await {
        Ok(()) => Ok(Some(output)),
        Err(error) => {
            tracing::warn!(error = %error, "last-frame extraction failed");
            Ok(None)
        }
    }
}
