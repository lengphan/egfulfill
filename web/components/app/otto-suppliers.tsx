"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { UploadSimple, MagnifyingGlass, CircleNotch, Info } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { SupplierProductCard } from "@/components/app/supplier-product-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseCSV } from "@/lib/order-import"
import { getOttoStatus, getOttoProducts, getOttoStyle, importOttoProducts, toggleOttoFavorite, getCatalogProducts, saveCatalogProducts, type OttoStyle, type OttoImportRow, type CatalogProduct } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"

const PAGE = 60

// Otto's Product Data stores images as Google Drive links, which don't render in an <img>
// (Drive blocks hotlinking). Rewrite them to Drive's embeddable thumbnail URL, which does.
function driveImg(url?: string | null): string {
  if (!url) return ""
  const s = String(url)
  const m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : s
}
const driveMap = (m?: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m ?? {})) out[k] = driveImg(v)
  return out
}

// Map the Product Data export → normalized rows. Otto's real headers are known
// (sku_no, sku_parent, name, description, 1+, image_main, color, size, type…); we match
// those exactly, with tolerant fallbacks so a differently-shaped CSV still imports.
function mapRows(rows: string[][]): OttoImportRow[] {
  if (rows.length < 2) return []
  const header = rows[0].map((h) => String(h || "").trim().toLowerCase())
  const exact = (name: string) => header.indexOf(name)
  const find = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)))
  const pick = (name: string, ...keys: string[]) => (exact(name) >= 0 ? exact(name) : find(...keys))
  const iSku = pick("sku_no", "sku", "item number", "item#", "item no", "itemnumber")
  const iStyle = pick("sku_parent", "style", "parent")
  const iName = pick("name", "product", "title")
  const iDesc = exact("description") >= 0 ? exact("description") : pick("description_short", "description", "desc")
  const iColor = pick("color", "colour")
  const iSize = pick("size")
  const iPrice = pick("1+", "price", "msrp", "wholesale", "net", "cost") // Otto's 1+ = unit price at qty 1
  const iCat = pick("type", "category", "cat")
  // Image can live in image_main OR image_1…image_10 — collect them all, prefer image_main.
  const imgCols = header.map((h, idx) => ({ h, idx })).filter((x) => /image|img|photo/.test(x.h)).map((x) => x.idx)
  const mainIdx = exact("image_main")
  const imageOrder = mainIdx >= 0 ? [mainIdx, ...imgCols.filter((i) => i !== mainIdx)] : imgCols
  const out: OttoImportRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const g = (i: number) => (i >= 0 && i < row.length ? String(row[i] || "").trim() : "")
    const sku = g(iSku) || g(iStyle)
    if (!sku) continue
    let image = ""
    for (const i of imageOrder) { const v = g(i); if (v && /^https?:\/\//i.test(v)) { image = v; break } if (v && !image) image = v }
    out.push({
      sku,
      style: g(iStyle) || undefined,
      name: g(iName) || undefined,
      description: g(iDesc) || undefined,
      color: g(iColor) || undefined,
      size: g(iSize) || undefined,
      price: g(iPrice) ? g(iPrice).replace(/[^0-9.]/g, "") : undefined,
      image: driveImg(image) || undefined,
      category: g(iCat) || undefined,
    })
  }
  return out
}

export function OttoSuppliers() {
  const isAdmin = getUser()?.role === "admin"
  const [status, setStatus] = useState<{ count: number; last: string | null } | null>(null)
  const [items, setItems] = useState<OttoStyle[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadStatus = useCallback(() => {
    if (!getToken()) return
    getOttoStatus().then((s) => setStatus({ count: s.count ?? 0, last: s.last ?? null })).catch(() => setStatus({ count: 0, last: null }))
  }, [])

  const load = useCallback((off: number, q: string) => {
    if (!getToken()) return
    setLoading(true)
    getOttoProducts({ search: q, limit: PAGE, offset: off })
      .then((r) => { setItems((prev) => (off ? [...prev, ...(r.items ?? [])] : (r.items ?? []))); setTotal(r.total ?? 0) })
      .catch(() => { if (!off) setItems([]) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { const id = setTimeout(loadStatus, 0); return () => clearTimeout(id) }, [loadStatus])
  // Debounced search + initial load.
  useEffect(() => {
    const id = setTimeout(() => { setOffset(0); load(0, search.trim().toLowerCase()) }, 300)
    return () => clearTimeout(id)
  }, [search, load])

  const onFile = async (file?: File) => {
    if (!file) return
    setImporting(true); setErr(null); setMsg(null)
    try {
      let rows: string[][]
      if (/\.xlsx?$/i.test(file.name)) {
        // Lazy-load SheetJS only when an actual spreadsheet is imported (keeps the bundle small).
        const XLSX = await import("xlsx")
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][]
        rows = raw.map((r) => r.map((c) => String(c ?? "")))
      } else {
        rows = parseCSV(await file.text())
      }
      const products = mapRows(rows)
      if (!products.length) throw new Error("No product rows found — check the file has a header row with SKU/Style columns.")
      const r = await importOttoProducts(products)
      if (r.error) throw new Error(r.error)
      setMsg(`Imported ${r.imported ?? products.length} rows · ${r.total ?? 0} SKUs in catalog.`)
      loadStatus(); setOffset(0); load(0, search.trim().toLowerCase())
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed.")
    } finally { setImporting(false); if (fileRef.current) fileRef.current.value = "" }
  }

  const addToCatalog = async (s: OttoStyle) => {
    setAddingId(s.style); setErr(null)
    try {
      const id = "OTTO-" + s.style
      // Pull the full product detail so the catalog gets the photo matching each color.
      const d = await getOttoStyle(s.style).catch(() => null)
      const colorImages: Record<string, string> = (d && !d.error && d.colorImages) ? driveMap(d.colorImages) : {}
      if (Object.keys(colorImages).length === 0) for (const c of s.colors ?? []) colorImages[c] = driveImg(s.image)
      const product: CatalogProduct = {
        id, name: d?.name || s.name || s.style, type: "Headwear", method: "Embroidery", status: "Active",
        price: Number(d?.price ?? s.price) || 0, basePrice: Number(d?.price ?? s.price) || 0,
        sizes: d?.sizes ?? s.sizes ?? [], colorImages, mainColor: Object.keys(colorImages)[0] || (s.colors ?? [])[0],
        img: driveImg(d?.image ?? s.image) || undefined, sku: s.skus?.[0] || s.style,
        description: d?.description ?? s.description ?? undefined, supplier: "Otto Cap",
      }
      const existing = await getCatalogProducts().catch(() => [] as CatalogProduct[])
      const next = existing.some((p) => p.id === id) ? existing.map((p) => (p.id === id ? product : p)) : [...existing, product]
      const r = await saveCatalogProducts(next)
      if (r.error) throw new Error(r.error)
      setAdded((prev) => new Set(prev).add(s.style))
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add to catalog.")
    } finally { setAddingId(null) }
  }

  const empty = status && status.count === 0

  return (
    <SectionCard title="Otto Cap" description="Imported from Otto's Product Data export — live price/stock via their Inventory API">
      {/* Import bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="relative max-w-md flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search caps by style, name, or SKU…" className="h-9 pl-9" />
        </div>
        <span className="text-xs text-muted-foreground">{status ? `${status.count.toLocaleString()} SKUs` : "…"}</span>
        {isAdmin && (
          <>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} weight="bold" />} {importing ? "Importing…" : "Import Product Data (CSV / XLSX)"}
            </Button>
          </>
        )}
      </div>

      {err && <div className="border-b border-border px-4 py-2 text-sm text-destructive">{err}</div>}
      {msg && <div className="border-b border-border px-4 py-2 text-sm text-emerald-600">{msg}</div>}

      {empty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Info size={22} weight="duotone" /></span>
          <div className="font-medium">No Otto catalog imported yet</div>
          <div className="max-w-md text-sm text-muted-foreground">
            Otto has no live catalog API. In the Otto dashboard go to <span className="font-medium text-foreground">My Account → Marketing Tools → Download → Product Data</span>, then {isAdmin ? "import the CSV here." : "ask an admin to import it here."}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((s) => (
              <SupplierProductCard
                key={s.style}
                data={{ id: s.style, title: s.name || s.style, subtitle: s.category || s.style, image: driveImg(s.image), price: s.price, priceMax: s.price_max, colors: s.colors, sizesCount: s.sizes?.length ?? 0, favorited: s.favorited }}
                added={added.has(s.style)}
                adding={addingId === s.style}
                onAdd={() => addToCatalog(s)}
                onFavorite={(on) => toggleOttoFavorite({ style: s.style, name: s.name, image: s.image, price: s.price }, on).catch(() => {})}
                loadColors={() => getOttoStyle(s.style).then((d) => (d && !d.error ? driveMap(d.colorImages) : {}))}
              />
            ))}
          </div>
          {items.length < total && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => { const n = offset + PAGE; setOffset(n); load(n, search.trim().toLowerCase()) }} disabled={loading}>
                {loading ? <CircleNotch size={14} className="animate-spin" /> : `Load more (${items.length}/${total})`}
              </Button>
            </div>
          )}
          {loading && items.length === 0 && <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>}
        </>
      )}
    </SectionCard>
  )
}
