"use client"

import { useEffect, useMemo, useState } from "react"
import { CircleNotch, ShoppingCart, Warning } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getFactoryList, saveFactoryList, type SavedPOLine } from "@/lib/api"

const num = (v: unknown) => Number(v) || 0
const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)

export type QuickOrderProduct = {
  /** Style-level identity — the sku is built per size when the supplier gives one. */
  style: string
  name: string
  supplier: string | null
  image?: string | null
  /** Sizes offered. A size with a known sku orders exactly; one without is recorded
   *  against the style for someone to resolve, rather than dropped. */
  sizes: { size: string; sku?: string | null; price?: number | null }[]
  defaultPrice?: number | null
}

/**
 * Quick order — quantities and prices per size, straight onto the to-order list.
 *
 * Browsing a supplier and wanting six of a thing in three sizes previously meant
 * importing it to the catalogue, finding it again in the picker, and adding each size
 * one at a time. This is the same intent expressed once.
 *
 * It adds to the TO-ORDER pool, not to a purchase order: no PO exists until one is
 * placed, and a decision to buy shouldn't quietly create a document.
 *
 * Prices default to the supplier's own where known, and stay editable — what a size costs
 * is what the invoice will say, not what a catalogue said last month.
 */
export function QuickOrderDialog({
  product, onClose, onAdded,
}: { product: QuickOrderProduct | null; onClose: () => void; onAdded?: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>({})
  const [price, setPrice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setQty({}); setErr(null)
      // Seed prices from the supplier's own, so the common case is "type quantities".
      const seed: Record<string, string> = {}
      for (const s of product?.sizes ?? []) {
        const p = s.price ?? product?.defaultPrice ?? null
        if (p != null) seed[s.size] = String(p)
      }
      setPrice(seed)
    }, 0)
    return () => clearTimeout(t)
  }, [product])

  const picked = useMemo(
    () => (product?.sizes ?? [])
      .map((s) => ({ s, q: parseInt(qty[s.size] ?? "", 10) || 0 }))
      .filter((x) => x.q > 0),
    [product, qty]
  )
  const total = picked.reduce((sum, { s, q }) => sum + num(price[s.size]) * q, 0)
  const units = picked.reduce((sum, { q }) => sum + q, 0)

  if (!product) return null

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      // Merge into the shared list rather than replacing it — this is a factory-wide blob
      // and someone else may have added to it since the page loaded.
      const current = await getFactoryList<SavedPOLine[]>("po_saved").catch(() => [])
      const next: SavedPOLine[] = Array.isArray(current) ? current.map((l) => ({ ...l })) : []
      for (const { s, q } of picked) {
        // A size with no sku of its own is keyed to the style so it still reaches the
        // list — dropping it would silently lose part of what was asked for.
        const sku = s.sku || `${product.style}-${s.size}`
        const hit = next.find((x) => x.sku === sku)
        if (hit) hit.qty = num(hit.qty) + q
        else next.push({
          sku,
          name: product.name,
          variant: s.size,
          qty: q,
          price: num(price[s.size]) || 0,
          supplier: product.supplier ?? null,
          savedAt: new Date().toISOString(),
        })
      }
      await saveFactoryList("po_saved", next)
      onAdded?.()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add these to the order list.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!product} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick order</DialogTitle>
          <DialogDescription>{product.name}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-1 overflow-y-auto py-2">
          <div className="flex items-center gap-2 pb-1 text-[11px] font-medium text-muted-foreground">
            <span className="flex-1">Size</span>
            <span className="w-16 text-center">Qty</span>
            <span className="w-24 text-right">Unit price</span>
          </div>
          {product.sizes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              This product lists no sizes, so there&apos;s nothing to order against.
            </div>
          ) : product.sizes.map((s) => (
            <div key={s.size} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.size}</div>
                {s.sku && <div className="truncate font-mono text-[10px] text-muted-foreground">{s.sku}</div>}
              </div>
              <Input
                value={qty[s.size] ?? ""}
                onChange={(e) => setQty((p) => ({ ...p, [s.size]: e.target.value.replace(/[^0-9]/g, "") }))}
                placeholder="0" inputMode="numeric" disabled={busy}
                className="h-8 w-16 text-center" aria-label={`Quantity for ${s.size}`}
              />
              <Input
                value={price[s.size] ?? ""}
                onChange={(e) => setPrice((p) => ({ ...p, [s.size]: e.target.value.replace(/[^0-9.]/g, "") }))}
                placeholder="0.00" inputMode="decimal" disabled={busy}
                className="h-8 w-24 text-right tabular-nums" aria-label={`Unit price for ${s.size}`}
              />
            </div>
          ))}
        </div>

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /><span>{err}</span>
          </div>
        )}

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {units ? `${units} units · ${usd(total)}` : "Nothing selected yet"}
          </span>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy || !picked.length}>
            {busy ? <CircleNotch size={13} className="animate-spin" /> : <ShoppingCart size={13} weight="bold" />}
            Add to order list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
