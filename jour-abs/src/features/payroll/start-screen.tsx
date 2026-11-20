import { CalendarCheck2, Clock4, FileSpreadsheet, Loader2, TrendingUp } from "lucide-react"

import { DropZone } from "@/components/file-drop"
import { MOD_KEY } from "@/components/use-shortcut"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"

const CHECKS = [
  {
    icon: CalendarCheck2,
    title: "JOUR ABS",
    text: "Colonnes JOUR ABS ajoutées à « Fiche employés », écarts de jours travaillés signalés.",
  },
  {
    icon: Clock4,
    title: "Journées de plus de 9 h",
    text: "Tous services cumulés, avec les créneaux qui se chevauchent dans le planning.",
  },
  {
    icon: TrendingUp,
    title: "Primes en hausse",
    text: "Primes supérieures à 250 € et plus élevées que le mois précédent.",
  },
]

type Props = { busy: boolean; onFiles: (files: File[]) => void; onBrowse: () => void }

export function StartScreen({ busy, onFiles, onBrowse }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:py-16">
      <DropZone onFiles={onFiles} disabled={busy} className="bg-card">
        <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary">
            <FileSpreadsheet className="size-6" aria-hidden />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight">Déposez l'export mensuel</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Glissez le fichier Excel du mois ici. Ajoutez aussi celui du mois précédent pour comparer les primes.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="lg" onClick={onBrowse} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              {busy ? "Lecture du fichier…" : "Choisir des fichiers"}
            </Button>
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              <Kbd>{MOD_KEY}</Kbd>
              <Kbd>O</Kbd>
            </span>
          </div>
        </div>
      </DropZone>

      <ul className="grid gap-5 sm:grid-cols-3" aria-label="Ce que l'outil vérifie">
        {CHECKS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{text}</span>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-muted-foreground">
        Les fichiers sont traités sur cet ordinateur ; rien n'est envoyé sur internet. Le fichier d'origine n'est jamais modifié.
      </p>
    </div>
  )
}
