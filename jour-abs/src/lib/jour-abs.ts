// Typed facade over the plain-JS calculation core (shared with the Node tests).
import core from "./jour-abs-core.js"

export type Period = { first: number; last: number }
export type PrimeEntry = { name: string; prime: number | null }
/** hours = worked, a double-booked slot counted once; exportHours = total as exported. */
export type LongDay = { name: string; date: number; hours: number; exportHours: number; overlap: boolean }
/** A shift set aside because the same slot was planned twice (the export still counts it). */
export type DuplicateShift = {
  name: string
  date: number
  poste: string
  start: string
  end: string
  hours: number
  dayHours: number
  exportHours: number
}
export type ReportRow = { name: string; systemDays: number | null; ruleDays: number }
export type MonthSummary = {
  period: Period
  employees: number
  primes: PrimeEntry[]
  longDays: LongDay[]
  duplicateShifts: DuplicateShift[]
}
export type ProcessResult = MonthSummary & { report: ReportRow[] }
export type PrimeIncrease = {
  name: string
  prime: number
  previous: number | null
  increase: number
}

type Core = {
  processWorkbook(workbook: unknown): ProcessResult
  readSummary(workbook: unknown): MonthSummary
  primeIncreases(current: PrimeEntry[], previous: PrimeEntry[]): PrimeIncrease[]
  unreadablePrimes(current: PrimeEntry[], previous: PrimeEntry[]): string[]
  isPreviousMonth(previous: Period, current: Period): boolean
  LONG_DAY_H: number
  PRIME_MIN_EUR: number
}

export const JourAbs = core as Core
