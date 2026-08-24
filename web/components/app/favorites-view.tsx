"use client"

import { useCallback, useEffect, useState } from "react"
import { Heart } from "@phosphor-icons/react"
import { SupplierProductCard } from "@/components/app/supplier-product-card"
import { Loading } from "@/components/app/loading"
import {
  getSsFavorites, toggleSsFavorite, getSsStyle,
  getOttoFavorites, toggleOttoFavorite, getOttoStyle,
  getCatalogProducts, saveCatalogProducts, colorNames,
  type SsStyle, type OttoFav, type CatalogProduct,
} from "@/lib/api"
import { ssCatalogProduct, ottoCatalogProduct } from "@/lib/supplier-catalog"
import { getToken } from "@/lib/auth"
import { nextEgSku } from "@/lib/sku"

// Otto images are Google Drive links — rewrite to the embeddable thumbnail URL.
function driveImg(url?: string | null): string {
  if (!url) return ""
  const s = String(url)
  const m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : s
}
const driveMap = (m?: Record<string, string>) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, driveImg(v)]))

type FavItem = { supplier: "ss" | "otto"; id: string; title: string; brand?: string | null; subtitle?: string | null; image?: string | null; price?: number | string | null; colors?: string[] | null; raw: SsStyle | OttoFav }

// Combined saved-blanks view across BOTH suppliers (the hearts save server-side).
/** `refreshKey` — bumped by the tab shell each time this view is re-shown. It stays
 *  mounted between visits now, so nothing else would re-read the hearts after they were
 *  changed on the All-suppliers tab. The reload replaces the list in place, so it is
 *  invisible: the old cards stay on screen until the new ones land. */
export function FavoritesView({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<FavItem[] | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    if (!getToken()) { setItems([]); return }
    Promise.all([
      getSsFavorites().catch(() => ({ favorites: [] as SsStyle[] })),
      getOttoFavorites().catch(() => ({ favorites: [] as OttoFav[] })),
    ]).then(([ss, otto]) => {
      setItems([
        ...(ss.favorites ?? []).map((s): FavItem => ({ supplier: "ss", id: s.styleID, title: s.title, brand: s.brand, subtitle: s.category, image: s.image, price: s.price, colors: colorNames(s.colors), raw: s })),
        ...(otto.favorites ?? []).map((o): FavItem => ({ supplier: "otto", id: o.style, title: o.name || o.style, image: driveImg(o.image), price: o.price, raw: o })),
      ])
    })
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load, refreshKey])

  const keyOf = (f: FavItem) => `${f.supplier}:${f.id}`

  const addToCatalog = async (f: FavItem) => {
    setAddingId(keyOf(f))
    try {
      /*
       * NEVER SAVE A FULL LIST BUILT ON A FAILED READ.
       *
       * This was `.catch(() => [])`, and POST /api/catalog_products is a whole-list REPLACE
       * that PRUNES: `delete from catalog_products where id <> all($1)`. So a read that
       * failed for any reason — a slow response, a dropped connection, a 502 — turned into
       * `existing = []`, then a one-item payload, and the other products on the shelf were
       * deleted. The server's own guards cannot catch it: the list is not empty and every
       * entry has an id, so it looks exactly like a deliberate "the catalogue is now this
       * one product".
       *
       * Catalogue rows carry base_price, which BILLS ORDERS, so this is the §2.6 case — an
       * accident here destroys data nobody asked to touch. Failing the add is the safe
       * outcome and the honest one: nothing was added, and it says so.
       */
      const existing = await getCatalogProducts().catch(() => { throw new Error("Couldn't read the current products, so nothing was added — try again.") })
      /**
       * THE SAME BUILDER THE BROWSE GRID USES. This was a private copy, and it had drifted
       * in the two ways a copy always does:
       *
       *  - `sku: f.id` wrote S&S's INTERNAL style id ("16") into OUR sku — the field publish
       *    writes onto the seller's listing. A supplier's code belongs in supplierSku, which
       *    sellerSafe strips; the shared builder puts it there.
       *  - it put the supplier's wholesale price into `price` AND `basePrice`, which is the
       *    exact mistake the shared builder documents against: base cost is meant to DERIVE
       *    as productCost + the base_markup setting, so writing cost into base charged the
       *    seller our raw cost with no margin.
       *
       * CLAUDE.md §5: import shared logic, never re-derive it.
       */
      const built: CatalogProduct = f.supplier === "ss"
        ? await ssCatalogProduct(f.id, { title: f.title, price: f.price, image: f.image, colors: f.colors, brand: f.brand })
        : await ottoCatalogProduct(f.id, { name: f.title, price: f.price, image: f.image, colors: f.colors, brand: f.brand })
      // This tab saves straight through with no review step, so the sku the builders leave
      // unset has to be assigned here — a product without one can't be stocked or resolved.
      const product: CatalogProduct = built.sku ? built : { ...built, sku: nextEgSku(existing) }
      const next = existing.some((p) => p.id === product.id) ? existing.map((p) => (p.id === product.id ? product : p)) : [...existing, product]
      await saveCatalogProducts(next)
      setAdded((prev) => new Set(prev).add(keyOf(f)))
    } catch { /* ignore */ } finally { setAddingId(null) }
  }

  const unfavorite = (f: FavItem) => {
    setRemoved((prev) => new Set(prev).add(keyOf(f)))
    if (f.supplier === "ss") toggleSsFavorite(f.raw as SsStyle, false).catch(() => {})
    else toggleOttoFavorite({ style: f.id }, false).catch(() => {})
  }

  if (items === null) return <Loading label="Loading favorites…" />
  const visible = items.filter((f) => !removed.has(keyOf(f)))
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
        <Heart size={18} weight="regular"  className="shrink-0 text-muted-foreground" />
        <div className="font-medium">No favorites yet</div>
        <div className="max-w-xs text-sm text-muted-foreground">Tap the heart on any S&amp;S or Otto blank to save it here.</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {visible.map((f) => (
        <SupplierProductCard
          key={keyOf(f)}
          data={{ id: f.id, title: f.title, brand: f.brand, subtitle: f.subtitle ?? (f.supplier === "otto" ? "Otto Cap" : "S&S"), image: f.image, price: f.price, colors: f.colors, favorited: true }}
          added={added.has(keyOf(f))}
          adding={addingId === keyOf(f)}
          onAdd={() => addToCatalog(f)}
          onFavorite={(on) => { if (!on) unfavorite(f) }}
          loadColors={f.supplier === "ss"
            ? () => getSsStyle(f.id).then((d) => (d && !d.error ? d.colorImages ?? {} : {}))
            : () => getOttoStyle(f.id).then((d) => (d && !d.error ? driveMap(d.colorImages) : {}))}
        />
      ))}
    </div>
  )
}
