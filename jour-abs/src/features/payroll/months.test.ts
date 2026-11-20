import { describe, expect, test } from "vitest"

import { checkFileNames, pickMonths } from "./months"

const month = (y: number, m: number) => ({
  period: { first: Date.UTC(y, m - 1, 1), last: Date.UTC(y, m, 0) },
})

describe("checkFileNames", () => {
  test("accepts one or two .xlsx files", () => {
    expect(checkFileNames(["oct.xlsx"])).toBeNull()
    expect(checkFileNames(["oct.XLSX", "sep.xlsx"])).toBeNull()
  })

  test("rejects no file, too many files and other formats", () => {
    expect(checkFileNames([])).toMatch(/xlsx/)
    expect(checkFileNames(["a.xlsx", "b.xlsx", "c.xlsx"])).toMatch(/deux fichiers/)
    expect(checkFileNames(["oct.xls"])).toMatch(/oct\.xls/)
  })
})

describe("pickMonths", () => {
  test("one file is the month to process, with no previous month", () => {
    const oct = month(2026, 10)
    expect(pickMonths([oct])).toEqual({ current: oct, previous: null })
  })

  test("two files: the later one is processed whatever the drop order", () => {
    const sep = month(2026, 9)
    const oct = month(2026, 10)
    expect(pickMonths([oct, sep])).toEqual({ current: oct, previous: sep })
    expect(pickMonths([sep, oct])).toEqual({ current: oct, previous: sep })
  })

  test("two files of the same month are refused", () => {
    expect(pickMonths([month(2026, 10), month(2026, 10)])).toEqual({
      error: "Les deux fichiers couvrent le même mois : déposez le mois à traiter et le mois précédent.",
    })
  })
})
