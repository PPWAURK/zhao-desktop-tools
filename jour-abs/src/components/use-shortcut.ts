import { useEffect } from "react"

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || !!target.closest("input:not([type=file]), textarea, select"))

/** ⌘/Ctrl + key. Ignored while typing in a field, on key repeat, or if already handled. */
export function useShortcut(key: string, action: (() => void) | null) {
  useEffect(() => {
    if (!action) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== key) return
      if (e.repeat || e.defaultPrevented || isEditable(e.target)) return
      e.preventDefault()
      action()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [key, action])
}

export const MOD_KEY = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl"
