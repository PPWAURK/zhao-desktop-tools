//! Background compression job: encodes each video in resumable segments,
//! then joins them into `<name>_<limit>MB.mp4` next to the original.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::media::{self, EncodeSettings, RunError, Runner};
use crate::plan::{make_plan, Codec, Plan};
use crate::platform::KeepAwake;
use crate::scan::{file_stem, output_name, resolve_dir};

/// Each segment is encoded separately so a stopped job resumes where it left off.
const SEGMENT_SECONDS: f64 = 600.0;
/// A shorter leftover is merged into the previous segment.
const MIN_TAIL_SECONDS: f64 = 30.0;
/// Share of the progress bar reserved for the final join step.
const ENCODE_SHARE: f64 = 0.98;
const MAX_LOG_LINES: usize = 500;
const PLAN_FILE: &str = "plan.txt";
const CONCAT_LIST: &str = "concat.txt";
const MIN_TARGET_MB: u32 = 5;
const MAX_TARGET_MB: u32 = 100_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub dir: String,
    pub files: Vec<String>,
    #[serde(rename = "targetMB")]
    pub target_mb: u32,
    pub codec: Codec,
    pub fps: u32,
    #[serde(rename = "audioK")]
    pub audio_k: u32,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileState {
    pub name: String,
    pub status: String,
    pub progress: f64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub running: bool,
    pub dir: String,
    pub files: Vec<FileState>,
    pub log: Vec<String>,
    pub speed: String,
}

enum Outcome {
    Done { out_size: u64, message: String },
    Skipped(String),
}

#[derive(Default)]
pub struct JobManager {
    state: Mutex<JobSnapshot>,
    runner: Runner,
}

impl JobManager {
    pub fn snapshot(&self) -> JobSnapshot {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn is_running(&self) -> bool {
        self.state.lock().map(|s| s.running).unwrap_or(false)
    }

    pub fn stop(&self) {
        self.runner.stop();
    }

    fn update(&self, f: impl FnOnce(&mut JobSnapshot)) {
        if let Ok(mut s) = self.state.lock() {
            f(&mut s);
        }
    }

    fn set_file(&self, index: usize, f: impl FnOnce(&mut FileState)) {
        self.update(|s| {
            if let Some(file) = s.files.get_mut(index) {
                f(file);
            }
        });
    }

    fn log(&self, line: impl Into<String>) {
        let line = line.into();
        self.update(|s| {
            s.log.push(line);
            let excess = s.log.len().saturating_sub(MAX_LOG_LINES);
            s.log.drain(..excess);
        });
    }

    /// Validates the request and starts the job on a background thread.
    pub fn start(self: &Arc<Self>, req: StartRequest) -> Result<(), String> {
        self.start_with(media::find_ffmpeg()?, req)
    }

    fn start_with(self: &Arc<Self>, ffmpeg: PathBuf, req: StartRequest) -> Result<(), String> {
        let dir = resolve_dir(&req.dir)?;
        validate(&req, &dir)?;
        {
            let mut s = self.state.lock().map_err(|_| "内部状态错误".to_string())?;
            if s.running {
                return Err("已经有任务在运行".into());
            }
            *s = JobSnapshot {
                running: true,
                dir: dir.to_string_lossy().into_owned(),
                files: req
                    .files
                    .iter()
                    .map(|n| FileState { name: n.clone(), status: "waiting".into(), ..Default::default() })
                    .collect(),
                log: Vec::new(),
                speed: String::new(),
            };
        }
        self.runner.reset();
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let awake = KeepAwake::start();
            me.run_all(&ffmpeg, &dir, &req);
            drop(awake);
            me.update(|s| {
                s.running = false;
                s.speed.clear();
            });
        });
        Ok(())
    }

    fn run_all(&self, ffmpeg: &Path, dir: &Path, req: &StartRequest) {
        self.log(format!("任务开始：{} 个视频，上限 {} MB", req.files.len(), req.target_mb));
        for (i, name) in req.files.iter().enumerate() {
            if self.runner.is_cancelled() {
                self.set_file(i, |f| { f.status = "cancelled".into(); f.message = "已停止".into(); });
                continue;
            }
            self.set_file(i, |f| { f.status = "running".into(); f.progress = 0.0; });
            match self.process_file(ffmpeg, dir, i, name, req) {
                Ok(Outcome::Done { out_size, message }) => {
                    self.log(format!("完成：{name}（{:.1} MB）", out_size as f64 / 1e6));
                    self.set_file(i, |f| {
                        f.status = "done".into(); f.progress = 1.0; f.out_size = Some(out_size); f.message = message;
                    });
                }
                Ok(Outcome::Skipped(msg)) => {
                    self.log(format!("跳过：{name}：{msg}"));
                    self.set_file(i, |f| { f.status = "skipped".into(); f.message = msg; });
                }
                Err(RunError::Cancelled) => {
                    self.log(format!("已停止：{name}（已完成的分段会保留）"));
                    self.set_file(i, |f| { f.status = "cancelled".into(); f.message = "已停止，可续跑".into(); });
                }
                Err(RunError::Failed(msg)) => {
                    self.log(format!("出错：{name}：{msg}"));
                    self.set_file(i, |f| { f.status = "failed".into(); f.message = msg; });
                }
            }
        }
        self.log(if self.runner.is_cancelled() { "任务已停止" } else { "全部处理完毕" });
    }

    fn process_file(
        &self,
        ffmpeg: &Path,
        dir: &Path,
        index: usize,
        name: &str,
        req: &StartRequest,
    ) -> Result<Outcome, RunError> {
        let input = dir.join(name);
        let out_name = output_name(name, req.target_mb);
        let output = dir.join(&out_name);
        if output.exists() {
            return Ok(Outcome::Skipped("已压过（输出文件已存在）".into()));
        }
        let size = std::fs::metadata(&input).map_err(|e| failed(format!("无法读取文件：{e}")))?.len();
        if size <= u64::from(req.target_mb) * 1_000_000 {
            return Ok(Outcome::Skipped("本来就不超过上限，无需压缩".into()));
        }
        let info = media::probe(ffmpeg, &input).map_err(failed)?;
        let plan = make_plan(info.duration, req.target_mb, req.audio_k, req.codec)
            .ok_or_else(|| failed("太长，压不到这个大小".into()))?;
        let settings = EncodeSettings { codec: req.codec, fps: req.fps, audio_kbps: req.audio_k };

        let seg_dir = dir.join(format!("_分段_{}", file_stem(name)));
        prepare_segment_dir(&seg_dir, &fingerprint(plan, settings)).map_err(failed)?;
        let segments = split_segments(info.duration);
        let seg_files = self.encode_segments(ffmpeg, &input, &seg_dir, index, &segments, info.duration, plan, settings)?;

        self.set_file(index, |f| { f.progress = ENCODE_SHARE; f.message = "合并分段…".into(); });
        let partial = dir.join(format!(".{out_name}.part"));
        let list_body: String = seg_files.iter().map(|p| format!("file '{}'\n", file_name(p))).collect();
        std::fs::write(seg_dir.join(CONCAT_LIST), list_body)
            .map_err(|e| failed(format!("无法写入分段列表：{e}")))?;
        // Windows ffmpeg's concat demuxer cannot open a list whose path has non-ASCII
        // characters (e.g. "_分段_课程"), so run inside the segment folder with a relative name.
        let args = media::concat_args(Path::new(CONCAT_LIST), &partial, req.codec);
        self.runner
            .run(ffmpeg, &args, Some(&seg_dir), |_, _| {})
            .inspect_err(|_| { let _ = std::fs::remove_file(&partial); })?;
        std::fs::rename(&partial, &output).map_err(|e| failed(format!("无法保存结果：{e}")))?;

        let out_size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        if req.clean {
            let _ = std::fs::remove_dir_all(&seg_dir);
        }
        let limit = u64::from(req.target_mb) * 1_000_000;
        let message = if out_size > limit { "完成（略超上限，可调低帧率或上限重压）" } else { "完成" };
        Ok(Outcome::Done { out_size, message: message.into() })
    }

    #[allow(clippy::too_many_arguments)]
    fn encode_segments(
        &self,
        ffmpeg: &Path,
        input: &Path,
        seg_dir: &Path,
        index: usize,
        segments: &[(f64, Option<f64>)],
        duration: f64,
        plan: Plan,
        settings: EncodeSettings,
    ) -> Result<Vec<PathBuf>, RunError> {
        let total = segments.len();
        let mut done_s = 0.0;
        let mut files = Vec::with_capacity(total);
        for (i, &(start, len)) in segments.iter().enumerate() {
            let seg_len = len.unwrap_or(duration - start).max(0.0);
            let seg_path = seg_dir.join(format!("seg_{i:03}.mp4"));
            files.push(seg_path.clone());
            if seg_path.is_file() {
                done_s += seg_len;
                continue; // finished in an earlier run
            }
            let label = format!("第 {}/{} 段", i + 1, total);
            self.set_file(index, |f| f.message = label.clone());
            let part = seg_dir.join(format!("seg_{i:03}.part"));
            let args = media::encode_args(input, &part, start, len, plan, settings);
            let result = self.runner.run(ffmpeg, &args, None, |t, speed| {
                let pct = ((done_s + t.min(seg_len)) / duration).clamp(0.0, 1.0) * ENCODE_SHARE;
                self.set_file(index, |f| f.progress = pct);
                if let Some(sp) = speed {
                    let sp = sp.to_string();
                    self.update(|s| s.speed = sp);
                }
            });
            if let Err(e) = result {
                let _ = std::fs::remove_file(&part);
                return Err(match e {
                    RunError::Failed(msg) => RunError::Failed(format!("{label}：{msg}")),
                    other => other,
                });
            }
            std::fs::rename(&part, &seg_path).map_err(|e| failed(format!("无法保存分段：{e}")))?;
            done_s += seg_len;
        }
        Ok(files)
    }

}

fn failed(msg: String) -> RunError {
    RunError::Failed(msg)
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn validate(req: &StartRequest, dir: &Path) -> Result<(), String> {
    if !(MIN_TARGET_MB..=MAX_TARGET_MB).contains(&req.target_mb) {
        return Err(format!("大小上限需在 {MIN_TARGET_MB} 到 {MAX_TARGET_MB} MB 之间"));
    }
    if !(5..=60).contains(&req.fps) {
        return Err("帧率设置无效".into());
    }
    if !(16..=192).contains(&req.audio_k) {
        return Err("音频码率设置无效".into());
    }
    if req.files.is_empty() {
        return Err("请至少勾选一个视频".into());
    }
    for name in &req.files {
        let plain = !name.contains('/') && !name.contains('\\') && name != ".." && !name.is_empty();
        if !plain || !dir.join(name).is_file() {
            return Err(format!("找不到视频：{name}"));
        }
    }
    Ok(())
}

/// Segment boundaries as (start, length); the last segment runs to the end.
pub fn split_segments(duration: f64) -> Vec<(f64, Option<f64>)> {
    let full = (duration / SEGMENT_SECONDS).floor() as usize;
    let tail = duration - full as f64 * SEGMENT_SECONDS;
    let count = if full == 0 { 1 } else if tail >= MIN_TAIL_SECONDS { full + 1 } else { full };
    (0..count)
        .map(|i| {
            let start = i as f64 * SEGMENT_SECONDS;
            let len = (i + 1 < count).then_some(SEGMENT_SECONDS);
            (start, len)
        })
        .collect()
}

fn fingerprint(plan: Plan, s: EncodeSettings) -> String {
    format!(
        "v1 codec={} height={} video={}k audio={}k fps={} segment={}s\n",
        s.codec.label(), plan.height, plan.video_kbps, s.audio_kbps, s.fps, SEGMENT_SECONDS
    )
}

/// Reuses finished segments only if they were made with the same settings.
fn prepare_segment_dir(seg_dir: &Path, fingerprint: &str) -> Result<(), String> {
    let plan_file = seg_dir.join(PLAN_FILE);
    let same = std::fs::read_to_string(&plan_file).map(|s| s == fingerprint).unwrap_or(false);
    if seg_dir.exists() && !same {
        std::fs::remove_dir_all(seg_dir).map_err(|e| format!("无法清理旧的分段：{e}"))?;
    }
    std::fs::create_dir_all(seg_dir).map_err(|e| format!("无法创建临时文件夹：{e}"))?;
    std::fs::write(&plan_file, fingerprint).map_err(|e| format!("无法创建临时文件夹：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled_ffmpeg() -> PathBuf {
        let name = if cfg!(windows) {
            "binaries/ffmpeg-x86_64-pc-windows-msvc.exe"
        } else {
            "binaries/ffmpeg-aarch64-apple-darwin"
        };
        Path::new(env!("CARGO_MANIFEST_DIR")).join(name)
    }

    fn wait_until(mut cond: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
        while !cond() {
            assert!(std::time::Instant::now() < deadline, "timed out");
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }

    /// Real ffmpeg run: 11m40s source at a 6 MB limit (240p, near the floor) -> 2 segments, stop after the first, resume, join.
    /// Run with: cargo test -- --ignored end_to_end
    #[test]
    #[ignore]
    fn end_to_end_stop_resume_and_join() {
        let ffmpeg = bundled_ffmpeg();
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("课程 录像.mov");
        let status = std::process::Command::new(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=30",
                "-f", "lavfi", "-i", "sine=frequency=440", "-t", "700", "-c:v", "libx264", "-preset", "ultrafast",
                "-b:v", "1500k", "-c:a", "aac", "-shortest"])
            .arg(&src)
            .status()
            .unwrap();
        assert!(status.success());
        assert!(std::fs::metadata(&src).unwrap().len() > 6_000_000);

        let req = StartRequest {
            dir: tmp.path().to_string_lossy().into(),
            files: vec!["课程 录像.mov".into()],
            target_mb: 6,
            codec: Codec::X265,
            fps: 12,
            audio_k: 28,
            clean: true,
        };
        let jobs = Arc::new(JobManager::default());
        let seg_dir = tmp.path().join("_分段_课程 录像");

        jobs.start_with(ffmpeg.clone(), req.clone()).unwrap();
        assert!(jobs.start_with(ffmpeg.clone(), req.clone()).is_err(), "second start is refused");
        wait_until(|| seg_dir.join("seg_000.mp4").exists());
        jobs.stop();
        wait_until(|| !jobs.is_running());
        assert_eq!(jobs.snapshot().files[0].status, "cancelled");
        assert!(seg_dir.join("seg_000.mp4").exists(), "finished segment kept after stop");
        assert!(!seg_dir.join("seg_001.part").exists(), "partial segment removed");

        jobs.start_with(ffmpeg.clone(), req.clone()).unwrap();
        wait_until(|| !jobs.is_running());
        let snap = jobs.snapshot();
        assert_eq!(snap.files[0].status, "done", "log: {:?}", snap.log);
        let out = tmp.path().join("课程 录像_6MB.mp4");
        let size = std::fs::metadata(&out).unwrap().len();
        assert!(size <= 6_000_000, "output {size} bytes exceeds limit");
        let info = media::probe(&ffmpeg, &out).unwrap();
        assert!((info.duration - 700.0).abs() < 2.0, "duration {}", info.duration);
        assert_eq!(info.height, Some(240));
        assert!(!seg_dir.exists(), "temp segments cleaned");

        jobs.start_with(ffmpeg, req).unwrap();
        wait_until(|| !jobs.is_running());
        assert_eq!(jobs.snapshot().files[0].status, "skipped", "existing output is skipped");
    }

    #[test]
    fn short_video_is_one_segment() {
        assert_eq!(split_segments(95.0), vec![(0.0, None)]);
    }

    #[test]
    fn small_tail_merges_into_last_segment() {
        assert_eq!(split_segments(1210.0), vec![(0.0, Some(600.0)), (600.0, None)]);
    }

    #[test]
    fn long_tail_gets_its_own_segment() {
        assert_eq!(split_segments(1300.0), vec![(0.0, Some(600.0)), (600.0, Some(600.0)), (1200.0, None)]);
    }

    #[test]
    fn segment_dir_is_reset_when_settings_change() {
        let tmp = tempfile::tempdir().unwrap();
        let seg = tmp.path().join("_分段_a");
        prepare_segment_dir(&seg, "one").unwrap();
        std::fs::write(seg.join("seg_000.mp4"), b"x").unwrap();
        prepare_segment_dir(&seg, "one").unwrap();
        assert!(seg.join("seg_000.mp4").exists(), "same settings keep finished segments");
        prepare_segment_dir(&seg, "two").unwrap();
        assert!(!seg.join("seg_000.mp4").exists(), "new settings discard old segments");
    }

    #[test]
    fn validate_rejects_paths_and_bad_settings() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.mov"), b"x").unwrap();
        let ok = StartRequest {
            dir: tmp.path().to_string_lossy().into(),
            files: vec!["a.mov".into()],
            target_mb: 250,
            codec: Codec::X265,
            fps: 12,
            audio_k: 28,
            clean: true,
        };
        assert!(validate(&ok, tmp.path()).is_ok());
        let bad_name = StartRequest { files: vec!["../a.mov".into()], ..ok.clone() };
        assert!(validate(&bad_name, tmp.path()).is_err());
        let bad_target = StartRequest { target_mb: 1, ..ok.clone() };
        assert!(validate(&bad_target, tmp.path()).is_err());
        let none = StartRequest { files: vec![], ..ok };
        assert!(validate(&none, tmp.path()).is_err());
    }
}
