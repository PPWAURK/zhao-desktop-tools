//! Small OS-specific helpers (macOS and Windows).

use std::path::{Path, PathBuf};
use std::process::Command;

/// File name of the bundled ffmpeg sidecar next to the app executable.
#[cfg(windows)]
pub const FFMPEG_FILE: &str = "ffmpeg.exe";
#[cfg(not(windows))]
pub const FFMPEG_FILE: &str = "ffmpeg";

/// Extra places to look when the sidecar is missing (development machines).
#[cfg(windows)]
pub const FALLBACK_FFMPEG: [&str; 0] = [];
#[cfg(not(windows))]
pub const FALLBACK_FFMPEG: [&str; 2] = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"];

/// Builds a command that never opens a console window on Windows.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Opens a folder in Finder / File Explorer.
pub fn reveal_folder(dir: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(not(windows))]
    let program = "open";
    // explorer.exe returns exit code 1 even on success, so only spawning is checked.
    Command::new(program).arg(dir).spawn().map(|_| ())
}

/// Keeps the computer from idle-sleeping while alive. Create and drop it on the
/// same thread (required by Windows' SetThreadExecutionState).
pub struct KeepAwake {
    #[cfg(not(windows))]
    child: Option<std::process::Child>,
}

impl KeepAwake {
    #[cfg(not(windows))]
    pub fn start() -> Self {
        let child = Command::new("/usr/bin/caffeinate")
            .args(["-i", "-w", &std::process::id().to_string()])
            .spawn()
            .ok();
        KeepAwake { child }
    }

    #[cfg(windows)]
    pub fn start() -> Self {
        use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
        // SAFETY: plain Win32 call with constant flags; no pointers involved.
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        KeepAwake {}
    }
}

impl Drop for KeepAwake {
    #[cfg(not(windows))]
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    #[cfg(windows)]
    fn drop(&mut self) {
        use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS};
        // SAFETY: see `start`; restores the default sleep behaviour.
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    }
}
