import type { DownloadEvent } from "@tauri-apps/plugin-updater"

export type DownloadProgress = { downloaded: number; total: number | null; finished: boolean }

export const START: DownloadProgress = { downloaded: 0, total: null, finished: false }

export function applyDownloadEvent(p: DownloadProgress, e: DownloadEvent): DownloadProgress {
  switch (e.event) {
    case "Started":
      return { ...p, total: e.data.contentLength ?? null }
    case "Progress":
      return { ...p, downloaded: p.downloaded + e.data.chunkLength }
    case "Finished":
      return { ...p, finished: true }
  }
}

/** 0–100, or null while the size is unknown. */
export function progressPercent(p: DownloadProgress): number | null {
  if (p.finished) return 100
  if (!p.total) return null
  return Math.min(100, Math.round((p.downloaded / p.total) * 100))
}
