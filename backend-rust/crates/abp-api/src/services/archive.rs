use crate::error::{ApiError, ApiResult};
use std::io::{Cursor, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

pub async fn zip_files(files: Vec<(String, String)>) -> ApiResult<Vec<u8>> {
    let mut output = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(&mut output);
    let options = SimpleFileOptions::default();
    for (name, path) in files {
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|error| ApiError::bad_request(format!("读取文件失败: {error}")))?;
        archive
            .start_file(sanitize_name(&name), options)
            .map_err(|error| ApiError::internal(anyhow::anyhow!("start archive entry: {error}")))?;
        archive
            .write_all(&bytes)
            .map_err(|error| ApiError::internal(anyhow::anyhow!("write archive entry: {error}")))?;
    }
    archive
        .finish()
        .map_err(|error| ApiError::internal(anyhow::anyhow!("finish archive: {error}")))?;
    Ok(output.into_inner())
}

fn sanitize_name(name: &str) -> String {
    Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download.bin")
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-') {
                value
            } else {
                '_'
            }
        })
        .collect()
}
