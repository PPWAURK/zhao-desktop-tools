//! Calcul JOUR ABS desktop shell.
//!
//! All calculation happens in the web page (ExcelJS + JourAbs logic). The Rust side
//! only provides what a plain browser page cannot do well inside a desktop app:
//! a native "Save as" dialog that writes the processed workbook to disk.

use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const NAME_HEADER: &str = "x-file-name";
const DEFAULT_NAME: &str = "fichier_jour_abs.xlsx";
const MAX_FILE_BYTES: usize = 200 * 1024 * 1024;

/// Decodes the percent-encoded file name sent by the page (encodeURIComponent).
fn decode_name(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| DEFAULT_NAME.to_string())
}

/// Keeps only the final path component so the page can never choose a directory.
fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    if base.is_empty() || base.starts_with('.') {
        return DEFAULT_NAME.to_string();
    }
    if base.to_lowercase().ends_with(".xlsx") {
        base.to_string()
    } else {
        format!("{base}.xlsx")
    }
}

/// Asks where to save the processed workbook and writes it.
/// Returns the saved path, or `None` when the user cancels the dialog.
#[tauri::command]
async fn save_xlsx(app: tauri::AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Données du fichier manquantes.".into());
    };
    if data.is_empty() || data.len() > MAX_FILE_BYTES {
        return Err("Taille du fichier invalide.".into());
    }
    let name = request
        .headers()
        .get(NAME_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(decode_name)
        .map(|n| safe_file_name(&n))
        .unwrap_or_else(|| DEFAULT_NAME.to_string());

    let mut dialog = app
        .dialog()
        .file()
        .set_title("Enregistrer le fichier traité")
        .set_file_name(&name)
        .add_filter("Excel", &["xlsx"]);
    if let Ok(dir) = app.path().download_dir() {
        dialog = dialog.set_directory(dir);
    }
    let Some(target) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = target
        .into_path()
        .map_err(|e| format!("Emplacement invalide : {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Impossible d'enregistrer : {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Shows the saved file selected in Finder / File Explorer.
#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !p.exists() {
        return Err("Fichier introuvable.".into());
    }
    #[cfg(windows)]
    let spawned = {
        let mut arg = std::ffi::OsString::from("/select,");
        arg.push(p.as_os_str());
        std::process::Command::new("explorer").arg(arg).spawn()
    };
    #[cfg(not(windows))]
    let spawned = std::process::Command::new("open").arg("-R").arg(&p).spawn();
    spawned.map(|_| ()).map_err(|e| format!("Impossible d'afficher le fichier : {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_xlsx, reveal_file])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running Calcul JOUR ABS: {e}");
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_encoded_utf8_names() {
        assert_eq!(decode_name("Grand_Boulevard_f%C3%A9vrier.xlsx"), "Grand_Boulevard_février.xlsx");
    }

    #[test]
    fn strips_directories_from_names() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd.xlsx");
        assert_eq!(safe_file_name("a/b/out.xlsx"), "out.xlsx");
    }

    #[test]
    fn falls_back_for_empty_or_hidden_names() {
        assert_eq!(safe_file_name(""), DEFAULT_NAME);
        assert_eq!(safe_file_name(".hidden"), DEFAULT_NAME);
    }
}
