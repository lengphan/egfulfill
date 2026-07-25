"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MagnifyingGlass, UploadSimple, ArrowsClockwise, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { usePaged, Pagination } from "@/components/app/pagination"
import { QuickOrderDialog, type QuickOrderProduct } from "@/components/app/quick-order-dialog"
import { SsSyncPanel } from "@/components/app/ss-sync-panel"
import { SupplierProductCard } from "@/components/app/supplier-product-card"
import { ProductEditorDialog } from "@/components/app/product-editor-dialog"
import { Loading } from "@/components/app/loading"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseCSV } from "@/lib/order-import"
import {
  getSsStylesAll, getSsStyleImgs, getSsStyle, toggleSsFavorite, ssWarm, ssSync,
  getOttoProducts, getOttoStyle, getSsStyleSkus, getCatalogFilters, toggleOttoFavorite, importOttoProducts,
  getCatalogProducts, saveCatalogProducts, colorNames,
  type SsStyle, type OttoStyle, type OttoImportRow, type CatalogProduct,
} from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { driveImg, prettyColor, driveMap, ssCatalogProduct, ottoCatalogProduct } from "@/lib/supplier-catalog"

const PAGE = 30

// Otto Product Data → normalized rows (real headers: sku_no, sku_parent, 1+, image_main…).
function mapOttoRows(rows: string[][]): OttoImportRow[] {
  if (rows.length < 2) return []
  const header = rows[0].map((h) => String(h || "").trim().toLowerCase())
  const exact = (n: string) => header.indexOf(n)
  const find = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)))
  const pick = (n: string, ...keys: string[]) => (exact(n) >= 0 ? exact(n) : find(...keys))
  const iSku = pick("sku_no", "sku", "item number", "itemnumber")
  const iStyle = pick("sku_parent", "style", "parent")
  const iName = pick("name", "product", "title")
  const iBrand = pick("brand", "manufacturer")
  const iDesc = exact("description") >= 0 ? exact("description") : pick("description_short", "desc")
  const iColor = pick("color", "colour"); const iSize = pick("size")
  const iPrice = pick("1+", "price", "msrp", "wholesale", "net", "cost")
  const iCat = pick("type", "category", "cat")
  const imgCols = header.map((h, idx) => ({ h, idx })).filter((x) => /image|img|photo/.test(x.h)).map((x) => x.idx)
  const mainIdx = exact("image_main"); const imageOrder = mainIdx >= 0 ? [mainIdx, ...imgCols.filter((i) => i !== mainIdx)] : imgCols
  const out: OttoImportRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; const g = (i: number) => (i >= 0 && i < row.length ? String(row[i] || "").trim() : "")
    const sku = g(iSku) || g(iStyle); if (!sku) continue
    let image = ""; for (const i of imageOrder) { const v = g(i); if (v && /^https?:\/\//i.test(v)) { image = v; break } if (v && !image) image = v }
    out.push({ sku, style: g(iStyle) || undefined, name: g(iName) || undefined, brand: g(iBrand) || undefined, description: g(iDesc) || undefined, color: g(iColor) || undefined, size: g(iSize) || undefined, price: g(iPrice) ? g(iPrice).replace(/[^0-9.]/g, "") : undefined, image: driveImg(image) || undefined, category: g(iCat) || undefined })
  }
  return out
}

type Item =
  | { supplier: "ss"; id: string; ss: SsStyle }
  | { supplier: "otto"; id: string; otto: OttoStyle }

// One feed across BOTH suppliers — no tab-switching. Each card is badged S&S / Otto and
// shows its brand. S&S streams from the full live catalog; Otto from the imported set.
export function AllSuppliers() {
  const isAdmin = getUser()?.role === "admin"
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [sup, setSup] = useState<"" | "ss" | "otto">("")
  const [brand, setBrand] = useState("")
  const [cat, setCat] = useState("")
  const [minP, setMinP] = useState("")
  const [maxP, setMaxP] = useState("")
  const [items, setItems] = useState<Item[] | null>(null)
  const [ssOff, setSsOff] = useState(0)
  const [ottoOff, setOttoOff] = useState(0)
  const [ssTotal, setSsTotal] = useState(0)
  const [ottoTotal, setOttoTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [allFilters, setAllFilters] = useState<{ brands: string[]; categories: string[]; priceMin: number | null; priceMax: number | null } | null>(null)
  useEffect(() => {
    const t = setTimeout(() => { getCatalogFilters().then(setAllFilters).catch(() => {}) }, 0)
    return () => clearTimeout(t)
  }, [])
  const [addingId, setAddingId] = useState<string | null>(null)
  // Supplier products used to land in the catalog the instant you clicked Add — no look
  // at what was imported, no chance to fix a title/price/sizes first. The resolved
  // product is now staged here and shown in the normal product editor for review.
  const [preview, setPreview] = useState<CatalogProduct | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  // S&S only returns sizes on the STYLE DETAIL, which is the same request the colour
  // swatches already make — so cache both from that one call rather than fetching twice.
  const [detailSizes, setDetailSizes] = useState<Record<string, string[]>>({})
  const [importing, setImporting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { const id = setTimeout(() => setDebounced(search.trim().toLowerCase()), 350); return () => clearTimeout(id) }, [search])

  const fetchPage = useCallback(async (q: string, sOff: number, oOff: number): Promise<Item[]> => {
    const [ss, otto] = await Promise.all([
      getSsStylesAll({ search: q, limit: PAGE, offset: sOff }).catch(() => ({ total: 0, styles: [] as SsStyle[] })),
      getOttoProducts({ search: q, limit: PAGE, offset: oOff }).catch(() => ({ total: 0, items: [] as OttoStyle[] })),
    ])
    setSsTotal(ss.total ?? 0); setOttoTotal(otto.total ?? 0)
    const ssStyles = ss.styles ?? []
    // Resolve S&S thumbnails + colors + PRICE for this page (batched, cached). Resolve when
    // the image, the colors, OR the price is missing — the price comes from the same call.
    const need = ssStyles.filter((s) => !s.image || !s.colors?.length || s.price == null).map((s) => s.styleID)
    if (need.length) {
      const imgs = await getSsStyleImgs(need).catch((): Awaited<ReturnType<typeof getSsStyleImgs>> => ({}))
      for (const s of ssStyles) {
        const hit = imgs[s.styleID]
        if (!hit) continue
        s.image = s.image ?? hit.image
        s.colors = s.colors?.length ? s.colors : (hit.colors ?? [])
        if (s.price == null) s.price = hit.price ?? null
        if (s.priceMax == null) s.priceMax = hit.priceMax ?? null
      }
    }
    const ssItems: Item[] = ssStyles.map((s) => ({ supplier: "ss", id: s.styleID, ss: s }))
    const ottoItems: Item[] = (otto.items ?? []).map((o) => ({ supplier: "otto", id: o.style, otto: o }))
    // Interleave so both suppliers show from the top.
    const merged: Item[] = []
    const n = Math.max(ssItems.length, ottoItems.length)
    for (let i = 0; i < n; i++) { if (ssItems[i]) merged.push(ssItems[i]); if (ottoItems[i]) merged.push(ottoItems[i]) }
    return merged
  }, [])

  const reload = useCallback((q: string) => {
    if (!getToken()) { setItems([]); return }
    setLoading(true); setSsOff(0); setOttoOff(0)
    fetchPage(q, 0, 0).then((m) => setItems(m)).catch(() => setItems([])).finally(() => setLoading(false))
  }, [fetchPage])

  useEffect(() => { const id = setTimeout(() => reload(debounced), 0); return () => clearTimeout(id) }, [debounced, reload])

  const loadMore = async () => {
    setLoading(true)
    const sOff = ssOff + PAGE, oOff = ottoOff + PAGE
    setSsOff(sOff); setOttoOff(oOff)
    try { const m = await fetchPage(debounced, sOff, oOff); setItems((prev) => [...(prev ?? []), ...m]) } finally { setLoading(false) }
  }

  const cardData = (it: Item) => it.supplier === "ss"
    // Favourites arrive WITH their sizes joined from the synced skus, so prefer those over
    // the lazily-fetched detail — the favourites tab was showing em-dashes because it was
    // waiting on a detail call that only fires when you open a card.
    // S&S: assert one-size ONLY once its sizes are actually resolved (favourite-joined, or
    // a detail call has returned) and came back empty — before that, empty means unloaded,
    // so oneSize stays undefined and the card shows "—".
    ? { id: it.ss.styleID, title: it.ss.title, brand: it.ss.brand, subtitle: it.ss.category, image: it.ss.image, price: it.ss.price, priceMax: it.ss.priceMax, colors: it.ss.colors, sizes: (it.ss.sizes?.length ? it.ss.sizes : detailSizes[`ss:${it.ss.styleID}`]) ?? [], sizesCount: it.ss.sizes?.length ?? undefined, oneSize: ((it.ss.sizes?.length ? it.ss.sizes : detailSizes[`ss:${it.ss.styleID}`])?.length === 0) && (it.ss.sizes !== undefined || detailSizes[`ss:${it.ss.styleID}`] !== undefined), favorited: it.ss.favorited }
    // Otto: the list returns every size, so an empty set is a real fact — the product has
    // no size dimension, i.e. one size / OSFM.
    : { id: it.otto.style, title: it.otto.name || it.otto.style, brand: it.otto.brand || "Otto Cap", subtitle: it.otto.category || undefined, image: driveImg(it.otto.image), price: it.otto.price, priceMax: it.otto.price_max, colors: it.otto.colors, sizes: it.otto.sizes ?? [], sizesCount: it.otto.sizes?.length ?? 0, oneSize: (it.otto.sizes?.length ?? 0) === 0, favorited: it.otto.favorited }

  const keyOf = (it: Item) => `${it.supplier}:${it.id}`

  // ── Quick order ────────────────────────────────────────────────────────────
  // Buying is not the same act as listing. "Add to catalog" decides what we SELL;
  // this decides what we BUY, and it goes to the to-order list without importing
  // anything — needing six of a blank shouldn't put it on the shop.
  const [quickOrder, setQuickOrder] = useState<QuickOrderProduct | null>(null)
  /**
   * Resolve a card into something orderable.
   *
   * The card only carries size STRINGS, so building a sku as `style-size` produced codes
   * like "10-271-L/XL" that no supplier has ever heard of — they'd be rejected at order
   * time, and they carry no image because nothing in the catalogue matches them. Otto's
   * real variant skus live on the style detail, so fetch them.
   */
  /**
   * S&S variants for one style, live.
   *
   * Returns the REASON on failure rather than an empty list. Swallowing the error made a
   * broken lookup indistinguishable from a product that genuinely has no sizes — the
   * dialog then said "this product lists no sizes" about a cap with forty, which sends
   * you looking at the product instead of the request.
   */
  const loadSsVariants = async (styleId: string) => {
    try {
      const d = await getSsStyleSkus(styleId)
      if (d?.error) return { sizes: [], error: d.error }
      const sizes = (d?.products ?? []).map((p) => ({
        size: [p.color, p.size].filter(Boolean).join(" / ") || p.sku,
        sku: p.sku, price: typeof p.price === "number" ? p.price : Number(p.price) || null,
        image: p.image ?? null,
      }))
      return { sizes, error: sizes.length ? null : "S&S returned no orderable skus for this style." }
    } catch (e) {
      return { sizes: [], error: e instanceof Error ? e.message : "Couldn't reach S&S." }
    }
  }

  const loadOttoVariants = async (style: string) => {
    try {
      const d = await getOttoStyle(style)
      const vs = Array.isArray(d?.variants) ? d.variants : []
      const sizes = vs.map((v) => ({
        // Otto colour names arrive as supplier codes ("S.Pnk/Blk/H.Pnk"); tidy them so a
        // row reads as a colour rather than an abbreviation nobody says out loud.
        size: [prettyColor(v.color), v.size].filter(Boolean).join(" / ") || v.sku,
        sku: v.sku, price: v.price ?? null, image: driveImg(v.image) || null,
      }))
      return { sizes, error: sizes.length ? null : "Otto returned no variants for this style." }
    } catch (e) { return { sizes: [], error: e instanceof Error ? e.message : "Couldn't reach Otto Cap." } }
  }

  const quickOrderFor = (it: Item): QuickOrderProduct => {
    const d = cardData(it)
    // S&S sizes are only loaded once a card has been expanded; Otto ships them with the
    // style. Either way an empty list is shown honestly rather than guessed at.
    const sizes = (d.sizes ?? []).map((sz: unknown) => {
      const o = (typeof sz === "string" ? { size: sz } : (sz ?? {})) as { size?: string; name?: string; sku?: string | null; price?: number | null }
      return { size: String(o.size ?? o.name ?? sz), sku: o.sku ?? null, price: o.price ?? null }
    })
    return {
      style: String(d.id),
      name: d.title || String(d.id),
      supplier: it.supplier === "ss" ? "S&S Activewear" : "Otto Cap",
      image: d.image ?? null,
      sizes,
      defaultPrice: typeof d.price === "number" ? d.price : Number(d.price) || null,
    }
  }

  // Step 1 — resolve the supplier style into our catalog shape and STAGE it. Nothing is
  // written yet; the editor below is the confirm step.
  const addToCatalog = async (it: Item) => {
    setAddingId(keyOf(it)); setMsg(null)
    try {
      const product = it.supplier === "ss"
        ? await ssCatalogProduct(it.id, { title: it.ss.title, price: it.ss.price, image: it.ss.image, colors: colorNames(it.ss.colors) })
        : await ottoCatalogProduct(it.id, { name: it.otto.name, price: it.otto.price, image: it.otto.image, colors: it.otto.colors })
      setPreview(product); setPreviewKey(keyOf(it))
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't load that product.") } finally { setAddingId(null) }
  }

  // Step 2 — the reviewed (possibly edited) product is what gets saved. Re-reads the
  // catalog at save time so a product added in another tab isn't clobbered.
  const confirmAdd = async (product: CatalogProduct) => {
    setMsg(null)
    try {
      const existing = await getCatalogProducts().catch(() => [] as CatalogProduct[])
      const next = existing.some((p) => p.id === product.id) ? existing.map((p) => (p.id === product.id ? product : p)) : [...existing, product]
      await saveCatalogProducts(next)
      if (previewKey) setAdded((prev) => new Set(prev).add(previewKey))
      setPreview(null); setPreviewKey(null)
      setMsg(`Added "${product.name ?? "product"}" to your catalog.`)
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't add to catalog.") }
  }

  const favorite = (it: Item, on: boolean) => {
    if (it.supplier === "ss") toggleSsFavorite(it.ss, on).catch(() => {})
    else toggleOttoFavorite({ style: it.otto.style, name: it.otto.name, image: it.otto.image, price: it.otto.price }, on).catch(() => {})
  }

  const loadColors = (it: Item) => it.supplier === "ss"
    ? () => getSsStyle(it.id).then((d) => {
        if (!d || d.error) return {}
        if (d.sizes?.length) setDetailSizes((p) => ({ ...p, [`ss:${it.id}`]: d.sizes! }))
        return d.colorImages ?? {}
      })
    : () => getOttoStyle(it.id).then((d) => (d && !d.error ? driveMap(d.colorImages) : {}))

  const onImport = async (file?: File) => {
    if (!file) return
    setImporting(true); setMsg(null)
    try {
      let rows: string[][]
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import("xlsx"); const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
        rows = (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: "" }) as unknown[][]).map((r) => r.map((c) => String(c ?? "")))
      } else rows = parseCSV(await file.text())
      const products = mapOttoRows(rows)
      if (!products.length) throw new Error("No product rows found — check the header row.")
      const r = await importOttoProducts(products)
      if (r.error) throw new Error(r.error)
      setMsg(`Imported ${r.imported ?? products.length} Otto rows.`); reload(debounced)
    } catch (e) { setMsg(e instanceof Error ? e.message : "Import failed.") } finally { setImporting(false); if (fileRef.current) fileRef.current.value = "" }
  }

  // Filters (supplier / brand / category / price) — applied to what's loaded, like SpyDeck.
  const brandOf = (it: Item) => (it.supplier === "ss" ? it.ss.brand || "" : it.otto.brand || "Otto Cap")
  const catOf = (it: Item) => (it.supplier === "ss" ? it.ss.category || "" : it.otto.category || "")
  const priceOf = (it: Item) => Number(it.supplier === "ss" ? it.ss.price : it.otto.price) || 0
  const pool = (items ?? []).filter((it) => !sup || it.supplier === sup)
  // Filter options come from the WHOLE catalogue, not the loaded page. Deriving them from
  // `pool` meant a brand two pages deep was never offered — and the fewer results a search
  // returned, the fewer ways there were to narrow it, which is exactly backwards.
  // Falls back to the on-screen values if the lookup fails, so the filters still work.
  const poolBrands = Array.from(new Set(pool.map(brandOf).filter(Boolean))).sort()
  const poolCats = Array.from(new Set(pool.map(catOf).filter(Boolean))).sort()
  const brands = allFilters?.brands?.length ? allFilters.brands : poolBrands
  const cats = allFilters?.categories?.length ? allFilters.categories : poolCats
  // The supplier pool runs to thousands of blanks once a few catalogs are loaded, so the
  // grid pages rather than rendering everything — the filters narrow WHAT you see, paging
  // keeps the page from becoming unusable when they don't narrow enough.
  const visible = (items ?? []).filter((it) => {
    if (sup && it.supplier !== sup) return false
    if (brand && brandOf(it) !== brand) return false
    if (cat && catOf(it) !== cat) return false
    const p = priceOf(it)
    if (minP && p < Number(minP)) return false
    if (maxP && p > Number(maxP)) return false
    return true
  })
  const paged = usePaged(visible, 48)
  const anyFilter = !!(sup || brand || cat || minP || maxP)
  const clearFilters = () => { setSup(""); setBrand(""); setCat(""); setMinP(""); setMaxP("") }

  const total = ssTotal + ottoTotal
  const canLoadMore = (items?.length ?? 0) < total

  return (
    // No title — the "All suppliers" tab already names it. The toolbar is the top of the card.
    <SectionCard>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="relative max-w-md flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all blanks by name, brand, style, SKU…" className="h-9 pl-9" />
        </div>
        {total > 0 && <span className="text-xs text-muted-foreground">{total.toLocaleString()} blanks</span>}
        {isAdmin && (
          <>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} weight="bold" />} Import Otto
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setRefreshing(true); ssWarm().catch(() => {}).finally(() => setRefreshing(false)) }} disabled={refreshing}>
              <ArrowsClockwise size={14} weight="bold" className={refreshing ? "animate-spin" : ""} /> Refresh
            </Button>
          </>
        )}
        {/* The sync controls live in THIS row now. They had a strip of their own that was
            empty whenever a sync wasn't running, which is nearly always — a full-width
            border and 3rem of padding to hold one button. Progress still appears, but
            below, and only while there is progress to show. */}
        <SsSyncPanel />
      </div>

      {/* Filters — brand / category / price, applied to what's loaded */}
      {items !== null && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm">
          <select value={sup} onChange={(e) => { setSup(e.target.value as "" | "ss" | "otto"); setBrand(""); setCat("") }} className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <option value="">All suppliers</option>
            <option value="ss">S&amp;S Activewear</option>
            <option value="otto">Otto Cap</option>
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">$</span>
            <Input value={minP} onChange={(e) => setMinP(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={allFilters?.priceMin != null ? String(allFilters.priceMin) : "min"} inputMode="decimal" className="h-8 w-16 px-2" />
            <span className="text-muted-foreground">–</span>
            <Input value={maxP} onChange={(e) => setMaxP(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={allFilters?.priceMax != null ? String(allFilters.priceMax) : "max"} inputMode="decimal" className="h-8 w-16 px-2" />
          </div>
          {anyFilter && <button onClick={clearFilters} className="text-xs font-medium text-primary hover:underline">Clear filters</button>}
          <span className="ml-auto text-xs text-muted-foreground">{visible.length.toLocaleString()} shown</span>
        </div>
      )}

      {msg && <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">{msg}</div>}

      {items === null ? (
        <Loading label="Loading catalog…" />
      ) : (
        <>
          {visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{anyFilter ? "No loaded blanks match these filters — load more to widen the pool." : `No blanks match “${debounced}”.`}</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
              {paged.pageItems.map((it) => (
                <SupplierProductCard
                  key={keyOf(it)}
                  data={cardData(it)}
                  supplierLabel={it.supplier === "ss" ? "S&S" : "Otto"}
                  added={added.has(keyOf(it))}
                  adding={addingId === keyOf(it)}
                  onAdd={() => addToCatalog(it)}
                  onQuickOrder={async () => {
                    const base = quickOrderFor(it)
                    // Otto sizes have no sku on the card; fetch the real ones so what's
                    // ordered is a code the supplier recognises.
                    // BOTH suppliers need their real variants fetched: an S&S card only
                    // has sizes once it's been expanded, so quick-ordering an unexpanded
                    // one showed "this product lists no sizes" for a product that has 40.
                    const r = it.supplier === "otto"
                      ? await loadOttoVariants(it.id)
                      : await loadSsVariants(it.id)
                    setQuickOrder(r.sizes.length ? { ...base, sizes: r.sizes } : { ...base, loadError: r.error ?? undefined })
                  }}
                  onFavorite={(on) => favorite(it, on)}
                  loadColors={loadColors(it)}
                  // S&S only — Otto has no live per-style fetch, so it gets no button.
                  // Sync this one style, then reload the grid so its fresh sizes/colours
                  // (and price) replace the "—" without touching the rest of the page.
                  onSync={it.supplier === "ss" ? async () => {
                    const r = await ssSync([it.ss.styleID])
                    if (r?.error) { setMsg(r.error); return }
                    reload(debounced)
                  } : undefined}
                />
              ))}
            </div>
          )}
          {visible.length > paged.perPage && (
            <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage}
              total={paged.total} start={paged.start}
              onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[48, 96, 192]} />
          )}
          {canLoadMore && (
            <div className="flex justify-center border-t border-border p-4">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
                {loading ? <CircleNotch size={14} className="animate-spin" /> : `Load more (${items.length}/${total.toLocaleString()})`}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Review step. Reuses the catalog's own product editor, so an imported product is
          checked and corrected through exactly the same form used to edit one later.
          newIdSeed is 0 because the staged product already carries its supplier-derived
          id — the seed only mints one for a brand-new product. */}
      <ProductEditorDialog
        open={!!preview}
        onOpenChange={(v) => { if (!v) { setPreview(null); setPreviewKey(null) } }}
        product={preview}
        onSave={confirmAdd}
        newIdSeed={0}
        title="Review before adding"
        ctaLabel="Add to catalog"
      />
      <QuickOrderDialog
        product={quickOrder}
        onClose={() => setQuickOrder(null)}
        onAdded={() => setMsg("Added to the order list — review and place it on the Purchase page.")}
      />
    </SectionCard>
  )
}
