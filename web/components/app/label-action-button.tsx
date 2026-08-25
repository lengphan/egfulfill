"use client"

import { useLabelT } from "@/lib/i18n"
import { useState } from "react"
import { CaretDown, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { voidLabel, type OrderRow } from "@/lib/api"
import { useConfirm } from "@/components/app/confirm-dialog"

/**
 * The order's label control, with two states so it's obvious at a glance whether a label
 * already exists on the order:
 *
 *  - NO label yet → a plain "Create label" button (opens the New-label window, which
 * pre-fills the ship-to from the order's own address).
 *  - label bought → a "Download label" split button: the main part opens the stored PDF,
 * the caret opens a menu to create ANOTHER label or refund/void this one (which credits
 * the cost back and is recorded in the order's history).
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
  const tl = useLabelT()
 const confirm = useConfirm()
 const [busy, setBusy] = useState(false)
 const labelUrl = order.tracking_label_url || ""
 const hasLabel = !!labelUrl

  /*
   * BUYING A SECOND LABEL COSTS AGAIN, and nothing on the way there said so — "Create
   * another label" opened the same window as "Create label" and bought a second one at
   * full price. The first stays valid too, so the parcel now has two live labels and the
   * carrier will bill for both.
   *
   * A confirm rather than a disabled item: a second label is a real need (a reprint on
   * damaged stock, a changed address), it just must not happen by accident.
   */
 const createAnother = async () => {
 const ok = await confirm({
 title: tl("labelActionButton", "This order already has a label"),
 body: `A label was already bought for this order${order.tracking ? ` (${order.tracking})` : ""}. Creating another buys a SECOND label and charges again — the first stays valid unless you refund it.`,
 confirmLabel: "Buy another label",
 cancelLabel: "Cancel",
    })
 if (ok) onOpenLabel()
  }

 const refund = async () => {
 const ok = await confirm({
 title: tl("labelActionButton", "Refund this label?"),
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
        {tl("labelActionButton", "Create label")}
      </Button>
    )
  }

 return (
    <div className="inline-flex h-9 items-center rounded-lg border border-border bg-card">
      <button
 onClick={() => window.open(labelUrl, "_blank", "noopener,noreferrer")}
 title={tl("labelActionButton", "Open the stored label PDF")}
 className="inline-flex h-full items-center gap-1.5 rounded-l-lg px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {tl("labelActionButton", "Download label")}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
 aria-label={tl("labelActionButton", "More label actions")}
 disabled={busy}
 className="inline-flex h-full items-center justify-center rounded-r-lg border-l border-border px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {busy ? <CircleNotch size={14} className="animate-spin" /> : <CaretDown size={12} weight="bold" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {/* The tracking number, where the label decisions are. It is further down the
 page as well, but "which label am I about to replace" is answered here. */}
          {order.tracking && (
            <>
              <div className="px-2 py-1.5">
                <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{tl("labelActionButton", "Tracking")}</div>
                <div className="truncate tabular-nums text-xs">{order.tracking}</div>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {/* WORDS, NOT GLYPHS — matching the ⋯ menu and the buttons either side of this
 one. This control sits in a row of plain-text buttons (Create label, Packing
 slip, Cancel order, Approve), so a truck and a plus here were the only marks in
 the row and read as decoration on the one action that spends money. The CARET
 stays: it is not a picture of the action, it is what says there is a menu. */}
          <DropdownMenuItem onClick={createAnother}>{tl("labelActionButton", "Create another label")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={refund}><span className="text-alert">{tl("labelActionButton", "Refund label")}</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
