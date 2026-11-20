# Tauri apps

Two desktop apps (Tauri 2) for macOS (Apple Silicon) and Windows (x64).

| App | Folder | What it does |
|-----|--------|--------------|
| Calcul JOUR ABS | `jour-abs/` | Drop the monthly Excel export; adds the JOUR ABS columns to « Fiche employés » and saves a copy via a native Save dialog. Logic is unchanged from `Calcul_JOUR_ABS.html`. |
| 视频压缩工具 | `video-compressor/` | Batch-compresses every video in a folder to a size limit (default 250 MB). Rust backend + bundled ffmpeg; encodes in 10-minute segments so a stopped job resumes; keeps the Mac awake while running. |

## Download builds

Every push to `main` runs **Actions → Build** on GitHub: it runs the Rust tests (including a real
ffmpeg stop/resume run on both OSes) and builds installers. Download them from the run's
**Artifacts** section:

- `*-Windows` → `…-setup.exe` (NSIS installer, installs for the current user, no admin needed)
- `*-macOS` → `.dmg`

## Build locally

```bash
cd jour-abs            # or video-compressor
pnpm install
pnpm tauri build       # → src-tauri/target/release/bundle/{macos/*.app,dmg/*.dmg}
pnpm tauri dev         # run with live reload
```

## Test

```bash
cd video-compressor/src-tauri
cargo test                         # unit tests
cargo test -- --ignored end_to_end # real ffmpeg: stop, resume, join, size limit (~20 s)
```

Notes
- The video page's `plan()` and `src-tauri/src/plan.rs` must stay in sync (tiers, 0.95 safety, 6 kbps MP4 overhead).
- Bundles are ad-hoc signed (`signingIdentity: "-"`). On another Mac, the first open needs right-click → Open (or System Settings → Privacy & Security → Open Anyway).
- Bundled ffmpeg: `binaries/ffmpeg-aarch64-apple-darwin` (macOS) and `binaries/ffmpeg-x86_64-pc-windows-msvc.exe` (Windows), taken from the original tool's packages. ffmpeg is GPL — keep this repo private or add the GPL notice before sharing it.
- Windows-specific settings live in `src-tauri/tauri.windows.conf.json`; OS helpers (no console windows, keep-awake, Explorer) in `video-compressor/src-tauri/src/platform.rs`.
- Windows installers are unsigned: SmartScreen shows « Windows a protégé votre ordinateur » → « Informations complémentaires » → « Exécuter quand même ».
