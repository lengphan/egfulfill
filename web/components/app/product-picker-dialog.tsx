"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Package } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchField } from "@/components/app/search-field"
import { getCatalogProducts, type CatalogProduct } from "@/lib/api"
import { BlankOutline, hasBlankOutline } from "@/components/app/blank-outline"
import { sizesOf, methodsOf } from "@/lib/variant-resolve"

const priceOf = (p: CatalogProduct) => Number(p.price ?? p.basePrice ?? p.base_price ?? 0) || 0
const imageOf = (p: CatalogProduct) =>
  p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages).find(Boolean) || "" : "") || ""
const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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
  /** Print methods the blank supports, split into individual options — a line needs one
   *  to be produced or priced. */
  methods: string[]
  /** THE CATALOG ROW THE PICK CAME FROM.
   *
   *  `img` above is the listing/hero shot, which is the wrong picture for a line that is
   *  going to be MADE — and it does not follow the colourway. A caller that cares (the
   *  manual order form) resolves imagery through `bestMockup(product, color)` instead,
   *  and re-resolves it when the colour changes. Carried here rather than re-fetched
   *  because the picker already had the row in hand. */
  product?: CatalogProduct
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
    sizes: sizesOf(p),
    methods: methodsOf(p),
    product: p,
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
  const tl = useLabelT()
  const [products, setProducts] = useState<CatalogProduct[] | null>(null)
  const [query, setQuery] = useState("")
  /** Null means every type. Set by the outline row, cleared by picking it again. */
  const [type, setType] = useState<string | null>(null)

  /**
   * THE TYPES THIS CATALOGUE ACTUALLY HAS, in the order they first appear.
   *
   * Derived rather than hard-coded: a fixed list of ten would offer a filter for blankets
   * nobody stocks and silently omit whatever gets added upstream. Counted, so a type with
   * one product does not look the same as one with forty.
   */
  const types = useMemo(() => {
    const seen = new Map<string, number>()
    for (const p of products ?? []) {
      const t = String(p.type ?? "").trim().toLowerCase()
      if (t) seen.set(t, (seen.get(t) ?? 0) + 1)
    }
    return [...seen.entries()].map(([id, n]) => ({ id, n }))
  }, [products])

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
    const byType = type ? list.filter((p) => String(p.type ?? "").toLowerCase() === type) : list
    if (!q) return byType
    return byType.filter((p) => `${p.name ?? ""} ${p.sku ?? ""} ${p.type ?? ""}`.toLowerCase().includes(q))
  }, [products, query, type])

  const pick = (p: CatalogProduct) => {
    onPick(toPickedProduct(p))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tl("productPicker", "Add from catalog")}</DialogTitle>
        </DialogHeader>

        {/* PICK THE SHAPE, NOT THE WORD. Finding a hoodie meant typing "hoodie"; a row of
            outlines is recognised without reading, and it is the same gesture whatever
            language the seller has the app in. A type with no drawing shows its name — it
            still filters, it just does not get a picture it has not been given. */}
        {types.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType((cur) => (cur === t.id ? null : t.id))}
                aria-pressed={type === t.id}
                className={
                  "eg-tap flex w-[4.5rem] flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] capitalize transition-colors " +
                  (type === t.id
                    ? "border-primary bg-accent font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground")
                }
              >
                {hasBlankOutline(t.id)
                  ? <BlankOutline type={t.id} className="h-8 w-full" />
                  : <span className="flex h-8 items-center text-xs">{t.id.slice(0, 3)}</span>}
                <span className="truncate">{t.id}</span>
              </button>
            ))}
          </div>
        )}
        <SearchField
          value={query}
          onChange={setQuery}
          autoFocus
          placeholder={tl("productPicker", "Search products…")}
        />

        <div className="max-h-[55vh] overflow-y-auto">
          {products === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Package size={22} weight="duotone" />
              {query ? `No products match “${query}”` : "Nothing stocked in this category yet"}{type ? ` in ${type}.` : "."}
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
                        <span className="truncate tabular-nums text-2xs text-muted-foreground">{p.sku}</span>
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
