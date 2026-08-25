"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useState } from "react"
import { cartChanged } from "@/lib/cart-events"
import { CircleNotch, Warning } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { bySize } from "@/lib/size-order"
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
   * against the style for someone to resolve, rather than dropped. */
 sizes: { size: string; sku?: string | null; price?: number | null; image?: string | null }[]
 defaultPrice?: number | null
  /** Why the variant lookup came back empty. Distinguishes a failed request from a
   * product that genuinely has no sizes — they are not the same fact. */
 loadError?: string
  /** The variant already chosen in the detail window, so it is not chosen twice. Absent
   * when opened from a tile, where nothing has been chosen yet. */
 preselect?: { color?: string | null; size?: string | null; qty?: number }
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
  const tl = useLabelT()
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
        // Never invent a sku. `style-size` produced codes no supplier has ever heard of —
        // they look orderable, reach a purchase order, and are rejected at the supplier.
        // A size without a real sku is skipped and reported instead.
 const sku = s.sku
 if (!sku) continue
 const hit = next.find((x) => x.sku === sku)
 if (hit) hit.qty = num(hit.qty) + q
 else next.push({
 sku,
 name: product.name,
          // Keep the picture with the line. Resolving it later works only while the sku is
          // still in a synced catalogue; carrying it survives that.
 image: product.image ?? null,
 variant: s.size,
 qty: q,
 price: num(price[s.size]) || 0,
 supplier: product.supplier ?? null,
 savedAt: new Date().toISOString(),
        })
      }
 const skipped = picked.filter(({ s }) => !s.sku).length
 if (skipped === picked.length) {
 setErr("None of these sizes have a supplier sku yet, so there's nothing orderable to add. Open the style in Add items instead.")
 return
      }
 await saveFactoryList("po_saved", next)
      // The badge in the header is listening for exactly this.
 cartChanged()
 onAdded?.()
 if (skipped) setErr(`Added — but ${skipped} size${skipped === 1 ? "" : "s"} had no supplier sku and were left out.`)
 else onClose()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't add these to the order list.")
    } finally { setBusy(false) }
  }

 return (
    <Dialog open={!!product} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tl("quickOrder", "Quick order")}</DialogTitle>
          <DialogDescription>{product.name}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-1 overflow-y-auto py-2">
          <div className="flex items-center gap-2 pb-1 text-2xs font-medium text-muted-foreground">
            <span className="w-16 shrink-0" aria-hidden />
            <span className="flex-1">{tl("quickOrder", "Colour / size")}</span>
            <span className="w-16 text-center">{tl("quickOrder", "Qty")}</span>
            <span className="w-24 text-right">{tl("quickOrder", "Unit price")}</span>
          </div>
          {product.sizes.length === 0 ? (
            <div className="space-y-2 py-8 text-center text-sm">
              <p className="text-muted-foreground">
                {product.loadError
                  ? tl("quickOrder", "Couldn't load this product's sizes.")
 : tl("quickOrder", "This product lists no sizes, so there's nothing to order against.")}
              </p>
              {product.loadError && (
                <p className="mx-auto max-w-sm text-xs text-destructive">{product.loadError}</p>
              )}
            </div>
          ) : [...product.sizes].sort((a, b) => bySize(a.size, b.size)).map((s) => (
            <div key={s.size} className="flex items-center gap-2 py-1.5">
              {/* The variant's OWN picture. Colour names alone can't be checked — "S.Pnk"
 against "H.Pnk" is a guess until you see them side by side. */}
              {s.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={s.image} alt="" loading="lazy" className="size-16 shrink-0 rounded border border-border bg-white object-contain" />
 : <span className="size-16 shrink-0 rounded border border-dashed border-border" aria-hidden />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{s.size}</div>
                {s.sku
                  ? <div className="truncate tabular-nums text-2xs text-muted-foreground">{s.sku}</div>
 : <div className="truncate text-2xs text-hold">{tl("quickOrder", "no supplier sku — can’t be ordered")}</div>}
              </div>
              <Input
 value={qty[s.size] ?? ""}
 onChange={(e) => setQty((p) => ({ ...p, [s.size]: e.target.value.replace(/[^0-9]/g, "") }))}
 placeholder="0" inputMode="numeric" disabled={busy || !s.sku}
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
            {units ? `${units} units · ${usd(total)}` : tl("quickOrder", "Nothing selected yet")}
          </span>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>{tl("quickOrder", "Cancel")}</Button>
          <Button size="sm" onClick={submit} disabled={busy || !picked.length}>
            {busy ? <CircleNotch size={13} className="animate-spin" /> : null}
            Add to order list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
