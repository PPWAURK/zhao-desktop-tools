//! 视频批量压缩工具 — Tauri shell.
//!
//! The page calls these commands instead of the old local HTTP API:
//! scan_dir, pick_folder, start_job, stop_job, job_status, reveal_folder.

mod job;
mod media;
mod plan;
mod platform;
mod scan;

use std::sync::Arc;

use serde::Deserialize;
use tauri::{Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use job::{JobManager, JobSnapshot, StartRequest};
use scan::ScanResult;

type Jobs = Arc<JobManager>;

#[derive(Deserialize)]
struct DirRequest {
    dir: String,
}

#[tauri::command]
async fn scan_dir(req: DirRequest) -> Result<ScanResult, String> {
    let dir = scan::resolve_dir(&req.dir)?;
    let ffmpeg = media::find_ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || scan::scan_dir(&ffmpeg, &dir))
        .await
        .map_err(|e| format!("读取视频失败：{e}"))?
}

#[derive(serde::Serialize)]
struct PickResult {
    dir: String,
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<PickResult, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择视频所在的文件夹")
        .blocking_pick_folder()
        .ok_or_else(|| "没有选择文件夹".to_string())?;
    let path = picked.into_path().map_err(|e| format!("文件夹路径无效：{e}"))?;
    Ok(PickResult { dir: path.to_string_lossy().into_owned() })
}

#[tauri::command]
fn start_job(req: StartRequest, jobs: State<'_, Jobs>) -> Result<(), String> {
    jobs.start(req)
}

#[tauri::command]
fn stop_job(jobs: State<'_, Jobs>) {
    jobs.stop();
}

#[tauri::command]
fn job_status(jobs: State<'_, Jobs>) -> JobSnapshot {
    jobs.snapshot()
}

#[tauri::command]
fn reveal_folder(req: DirRequest) -> Result<(), String> {
    let dir = scan::resolve_dir(&req.dir)?;
    platform::reveal_folder(&dir).map_err(|e| format!("无法打开文件夹：{e}"))
}

/// Asks before closing the window while videos are still being compressed.
fn confirm_close(app: &tauri::AppHandle) {
    let handle = app.clone();
    app.dialog()
        .message("正在压缩视频。现在退出会停止压缩，已完成的分段会保留，下次点「开始压缩」可继续。")
        .title("确定退出吗？")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("退出".into(), "继续压缩".into()))
        .show(move |quit| {
            if quit {
                handle.state::<Jobs>().stop();
                handle.exit(0);
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage::<Jobs>(Arc::new(JobManager::default()))
        .invoke_handler(tauri::generate_handler![
            scan_dir,
            pick_folder,
            start_job,
            stop_job,
            job_status,
            reveal_folder
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Jobs>().is_running() {
                    api.prevent_close();
                    confirm_close(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while building 视频压缩工具: {e}");
            std::process::exit(1);
        });

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<Jobs>().stop(); // never leave ffmpeg running in the background
        }
    });
}
