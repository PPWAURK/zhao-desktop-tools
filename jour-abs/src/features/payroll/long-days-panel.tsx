import { CircleCheck, TriangleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DuplicateShift, LongDay } from "@/lib/jour-abs"

import { formatDay, formatHours, groupLongDays } from "./format"
import { RuleNotes } from "./rule-notes"

const RULES = [
  "Total des heures travaillées d'une même journée (colonne « Heures Travaillées », tous services cumulés), strictement supérieur à 9 h.",
  "Créneau planifié deux fois (les services se recouvrent sur au moins la moitié du plus court) : compté une seule fois, en gardant le service le plus court.",
  "Seuls les jours du 1er au dernier jour du mois sont comptés.",
]

function overlapHint(day: LongDay): string {
  return day.exportHours !== day.hours
    ? `Créneau en double compté une seule fois (l'export compte ${formatHours(day.exportHours)}).`
    : "Deux services se chevauchent en partie dans le planning : à vérifier."
}

function DayBadge({ day }: { day: LongDay }) {
  const label = `${formatDay(day.date)} · ${formatHours(day.hours)}`
  if (!day.overlap) {
    return (
      <Badge variant="outline" className="font-normal tabular-nums">
        {label}
      </Badge>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="warning" className="font-normal tabular-nums" tabIndex={0} aria-label={`${label}, chevauchement`}>
          <TriangleAlert data-icon="inline-start" aria-hidden />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{overlapHint(day)}</TooltipContent>
    </Tooltip>
  )
}

function DuplicateShifts({ shifts }: { shifts: DuplicateShift[] }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="duplicates-title">
      <div className="flex flex-col gap-0.5">
        <h2 id="duplicates-title" className="flex items-center gap-1.5 text-sm font-medium text-warning">
          <TriangleAlert className="size-4" aria-hidden />
          Créneaux planifiés deux fois
        </h2>
        <p className="text-sm text-muted-foreground">
          Le même créneau figure deux fois dans le planning. Ici, seul le service le plus court est compté ; l'export compte
          les deux. À corriger dans le planning.
        </p>
      </div>
      <div className="rounded-lg border border-warning/30 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-3">Employé</TableHead>
              <TableHead>Jour</TableHead>
              <TableHead>Service en double</TableHead>
              <TableHead className="w-28 text-right">Retenu</TableHead>
              <TableHead className="w-28 pr-3 text-right">Export</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.map((s) => (
              <TableRow key={`${s.name}-${s.date}-${s.start}-${s.poste}`}>
                <TableCell className="pl-3 font-medium">{s.name}</TableCell>
                <TableCell className="tabular-nums">{formatDay(s.date)}</TableCell>
                <TableCell>
                  {s.poste || "Service"} · {s.start}–{s.end}{" "}
                  <span className="text-muted-foreground tabular-nums">({formatHours(s.hours)})</span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatHours(s.dayHours)}</TableCell>
                <TableCell className="pr-3 text-right text-muted-foreground tabular-nums line-through decoration-muted-foreground/60">
                  {formatHours(s.exportHours)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

type Props = { longDays: LongDay[]; duplicateShifts: DuplicateShift[] }

export function LongDaysPanel({ longDays, duplicateShifts }: Props) {
  const groups = groupLongDays(longDays)
  const overlaps = longDays.filter((d) => d.overlap).length
  const duplicates = duplicateShifts.length > 0 ? <DuplicateShifts shifts={duplicateShifts} /> : null

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {duplicates}
        <Alert>
          <CircleCheck className="text-primary" />
          <AlertTitle>Aucune journée de plus de 9 h</AlertTitle>
          <AlertDescription>Personne ne dépasse 9 h de travail sur une journée ce mois-ci.</AlertDescription>
        </Alert>
        <RuleNotes items={RULES} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {duplicates}
      {overlaps > 0 ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>
            {overlaps === 1 ? "1 journée de plus de 9 h avec des services qui se chevauchent" : `${overlaps} journées de plus de 9 h avec des services qui se chevauchent`}
          </AlertTitle>
          <AlertDescription>Survolez les jours marqués d'un triangle pour le détail.</AlertDescription>
        </Alert>
      ) : null}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48 pl-3">Employé</TableHead>
              <TableHead className="w-20 text-right">Jours</TableHead>
              <TableHead className="w-24 text-right">Max</TableHead>
              <TableHead className="pr-3">Journées concernées</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.name} className="align-top">
                <TableCell className="pl-3 font-medium">{g.name}</TableCell>
                <TableCell className="text-right tabular-nums">{g.days.length}</TableCell>
                <TableCell className="text-right tabular-nums">{formatHours(g.maxHours)}</TableCell>
                <TableCell className="pr-3 whitespace-normal">
                  <div className="flex flex-wrap gap-1.5">
                    {g.days.map((d) => (
                      <DayBadge key={d.date} day={d} />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RuleNotes items={RULES} />
    </div>
  )
}
