"use client"

import { useState } from "react"
import { ArrowClockwise, CircleNotch } from "@phosphor-icons/react"
import { refreshTracking, type OrderRow } from "@/lib/api"

/**
 * What the CARRIER says about a parcel we've already shipped.
 *
 * Deliberately not a pipeline stage. `shipped` is our claim — we handed it over — and
 * that stays true whatever happens next. This is the carrier's claim about the same
 * parcel: a different fact, from a party we don't control. Keeping them apart means a
 * webhook can never move an order behind the floor's back, and every stage rule still
 * only has to reason about states a human sets.
 */

const TONE: Record<string, { label: string; cls: string }> = {
  awaiting_pickup: { label: "Not scanned yet", cls: "bg-amber-100 text-amber-800" },
  in_transit: { label: "In transit", cls: "bg-primary/10 text-primary" },
  delivered: { label: "Delivered", cls: "bg-emerald-100 text-emerald-700" },
  returned: { label: "Returned", cls: "bg-red-100 text-red-700" },
  failed: { label: "Delivery failed", cls: "bg-red-100 text-red-700" },
}

export function DeliveryBadge({ order, onRefreshed, className }: {
  order: OrderRow
  onRefreshed?: () => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  // Only meaningful once it's left us — before that, the pipeline stage is the answer.
  if (!order.tracking) return null

  const s = order.delivery_status ? TONE[order.delivery_status] : null

  const check = async () => {
    setBusy(true)
    try { await refreshTracking(order.id); onRefreshed?.() } catch { /* leave the old state */ }
    finally { setBusy(false) }
  }

  return (
    <span className={"inline-flex items-center gap-1.5 " + (className ?? "")}>
      {s ? (
        <span title={order.delivery_detail ?? undefined} className={"rounded px-1.5 py-0.5 text-2xs font-medium " + s.cls}>
          {s.label}
        </span>
      ) : (
        <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
          No carrier update
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); check() }}
        disabled={busy}
        title="Ask the carrier where this is now"
        className="eg-tap text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        aria-label="Refresh carrier status"
      >
        {busy ? <CircleNotch size={12} className="animate-spin" /> : <ArrowClockwise size={12} weight="bold" />}
      </button>
    </span>
  )
}
