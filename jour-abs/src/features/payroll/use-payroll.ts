import { useCallback, useRef, useState } from "react"

import { errorMessage, readWorkbook, workbookToBlob } from "@/lib/excel"
import { JourAbs, type MonthSummary, type ProcessResult } from "@/lib/jour-abs"

import { checkFileNames, pickMonths } from "./months"

export type ProcessedMonth = {
  fileName: string
  result: ProcessResult
  output: { blob: Blob; name: string }
}

export type PreviousMonth = { fileName: string; summary: MonthSummary }

export type PayrollState = {
  busy: boolean
  month: ProcessedMonth | null
  previous: PreviousMonth | null
  error: string | null
  previousError: string | null
}

const INITIAL: PayrollState = { busy: false, month: null, previous: null, error: null, previousError: null }

const outputName = (fileName: string) => fileName.replace(/\.xlsx$/i, "") + "_jour_abs.xlsx"

/**
 * Reads the dropped exports. Only the latest drop may update the screen (runId), so two quick
 * drops can never mix the results of different files.
 */
export function usePayroll() {
  const [state, setState] = useState<PayrollState>(INITIAL)
  const runId = useRef(0) // bumped by every openFiles
  const previousRunId = useRef(0) // bumped by every addPrevious

  const openFiles = useCallback(async (files: File[]) => {
    const problem = checkFileNames(files.map((f) => f.name))
    if (problem) {
      setState((s) => ({ ...s, error: problem }))
      return
    }
    const run = ++runId.current
    setState((s) => ({ ...s, busy: true, error: null, previousError: null }))
    try {
      const books = await Promise.all(
        files.map(async (file) => {
          const workbook = await readWorkbook(file)
          return { file, workbook, period: JourAbs.readSummary(workbook).period }
        })
      )
      const picked = pickMonths(books)
      if ("error" in picked) throw new Error(picked.error)
      const { current, previous } = picked
      const result = JourAbs.processWorkbook(current.workbook)
      const blob = await workbookToBlob(current.workbook)
      if (run !== runId.current) return
      setState({
        busy: false,
        error: null,
        previousError: null,
        month: {
          fileName: current.file.name,
          result,
          output: { blob, name: outputName(current.file.name) },
        },
        previous: previous
          ? { fileName: previous.file.name, summary: JourAbs.readSummary(previous.workbook) }
          : null,
      })
    } catch (e) {
      if (run !== runId.current) return
      setState((s) => ({ ...s, busy: false, error: errorMessage(e, "impossible de lire ce fichier") }))
    }
  }, [])

  const addPrevious = useCallback(
    async (files: File[]) => {
      const month = state.month
      if (!month || state.busy) return
      const problem = files.length === 1 ? checkFileNames([files[0].name]) : "Déposez un seul fichier : celui du mois précédent."
      if (problem) {
        setState((s) => ({ ...s, previousError: problem }))
        return
      }
      const run = runId.current
      const previousRun = ++previousRunId.current
      const stale = () => run !== runId.current || previousRun !== previousRunId.current
      try {
        const summary = JourAbs.readSummary(await readWorkbook(files[0]))
        if (stale()) return // a new month or a newer previous-month file was opened meanwhile
        if (summary.period.first >= month.result.period.first) {
          throw new Error("ce fichier n'est pas antérieur au mois traité.")
        }
        setState((s) => ({ ...s, previous: { fileName: files[0].name, summary }, previousError: null }))
      } catch (e) {
        if (stale()) return
        setState((s) => ({ ...s, previousError: "Impossible de comparer : " + errorMessage(e, "fichier illisible") }))
      }
    },
    [state.month, state.busy]
  )

  const clearPrevious = useCallback(() => {
    previousRunId.current += 1 // forget a previous-month file still being read
    setState((s) => ({ ...s, previous: null, previousError: null }))
  }, [])

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), [])

  return { state, openFiles, addPrevious, clearPrevious, dismissError }
}
