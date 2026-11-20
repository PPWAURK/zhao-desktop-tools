//! Lists the videos in a folder (not recursive) and probes each one.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::media;
use crate::platform;

const VIDEO_EXTS: [&str; 12] = ["mov", "mp4", "mkv", "avi", "m4v", "wmv", "flv", "mts", "m2ts", "ts", "webm", "3gp"];
const PROBE_THREADS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub name: String,
    pub size: u64,
    pub duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Compressed outputs already next to this video (e.g. `name_250MB.mp4`).
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub dir: String,
    pub videos: Vec<VideoInfo>,
}

fn output_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)_\d+MB\.mp4$").expect("valid regex"))
}

/// Our own outputs look like `<stem>_<n>MB.mp4`; they are never re-compressed.
pub fn is_output_name(name: &str) -> bool {
    output_re().is_match(name)
}

pub fn output_name(video_name: &str, target_mb: u32) -> String {
    format!("{}_{}MB.mp4", file_stem(video_name), target_mb)
}

pub fn file_stem(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

fn is_video_name(name: &str) -> bool {
    if name.starts_with('.') || is_output_name(name) {
        return false; // hidden files include macOS "._" metadata files on external drives
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    name.contains('.') && VIDEO_EXTS.contains(&ext.as_str())
}

/// Accepts pasted paths: surrounding quotes, Terminal `\ ` escapes (macOS), leading `~`.
pub fn clean_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    let unquoted = trimmed
        .strip_prefix('"').and_then(|s| s.strip_suffix('"'))
        .or_else(|| trimmed.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
        .unwrap_or(trimmed);
    // On Windows a backslash is the path separator, so only unescape on macOS.
    let unescaped = if cfg!(windows) { unquoted.to_string() } else { unquoted.replace("\\ ", " ") };
    match (unescaped.strip_prefix('~'), platform::home_dir()) {
        (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
            home.join(rest.trim_start_matches(['/', '\\']))
        }
        _ => PathBuf::from(unescaped),
    }
}

pub fn resolve_dir(raw: &str) -> Result<PathBuf, String> {
    let dir = clean_path(raw);
    if raw.trim().is_empty() {
        return Err("请先选择或输入文件夹".into());
    }
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("找不到这个文件夹：{}", dir.display()));
    }
    Ok(dir)
}

pub fn scan_dir(ffmpeg: &Path, dir: &Path) -> Result<ScanResult, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("无法读取文件夹：{e}"))?;
    let mut all_names: Vec<(String, u64)> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            meta.is_file().then(|| (e.file_name().to_string_lossy().into_owned(), meta.len()))
        })
        .collect();
    all_names.sort_by(|a, b| a.0.cmp(&b.0));

    let outputs: Vec<&String> = all_names.iter().map(|(n, _)| n).filter(|n| is_output_name(n)).collect();
    let candidates: Vec<(String, u64)> = all_names.iter().filter(|(n, _)| is_video_name(n)).cloned().collect();

    let mut videos: Vec<VideoInfo> = Vec::with_capacity(candidates.len());
    for chunk in candidates.chunks(PROBE_THREADS) {
        let probed: Vec<VideoInfo> = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|(name, size)| scope.spawn(move || probe_one(ffmpeg, dir, name, *size)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        videos.extend(probed);
    }
    let videos = videos
        .into_iter()
        .map(|v| {
            let prefix = format!("{}_", file_stem(&v.name));
            let mine = outputs.iter().filter(|o| o.starts_with(&prefix)).map(|o| o.to_string()).collect();
            VideoInfo { outputs: mine, ..v }
        })
        .collect();
    Ok(ScanResult { dir: dir.to_string_lossy().into_owned(), videos })
}

fn probe_one(ffmpeg: &Path, dir: &Path, name: &str, size: u64) -> VideoInfo {
    let base = VideoInfo {
        name: name.to_string(),
        size,
        duration: 0.0,
        width: None,
        height: None,
        codec: None,
        error: None,
        outputs: Vec::new(),
    };
    match media::probe(ffmpeg, &dir.join(name)) {
        Ok(p) => VideoInfo { duration: p.duration, width: p.width, height: p.height, codec: p.codec, ..base },
        Err(e) => VideoInfo { error: Some(e), ..base },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_outputs_and_videos() {
        assert!(is_output_name("课程1_250MB.mp4"));
        assert!(is_output_name("a_1000mb.MP4"));
        assert!(!is_output_name("a_250MB.mov"));
        assert!(is_video_name("录像.MOV"));
        assert!(!is_video_name("._录像.mov"));
        assert!(!is_video_name("a_250MB.mp4"));
        assert!(!is_video_name("notes.txt"));
        assert!(!is_video_name("mp4"));
    }

    #[test]
    fn builds_output_name_from_stem() {
        assert_eq!(output_name("会议.录像.mov", 250), "会议.录像_250MB.mp4");
        assert_eq!(output_name("noext", 50), "noext_50MB.mp4");
    }

    #[test]
    fn cleans_pasted_paths() {
        assert_eq!(clean_path("  '/Volumes/My Disk/a'  "), PathBuf::from("/Volumes/My Disk/a"));
        assert_eq!(clean_path("\"D:\\录像\\3月\""), PathBuf::from("D:\\录像\\3月"));
        let home = platform::home_dir().unwrap();
        assert_eq!(clean_path("~/Movies"), home.join("Movies"));
    }

    #[cfg(not(windows))]
    #[test]
    fn unescapes_terminal_spaces_on_macos() {
        assert_eq!(clean_path("/Volumes/My\\ Disk"), PathBuf::from("/Volumes/My Disk"));
    }

    #[test]
    fn rejects_missing_or_relative_dirs() {
        assert!(resolve_dir("").is_err());
        assert!(resolve_dir("relative/dir").is_err());
        assert!(resolve_dir("/definitely/not/here").is_err());
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_dir(&tmp.path().to_string_lossy()).is_ok());
    }
}
