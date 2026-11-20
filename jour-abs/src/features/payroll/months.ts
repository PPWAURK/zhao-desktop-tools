import type { Period } from "@/lib/jour-abs"

const MAX_FILES = 2

/** Returns a user-facing problem with the chosen files, or null when they can be read. */
export function checkFileNames(names: string[]): string | null {
  if (names.length === 0) return "Choisissez un fichier Excel au format .xlsx."
  if (names.length > MAX_FILES) {
    return "Déposez au plus deux fichiers : le mois à traiter et le mois précédent."
  }
  const wrong = names.find((n) => !/\.xlsx$/i.test(n))
  return wrong ? `« ${wrong} » n'est pas un fichier Excel .xlsx.` : null
}

type WithPeriod = { period: Period }

/** The later month is processed; with two files, the earlier one gives last month's primes. */
export function pickMonths<T extends WithPeriod>(
  months: T[]
): { current: T; previous: T | null } | { error: string } {
  const sorted = [...months].sort((a, b) => a.period.first - b.period.first)
  if (sorted.length === 2 && sorted[0].period.first === sorted[1].period.first) {
    return {
      error: "Les deux fichiers couvrent le même mois : déposez le mois à traiter et le mois précédent.",
    }
  }
  return { current: sorted[sorted.length - 1], previous: sorted.length === 2 ? sorted[0] : null }
}
