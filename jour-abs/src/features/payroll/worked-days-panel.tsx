import { CircleCheck } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ReportRow } from "@/lib/jour-abs"

import { formatNumber } from "./format"
import { RuleNotes } from "./rule-notes"

export const workedDayGaps = (report: ReportRow[]) => report.filter((r) => r.systemDays !== r.ruleDays)

const RULES = [
  "Heures d'une journée : 5 h ou plus = 1 jour ; plus de 2 h et moins de 5 h = 0,5 jour ; 2 h ou moins = 0 jour.",
  "JOUR ABS d'une semaine = 5 − jours convertis de la semaine entière (y compris les jours du mois voisin).",
  "Semaine à cheval sur deux mois : comptée une seule fois, dans le mois qui en a 4 jours ou plus.",
  "Non calculé : « Aucun contrat », contrat de moins de 35 h (hors Extra), personne sans heure travaillée. Arrivées, départs et longues absences : à vérifier à la main.",
]

export function WorkedDaysPanel({ report }: { report: ReportRow[] }) {
  const gaps = workedDayGaps(report)
  return (
    <div className="flex flex-col gap-5">
      {gaps.length === 0 ? (
        <Alert>
          <CircleCheck className="text-primary" />
          <AlertTitle>Jours travaillés conformes</AlertTitle>
          <AlertDescription>Pour tous les employés, le décompte du système correspond à la règle.</AlertDescription>
        </Alert>
      ) : (
        <section className="flex flex-col gap-2" aria-labelledby="gaps-title">
          <div className="flex flex-col gap-0.5">
            <h2 id="gaps-title" className="text-sm font-medium">
              Jours travaillés à vérifier
            </h2>
            <p className="text-sm text-muted-foreground">
              Le décompte du système diffère de la règle. À titre d'information : aucun chiffre n'est modifié dans le fichier.
            </p>
          </div>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">Employé</TableHead>
                  <TableHead className="w-32 text-right">Système</TableHead>
                  <TableHead className="w-32 text-right">Selon la règle</TableHead>
                  <TableHead className="w-28 pr-3 text-right">Écart</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gaps.map((r) => {
                  const diff = typeof r.systemDays === "number" ? r.ruleDays - r.systemDays : null
                  return (
                    <TableRow key={r.name}>
                      <TableCell className="pl-3 font-medium">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.systemDays === null ? "—" : formatNumber(r.systemDays)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.ruleDays)}</TableCell>
                      <TableCell className="pr-3 text-right text-muted-foreground tabular-nums">
                        {diff === null ? "—" : (diff > 0 ? "+" : "") + formatNumber(diff)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
      <RuleNotes items={RULES} />
    </div>
  )
}
