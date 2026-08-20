"use client"

import { useState } from "react"
import { ArrowClockwise, CircleNotch } from "@phosphor-icons/react"
import { refreshTracking, type OrderRow } from "@/lib/api"
import { deliveryWord, DELIVERY_PILL_TONE } from "@/lib/delivery-status"

/**
 * What the CARRIER says about a parcel — the second status an order carries, beside the
 * one the floor sets. See lib/delivery-status.ts for why the two never touch.
 *
 * FACTORY ONLY, on every order including a seller's own. It adopts the carrier's word and
 * changes nothing: it cannot advance a stage, and it does not gate an action. An order
 * fulfilled somewhere else can still be made here — there are plenty of reasons to — so
 * this reports, and a person decides. Catching the pipeline up to it is an admin's move
 * on the stage menu, deliberately, not something a poll does at 3am.
 */

export function DeliveryBadge({ order, onRefreshed, className }: {
  order: OrderRow
  onRefreshed?: () => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  // Only meaningful once it's left us — before that, the pipeline stage is the answer.
  if (!order.tracking) return null

  const word = deliveryWord(order.delivery_status)

  const check = async () => {
    setBusy(true)
    try { await refreshTracking(order.id); onRefreshed?.() } catch { /* leave the old state */ }
    finally { setBusy(false) }
  }

  return (
    <span className={"inline-flex items-center gap-1.5 " + (className ?? "")}>
      {word ? (
        <span title={order.delivery_detail ?? undefined}
              className={"rounded px-1.5 py-0.5 text-2xs font-medium "
                + (DELIVERY_PILL_TONE[order.delivery_status ?? ""] ?? "bg-muted text-muted-foreground")}>
          {word}
        </span>
      ) : (
        <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
          Not asked yet
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
