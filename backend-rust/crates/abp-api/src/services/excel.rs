use crate::error::{ApiError, ApiResult};
use serde_json::Value;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Produce a small standards-compliant XLSX workbook using inline strings.
/// Keeping this writer local avoids a Python/openpyxl runtime dependency while
/// preserving the endpoint's MIME type and spreadsheet semantics.
pub fn keyword_workbook(rows: &[Value]) -> ApiResult<Vec<u8>> {
    let mut output = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(&mut output);
    let options = SimpleFileOptions::default();
    let files = [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="核心大词分析" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
    ];
    for (name, contents) in files {
        zip.start_file(name, options)
            .map_err(|error| ApiError::internal(anyhow::anyhow!("start xlsx entry: {error}")))?;
        zip.write_all(contents.as_bytes())
            .map_err(|error| ApiError::internal(anyhow::anyhow!("write xlsx entry: {error}")))?;
    }
    zip.start_file("xl/worksheets/sheet1.xml", options)
        .map_err(|error| ApiError::internal(anyhow::anyhow!("start worksheet: {error}")))?;
    let mut sheet = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    );
    let headers = [
        "标题",
        "标题_中文翻译",
        "标题_核心大词(Root Keywords)",
        "处理状态",
    ];
    sheet.push_str(&row_xml(1, &headers.map(str::to_string)));
    for (index, item) in rows.iter().enumerate() {
        let status = match item
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending")
        {
            "completed" => "已完成",
            "failed" => "失败",
            _ => "未处理",
        };
        let values = vec![
            string_value(item.get("original")),
            string_value(item.get("translation")),
            string_value(item.get("keywords")),
            status.to_string(),
        ];
        sheet.push_str(&row_xml(index + 2, &values));
    }
    sheet.push_str("</sheetData></worksheet>");
    zip.write_all(sheet.as_bytes())
        .map_err(|error| ApiError::internal(anyhow::anyhow!("write worksheet: {error}")))?;
    zip.finish()
        .map_err(|error| ApiError::internal(anyhow::anyhow!("finish xlsx: {error}")))?;
    Ok(output.into_inner())
}

fn row_xml(row: usize, values: &[String]) -> String {
    let cells = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            format!(
                r#"<c r="{}{}" t="inlineStr"><is><t>{}</t></is></c>"#,
                column_name(index),
                row,
                xml_escape(value)
            )
        })
        .collect::<String>();
    format!("<row r=\"{row}\">{cells}</row>")
}

fn column_name(index: usize) -> String {
    ((b'A' + (index as u8)) as char).to_string()
}

fn string_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.clone(),
        Some(value) => value.to_string(),
        None => String::new(),
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
