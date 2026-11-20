import { Info } from "lucide-react"

/** How a panel's figures are computed, shown under its table. */
export function RuleNotes({ items }: { items: string[] }) {
  return (
    <div className="flex gap-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
