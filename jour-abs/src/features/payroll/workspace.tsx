import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import { formatMonth } from "./format"
import { LongDaysPanel } from "./long-days-panel"
import { PrimesPanel, primeFindings } from "./primes-panel"
import type { PreviousMonth, ProcessedMonth } from "./use-payroll"
import { WorkedDaysPanel, workedDayGaps } from "./worked-days-panel"

type Props = {
  month: ProcessedMonth
  previous: PreviousMonth | null
  previousError: string | null
  busy: boolean
  onAddPrevious: (files: File[]) => void
  onClearPrevious: () => void
}

function Count({ value }: { value: number | null }) {
  return (
    <Badge variant="secondary" className={cn("h-4.5 min-w-5 px-1.5 tabular-nums", value === 0 && "opacity-60")}>
      {value === null ? "—" : value}
    </Badge>
  )
}

export function Workspace({ month, previous, previousError, busy, onAddPrevious, onClearPrevious }: Props) {
  const [tab, setTab] = useState("jours")
  const { result } = month
  const gaps = workedDayGaps(result.report).length
  const primes = primeFindings(result.primes, previous)

  return (
    <div
      aria-busy={busy || undefined}
      inert={busy}
      className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 transition-opacity duration-200", busy && "pointer-events-none opacity-50")}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight capitalize">{formatMonth(result.period)}</h1>
        <p className="text-sm text-muted-foreground">
          {result.employees} employés · colonnes JOUR ABS ajoutées à l'onglet « Fiche employés » du fichier à enregistrer
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList variant="line" className="w-full justify-start gap-4 border-b px-0">
          <TabsTrigger value="jours" className="flex-none px-0">
            Jours travaillés <Count value={gaps} />
          </TabsTrigger>
          <TabsTrigger value="longues" className="flex-none px-0">
            Journées ≥ 9 h <Count value={result.longDays.length} />
          </TabsTrigger>
          <TabsTrigger value="primes" className="flex-none px-0">
            Primes <Count value={primes === null ? null : primes.length} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="jours">
          <WorkedDaysPanel report={result.report} />
        </TabsContent>
        <TabsContent value="longues">
          <LongDaysPanel longDays={result.longDays} duplicateShifts={result.duplicateShifts} />
        </TabsContent>
        <TabsContent value="primes">
          <PrimesPanel
            current={result}
            previous={previous}
            previousError={previousError}
            onAddPrevious={onAddPrevious}
            onClearPrevious={onClearPrevious}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
