"use client"

import { useState } from "react"
import { CheckCircle, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { updateOrder, postItemStatus, type OrderRow, type CatalogProduct } from "@/lib/api"
import { normalizeStage, isFactoryOrder } from "@/lib/factory-status"
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
  const [busy, setBusy] = useState(false)
  if (!isApprovable(order)) return null

  const incomplete = orderNeedsSetup(order.items, catalog)
  const blocked = incomplete > 0

  const approve = async () => {
    setBusy(true)
    onError?.("")
    try {
      // One hop either way — Pending → Working for a seller's order, Draft → Working for
      // the factory's own. Move each line, then the order.
      for (const it of order.items ?? []) {
        if (it.sku || it.line_id) await postItemStatus(order.id, it.sku ?? "", "working", it.line_id)
      }
      const r = await updateOrder(order.id, { factoryStatus: "working" })
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
          ? "Put this into production — moves it to Awaiting scan"
          : "Accept this seller's order into production — moves it to Awaiting scan"}
    >
      {/* ONE WORD, both kinds of order. "Approve" and "Start" were the same write with two
          names, and the row in the hub had a third ("Next stage") for the same act on a
          Pending order — three labels for one decision, which is what made it unreadable.
          Who is waiting is already on the row: a seller's order says Pending. */}
      {busy ? <CircleNotch size={14} className="animate-spin" /> : <><CheckCircle size={14} weight="bold" /> Start</>}
    </Button>
  )
}
