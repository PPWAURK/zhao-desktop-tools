import { describe, expect, test } from "vitest"

import { formatDay, formatEuro, formatHours, formatMonth, groupLongDays } from "./format"

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

describe("French formatting", () => {
  test("formats hours with a decimal comma", () => {
    expect(formatHours(9.5)).toBe("9,5 h")
    expect(formatHours(10.25)).toBe("10,25 h")
    expect(formatHours(12)).toBe("12 h")
  })

  test("formats euros without forced decimals", () => {
    expect(formatEuro(350).replace(/\s/g, " ")).toBe("350 €")
    expect(formatEuro(1250.5).replace(/\s/g, " ")).toBe("1 250,5 €")
  })

  test("formats a day as short weekday and day/month", () => {
    expect(formatDay(utc(2026, 10, 12))).toBe("lun. 12/10")
    expect(formatDay(utc(2026, 10, 31))).toBe("sam. 31/10")
  })

  test("formats a period as its month name", () => {
    expect(formatMonth({ first: utc(2026, 10, 1), last: utc(2026, 10, 31) })).toBe("octobre 2026")
  })
})

describe("groupLongDays", () => {
  test("groups days per employee, most long days first, with the longest day", () => {
    const days = [
      { name: "Lea BERNARD", date: utc(2026, 10, 1), hours: 9.5, exportHours: 9.5, overlap: false },
      { name: "Paul MARTIN", date: utc(2026, 10, 2), hours: 11, exportHours: 11, overlap: false },
      { name: "Paul MARTIN", date: utc(2026, 10, 3), hours: 14, exportHours: 14, overlap: true },
    ]

    const groups = groupLongDays(days)

    expect(groups.map((g) => [g.name, g.days.length, g.maxHours, g.overlaps])).toEqual([
      ["Paul MARTIN", 2, 14, 1],
      ["Lea BERNARD", 1, 9.5, 0],
    ])
  })

  test("breaks ties alphabetically", () => {
    const d = (name: string) => ({ name, date: utc(2026, 10, 1), hours: 10, exportHours: 10, overlap: false })
    expect(groupLongDays([d("Zoe A"), d("Alex B")]).map((g) => g.name)).toEqual(["Alex B", "Zoe A"])
  })
})
