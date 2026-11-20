import { useCallback, useRef, useState } from "react"
import { Download, FileSpreadsheet, FolderOpen, Loader2, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"

import { useFilePicker, useWindowFileDrop } from "@/components/file-drop"
import { MOD_KEY, useShortcut } from "@/components/use-shortcut"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { revealFile, saveFile } from "@/lib/desktop"
import { errorMessage } from "@/lib/excel"
import { StartScreen } from "@/features/payroll/start-screen"
import { UpdateBanner } from "@/features/updates/update-banner"
import { useAppUpdate } from "@/features/updates/use-app-update"
import { usePayroll } from "@/features/payroll/use-payroll"
import { Workspace } from "@/features/payroll/workspace"

export default function App() {
  const { state, openFiles, addPrevious, clearPrevious, dismissError } = usePayroll()
  const { month, busy } = state
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false) // blocks a second save before the re-render lands
  const picker = useFilePicker(openFiles, true)
  const appUpdate = useAppUpdate()
  const drag = useWindowFileDrop(busy ? null : openFiles)

  const save = useCallback(async () => {
    if (!month || busy || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const outcome = await saveFile(month.output.blob, month.output.name)
      if (outcome.kind === "saved") {
        const { path } = outcome
        toast.success("Fichier enregistré", {
          description: path,
          action: {
            label: "Afficher",
            onClick: () =>
              revealFile(path).catch((e) =>
                toast.error("Impossible d'afficher le fichier", { description: errorMessage(e, "fichier introuvable") })
              ),
          },
        })
      } else if (outcome.kind === "downloaded") {
        toast.success("Téléchargement lancé", { description: month.output.name })
      }
    } catch (e) {
      toast.error("Échec de l'enregistrement", { description: errorMessage(e, "erreur inconnue") })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [month, busy])

  useShortcut("o", busy ? null : picker.open)
  useShortcut("s", month ? save : null)

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar px-4">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="size-7 rounded-lg ring-1 ring-border" />
          <span className="text-sm font-semibold tracking-tight">Super Xiaona</span>
        </div>
        {month ? (
          <>
            <Separator orientation="vertical" className="h-5!" />
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
              <span className="truncate" data-selectable>
                {month.fileName}
              </span>
            </span>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {busy && month ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Lecture…
            </span>
          ) : null}
          {month ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" onClick={picker.open} disabled={busy}>
                    <FolderOpen data-icon="inline-start" aria-hidden />
                    Ouvrir
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ouvrir un autre mois ({MOD_KEY} O)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={save} disabled={busy || saving}>
                    {saving ? (
                      <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />
                    ) : (
                      <Download data-icon="inline-start" aria-hidden />
                    )}
                    Enregistrer
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Enregistrer le fichier avec JOUR ABS ({MOD_KEY} S)</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
        {picker.input}
      </header>
      <UpdateBanner state={appUpdate.state} onInstall={appUpdate.install} onDismiss={appUpdate.dismiss} />

      <main className="flex flex-1 flex-col">
        {state.error ? (
          <div className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6">
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Impossible de traiter le fichier</AlertTitle>
              <AlertDescription>{state.error}</AlertDescription>
              <AlertAction>
                <Button variant="ghost" size="icon-sm" onClick={dismissError} aria-label="Fermer">
                  <X />
                </Button>
              </AlertAction>
            </Alert>
          </div>
        ) : null}

        {month ? (
          <Workspace
            month={month}
            previous={state.previous}
            previousError={state.previousError}
            busy={busy}
            onAddPrevious={addPrevious}
            onClearPrevious={clearPrevious}
          />
        ) : (
          <StartScreen busy={busy} onFiles={openFiles} onBrowse={picker.open} />
        )}
      </main>

      {month && drag === "window" ? (
        <div className="pointer-events-none fixed inset-2 z-30 flex items-start justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 pt-16 animate-in fade-in-0 duration-150">
          <span className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm">
            Relâchez pour ouvrir ces fichiers
          </span>
        </div>
      ) : null}

      <Toaster position="bottom-right" />
    </div>
  )
}
