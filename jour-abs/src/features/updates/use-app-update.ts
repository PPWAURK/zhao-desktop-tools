import { useCallback, useEffect, useRef, useState } from "react"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"

import { isDesktop } from "@/lib/desktop"
import { errorMessage } from "@/lib/excel"

import { applyDownloadEvent, START, type DownloadProgress } from "./progress"

const CHECK_DELAY_MS = 3000

export type UpdateState =
  | { status: "none" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; progress: DownloadProgress }
  | { status: "restarting"; version: string }
  | { status: "failed"; version: string; message: string }

/** Checks GitHub for a newer signed version shortly after launch; installs it on request. */
export function useAppUpdate() {
  const [state, setState] = useState<UpdateState>({ status: "none" })
  const update = useRef<Update | null>(null)

  useEffect(() => {
    if (!isDesktop()) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const found = await check()
        if (cancelled || !found) return
        update.current = found
        setState({ status: "available", version: found.version })
      } catch (e) {
        // Offline or GitHub unreachable: try again at the next launch.
        console.warn("Update check failed:", errorMessage(e, "unknown error"))
      }
    }, CHECK_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const install = useCallback(async () => {
    const found = update.current
    if (!found) return
    const version = found.version
    let progress = START
    setState({ status: "downloading", version, progress })
    try {
      await found.downloadAndInstall((event) => {
        progress = applyDownloadEvent(progress, event)
        setState({ status: "downloading", version, progress })
      })
      setState({ status: "restarting", version })
      await relaunch()
    } catch (e) {
      setState({ status: "failed", version, message: errorMessage(e, "erreur inconnue") })
    }
  }, [])

  const dismiss = useCallback(() => setState({ status: "none" }), [])

  return { state, install, dismiss }
}
