import { Download, Loader2, RotateCw, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { progressPercent } from "./progress"
import type { UpdateState } from "./use-app-update"

type Props = { state: UpdateState; onInstall: () => void; onDismiss: () => void }

/** Slim bar under the header; only visible when an update is available or installing. */
export function UpdateBanner({ state, onInstall, onDismiss }: Props) {
  if (state.status === "none") return null
  const failed = state.status === "failed"

  return (
    <div
      role="status"
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm",
        failed ? "bg-warning-surface text-warning" : "bg-accent text-accent-foreground"
      )}
    >
      {state.status === "available" ? (
        <>
          <Download className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="flex-1">
            Nouvelle version <span className="font-medium">{state.version}</span> disponible.
          </span>
          <Button size="sm" onClick={onInstall}>
            Mettre à jour
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Plus tard">
            <X />
          </Button>
        </>
      ) : null}

      {state.status === "downloading" ? <Downloading version={state.version} percent={progressPercent(state.progress)} /> : null}

      {state.status === "restarting" ? (
        <>
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          <span>Installation de la version {state.version}… l'application va redémarrer.</span>
        </>
      ) : null}

      {failed ? (
        <>
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">La mise à jour a échoué : {state.message}</span>
          <Button size="sm" variant="outline" onClick={onInstall}>
            <RotateCw data-icon="inline-start" aria-hidden />
            Réessayer
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Fermer">
            <X />
          </Button>
        </>
      ) : null}
    </div>
  )
}

function Downloading({ version, percent }: { version: string; percent: number | null }) {
  return (
    <>
      <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
      <span className="shrink-0">
        Téléchargement de la version {version}
        {percent === null ? "…" : ` · ${percent} %`}
      </span>
      <div
        className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-primary/15"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-label="Progression du téléchargement"
      >
        <div
          className={cn("h-full rounded-full bg-primary transition-[width] duration-200", percent === null && "w-1/3 animate-pulse")}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </>
  )
}
