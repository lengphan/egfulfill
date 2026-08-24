import { buyUspsLabel, fetchShipmentLabel, type OrderRow, type ShipAddress } from "@/lib/api"
import { numOf, shipAddressOf, isShippable } from "@/lib/order-format"
import { parcelFromOrder } from "@/lib/parcel-from-order"
import type { CatalogProduct } from "@/lib/api"

/** The stock mailer, used only where the catalog knows nothing about a line. Same box the
 *  single-label dialog opens on, so a bulk buy and a one-off agree. */
export const DEFAULT_BULK_PARCEL = { weightOz: 6, length: 13, width: 10, height: 1 }

/**
 * BUY POSTAGE FOR A SELECTION, one parcel at a time.
 *
 * Sequential, not Promise.all, and that is the point. Each call spends real money on a real
 * card, so a burst that trips a rate limit does not fail cleanly — it fails halfway, having
 * charged for some of them. One at a time with a pause is slower and knowable.
 *
 * PARTIAL SUCCESS IS THE NORMAL CASE, so it is reported as data rather than thrown. Ten
 * selected, seven bought, three skipped for no address: the caller needs all three numbers
 * and the names behind them, because the seven are already paid for and must never be
 * re-bought on a retry.
 */

export type BulkLabelOutcome = {
  order: OrderRow
  ok: boolean
  /** Why it wasn't bought — an address we don't have, or the carrier's own words. */
  reason?: string
  tracking?: string
  cost?: number
  /** Same-origin blob for printing, fetched after the buy so the packet can be assembled. */
  labelBlobUrl?: string
}

/** Orders we can price. An order with no street or no ZIP cannot be quoted, and asking the
 *  carrier anyway spends a request to be told so. */
export function labelableOrders(orders: OrderRow[]): { ready: OrderRow[]; blocked: { order: OrderRow; reason: string }[] } {
  const ready: OrderRow[] = []
  const blocked: { order: OrderRow; reason: string }[] = []
  for (const o of orders) {
    if (o.tracking) blocked.push({ order: o, reason: "already has a label" })
    else if (!isShippable(o)) blocked.push({ order: o, reason: "no shipping address yet" })
    else ready.push(o)
  }
  return { ready, blocked }
}

/* Through the shared reader, then renamed for the carrier payload. This copy had already
   drifted: it dropped `line2`/`address2` and `province`/`postcode` entirely, so a Shopify
   apartment number and every Canadian province were missing from the label it bought. */
const toShipAddress = (o: OrderRow): ShipAddress => {
  const a = shipAddressOf(o)
  return {
    name: a.name, street: a.line1, street2: a.line2,
    city: a.city, state: a.state, zip: a.zip,
  }
}

/**
 * Buy for each order in turn. `parcel` is the box every one of them goes in — bulk buying
 * assumes a uniform parcel, which is what makes it bulk; anything unusual is bought on its
 * own through the label dialog.
 *
 * `onProgress` fires after each order so a long batch can show where it has got to rather
 * than freezing behind ten purchases.
 */
export async function buyLabelsFor(
  orders: OrderRow[],
  parcel: { weightOz: number; length: number; width: number; height: number },
  onProgress?: (done: number, total: number, last: BulkLabelOutcome) => void,
  catalog?: CatalogProduct[],
): Promise<BulkLabelOutcome[]> {
  const out: BulkLabelOutcome[] = []
  for (const o of orders) {
    let result: BulkLabelOutcome
    // EACH order's own weight and box, from the catalog — the same derivation the single
    // label dialog uses, so buying twenty is not a different declaration from buying one.
    // Falls back to the stock mailer per FIELD, not wholesale: a product that knows its
    // weight but not its box should contribute the weight.
    const g = catalog ? parcelFromOrder(o.items, catalog) : null
    const box = g
      ? { weightOz: g.weightOz || parcel.weightOz,
          length: g.length || parcel.length,
          width: g.width || parcel.width,
          height: g.height || parcel.height }
      : parcel
    try {
      const r = await buyUspsLabel({ to: toShipAddress(o), from: {} as ShipAddress, orderId: o.id, ...box })
      if (r?.error || !r?.trackingNumber) {
        result = { order: o, ok: false, reason: r?.error || "the carrier returned no label" }
      } else {
        // The bytes, same-origin, so the packet can print them. A failure here costs the
        // printing and not the postage, so it is recorded and never treated as a failed buy.
        let labelBlobUrl: string | undefined
        try { labelBlobUrl = URL.createObjectURL(await fetchShipmentLabel(String(o.id))) } catch { /* print falls back */ }
        result = { order: o, ok: true, tracking: r.trackingNumber, cost: r.cost ?? undefined, labelBlobUrl }
      }
    } catch (e) {
      result = { order: o, ok: false, reason: e instanceof Error ? e.message : "failed" }
    }
    out.push(result)
    onProgress?.(out.length, orders.length, result)
    // A courtesy gap between purchases. Shippo rate-limits, and a refused label in the
    // middle of a batch is the one that gets missed when the parcels are already packed.
    await new Promise((r) => setTimeout(r, 350))
  }
  return out
}

/**
 * Release the label blobs a batch created.
 *
 * createObjectURL pins its Blob until it is revoked or the tab closes, so a sixty-label run
 * held sixty label PDFs in memory indefinitely — and the printing is finished the moment the
 * packet has been built. The caller revokes when it is done rather than the buyer loop,
 * because printing happens after every buy has returned.
 */
export function releaseLabelBlobs(results: BulkLabelOutcome[]): void {
  for (const r of results) {
    if (r.labelBlobUrl) { try { URL.revokeObjectURL(r.labelBlobUrl) } catch { /* already gone */ } }
  }
}

/** One line a human can act on: what was bought, what wasn't, and the first reason why. */
export function summarise(results: BulkLabelOutcome[], blocked: { order: OrderRow; reason: string }[]): string {
  const ok = results.filter((r) => r.ok)
  const bad = results.filter((r) => !r.ok)
  const parts = [`${ok.length} label${ok.length === 1 ? "" : "s"} bought`]
  if (bad.length) parts.push(`${bad.length} failed — ${numOf(bad[0].order)}: ${bad[0].reason}`)
  if (blocked.length) parts.push(`${blocked.length} skipped — ${numOf(blocked[0].order)}: ${blocked[0].reason}`)
  return parts.join(" · ")
}
