"use client"

import { useState } from "react"
import { CheckCircle, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { updateOrder, postItemStatus, type OrderRow, type CatalogProduct } from "@/lib/api"
import { normalizeStage } from "@/lib/factory-status"
import { orderNeedsSetup } from "@/lib/variant-resolve"

/** Only a Pending (in_review) order is waiting to be approved into production. */
export const isApprovable = (o: { factory_status?: string | null }) =>
  normalizeStage(o.factory_status) === "in_review"

/**
 * Approve — the factory accepts a seller's Pending order into production. It advances the
 * order in_review → awaiting_scan (one hop), at which point the seller sees "In Process" and
 * the order joins the dispatch/label flow. Blocked until every line is fully set up: an order
 * with an unpicked blank/colour/size/method can't be made, so it can't be approved. The
 * server still enforces both the role and the transition — this is the visible front door.
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
      // in_review → awaiting_scan is one hop; move each line, then the order.
      for (const it of order.items ?? []) {
        if (it.sku || it.line_id) await postItemStatus(order.id, it.sku ?? "", "awaiting_scan", it.line_id)
      }
      const r = await updateOrder(order.id, { factoryStatus: "awaiting_scan" })
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
        ? `${incomplete} item${incomplete === 1 ? "" : "s"} still need a blank, colour, size & method — set them before approving.`
        : "Accept into production — moves to Awaiting scan"}
    >
      {busy ? <CircleNotch size={14} className="animate-spin" /> : <><CheckCircle size={14} weight="bold" /> Approve</>}
    </Button>
  )
}
