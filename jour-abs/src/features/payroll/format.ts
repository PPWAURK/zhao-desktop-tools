import type { LongDay, Period } from "@/lib/jour-abs"

const LOCALE = "fr-FR"
const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 })
const euroFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" })
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" })

const pad = (n: number) => String(n).padStart(2, "0")

export function formatNumber(n: number): string {
  return numberFormat.format(n)
}

export function formatHours(n: number): string {
  return `${formatNumber(n)} h`
}

export function formatEuro(n: number): string {
  return euroFormat.format(n)
}

/** "lun. 12/10" (dates from the core are UTC midnights). */
export function formatDay(ms: number): string {
  const d = new Date(ms)
  return `${weekdayFormat.format(d)} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`
}

/** "octobre 2026" */
export function formatMonth(period: Period): string {
  return monthFormat.format(new Date(period.first))
}

export type LongDayGroup = {
  name: string
  days: LongDay[]
  maxHours: number
  overlaps: number
}

/** One group per employee, most long days first, ties by name. */
export function groupLongDays(longDays: LongDay[]): LongDayGroup[] {
  const byName = new Map<string, LongDay[]>()
  for (const day of longDays) {
    byName.set(day.name, [...(byName.get(day.name) ?? []), day])
  }
  return [...byName.entries()]
    .map(([name, days]) => ({
      name,
      days,
      maxHours: Math.max(...days.map((d) => d.hours)),
      overlaps: days.filter((d) => d.overlap).length,
    }))
    .sort((a, b) => b.days.length - a.days.length || a.name.localeCompare(b.name, LOCALE))
}
