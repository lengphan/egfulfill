"use client"

import { useLabelT } from "@/lib/i18n"
import { useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { updateOrder, postItemStatus, type OrderRow, type CatalogProduct } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { normalizeStage, isFactoryOrder, canSetStage } from "@/lib/factory-status"
import { orderNeedsSetup } from "@/lib/variant-resolve"

/**
 * What's waiting to be accepted into production — and it isn't the same stage for both
 * kinds of order.
 *
 * A SELLER's order waits at Pending (in_review): submitted, charged, ours to accept. The
 * FACTORY's own order has no such stage — nobody submitted it and nobody paid — so it waits
 * at Draft, and this is the button that starts it. Without this half, removing Pending from
 * those orders would have taken their one-click start with it and left the ⋯ menu as the
 * only way to begin the floor's own work.
 */
export const isApprovable = (o: { factory_status?: string | null; factory_order?: boolean | null }) =>
  isFactoryOrder(o)
    // Draft is where a factory order waits. in_review is where the ones written BEFORE
    // Pending was taken off their line are stranded — the same button gets those out, in
    // one click, which is a better answer than a migration nobody remembers running.
    ? ["", "in_review"].includes(normalizeStage(o.factory_status))
    : normalizeStage(o.factory_status) === "in_review"

/**
 * Approve — the factory accepts an order into production, moving it to Awaiting scan: one
 * hop from Pending for a seller's order, one hop from Draft for its own (see FACTORY_LINE).
 * A seller then sees "In Process" and the order joins the dispatch/label flow. Blocked until
 * every line is fully set up: an order with an unpicked blank/colour/size/method can't be
 * made, so it can't be approved. The server still enforces both the role and the transition
 * — this is the visible front door.
 */
export function ApproveOrderButton({
  order, catalog, onDone, onError, size = "sm",
}: {
  order: OrderRow
  catalog: CatalogProduct[]
  onDone: () => void
  onError?: (m: string) => void
  size?: "sm" | "default"
}) {
  const tl = useLabelT()
  const [busy, setBusy] = useState(false)
  const role = getUser()?.role ?? ""
  if (!isApprovable(order)) return null

  const incomplete = orderNeedsSetup(order.items, catalog)
  const blocked = incomplete > 0
  /**
   * The next stage THIS role may set from here, and nothing else shown.
   *
   * An operator's move is Approved; the warehouse's is Working. A role that may set
   * neither gets no button at all rather than one that would be refused — an affordance
   * that 403s is worse than an absent one, because it reads as breakage rather than as
   * somebody else's job.
   */
  const fac = isFactoryOrder(order)
  const at = order.factory_status ?? ""
  const target = canSetStage(role, at, "approved", fac) ? "approved"
    : canSetStage(role, at, "working", fac) ? "working"
      : null
  if (!target) return null
  const word = target === "approved" ? "Approve" : "Start"

  const approve = async () => {
    setBusy(true)
    onError?.("")
    try {
      /**
       * THE LINES GO WHERE THE ORDER GOES. This wrote "working" for every line whatever the
       * button said, which was left behind when Approve and Start became two stages: an
       * operator pressing Approve sent every LINE to Working — a stage that role may not set
       * — and then the ORDER to Approved, so the two disagreed and the line writes were
       * refused one by one. It also made the shelf flicker, since the order reaching Working
       * takes its blanks and the correction at Approved puts them straight back.
       */
      for (const it of order.items ?? []) {
        if (it.sku || it.line_id) await postItemStatus(order.id, it.sku ?? "", target, it.line_id)
      }
      /**
       * APPROVE MEANS APPROVED, and Start means Working — they are two stages now.
       *
       * This wrote `working` under the word "Start" for everybody, which was right while the
       * pipeline had nothing between a submission and production. It does now: an operator
       * confirms the blank (Approved) and the warehouse commits it (Working). Writing
       * `working` from here would let an operator start production with one press of a
       * button whose own permission check no longer permits it — the server would refuse,
       * and the refusal would read as a bug.
       *
       * So the button writes the next stage this ROLE may actually set, and says which.
       */
      const r = await updateOrder(order.id, { factoryStatus: target })
      if ((r as { error?: string })?.error) throw new Error((r as { error?: string }).error)
      onDone()
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Couldn't approve this order.")
    } finally { setBusy(false) }
  }

  return (
    <Button
      size={size}
      onClick={approve}
      disabled={busy || blocked}
      title={blocked
        ? `${incomplete} item${incomplete === 1 ? "" : "s"} still need a blank, colour, size & method — set them before starting.`
        : isFactoryOrder(order)
          ? target === "approved" ? tl("approveOrderButton", "Confirm the blank on every line") : tl("approveOrderButton", "Put this into production")
          : target === "approved"
            ? tl("approveOrderButton", "Confirm the blank on every line — the warehouse starts production from there")
            : tl("approveOrderButton", "Accept this order into production")}
    >
      {/* ONE WORD, both kinds of order. "Approve" and "Start" were the same write with two
          names, and the row in the hub had a third ("Next stage") for the same act on a
          Pending order — three labels for one decision, which is what made it unreadable.
          Who is waiting is already on the row: a seller's order says Pending. */}
      {busy ? <CircleNotch size={14} className="animate-spin" /> : word}
    </Button>
  )
}
