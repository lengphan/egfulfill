"use client"

import { useLabelT } from "@/lib/i18n"
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
import { revalidateCatalog } from "@/lib/revalidate-catalog"
import { ssCatalogProduct, ottoCatalogProduct } from "@/lib/supplier-catalog"
import { getToken } from "@/lib/auth"
import { nextEgSku } from "@/lib/sku"
import { ProductEditorDialog } from "@/components/app/product-editor-dialog"

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
  const tl = useLabelT()
  const [items, setItems] = useState<FavItem[] | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  /** The product being reviewed before it is added — see addToCatalog. */
  const [review, setReview] = useState<{ key: string; product: CatalogProduct; nextSku: string; taken: string[] } | null>(null)

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

  /**
   * THROUGH THE REVIEW STEP, NOT STRAIGHT INTO PRODUCTS (owner, 2026-09-25).
   *
   * This saved the built product directly, so a favourite arrived with the supplier's cost
   * and no Blank price — on sale at cost + the markup setting, and 0.00 wherever Blank is
   * read. It now opens the same editor the supplier page uses, which refuses the add until
   * every size has a Blank price.
   */
  const addToCatalog = async (f: FavItem) => {
    setAddingId(keyOf(f))
    try {
      const existing = await getCatalogProducts()
      /* THE SAME BUILDER THE BROWSE GRID USES — CLAUDE.md §5: import shared logic, never
         re-derive it. It puts the supplier's price in productCost and its code in
         supplierSku, and leaves our sku for the editor to fill. */
      const built: CatalogProduct = f.supplier === "ss"
        ? await ssCatalogProduct(f.id, { title: f.title, price: f.price, image: f.image, colors: f.colors, brand: f.brand })
        : await ottoCatalogProduct(f.id, { name: f.title, price: f.price, image: f.image, colors: f.colors, brand: f.brand })
      setReview({
        key: keyOf(f), product: built, nextSku: nextEgSku(existing),
        taken: existing.filter((p) => p.id !== built.id).map((p) => String(p.sku ?? "")).filter(Boolean),
      })
    } catch { /* ignore */ } finally { setAddingId(null) }
  }

  const confirmAdd = async (product: CatalogProduct) => {
    if (!review) return
    /*
     * NEVER SAVE A FULL LIST BUILT ON A FAILED READ.
     *
     * POST /api/catalog_products is a whole-list REPLACE that PRUNES, so a failed read turned
     * into `existing = []` would delete every other product. Re-read at save time (not the
     * copy from when the review opened), and let a failure throw — the editor stays open
     * and says so.
     */
    const existing = await getCatalogProducts().catch(() => { throw new Error("Couldn't read the current products, so nothing was added — try again.") })
    const withSku: CatalogProduct = product.sku ? product : { ...product, sku: nextEgSku(existing) }
    const next = existing.some((p) => p.id === withSku.id) ? existing.map((p) => (p.id === withSku.id ? withSku : p)) : [...existing, withSku]
    await saveCatalogProducts(next)
    // See revalidateCatalog — appearing has the same 300s lag as disappearing.
    void revalidateCatalog().catch(() => {})
    setAdded((prev) => new Set(prev).add(review.key))
    setReview(null)
  }

  const unfavorite = (f: FavItem) => {
    setRemoved((prev) => new Set(prev).add(keyOf(f)))
    if (f.supplier === "ss") toggleSsFavorite(f.raw as SsStyle, false).catch(() => {})
    else toggleOttoFavorite({ style: f.id }, false).catch(() => {})
  }

  if (items === null) return <Loading label={tl("favorites", "Loading favorites…")} />
  const visible = items.filter((f) => !removed.has(keyOf(f)))
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
        <Heart size={18} weight="regular"  className="shrink-0 text-muted-foreground" />
        <div className="font-medium">{tl("favorites", "No favorites yet")}</div>
        <div className="max-w-xs text-sm text-muted-foreground">{tl("favorites", "Tap the heart on any S&S or Otto blank to save it here.")}</div>
      </div>
    )
  }

  return (
    <>
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
    <ProductEditorDialog
      open={!!review}
      onOpenChange={(v) => { if (!v) setReview(null) }}
      product={review?.product ?? null}
      onSave={confirmAdd}
      requireBlank
      newIdSeed={0}
      nextSku={review?.nextSku}
      takenSkus={review?.taken}
      title={tl("allSuppliers", "Review before adding")}
      ctaLabel="Add to Products"
    />
    </>
  )
}
