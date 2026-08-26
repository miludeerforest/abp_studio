use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;

/// Encode arbitrary media bytes for provider data URLs.
pub fn encode_base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// Decode raw base64, a data URL, or return an error for unsupported content.
pub fn decode_data_or_base64(value: &str) -> Result<Vec<u8>> {
    let encoded = value
        .split_once(",")
        .map(|(_, tail)| tail)
        .unwrap_or(value)
        .trim();
    STANDARD
        .decode(encoded)
        .or_else(|_| {
            // Some providers omit padding.
            let mut padded = encoded.to_string();
            while !padded.len().is_multiple_of(4) {
                padded.push('=');
            }
            STANDARD.decode(padded)
        })
        .context("invalid base64 media payload")
}

/// Resize and JPEG-compress an uploaded image, matching the Python helper's
/// default 800px/quality-75 behavior. If decoding fails, original bytes are
/// returned so callers can still send non-image provider inputs unchanged.
pub fn compress_image(bytes: &[u8], max_size: u32, quality: u8) -> Result<Vec<u8>> {
    let image = match image::load_from_memory(bytes) {
        Ok(image) => image,
        Err(_) => return Ok(bytes.to_vec()),
    };
    let image = resize_image(image, max_size);
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Jpeg)
        .map_err(|e| anyhow!("encode compressed image: {e}"))?;
    // image::DynamicImage::write_to does not expose JPEG quality. Re-encode
    // with the encoder when quality differs from the default.
    if quality != 75 {
        let rgb = image.to_rgb8();
        let mut output = Cursor::new(Vec::new());
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, quality);
        encoder
            .encode(
                &rgb,
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| anyhow!("encode JPEG: {e}"))?;
        return Ok(output.into_inner());
    }
    Ok(output.into_inner())
}

fn resize_image(image: DynamicImage, max_size: u32) -> DynamicImage {
    let (width, height) = (image.width(), image.height());
    if width <= max_size && height <= max_size {
        image
    } else {
        image.resize(max_size, max_size, image::imageops::FilterType::Lanczos3)
    }
}

pub fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image::load_from_memory(bytes)
        .ok()
        .map(|image| (image.width(), image.height()))
}

pub fn media_extension(bytes: &[u8], fallback: &str) -> String {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg".into()
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png".into()
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "webp".into()
    } else {
        fallback.to_string()
    }
}
