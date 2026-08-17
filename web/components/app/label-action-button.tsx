"use client"

import { useState } from "react"
import { DownloadSimple, Plus, ArrowCounterClockwise, CaretDown, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { voidLabel, type OrderRow } from "@/lib/api"
import { useConfirm } from "@/components/app/confirm-dialog"

/**
 * The order's label control, with two states so it's obvious at a glance whether a label
 * already exists on the order:
 *
 *  - NO label yet → a plain "Create label" button (opens the New-label window, which
 *    pre-fills the ship-to from the order's own address).
 *  - label bought → a "Download label" split button: the main part opens the stored PDF,
 *    the caret opens a menu to create ANOTHER label or refund/void this one (which credits
 *    the cost back and is recorded in the order's history).
 *
 * `tracking_label_url` is the signal that a label was actually BOUGHT here — a partner
 * pre-scan sets only `tracking`, never the stored label PDF, so it can't false-positive.
 */
export function LabelActionButton({ order, onOpenLabel, onChanged, onError }: {
  order: OrderRow
  onOpenLabel: () => void
  onChanged: () => void
  onError?: (msg: string) => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const labelUrl = order.tracking_label_url || ""
  const hasLabel = !!labelUrl

  const refund = async () => {
    const ok = await confirm({
      title: "Refund this label?",
      body: "Voids the label with the carrier and credits the cost back to the ledger. This only works on an UNUSED label and within the carrier's refund window. It's recorded in the order's history.",
      confirmLabel: "Refund label",
      cancelLabel: "Keep it",
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await voidLabel(order.id)
      if (r?.error) throw new Error(r.error)
      onChanged()
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Couldn't refund that label.")
    } finally { setBusy(false) }
  }

  if (!hasLabel) {
    return (
      <Button variant="outline" size="sm" onClick={onOpenLabel}>
        Create label
      </Button>
    )
  }

  return (
    <div className="inline-flex h-9 items-center rounded-lg border border-border bg-card">
      <button
        onClick={() => window.open(labelUrl, "_blank", "noopener,noreferrer")}
        title="Open the stored label PDF"
        className="inline-flex h-full items-center gap-1.5 rounded-l-lg px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <DownloadSimple size={14} weight="bold" /> Download label
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More label actions"
          disabled={busy}
          className="inline-flex h-full items-center justify-center rounded-r-lg border-l border-border px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {busy ? <CircleNotch size={14} className="animate-spin" /> : <CaretDown size={12} weight="bold" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onOpenLabel}><Plus size={14} weight="bold" /> Create another label</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={refund}><ArrowCounterClockwise size={14} weight="bold" /> <span className="text-red-600">Refund label</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
