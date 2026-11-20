//! Everything that talks to ffmpeg: locating it, probing files, building
//! encode arguments, and running it with progress reporting.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use regex::Regex;

use crate::plan::{Codec, Plan};
use crate::platform;

const STDERR_TAIL_LINES: usize = 12;
/// VBV buffer = this many seconds of the target video bitrate.
const VBV_BUFFER_FACTOR: u32 = 2;

/// The bundled sidecar sits next to the app executable
/// (macOS: Contents/MacOS/ffmpeg, Windows: <install dir>\ffmpeg.exe).
pub fn find_ffmpeg() -> Result<PathBuf, String> {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(platform::FFMPEG_FILE)));
    bundled
        .into_iter()
        .chain(platform::FALLBACK_FFMPEG.iter().map(PathBuf::from))
        .find(|p| p.is_file())
        .ok_or_else(|| "找不到压缩引擎 ffmpeg，请重新安装本程序".to_string())
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProbeInfo {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
}

fn duration_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)").expect("valid regex"))
}

fn video_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"Stream #\d+:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})").expect("valid regex")
    })
}

/// Parses the banner `ffmpeg -i <file>` prints to stderr.
pub fn parse_probe(stderr: &str) -> Option<ProbeInfo> {
    let d = duration_re().captures(stderr)?;
    let h: f64 = d[1].parse().ok()?;
    let m: f64 = d[2].parse().ok()?;
    let s: f64 = d[3].parse().ok()?;
    let duration = h * 3600.0 + m * 60.0 + s;
    let video = video_re().captures(stderr);
    Some(ProbeInfo {
        duration,
        codec: video.as_ref().map(|c| c[1].to_string()),
        width: video.as_ref().and_then(|c| c[2].parse().ok()),
        height: video.as_ref().and_then(|c| c[3].parse().ok()),
    })
}

pub fn probe(ffmpeg: &Path, input: &Path) -> Result<ProbeInfo, String> {
    // ffmpeg exits non-zero without an output file; the banner is still complete.
    let out = platform::command(ffmpeg)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(input)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("无法启动 ffmpeg：{e}"))?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    match parse_probe(&stderr) {
        Some(info) if info.duration > 0.0 => Ok(info),
        _ => Err("无法读取视频信息".to_string()),
    }
}

/// Caps the short side at `height` (never upscales) and sets the frame rate.
pub fn scale_filter(height: u32, fps: u32) -> String {
    format!(
        "scale=w='if(gt(iw,ih),-2,min({height},iw))':h='if(gt(iw,ih),min({height},ih),-2)',fps={fps}"
    )
}

#[derive(Debug, Clone, Copy)]
pub struct EncodeSettings {
    pub codec: Codec,
    pub fps: u32,
    pub audio_kbps: u32,
}

pub fn encode_args(
    input: &Path,
    output: &Path,
    start_s: f64,
    length_s: Option<f64>,
    plan: Plan,
    s: EncodeSettings,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(), "-nostdin".into(), "-y".into(), "-loglevel".into(), "error".into(),
        "-ss".into(), format!("{start_s:.3}"),
        "-i".into(), input.to_string_lossy().into_owned(),
    ];
    if let Some(len) = length_s {
        args.extend(["-t".into(), format!("{len:.3}")]);
    }
    args.extend([
        "-map".into(), "0:v:0".into(), "-map".into(), "0:a:0?".into(),
        "-vf".into(), scale_filter(plan.height, s.fps),
        "-c:v".into(), s.codec.encoder().into(), "-preset".into(), "medium".into(),
        // Average bitrate alone overshoots at low rates; VBV caps peaks so the size limit holds.
        "-b:v".into(), format!("{}k", plan.video_kbps),
        "-maxrate".into(), format!("{}k", plan.video_kbps),
        "-bufsize".into(), format!("{}k", plan.video_kbps * VBV_BUFFER_FACTOR),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);
    if s.codec == Codec::X265 {
        args.extend(["-x265-params".into(), "log-level=error".into(), "-tag:v".into(), "hvc1".into()]);
    }
    args.extend([
        "-c:a".into(), "aac".into(), "-b:a".into(), format!("{}k", s.audio_kbps), "-ac".into(), "1".into(),
        "-f".into(), "mp4".into(), "-progress".into(), "pipe:1".into(), "-nostats".into(),
        output.to_string_lossy().into_owned(),
    ]);
    args
}

pub fn concat_args(list: &Path, output: &Path, codec: Codec) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(), "-nostdin".into(), "-y".into(), "-loglevel".into(), "error".into(),
        "-f".into(), "concat".into(), "-safe".into(), "0".into(),
        "-i".into(), list.to_string_lossy().into_owned(),
        "-map".into(), "0".into(), "-c".into(), "copy".into(), "-movflags".into(), "+faststart".into(),
    ];
    if codec == Codec::X265 {
        args.extend(["-tag:v".into(), "hvc1".into()]);
    }
    args.extend(["-f".into(), "mp4".into(), output.to_string_lossy().into_owned()]);
    args
}

#[derive(Debug, PartialEq)]
pub enum RunError {
    Cancelled,
    Failed(String),
}

/// Shared handle so another thread can stop the running ffmpeg.
#[derive(Default)]
pub struct Runner {
    cancel: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl Runner {
    pub fn reset(&self) {
        self.cancel.store(false, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    pub fn stop(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = self.child.lock() {
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
            }
        }
    }

    /// Runs ffmpeg, calling `on_progress(seconds_done, speed)` from `-progress pipe:1` output.
    /// `cwd` lets callers pass short relative paths (see the concat step).
    pub fn run(
        &self,
        ffmpeg: &Path,
        args: &[String],
        cwd: Option<&Path>,
        mut on_progress: impl FnMut(f64, Option<&str>),
    ) -> Result<(), RunError> {
        if self.is_cancelled() {
            return Err(RunError::Cancelled);
        }
        let mut cmd = platform::command(ffmpeg);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        let mut child = cmd
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| RunError::Failed(format!("无法启动 ffmpeg：{e}")))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        self.store_child(child);
        if self.is_cancelled() {
            self.stop();
        }

        let stderr_thread = std::thread::spawn(move || read_tail(stderr));
        if let Some(out) = stdout {
            read_progress(out, &mut on_progress);
        }
        let status = self.wait_child();
        let tail = stderr_thread.join().unwrap_or_default();

        if self.is_cancelled() {
            return Err(RunError::Cancelled);
        }
        match status {
            Some(s) if s.success() => Ok(()),
            Some(s) => Err(RunError::Failed(
                tail.last().cloned().unwrap_or_else(|| format!("ffmpeg 退出码 {}", s.code().unwrap_or(-1))),
            )),
            None => Err(RunError::Failed("ffmpeg 异常结束".into())),
        }
    }

    fn store_child(&self, child: Child) {
        if let Ok(mut slot) = self.child.lock() {
            *slot = Some(child);
        }
    }

    fn wait_child(&self) -> Option<std::process::ExitStatus> {
        let child = self.child.lock().ok().and_then(|mut slot| slot.take());
        child.and_then(|mut c| c.wait().ok())
    }
}

fn read_progress(out: impl Read, on_progress: &mut impl FnMut(f64, Option<&str>)) {
    let mut speed: Option<String> = None;
    for line in BufReader::new(out).lines().map_while(Result::ok) {
        if let Some(v) = line.strip_prefix("speed=") {
            let v = v.trim();
            speed = (v != "N/A").then(|| v.to_string());
        } else if let Some(v) = line.strip_prefix("out_time_us=") {
            if let Ok(us) = v.trim().parse::<i64>() {
                on_progress(us.max(0) as f64 / 1_000_000.0, speed.as_deref());
            }
        }
    }
}

fn read_tail(stderr: Option<impl Read>) -> Vec<String> {
    let Some(err) = stderr else { return Vec::new() };
    let mut tail: Vec<String> = Vec::new();
    for line in BufReader::new(err).lines().map_while(Result::ok) {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        tail.push(line);
        if tail.len() > STDERR_TAIL_LINES {
            tail.remove(0);
        }
    }
    tail
}

#[cfg(test)]
mod tests {
    use super::*;

    const BANNER: &str = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':\n  Duration: 01:02:03.50, start: 0.000000, bitrate: 5000 kb/s\n    Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 3840x2160 [SAR 1:1 DAR 16:9], 4800 kb/s, 30 fps\n    Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s\n";

    #[test]
    fn parses_duration_resolution_and_codec() {
        let info = parse_probe(BANNER).unwrap();
        assert!((info.duration - 3723.5).abs() < 1e-6);
        assert_eq!(info.width, Some(3840));
        assert_eq!(info.height, Some(2160));
        assert_eq!(info.codec.as_deref(), Some("h264"));
    }

    #[test]
    fn missing_duration_is_none() {
        assert_eq!(parse_probe("a.mp4: Invalid data found when processing input"), None);
    }

    #[test]
    fn x265_args_include_hvc1_tag_and_length() {
        let plan = Plan { height: 720, video_kbps: 900 };
        let s = EncodeSettings { codec: Codec::X265, fps: 12, audio_kbps: 28 };
        let args = encode_args(Path::new("/in.mov"), Path::new("/out.mp4"), 600.0, Some(600.0), plan, s);
        let joined = args.join(" ");
        assert!(joined.contains("-ss 600.000 -i /in.mov -t 600.000"));
        assert!(joined.contains("-c:v libx265"));
        assert!(joined.contains("-b:v 900k -maxrate 900k -bufsize 1800k"));
        assert!(joined.contains("-tag:v hvc1"));
        assert!(joined.contains("min(720,ih)"));
        assert!(joined.contains("fps=12"));
        assert!(joined.contains("-b:a 28k -ac 1"));
    }

    #[test]
    fn last_segment_has_no_length_and_x264_has_no_hvc1() {
        let plan = Plan { height: 480, video_kbps: 500 };
        let s = EncodeSettings { codec: Codec::X264, fps: 15, audio_kbps: 48 };
        let args = encode_args(Path::new("/in.mov"), Path::new("/o.mp4"), 0.0, None, plan, s);
        assert!(!args.contains(&"-t".to_string()));
        assert!(!args.contains(&"hvc1".to_string()));
        assert!(args.contains(&"libx264".to_string()));
    }
}
