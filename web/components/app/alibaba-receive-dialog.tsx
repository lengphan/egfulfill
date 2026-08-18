"use client"

import { useEffect, useState } from "react"
import { CircleNotch, Warning, Package } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { savePurchaseOrder, scanInventory, addInventoryItem, getCatalogProducts, saveCatalogProducts, type AlibabaOrderDetail, type POLine } from "@/lib/api"

/**
 * Bring an Alibaba order into the purchase-order table so it can be RECEIVED.
 *
 * Alibaba orders are placed and paid on their site — there is nothing for us to send. What
 * was missing is the other half: goods turn up in the building and nothing puts them into
 * stock, because the whole draft → placed → received path is keyed on a purchase order and
 * Alibaba never made one.
 *
 * So this writes the PO rather than inventing a second receiving path. Status `placed`,
 * because it genuinely was — on their site, by a person, with money that has already left.
 * From there the Orders tab receives it exactly like an S&S or Otto order: quantities go
 * into inventory and the cost books to the ledger. One receiving path, one place where
 * "what did this cost" is answered.
 *
 * THE SKU IS THE WHOLE PROBLEM, and it is why this is a dialog and not a button.
 * Inventory is keyed by OUR sku. Alibaba's line carries `sku_id` ("12:001;5:100" — their
 * internal variant handle, meaningless here) and `model_number`, the supplier's own style
 * code, which is the closest thing to a sku on the order and still not ours. Guessing
 * silently would put stock under a code nobody recognises and quietly split one product
 * across two rows, so the guess is shown and stays editable.
 */

/** Their model number if they gave one, otherwise something traceable rather than blank.
 *  Never an empty sku: inventory keyed on "" merges every unnamed line into one row. */
const skuGuess = (it: { modelNumber?: string | null; productId?: string | null }, i: number) =>
  (it.modelNumber || "").trim() || (it.productId ? `ALI-${it.productId}` : `ALI-LINE-${i + 1}`)

export function AlibabaReceiveDialog({
  order, onClose, onImported,
}: {
  /** The order to import. Null closes the dialog — it is remounted per order by the caller. */
  order: AlibabaOrderDetail | null
  onClose: () => void
  onImported?: (poNum: string) => void
}) {
  const [lines, setLines] = useState<POLine[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // "Into stock" used to create a purchase order and stop there — and a PO never becomes
  // inventory in this system, not even when marked received (purchase.js books the COST;
  // stock is /api/inventory). So the button was named for something it didn't do, and the
  // goods were invisible in Inventory afterwards. Both steps happen here now.
  const [receiveNow, setReceiveNow] = useState(true)
  const [makeProducts, setMakeProducts] = useState(true)

  useEffect(() => {
    if (!order) return
    const t = setTimeout(() => {
      setErr(null)
      setLines((order.items ?? []).map((it, i) => ({
        sku: skuGuess(it, i),
        name: it.name ?? undefined,
        variant: it.variant ?? undefined,
        qty: it.qty ?? 0,
        // Their unit price, not a share of the total. Freight is NOT spread across the
        // lines: it books once, from the order's own total, when the PO is received —
        // amortising it here would make the per-unit cost on the line a number that
        // matches nothing on their invoice.
        price: it.unitPrice ?? 0,
        image: it.image ?? null,
      })))
    }, 0)
    return () => clearTimeout(t)
  }, [order])

  if (!order) return null

  const poNum = `ALI-${order.tradeId}`
  const set = (i: number, patch: Partial<POLine>) =>
    setLines((prev) => prev.map((l, x) => (x === i ? { ...l, ...patch } : l)))

  const dupSkus = (() => {
    const seen = new Map<string, number>()
    for (const l of lines) seen.set(l.sku.trim(), (seen.get(l.sku.trim()) ?? 0) + 1)
    return new Set([...seen].filter(([k, n]) => k && n > 1).map(([k]) => k))
  })()

  const usable = lines.filter((l) => l.sku.trim() && Number(l.qty) > 0)

  const importIt = async () => {
    if (!usable.length) { setErr("Every line needs a sku and a quantity above zero — that is what stock gets counted against."); return }
    setBusy(true); setErr(null)
    try {
      const r = await savePurchaseOrder({
        num: poNum,
        supplier: order.sellerName || "Alibaba supplier",
        items: usable.map((l) => ({ ...l, sku: l.sku.trim(), qty: Number(l.qty), price: Number(l.price) || 0 })),
        status: "placed",
        meta: {
          api: "alibaba",
          // Placed on THEIR site at their timestamp — not now. Using the import moment
          // would date the order to the day someone got round to filing it.
          placedAt: order.createdAt ?? new Date().toISOString(),
          // What Alibaba actually billed, so the ledger books the real figure on receipt
          // rather than the line sum. Freight on inbound stock is part of what the stock
          // cost — see supplierCharged() in server/src/routes/purchase.js.
          response: {
            ok: true,
            alibabaOrder: {
              tradeId: order.tradeId,
              sellerName: order.sellerName ?? null,
              sellerEid: order.sellerEid ?? null,
              productTotal: order.productTotal ?? null,
              shipmentFee: order.shipmentFee ?? null,
              total: order.total ?? null,
              currency: order.currency ?? "USD",
              tradeTerm: order.tradeTerm ?? null,
            },
          },
        },
      })
      if (r.error) throw new Error(r.error)

      // ── The goods themselves ────────────────────────────────────────────────
      // A scan is an atomic delta, so an existing stock line is incremented rather than
      // overwritten, and it leaves a scan_history row — receiving a delivery is a movement
      // and should read as one. A sku we have never seen 404s, and only then is a new
      // inventory row created, carrying the quantity as its opening count.
      if (receiveNow) {
        for (const l of usable) {
          const sku = l.sku.trim()
          const qty = Number(l.qty)
          try {
            await scanInventory({ sku, direction: "in", qty, order_ref: poNum })
          } catch {
            await addInventoryItem({
              sku, name: l.name || sku, variant: l.variant || undefined,
              in_stock: qty, supplier: order.sellerName || "Alibaba",
            }).catch(() => null)
          }
        }
      }

      // ── The product ─────────────────────────────────────────────────────────
      // Created OFF: `inCatalog: false` keeps it out of the shop window until someone
      // decides it belongs there. Only skus with no product yet are added, so re-importing
      // an order can't duplicate one. The unit price is the SUPPLIER's, so it is our COST
      // (productCost) — writing it to base price would charge a seller our raw cost with
      // no margin, the same trap the S&S and Otto builders call out.
      if (makeProducts) {
        const existing = await getCatalogProducts().catch(() => null)
        if (existing) {
          const have = new Set(existing.map((p) => String(p.sku || "").trim().toLowerCase()).filter(Boolean))
          const fresh = usable
            .filter((l) => !have.has(l.sku.trim().toLowerCase()))
            .map((l) => ({
              id: `ALI-${l.sku.trim()}`,
              name: l.name || l.sku.trim(),
              sku: l.sku.trim(),
              status: "Active",
              productCost: Number(l.price) || undefined,
              img: l.image || undefined,
              supplier: order.sellerName || "Alibaba",
              inCatalog: false,
            }))
          if (fresh.length) {
            await saveCatalogProducts([...existing, ...fresh]).catch(() => null)
          }
        }
      }

      onImported?.(poNum)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the purchase order.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package size={18} weight="fill" /> Bring {order.tradeId} into stock
          </DialogTitle>
          <DialogDescription>
            Creates purchase order <span className="font-mono font-medium">{poNum}</span>
            {/* Supplier names end in a full stop far more often than not ("… Co., Ltd."),
                so the sentence is separated rather than joined — otherwise "Ltd.. Receive". */}
            {order.sellerName ? ` against ${order.sellerName}` : ""}
            {order.sellerName && /[.!?]$/.test(order.sellerName) ? " " : ". "}
            {receiveNow ? " The quantities go into inventory as sellable stock now" : " Receive it from the Orders tab when the goods arrive"} —{" "}
            {order.total != null
              ? <>the <strong>{`$${Number(order.total).toFixed(2)}`}</strong> Alibaba billed, freight included, books to the ledger then.</>
              : <>its cost books to the ledger then.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <p className="text-xs text-muted-foreground">
            {/* Said plainly, because a wrong sku here is not visible again until someone
                wonders why stock is short. */}
            Inventory counts against <strong className="text-foreground">our</strong>{" "}sku, and
            Alibaba&apos;s lines don&apos;t carry one — these are their model numbers, which is the
            closest thing on the order. Change any that should land on an existing stock line.
          </p>

          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={receiveNow} onChange={(e) => setReceiveNow(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">Receive into stock now</span> — adds these quantities to
                inventory as sellable stock. Untick if the goods haven&apos;t physically arrived.
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={makeProducts} onChange={(e) => setMakeProducts(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">Create products for new skus</span> — built from the
                supplier&apos;s photo, name and unit cost, and left <strong>switched off</strong> until you
                publish them in Products. Skus that already have a product are skipped.
              </span>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left eg-label text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Item</th>
                  <th className="py-1.5 pr-3 font-medium">Our sku</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                  <th className="py-1.5 text-right font-medium">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3">
                      <span className="line-clamp-2 max-w-[16rem] text-xs">{l.name ?? "—"}</span>
                      {l.variant && <span className="text-2xs text-muted-foreground">{l.variant}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <Input value={l.sku} onChange={(e) => set(i, { sku: e.target.value })}
                             className={"h-8 w-44 font-mono text-xs " + (dupSkus.has(l.sku.trim()) ? "border-amber-500" : "")} />
                      {/* Two lines on one sku merge into a single stock movement. That is
                          sometimes right — the same blank in one colour ordered twice — and
                          sometimes a mistake, and only the person importing knows which. */}
                      {dupSkus.has(l.sku.trim()) && (
                        <span className="text-2xs text-amber-600">shares a sku with another line — the quantities will merge</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Input value={String(l.qty ?? 0)} inputMode="numeric"
                             onChange={(e) => set(i, { qty: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                             className="h-8 w-20 text-right tabular-nums" />
                    </td>
                    <td className="py-2 text-right">
                      <Input value={String(l.price ?? 0)} inputMode="decimal"
                             onChange={(e) => set(i, { price: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })}
                             className="h-8 w-24 text-right tabular-nums" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {order.shipmentFee ? (
            <p className="text-2xs text-muted-foreground">
              Unit prices are Alibaba&apos;s own. The {`$${Number(order.shipmentFee).toFixed(2)}`} freight is
              not spread across these lines — it books once from the order total, so each line still
              matches their invoice.
            </p>
          ) : null}

          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /><span>{err}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={importIt} disabled={busy || !usable.length}>
            {busy ? <CircleNotch size={14} className="animate-spin" /> : null}
            Create {poNum}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
