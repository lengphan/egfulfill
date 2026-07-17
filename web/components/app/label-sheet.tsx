"use client"

import { useState } from "react"
import { Printer, Minus, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Barcode } from "@/components/app/barcode"

export type LabelSpec = { sku: string; name?: string | null; variant?: string | null; copies?: number }

/**
 * The ONE printable barcode sheet. Inventory prints selected variants; the Orders
 * hub prints the blanks a specific order needs. Both land here so a label looks
 * identical wherever it came from — and so the print CSS lives in one place.
 *
 * `copies` is per label: a variant needing 12 pieces prints 12 identical barcodes,
 * which is what actually happens on the floor.
 */
export function LabelSheet({
  labels,
  open,
  onClose,
  title = "labels",
}: {
  labels: LabelSpec[]
  open: boolean
  onClose: () => void
  title?: string
}) {
  // Global multiplier on top of each label's own `copies` — for "print the whole
  // sheet twice" without editing every row.
  const [multiplier, setMultiplier] = useState(1)
  if (!open) return null

  // Expand into one entry per physical sticker.
  const sheet: { key: string; l: LabelSpec }[] = []
  labels.forEach((l, i) => {
    const n = Math.max(1, (l.copies ?? 1) * multiplier)
    for (let c = 0; c < n; c++) sheet.push({ key: `${l.sku}-${i}-${c}`, l })
  })

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <span className="font-medium">{sheet.length} {title}</span>
        <span className="text-xs text-muted-foreground">{labels.length} variant{labels.length === 1 ? "" : "s"}</span>

        <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          Copies of each
          <span className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="size-7 p-0" onClick={() => setMultiplier((m) => Math.max(1, m - 1))} aria-label="Fewer copies"><Minus size={12} weight="bold" /></Button>
            <span className="w-6 text-center text-sm font-semibold text-foreground tabular-nums">{multiplier}</span>
            <Button size="sm" variant="outline" className="size-7 p-0" onClick={() => setMultiplier((m) => Math.min(50, m + 1))} aria-label="More copies"><Plus size={12} weight="bold" /></Button>
          </span>
        </label>

        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
          <Button size="sm" onClick={() => window.print()} disabled={!sheet.length}><Printer size={14} weight="bold" /> Print</Button>
        </div>
      </div>

      {sheet.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">Nothing selected to print.</div>
      ) : (
        <div className="print-area grid grid-cols-3 gap-3 p-4 sm:grid-cols-4">
          {sheet.map(({ key, l }) => (
            <div key={key} className="flex flex-col items-center gap-1 overflow-hidden rounded border border-border p-2 text-center">
              <div className="w-full truncate text-xs font-medium">{l.name || l.sku}</div>
              {l.variant && <div className="w-full truncate text-[10px] text-muted-foreground">{l.variant}</div>}
              {/* fit → scales to the label. A long SKU otherwise renders ~450px wide
                  and spills across the card, printing a clipped, unscannable code. */}
              <Barcode value={l.sku} height={46} fit className="w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
