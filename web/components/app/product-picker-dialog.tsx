"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { MagnifyingGlass, Package } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getCatalogProducts, type CatalogProduct } from "@/lib/api"

const priceOf = (p: CatalogProduct) => Number(p.price ?? p.basePrice ?? p.base_price ?? 0) || 0
const imageOf = (p: CatalogProduct) =>
  p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages).find(Boolean) || "" : "") || ""
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// What the picker hands back — enough to prefill an order line.
export type PickedProduct = {
  name: string
  sku: string
  img: string
  price: number
  color: string
  /** Every colour the blank comes in (colorImages keys) — drives the line's colour
   *  dropdown. Empty for a product that defines none. */
  colors: string[]
  sizes: string[]
}

/** Catalog product → order-line prefill. Shared by the picker dialog and the inline
 *  product combobox so both fill a line identically — a line prefilled one way and not
 *  the other is how variant dropdowns end up empty. */
export function toPickedProduct(p: CatalogProduct): PickedProduct {
  return {
    name: p.name ?? p.sku ?? "Item",
    sku: p.sku ?? "",
    img: imageOf(p),
    price: priceOf(p),
    color: p.mainColor || (p.colorImages ? Object.keys(p.colorImages)[0] || "" : ""),
    // mainColor may not be a colorImages key, so union them and drop blanks.
    colors: Array.from(new Set([p.mainColor, ...Object.keys(p.colorImages ?? {})].filter((c): c is string => !!c))),
    sizes: p.sizes ?? [],
  }
}

export { imageOf as productImage, priceOf as productPrice }

// Demo fallback so the picker is never empty in standalone/dev.
export const DEMO: CatalogProduct[] = [
  { name: "Heavyweight Hoodie", sku: "HOOD-HW", type: "Apparel", price: 42, sizes: ["S", "M", "L", "XL", "2XL"], colorImages: { Black: "" } },
  { name: "Classic Tee", sku: "TEE-CL", type: "Apparel", price: 18, sizes: ["S", "M", "L", "XL"], colorImages: { White: "" } },
  { name: "Embroidered Cap", sku: "CAP-EMB", type: "Headwear", price: 24, sizes: ["OS"], colorImages: { Black: "" } },
  { name: "Canvas Tote", sku: "TOTE-CV", type: "Bags", price: 14, sizes: ["OS"], colorImages: { Natural: "" } },
  { name: "Ceramic Mug 15oz", sku: "MUG-15", type: "Drinkware", price: 12.8, sizes: ["15oz"], colorImages: { White: "" } },
  { name: "Crewneck Sweatshirt", sku: "CREW-STD", type: "Apparel", price: 34, sizes: ["S", "M", "L", "XL"], colorImages: { Sand: "" } },
]

export function ProductPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (p: PickedProduct) => void
}) {
  const [products, setProducts] = useState<CatalogProduct[] | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!open) return
    let alive = true
    getCatalogProducts()
      .then((rows) => alive && setProducts(rows && rows.length ? rows : DEMO))
      .catch(() => alive && setProducts(DEMO))
    return () => {
      alive = false
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = products ?? []
    if (!q) return list
    return list.filter((p) => `${p.name ?? ""} ${p.sku ?? ""} ${p.type ?? ""}`.toLowerCase().includes(q))
  }, [products, query])

  const pick = (p: CatalogProduct) => {
    onPick(toPickedProduct(p))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add from catalog</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" className="pl-9" autoFocus />
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {products === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Package size={22} weight="duotone" /> No products match “{query}”.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.map((p, i) => {
                const src = imageOf(p)
                return (
                  <button
                    key={p.id ?? p.sku ?? i}
                    onClick={() => pick(p)}
                    className="group flex flex-col overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-primary hover:bg-accent"
                  >
                    <div className="relative flex aspect-square items-center justify-center bg-muted">
                      {src ? (
                        <Image src={src} alt={p.name ?? ""} fill unoptimized sizes="200px" className="object-cover" />
                      ) : (
                        <Package size={26} weight="duotone" className="text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="truncate text-sm font-medium">{p.name ?? p.sku}</div>
                      <div className="mt-0.5 flex items-center justify-between">
                        <span className="truncate font-mono text-[11px] text-muted-foreground">{p.sku}</span>
                        <span className="text-sm font-semibold tabular-nums">{usd(priceOf(p))}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
