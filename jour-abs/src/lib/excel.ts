// ExcelJS is the vendored browser build loaded by index.html (public/vendor), shared with the tests.
type Workbook = {
  xlsx: {
    load(data: ArrayBuffer): Promise<unknown>
    writeBuffer(): Promise<ArrayBuffer>
  }
}

declare global {
  interface Window {
    ExcelJS?: { Workbook: new () => Workbook }
  }
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export async function readWorkbook(file: File): Promise<Workbook> {
  if (!window.ExcelJS) throw new Error("le moteur Excel n'est pas chargé")
  const workbook = new window.ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  return workbook
}

export async function workbookToBlob(workbook: Workbook): Promise<Blob> {
  return new Blob([await workbook.xlsx.writeBuffer()], { type: XLSX_MIME })
}

export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "string") return e
  if (e instanceof Error && e.message) return e.message
  return fallback
}
