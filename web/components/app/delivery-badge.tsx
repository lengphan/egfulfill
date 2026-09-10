"use client"

import { type OrderRow } from "@/lib/api"
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

export function DeliveryBadge({ order, className }: {
  order: OrderRow
  className?: string
}) {
  // Only meaningful once it's left us — before that, the pipeline stage is the answer.
  if (!order.tracking) return null

  /**
   * NO PILL FOR "WE HAVEN'T ASKED" (owner's call, 2026-09-09).
   *
   * This drew a grey "Not asked yet" chip whenever a parcel had a tracking number and no
   * carrier status. It looked like a delivery state and it is not one — it is a fact about
   * OUR polling, printed in the column where the CARRIER speaks, and §4 is explicit that a
   * pill must carry meaning. Worse, it was usually a lie about to be corrected: the status
   * arrives on its own now, because the staff orders read sweeps stale parcels the same way
   * the Shipments list already did (refreshStaleTracking, server/src/routes/orders.js).
   *
   * So an unanswered parcel shows NOTHING, which is the honest amount.
   *
   * ── NO REFRESH BUTTON EITHER (owner, 2026-09-10) ─────────────────────────────────────
   *
   * It sat beside the word on every shipped row: a ⟳ per parcel, in a column people scan
   * DOWN. That is a control repeated once per row to do a job nothing asks a person to do —
   * and it is a job that already happens by itself. `refreshStaleTracking` sweeps twelve
   * parcels on every read of this list, oldest-checked first, skipping the final states, on
   * a six-hour window. It is exported specifically so the ORDERS list drives it, which is
   * this list. The button was asking somebody to do the poller's work by hand.
   *
   * The trade, stated: a specific parcel you care about right now might be up to six hours
   * behind, and there is no longer a way to demand an answer for that one. If that turns
   * out to matter, the fix is to prioritise the sweep, not to put a button on every row.
   */
  const word = deliveryWord(order.delivery_status)
  if (!word) return null

  return (
    <span className={"inline-flex items-center " + (className ?? "")}>
      <span title={order.delivery_detail ?? undefined}
            className={"rounded px-1.5 py-0.5 text-2xs font-medium "
              + (DELIVERY_PILL_TONE[order.delivery_status ?? ""] ?? "bg-muted text-muted-foreground")}>
        {word}
      </span>
    </span>
  )
}
