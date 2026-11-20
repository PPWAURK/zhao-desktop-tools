import { describe, expect, test } from "vitest"

import { applyDownloadEvent, progressPercent, START } from "./progress"

describe("download progress", () => {
  test("adds chunks to the announced total", () => {
    let p = applyDownloadEvent(START, { event: "Started", data: { contentLength: 1000 } })
    p = applyDownloadEvent(p, { event: "Progress", data: { chunkLength: 250 } })
    p = applyDownloadEvent(p, { event: "Progress", data: { chunkLength: 250 } })

    expect(p).toEqual({ downloaded: 500, total: 1000, finished: false })
    expect(progressPercent(p)).toBe(50)
  })

  test("has no percentage when the size is unknown", () => {
    const p = applyDownloadEvent(START, { event: "Started", data: {} })

    expect(progressPercent(applyDownloadEvent(p, { event: "Progress", data: { chunkLength: 10 } }))).toBeNull()
  })

  test("is complete when finished, never above 100", () => {
    let p = applyDownloadEvent(START, { event: "Started", data: { contentLength: 100 } })
    p = applyDownloadEvent(p, { event: "Progress", data: { chunkLength: 150 } })
    expect(progressPercent(p)).toBe(100)

    const done = applyDownloadEvent(START, { event: "Finished" })
    expect(done.finished).toBe(true)
    expect(progressPercent(done)).toBe(100)
  })

  test("does not change the previous state", () => {
    const before = applyDownloadEvent(START, { event: "Started", data: { contentLength: 10 } })
    applyDownloadEvent(before, { event: "Progress", data: { chunkLength: 5 } })

    expect(before.downloaded).toBe(0)
  })
})
