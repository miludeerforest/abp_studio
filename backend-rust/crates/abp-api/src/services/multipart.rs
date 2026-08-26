use crate::error::{ApiError, ApiResult};
use axum::extract::Multipart;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct UploadedPart {
    pub field: String,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct MultipartForm {
    pub text: HashMap<String, String>,
    pub files: Vec<UploadedPart>,
}

impl MultipartForm {
    pub fn file(&self, field: &str) -> Option<&UploadedPart> {
        self.files.iter().find(|file| file.field == field)
    }

    pub fn files<'a>(&'a self, field: &'a str) -> impl Iterator<Item = &'a UploadedPart> {
        self.files.iter().filter(move |file| file.field == field)
    }

    pub fn text_or(&self, field: &str, default: &str) -> String {
        self.text
            .get(field)
            .cloned()
            .unwrap_or_else(|| default.to_string())
    }

    pub fn optional_text(&self, field: &str) -> Option<String> {
        self.text
            .get(field)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }
}

pub async fn collect(mut multipart: Multipart) -> ApiResult<MultipartForm> {
    let mut form = MultipartForm::default();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::bad_request(format!("multipart error: {error}")))?
    {
        let name = field
            .name()
            .ok_or_else(|| ApiError::bad_request("multipart field name missing"))?
            .to_string();
        let filename = field.file_name().map(str::to_string);
        let content_type = field.content_type().map(str::to_string);
        let bytes = field
            .bytes()
            .await
            .map_err(|error| ApiError::bad_request(format!("read multipart field: {error}")))?
            .to_vec();
        let is_file = filename.is_some()
            || content_type
                .as_deref()
                .map(|value| value.starts_with("image/") || value.starts_with("video/"))
                .unwrap_or(false);
        if is_file {
            form.files.push(UploadedPart {
                field: name,
                filename,
                content_type,
                bytes,
            });
        } else {
            let value = String::from_utf8(bytes)
                .map_err(|_| ApiError::bad_request(format!("field {name} is not valid UTF-8")))?;
            form.text.insert(name, value);
        }
    }
    Ok(form)
}
