import { useEffect, useRef, useState } from "react"
import { CircleCheck, FileSpreadsheet, TriangleAlert, X } from "lucide-react"

import { DropZone, useFilePicker } from "@/components/file-drop"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { JourAbs, type PrimeEntry, type Period } from "@/lib/jour-abs"

import { formatEuro, formatMonth } from "./format"
import { RuleNotes } from "./rule-notes"
import type { PreviousMonth } from "./use-payroll"

const RULES = [
  "Colonne « Primes (€) » de la ligne Total de chaque employé.",
  "Signalée si la prime du mois est strictement supérieure à 250 € et à celle du mois précédent. Un employé absent du mois précédent compte pour 0 €.",
]

type Props = {
  current: { period: Period; primes: PrimeEntry[] }
  previous: PreviousMonth | null
  previousError: string | null
  onAddPrevious: (files: File[]) => void
  onClearPrevious: () => void
}

export const primeFindings = (current: PrimeEntry[], previous: PreviousMonth | null) =>
  previous ? JourAbs.primeIncreases(current, previous.summary.primes) : null

type AddPreviousProps = { onFiles: (files: File[]) => void; error: string | null; focusOnMount: boolean }

function AddPrevious({ onFiles, error, focusOnMount }: AddPreviousProps) {
  const picker = useFilePicker(onFiles)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // After "Changer de mois précédent" the focused button disappears; keep keyboard focus nearby.
  useEffect(() => {
    if (focusOnMount) buttonRef.current?.focus()
  }, [focusOnMount])
  return (
    <div className="flex flex-col gap-3">
      <DropZone onFiles={onFiles}>
        <div className="flex flex-col items-start gap-3 px-5 py-6 sm:flex-row sm:items-center">
          <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">Ajoutez l'export du mois précédent</span>
            <span className="text-sm text-muted-foreground">
              Glissez le fichier ici pour comparer les primes avec le mois traité.
            </span>
          </div>
          <Button ref={buttonRef} variant="outline" onClick={picker.open}>
            Choisir le fichier
          </Button>
          {picker.input}
        </div>
      </DropZone>
      {error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

export function PrimesPanel({ current, previous, previousError, onAddPrevious, onClearPrevious }: Props) {
  const [cleared, setCleared] = useState(false)
  const clear = () => {
    setCleared(true)
    onClearPrevious()
  }

  if (!previous) {
    return (
      <div className="flex flex-col gap-5">
        <AddPrevious onFiles={onAddPrevious} error={previousError} focusOnMount={cleared} />
        <RuleNotes items={RULES} />
      </div>
    )
  }

  const rows = JourAbs.primeIncreases(current.primes, previous.summary.primes)
  const unreadable = JourAbs.unreadablePrimes(current.primes, previous.summary.primes)
  const consecutive = JourAbs.isPreviousMonth(previous.summary.period, current.period)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground capitalize">{formatMonth(current.period)}</span> comparé à{" "}
          <span className="font-medium text-foreground">{formatMonth(previous.summary.period)}</span>
          <span className="hidden sm:inline"> · {previous.fileName}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={clear}>
          <X data-icon="inline-start" aria-hidden />
          Changer de mois précédent
        </Button>
      </div>

      {!consecutive ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Ce n'est pas le mois juste avant</AlertTitle>
          <AlertDescription>La comparaison porte sur {formatMonth(previous.summary.period)}.</AlertDescription>
        </Alert>
      ) : null}
      {unreadable.length > 0 ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Prime illisible, non comparée</AlertTitle>
          <AlertDescription>{unreadable.join(", ")}</AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <Alert>
          <CircleCheck className="text-primary" />
          <AlertTitle>Aucune prime à signaler</AlertTitle>
          <AlertDescription>Aucune prime supérieure à 250 € n'est en hausse par rapport au mois précédent.</AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Employé</TableHead>
                <TableHead className="w-36 text-right">Mois précédent</TableHead>
                <TableHead className="w-36 text-right">Prime du mois</TableHead>
                <TableHead className="w-32 pr-3 text-right">Hausse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="pl-3 font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.previous === null ? <Badge variant="outline">Absent</Badge> : formatEuro(r.previous)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatEuro(r.prime)}</TableCell>
                  <TableCell className="pr-3 text-right font-medium text-primary tabular-nums">
                    +{formatEuro(r.increase)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <RuleNotes items={RULES} />
    </div>
  )
}
