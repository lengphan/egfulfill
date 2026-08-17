"use client"

import { Warning, Truck } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { warehouseEta, fmtEta } from "@/lib/warehouse-eta"

export type LineStock = { total: number; warehouses: { abbr: string; qty: number }[] }
export type TransitMap = Record<string, { days: number | null; cutOff: string }>

/**
 * What S&S will actually do with this line, before it's ordered.
 *
 * With autoselectWarehouse on — which is their recommendation and what we send — S&S
 * never refuse a line they can't fill from one place. Their doc: "Each line may be split
 * between multiple warehouses." So there are two silent outcomes:
 *
 *   SPLIT   — enough in total, not in one place. Arrives as several boxes, on several
 *             days, at several shipping charges. Looks identical to a normal order until
 *             the cartons turn up.
 *   SHORT   — not enough anywhere. Ships what exists; the rest comes back as a LineError
 *             and the shelf is quietly missing units.
 *
 * Neither is visible at the moment of ordering, which is the only moment you can do
 * anything about it. So both are named here, with the three things you'd actually want to
 * do: take what one warehouse can send, park the rest, or go ahead knowing.
 */
export function StockSplitWarning({
  qty, stock, transit, now, onReduce, onSaveForLater,
}: {
  qty: number
  stock: LineStock
  transit: TransitMap
  now: number
  /** Drop the quantity to what the best single warehouse can ship in one box. */
  onReduce: (qty: number, warehouse: string) => void
  onSaveForLater: () => void
}) {
  const stocked = stock.warehouses.filter((w) => w.qty > 0)
  const covers = stocked.filter((w) => w.qty >= qty)
  if (covers.length > 0) return null          // one warehouse can send it whole — nothing to say

  // Nothing anywhere is a different problem from "spread thin", and needs a different answer.
  const none = stock.total <= 0
  // The biggest single warehouse: the most that can arrive in ONE box.
  const best = stocked.reduce<{ abbr: string; qty: number } | null>(
    (a, w) => (!a || w.qty > a.qty ? w : a), null)

  const eta = best ? warehouseEta(transit[best.abbr]?.days ?? null, transit[best.abbr]?.cutOff ?? null, new Date(now)) : null
  // How many parcels it takes, largest warehouses first — the number that turns an
  // abstract "split" into "three boxes, three shipping charges".
  const boxes = (() => {
    let left = qty, n = 0
    for (const w of [...stocked].sort((a, b) => b.qty - a.qty)) {
      if (left <= 0) break
      left -= w.qty; n++
    }
    return left > 0 ? null : n
  })()

  return (
    <div className={"mt-1.5 rounded-lg border px-3 py-2 text-xs " + (
      none ? "border-destructive/30 bg-destructive/10 text-destructive"
           : "border-amber-200 bg-amber-50 text-amber-900")}>
      <div className="flex items-start gap-2">
        <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {none ? (
            <p>
              <strong>Out of stock everywhere.</strong> S&amp;S will ship nothing for this line and report it
              back as an error — the order still goes, just without this.
            </p>
          ) : (
            <p>
              <strong>No single warehouse has {qty}.</strong>{" "}
              {stock.total} in stock across {stocked.length} warehouse{stocked.length === 1 ? "" : "s"}, so S&amp;S
              will split it{boxes ? ` into about ${boxes} shipments` : ""} — separate boxes, separate days,
              separate shipping charges.
            </p>
          )}

          {best && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {/* The one-box option, stated with its real consequence: fewer units. */}
              <Button size="sm" variant="outline" className="h-7"
                onClick={() => onReduce(best.qty, best.abbr)}>
                Take {best.qty} from {best.abbr} only
                {eta?.deliveryAt ? ` · ${fmtEta(eta.deliveryAt)}` : ""}
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={onSaveForLater}>
                Save for later
              </Button>
              <span className="inline-flex items-center gap-1 text-2xs opacity-80">
                <Truck size={11} /> or order anyway and accept the split
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
