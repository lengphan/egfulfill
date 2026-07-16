"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MagnifyingGlass, UploadSimple, ArrowsClockwise, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { SupplierProductCard } from "@/components/app/supplier-product-card"
import { Loading } from "@/components/app/loading"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseCSV } from "@/lib/order-import"
import {
  getSsStylesAll, getSsStyleImgs, getSsStyle, toggleSsFavorite, ssWarm,
  getOttoProducts, getOttoStyle, toggleOttoFavorite, importOttoProducts,
  getCatalogProducts, saveCatalogProducts,
  type SsStyle, type OttoStyle, type OttoImportRow, type CatalogProduct,
} from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { driveImg, driveMap, ssCatalogProduct, ottoCatalogProduct } from "@/lib/supplier-catalog"

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
    out.push({ sku, style: g(iStyle) || undefined, name: g(iName) || undefined, description: g(iDesc) || undefined, color: g(iColor) || undefined, size: g(iSize) || undefined, price: g(iPrice) ? g(iPrice).replace(/[^0-9.]/g, "") : undefined, image: driveImg(image) || undefined, category: g(iCat) || undefined })
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
  const [items, setItems] = useState<Item[] | null>(null)
  const [ssOff, setSsOff] = useState(0)
  const [ottoOff, setOttoOff] = useState(0)
  const [ssTotal, setSsTotal] = useState(0)
  const [ottoTotal, setOttoTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
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
    // Resolve S&S thumbnails for this page (batched, cached).
    const need = ssStyles.filter((s) => !s.image).map((s) => s.styleID)
    if (need.length) {
      const imgs = await getSsStyleImgs(need).catch(() => ({} as Record<string, { image: string | null; colors: string[] }>))
      for (const s of ssStyles) { const hit = imgs[s.styleID]; if (hit) { s.image = s.image ?? hit.image; s.colors = s.colors?.length ? s.colors : (hit.colors ?? []) } }
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
    ? { id: it.ss.styleID, title: it.ss.title, brand: it.ss.brand, subtitle: it.ss.category, image: it.ss.image, price: it.ss.price, colors: it.ss.colors, favorited: it.ss.favorited }
    : { id: it.otto.style, title: it.otto.name || it.otto.style, subtitle: it.otto.category || undefined, image: driveImg(it.otto.image), price: it.otto.price, priceMax: it.otto.price_max, colors: it.otto.colors, sizesCount: it.otto.sizes?.length ?? 0, favorited: it.otto.favorited }

  const keyOf = (it: Item) => `${it.supplier}:${it.id}`

  const addToCatalog = async (it: Item) => {
    setAddingId(keyOf(it)); setMsg(null)
    try {
      const existing = await getCatalogProducts().catch(() => [] as CatalogProduct[])
      const product = it.supplier === "ss"
        ? await ssCatalogProduct(it.id, { title: it.ss.title, price: it.ss.price, image: it.ss.image, colors: it.ss.colors })
        : await ottoCatalogProduct(it.id, { name: it.otto.name, price: it.otto.price, image: it.otto.image, colors: it.otto.colors })
      const next = existing.some((p) => p.id === product.id) ? existing.map((p) => (p.id === product.id ? product : p)) : [...existing, product]
      await saveCatalogProducts(next)
      setAdded((prev) => new Set(prev).add(keyOf(it)))
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't add to catalog.") } finally { setAddingId(null) }
  }

  const favorite = (it: Item, on: boolean) => {
    if (it.supplier === "ss") toggleSsFavorite(it.ss, on).catch(() => {})
    else toggleOttoFavorite({ style: it.otto.style, name: it.otto.name, image: it.otto.image, price: it.otto.price }, on).catch(() => {})
  }

  const loadColors = (it: Item) => it.supplier === "ss"
    ? () => getSsStyle(it.id).then((d) => (d && !d.error ? d.colorImages ?? {} : {}))
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

  const total = ssTotal + ottoTotal
  const canLoadMore = (items?.length ?? 0) < total

  return (
    <SectionCard title="All suppliers" description="S&S Activewear + Otto Cap in one feed — each card shows its supplier & brand">
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
      </div>

      {msg && <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">{msg}</div>}

      {items === null ? (
        <Loading label="Loading catalog…" />
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No blanks match “{debounced}”.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => (
              <SupplierProductCard
                key={keyOf(it)}
                data={cardData(it)}
                supplierLabel={it.supplier === "ss" ? "S&S" : "Otto"}
                added={added.has(keyOf(it))}
                adding={addingId === keyOf(it)}
                onAdd={() => addToCatalog(it)}
                onFavorite={(on) => favorite(it, on)}
                loadColors={loadColors(it)}
              />
            ))}
          </div>
          {canLoadMore && (
            <div className="flex justify-center border-t border-border p-4">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
                {loading ? <CircleNotch size={14} className="animate-spin" /> : `Load more (${items.length}/${total.toLocaleString()})`}
              </Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}
