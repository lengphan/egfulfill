"use client"

import { type OrderRow } from "@/lib/api"
import { deliveryWord, DELIVERY_TEXT_TONE } from "@/lib/delivery-status"

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
  /**
   * NO LABEL IS A STATUS TOO (owner, 2026-09-11).
   *
   * This returned null, so the cell was EMPTY — and §4's honesty rule turns on exactly
   * that: a blank cell cannot be told from a status we failed to read. "No label" says the
   * fact plainly, and it is a different fact from "Preshipment", which means a label EXISTS
   * and the carrier has not collected it yet.
   *
   * Settled weight, which is the quietest register there is (lib/status-tone.ts) — most
   * orders in a queue have no label yet, so this appears on most rows and must not compete
   * with the stage beside it. It is the answer to "has this shipped", not a call to act.
   *
   * NOT extended to the other null below. A parcel with a label and no carrier answer still
   * shows nothing, deliberately — that would be a fact about OUR polling printed in the
   * column where the CARRIER speaks, which is the 2026-09-09 decision recorded there.
   */
  if (!order.tracking) {
    /* A DASH, NOT THE WORDS (owner, 2026-09-11). "No label" was the first attempt and it
       was too loud: most orders in a queue have no label yet, so it printed a two-word
       sentence down almost every row of a column people scan for the exceptions. The dash
       is what the TRACKING column beside it already uses for the same absence, so the pair
       now says the same thing the same way — and it still satisfies the honesty rule,
       because a mark means "we looked and there is nothing" where a blank cell cannot be
       told from a status we failed to read. The sentence moves to the tooltip. */
    return (
      <span title="No shipping label has been produced for this order yet"
            className={"text-muted-foreground/60 " + (className ?? "")}>
        —
      </span>
    )
  }

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

  /**
   * NO CAPSULE, for the reason StageBadge already gives beside the same decision: "a pill has
   * to carry meaning, and an order stage did — until every label in the app became one and
   * the shape stopped saying anything. The word is the chip now."
   *
   * That applies doubly now the two sit in ADJACENT columns. A bare word beside a capsule
   * reads as two different kinds of fact, when they are the same kind from two owners — and
   * the capsule was the louder of the pair while carrying the less actionable half.
   *
   * DELIVERY_TEXT_TONE was written for this and its own note says so: "coloured type, for a
   * column of them". It was a column of them the moment Delivery got its own.
   */
  return (
    <span title={order.delivery_detail ?? undefined}
          className={(DELIVERY_TEXT_TONE[order.delivery_status ?? ""] ?? "text-muted-foreground")
            + " " + (className ?? "")}>
      {word}
    </span>
  )
}
