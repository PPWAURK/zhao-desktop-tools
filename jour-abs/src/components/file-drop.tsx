import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

const ACCEPT = ".xlsx"
const DROPZONE_ATTR = "data-dropzone"

const hasFiles = (e: { dataTransfer: DataTransfer | null }) =>
  Array.from(e.dataTransfer?.types ?? []).includes("Files")

/** Hidden file input + an `open()` to trigger it. */
export function useFilePicker(onFiles: (files: File[]) => void, multiple = false) {
  const inputRef = useRef<HTMLInputElement>(null)
  const open = useCallback(() => inputRef.current?.click(), [])
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      multiple={multiple}
      hidden
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? [])
        e.currentTarget.value = ""
        if (files.length) onFiles(files)
      }}
    />
  )
  return { input, open }
}

type DropZoneProps = {
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
  children: ReactNode
}

/** A region that accepts dropped files; it handles its own drops so the window handler ignores them. */
export function DropZone({ onFiles, disabled, className, children }: DropZoneProps) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e) || disabled) return
    depth.current += 1
    setOver(true)
  }
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }
  // No stopPropagation: the window handler must still see the drop to reset its drag state;
  // it skips files dropped inside a DropZone.
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    if (!disabled) onFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      {...{ [DROPZONE_ATTR]: "" }}
      data-over={over || undefined}
      aria-busy={disabled || undefined}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "rounded-xl border border-dashed border-input transition-colors duration-150",
        "data-over:border-primary data-over:bg-accent",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Accepts files dropped anywhere in the window (outside a DropZone) and stops the webview from
 * navigating to a dropped file. Returns where files are being dragged: over a DropZone, elsewhere
 * in the window, or null.
 */
export type WindowDrag = "zone" | "window" | null

export function useWindowFileDrop(onFiles: ((files: File[]) => void) | null): WindowDrag {
  const [drag, setDrag] = useState<WindowDrag>(null)

  useEffect(() => {
    let depth = 0
    const inZone = (e: Event) => e.target instanceof Element && !!e.target.closest(`[${DROPZONE_ATTR}]`)
    const enter = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return
      depth += 1
      setDrag(inZone(e) ? "zone" : "window")
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDrag(null)
    }
    const over = (e: globalThis.DragEvent) => {
      e.preventDefault()
      if (hasFiles(e)) setDrag(inZone(e) ? "zone" : "window")
    }
    const drop = (e: globalThis.DragEvent) => {
      e.preventDefault()
      depth = 0
      setDrag(null)
      if (onFiles && !inZone(e) && e.dataTransfer?.files.length) onFiles(Array.from(e.dataTransfer.files))
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragleave", leave)
    window.addEventListener("dragover", over)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("dragover", over)
      window.removeEventListener("drop", drop)
    }
  }, [onFiles])

  return drag
}
