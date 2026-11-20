// Native features when running inside the Tauri app, browser fallbacks otherwise.
import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { invoke, isTauri } from "@tauri-apps/api/core"

export const isDesktop = (): boolean => isTauri()

export type SaveOutcome = { kind: "saved"; path: string } | { kind: "downloaded" } | { kind: "cancelled" }

/** Desktop: native Save dialog. Browser: a regular download. */
export async function saveFile(blob: Blob, name: string): Promise<SaveOutcome> {
  if (!isDesktop()) {
    downloadInBrowser(blob, name)
    return { kind: "downloaded" }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const path = await invoke<string | null>("save_xlsx", bytes, {
    headers: { "x-file-name": encodeURIComponent(name) },
  })
  return path ? { kind: "saved", path } : { kind: "cancelled" }
}

/** Installed app version (null in the browser or while loading). */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (isDesktop()) getVersion().then(setVersion, () => setVersion(null))
  }, [])
  return version
}

export async function revealFile(path: string): Promise<void> {
  if (isDesktop()) await invoke("reveal_file", { path })
}

function downloadInBrowser(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
