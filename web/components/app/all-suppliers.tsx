"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import { UploadSimple, CircleNotch, Package } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { SearchField } from "@/components/app/search-field"
import { usePaged, Pagination } from "@/components/app/pagination"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SupplierDetailDialog } from "@/components/app/supplier-detail-dialog"
import { QuickOrderDialog, type QuickOrderProduct } from "@/components/app/quick-order-dialog"
import { SsSyncPanel } from "@/components/app/ss-sync-panel"
import { SupplierProductCard } from "@/components/app/supplier-product-card"
import { ProductEditorDialog } from "@/components/app/product-editor-dialog"
import { Loading } from "@/components/app/loading"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseCSV } from "@/lib/order-import"
import {
 getSsStylesAll, getSsStyleImgs, getSsStyle, toggleSsFavorite, ssSync, startSsSyncAll,
 getOttoProducts, getOttoStyle, getSsStyleSkus, getCatalogFilters, toggleOttoFavorite, importOttoProducts,
 getSanmarCatalog, getSanmarCatalogStyle, toggleSanmarFavorite, syncSanmarCatalog,
 getCatalogProducts, saveCatalogProducts, colorNames,
 type SsStyle, type OttoStyle, type OttoImportRow, type SanmarCatalogStyle, type CatalogProduct,
} from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { driveImg, prettyColor, driveMap, ssCatalogProduct, ssStockByColor, ottoCatalogProduct, sanmarCatalogProduct } from "@/lib/supplier-catalog"
import { nextEgSku } from "@/lib/sku"
import { ourSku } from "@/lib/our-sku"
import { EmptyState } from "@/components/app/empty-state"

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
  | { supplier: "sanmar"; id: string; sanmar: SanmarCatalogStyle }

// One feed across ALL suppliers — no tab-switching. Each card is badged S&S / Otto / SanMar
// and shows its brand. S&S streams from the full live catalog; Otto and SanMar from their
// imported sets (SanMar's is the SDL/EPDD flat file, ingested into sanmar_products).
/** `refreshKey` — bumped by the tab shell when this view is re-shown. It stays mounted
 * between tab switches (that's what makes switching instant), so this is what re-reads
 * the catalogue after a heart was changed on the Favorites tab. `reload` keeps the
 * current grid on screen while it refetches, so the refresh doesn't flash. */
export function AllSuppliers({ refreshKey = 0 }: { refreshKey?: number }) {
  const tl = useLabelT()
 const isAdmin = getUser()?.role === "admin"
 const [search, setSearch] = useState("")
 const [debounced, setDebounced] = useState("")
 const [sup, setSup] = useState<"" | "ss" | "otto" | "sanmar">("")
 const [brand, setBrand] = useState("")
 const [cat, setCat] = useState("")
 const [minP, setMinP] = useState("")
 const [maxP, setMaxP] = useState("")
 const [items, setItems] = useState<Item[] | null>(null)
 const [ssOff, setSsOff] = useState(0)
 const [ottoOff, setOttoOff] = useState(0)
 const [sanmarOff, setSanmarOff] = useState(0)
 const [ssTotal, setSsTotal] = useState(0)
 const [ottoTotal, setOttoTotal] = useState(0)
 const [sanmarTotal, setSanmarTotal] = useState(0)
 const [loading, setLoading] = useState(false)
  /**
   * WHAT IS ALREADY IN OUR CATALOGUE.
   *
   * This only ever recorded what YOU added in this session, so a refresh made every card
   * look untouched — and browsing 4,000 styles with no idea which you had already taken is
   * how the same blank gets added three times under three names.
   *
   * Seeded from the catalogue itself on load, matched on the id the builders write
   * (SS-1717 / OTTO-39 / SANMAR-K500), so it survives a reload and is true across people
   * rather than per-tab.
   */
 const [added, setAdded] = useState<Set<string>>(new Set())
 const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
 useEffect(() => {
 const t = setTimeout(() => {
 getCatalogProducts()
        .then((r) => setAddedIds(new Set((r ?? []).map((p) => String(p.id || "")).filter(Boolean))))
        .catch(() => { /* the grid still works; cards just cannot say "Added" */ })
    }, 0)
 return () => clearTimeout(t)
  }, [refreshKey])
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
  /** Per-colour supplier stock for the review step. null = not asked (Otto / SanMar). */
 const [previewStock, setPreviewStock] = useState<Record<string, number> | null>(null)
  /** The next free EG-#### to offer in the review step — see addToCatalog. */
 const [previewNextSku, setPreviewNextSku] = useState<string | undefined>(undefined)
  // S&S only returns sizes on the STYLE DETAIL, which is the same request the colour
  // swatches already make — so cache both from that one call rather than fetching twice.
 const [detailSizes, setDetailSizes] = useState<Record<string, string[]>>({})
 const [importing, setImporting] = useState(false)
 const [refreshing, setRefreshing] = useState(false)
 const [msg, setMsg] = useState<string | null>(null)
 const fileRef = useRef<HTMLInputElement>(null)

 useEffect(() => { const id = setTimeout(() => setDebounced(search.trim().toLowerCase()), 350); return () => clearTimeout(id) }, [search])

 const fetchPage = useCallback(async (q: string, sOff: number, oOff: number, saOff: number): Promise<Item[]> => {
 const [ss, otto, sanmar] = await Promise.all([
 getSsStylesAll({ search: q, limit: PAGE, offset: sOff }).catch(() => ({ total: 0, styles: [] as SsStyle[] })),
 getOttoProducts({ search: q, limit: PAGE, offset: oOff }).catch(() => ({ total: 0, items: [] as OttoStyle[] })),
 getSanmarCatalog({ search: q, limit: PAGE, offset: saOff }).catch(() => ({ total: 0, items: [] as SanmarCatalogStyle[] })),
    ])
 setSsTotal(ss.total ?? 0); setOttoTotal(otto.total ?? 0); setSanmarTotal(sanmar.total ?? 0)
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
 const sanmarItems: Item[] = (sanmar.items ?? []).map((s) => ({ supplier: "sanmar", id: s.style, sanmar: s }))
    // Interleave so every supplier shows from the top.
 const merged: Item[] = []
 const n = Math.max(ssItems.length, ottoItems.length, sanmarItems.length)
 for (let i = 0; i < n; i++) { if (ssItems[i]) merged.push(ssItems[i]); if (ottoItems[i]) merged.push(ottoItems[i]); if (sanmarItems[i]) merged.push(sanmarItems[i]) }
 return merged
  }, [])

 const reload = useCallback((q: string) => {
 if (!getToken()) { setItems([]); return }
 setLoading(true); setSsOff(0); setOttoOff(0); setSanmarOff(0)
 fetchPage(q, 0, 0, 0).then((m) => setItems(m)).catch(() => setItems([])).finally(() => setLoading(false))
  }, [fetchPage])

 useEffect(() => { const id = setTimeout(() => reload(debounced), 0); return () => clearTimeout(id) }, [debounced, reload, refreshKey])

 const loadMore = async () => {
 setLoading(true)
 const sOff = ssOff + PAGE, oOff = ottoOff + PAGE, saOff = sanmarOff + PAGE
 setSsOff(sOff); setOttoOff(oOff); setSanmarOff(saOff)
 try { const m = await fetchPage(debounced, sOff, oOff, saOff); setItems((prev) => [...(prev ?? []), ...m]) } finally { setLoading(false) }
  }

 const cardData = (it: Item) => {
    // S&S: favourites arrive WITH their sizes joined from the synced skus, so prefer those
    // over the lazily-fetched detail — the favourites tab was showing em-dashes because it
    // was waiting on a detail call that only fires when you open a card. Assert one-size
    // ONLY once sizes are actually resolved (favourite-joined, or a detail call returned)
    // and came back empty — before that, empty means unloaded, so oneSize stays undefined
    // and the card shows "—".
 if (it.supplier === "ss") return { id: it.ss.styleID, title: it.ss.title, brand: it.ss.brand, subtitle: it.ss.category, image: it.ss.image, price: it.ss.price, priceMax: it.ss.priceMax, colors: it.ss.colors, sizes: (it.ss.sizes?.length ? it.ss.sizes : detailSizes[`ss:${it.ss.styleID}`]) ?? [], sizesCount: it.ss.sizes?.length ?? undefined, oneSize: ((it.ss.sizes?.length ? it.ss.sizes : detailSizes[`ss:${it.ss.styleID}`])?.length === 0) && (it.ss.sizes !== undefined || detailSizes[`ss:${it.ss.styleID}`] !== undefined), favorited: it.ss.favorited }
    // Otto: the list returns every size, so an empty set is a real fact — the product has
    // no size dimension, i.e. one size / OSFM.
 if (it.supplier === "otto") return { id: it.otto.style, title: it.otto.name || it.otto.style, brand: it.otto.brand || "Otto Cap", subtitle: it.otto.category || undefined, image: driveImg(it.otto.image), price: it.otto.price, priceMax: it.otto.price_max, colors: it.otto.colors, sizes: it.otto.sizes ?? [], sizesCount: it.otto.sizes?.length ?? 0, oneSize: (it.otto.sizes?.length ?? 0) === 0, favorited: it.otto.favorited }
    // SanMar: the imported catalog aggregates every colour and size per style, so — like
    // Otto — an empty size set is a real fact. Image is already proxied by the API.
 return { id: it.sanmar.style, title: it.sanmar.name || it.sanmar.style, brand: it.sanmar.brand || "SanMar", subtitle: it.sanmar.category || undefined, image: it.sanmar.image, price: it.sanmar.price, priceMax: it.sanmar.price_max, colors: it.sanmar.colors, sizes: it.sanmar.sizes ?? [], sizesCount: it.sanmar.sizes?.length ?? 0, oneSize: (it.sanmar.sizes?.length ?? 0) === 0, favorited: it.sanmar.favorited }
  }

 const keyOf = (it: Item) => `${it.supplier}:${it.id}`
  /**
   * The catalog id a supplier style becomes once added — SS-1717, OTTO-39, SANMAR-K500.
   * Set by the three builders in lib/supplier-catalog, and the only durable link between a
   * card in this grid and a row in our catalogue.
   */
 const catalogIdOf = (it: Item) =>
    `${it.supplier === "ss" ? "SS" : it.supplier === "otto" ? "OTTO" : "SANMAR"}-${it.id}`

  // ── Quick order ────────────────────────────────────────────────────────────
  // Buying is not the same act as listing. "Add to Products" decides what we SELL;
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

 const loadSanmarVariants = async (style: string) => {
 try {
 const d = await getSanmarCatalogStyle(style)
 if (d?.error) return { sizes: [], error: d.error }
 const sizes = (d.variants ?? []).map((v) => ({
 size: [v.color, v.size].filter(Boolean).join(" / ") || v.sku,
        // SanMar's orderable handle is the inventory key (carried as `sku` by the detail API).
 sku: v.sku, price: v.price ?? null, image: v.image ?? null,
      }))
 return { sizes, error: sizes.length ? null : "This SanMar style has no variants in the imported catalog." }
    } catch (e) { return { sizes: [], error: e instanceof Error ? e.message : "Couldn't load the SanMar catalog." } }
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
 supplier: it.supplier === "ss" ? "S&S Activewear" : it.supplier === "otto" ? "Otto Cap" : "SanMar",
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
        // `brand` travels with the row: it is what the builders lift OUT of the title into
        // the product's own Brand field, and Otto's style detail carries none of its own.
        ? await ssCatalogProduct(it.id, { title: it.ss.title, price: it.ss.price, image: it.ss.image, colors: colorNames(it.ss.colors), brand: it.ss.brand })
 : it.supplier === "otto"
          ? await ottoCatalogProduct(it.id, { name: it.otto.name, price: it.otto.price, image: it.otto.image, colors: it.otto.colors, brand: it.otto.brand })
 : await sanmarCatalogProduct(it.id, { name: it.sanmar.name, price: it.sanmar.price, image: it.sanmar.fullImage || it.sanmar.image, colors: it.sanmar.colors ?? [], brand: it.sanmar.brand })
 setPreview(product); setPreviewKey(keyOf(it))
      // OUR sku, offered in the review step. The builders deliberately leave `sku` unset —
      // the supplier's code belongs in supplierSku, because publish writes `sku` onto the
      // seller's listing — so without a number to offer here the field would open blank and
      // the product would save with no sku at all. confirmAdd assigns one regardless; this
      // is so the operator SEES which one before agreeing to it.
 getCatalogProducts().then((ps) => setPreviewNextSku(nextEgSku(ps))).catch(() => {})
      // Stock for the review step, so a style can be trimmed to what the supplier can
      // actually fill BEFORE it becomes a product. S&S only — the other two would cost a
      // call per sku / per style, and null means "not asked", never "none".
 setPreviewStock(it.supplier === "ss" ? await ssStockByColor(it.id) : null)
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't load that product.") } finally { setAddingId(null) }
  }

  // Step 2 — the reviewed (possibly edited) product is what gets saved. Re-reads the
  // catalog at save time so a product added in another tab isn't clobbered.
 const confirmAdd = async (product: CatalogProduct) => {
 setMsg(null)
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
       * A PRODUCT WITHOUT OUR SKU CAN'T BE STOCKED OR RESOLVED, so one is assigned here —
       * against the catalogue as it is at SAVE time, which is the only moment that answer is
       * authoritative. The number offered in the review step was computed when the window
       * opened, so adding two blanks in a row would otherwise hand both the same one.
       *
       * Only when it is missing: whatever the operator typed wins, always.
       */
      /**
       * OURS UNLESS IT ALREADY IS OURS — the hole those eight products came through.
       *
       * This read `product.sku ? product : …`, so a builder that had put ANY code in the
       * field — the supplier's own style number, which is what a supplier feed carries —
       * kept it, and that number became our sku for the life of the product. Everything that
       * prints a sku then printed the vendor's part number.
       *
       * The supplier's code is not thrown away: it moves to `supplierSku`, which is where it
       * belongs and which the server strips from a seller's copy.
       */
 const withSku = ourSku(product.sku)
        ? product
 : { ...product, sku: nextEgSku(existing), supplierSku: product.supplierSku || product.sku || undefined }
 const next = existing.some((p) => p.id === withSku.id) ? existing.map((p) => (p.id === withSku.id ? withSku : p)) : [...existing, withSku]
 await saveCatalogProducts(next)
 if (previewKey) setAdded((prev) => new Set(prev).add(previewKey))
 setPreview(null); setPreviewKey(null)
      // "Products", not "catalog". Catalog is a DIFFERENT screen — /published-catalog, the
      // lookbook sent to trade buyers — and calling this one by that name is what had five
      // Active products read as five on the marketing site when one was there.
 setMsg(`Added "${product.name ?? "product"}" to Products.`)
    } catch (e) {
      /*
       * RETHROWN, not swallowed into `msg`.
       *
       * A refusal used to land in the same muted-grey strip at the top of this page that
       * announces a SUCCESS — same size, same colour, same position — while the review
       * dialog had already closed itself and the card still read "Add to Products". Three
       * signals all saying nothing happened, and the one sentence explaining why dressed as
       * good news. The dialog keeps itself open now and prints this in red beside the
       * button, which is where the person is looking.
       */
      throw e instanceof Error ? e : new Error("Couldn't add to Products.")
    }
  }

 const favorite = (it: Item, on: boolean) => {
 if (it.supplier === "ss") toggleSsFavorite(it.ss, on).catch(() => {})
 else if (it.supplier === "otto") toggleOttoFavorite({ style: it.otto.style, name: it.otto.name, image: it.otto.image, price: it.otto.price }, on).catch(() => {})
 else toggleSanmarFavorite({ style: it.sanmar.style, name: it.sanmar.name ?? undefined, image: it.sanmar.fullImage || it.sanmar.image, price: typeof it.sanmar.price === "number" ? it.sanmar.price : Number(it.sanmar.price) || null }, on).catch(() => {})
  }

 const loadColors = (it: Item): (() => Promise<Record<string, string>>) => {
 if (it.supplier === "ss") return () => getSsStyle(it.id).then((d) => {
 if (!d || d.error) return {}
 if (d.sizes?.length) setDetailSizes((p) => ({ ...p, [`ss:${it.id}`]: d.sizes! }))
 return d.colorImages ?? {}
    })
 if (it.supplier === "otto") return () => getOttoStyle(it.id).then((d) => (d && !d.error ? driveMap(d.colorImages) : {}))
    // SanMar colour images come straight from the imported detail (already proxied).
 return () => getSanmarCatalogStyle(it.id).then((d) => (d && !d.error ? d.colorImages ?? {} : {}))
  }

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

  // SanMar's SDL/EPDD file is a comma-delimited CSV with a header row. Send the raw text —
  // the server parses it by column name. (Big files may exceed the 60MB body limit; the
  // basic SDL is well under, but a full EPDD with inventory can be split if it errors.)
  // SanMar is a SERVER-side sync, not an upload. The SDL is ~195MB — over the API's 60MB body
  // limit and far over Vercel's ~4.5MB proxy cap — so it can never travel through the browser.
  // The server reads the copy already on its disk instead.
 const [importOpen, setImportOpen] = useState(false)
  /** The blank whose full detail is open. Null = closed. */
 const [detail, setDetail] = useState<{ item: Item; supplier: "ss" | "otto" | "sanmar"; styleId: string; seed: { name?: string | null; brand?: string | null; image?: string | null; price?: string | null; styleNo?: string | null } } | null>(null)

  /**
   * The one refresh worth a button.
   *
   * SanMar re-reads itself nightly from the host cron, and S&S now has its own daily pull —
   * so the only reason left to press anything is impatience: a style you have just been told
   * about and want in the grid NOW. That is a full S&S sync, which is what this does.
   */
 const onSyncAll = async () => {
 setRefreshing(true); setMsg(null)
 try {
 const r = await startSsSyncAll(false)
 setMsg(r?.already ? "A catalogue sync is already running — leave it going." : "Syncing the S&S catalogue in the background; new styles appear as they land.")
      // SanMar's re-read is cheap and server-side, so it rides along rather than needing
      // its own button.
 syncSanmarCatalog().then(() => reload(debounced)).catch(() => {})
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't start the sync.") } finally { setRefreshing(false) }
  }


  /**
   * WHICH SUPPLIERS NEED A FILE, said once instead of implied by a button label.
   *
   * Only Otto does. S&S has a live catalogue API and now a nightly pull; SanMar's SDL is
   * ~195MB and can never travel through a browser (60MB body limit, ~4.5MB proxy cap), so
   * the server reads the copy on its own disk and a host cron refreshes it at 04:20.
   *
   * Naming all three — including the two with nothing to upload — is the point. "Import
   * Otto" made a file look like Otto's quirk; the truth is that the other two refresh
   * themselves, which is worth knowing before someone goes hunting for an export.
   */
 const IMPORT_SOURCES = [
    { key: "otto", name: "Otto Cap", needsFile: true,
 how: "Otto publish no catalogue API. Download their Product Data export (CSV or XLSX) from the Otto dealer portal and drop it here." },
    { key: "ss", name: "S&S Activewear", needsFile: false,
 how: "Live API — pulls itself nightly, and Refresh all styles forces it now. Nothing to upload." },
    { key: "sanmar", name: "SanMar", needsFile: false,
 how: "The SDL catalogue file is ~195MB, far past what a browser upload allows, so the server reads its own copy. A nightly job refreshes it at 04:20." },
  ] as const

  // Filters (supplier / brand / category / price) — applied to what's loaded, like SpyDeck.
 const brandOf = (it: Item) => (it.supplier === "ss" ? it.ss.brand || "" : it.supplier === "otto" ? it.otto.brand || "Otto Cap" : it.sanmar.brand || "SanMar")
 const catOf = (it: Item) => (it.supplier === "ss" ? it.ss.category || "" : it.supplier === "otto" ? it.otto.category || "" : it.sanmar.category || "")
 const priceOf = (it: Item) => Number(it.supplier === "ss" ? it.ss.price : it.supplier === "otto" ? it.otto.price : it.sanmar.price) || 0
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

 const total = ssTotal + ottoTotal + sanmarTotal
 const canLoadMore = (items?.length ?? 0) < total

  /**
   * PAGING PAST THE END FETCHES MORE, so the pager is the only control needed.
   *
   * `paged` divides the rows already in memory; the server holds thousands more. Landing on
   * the last page used to be the end of the catalogue unless you noticed a separate button
   * underneath. Now it just loads the next chunk.
   *
   * Guarded on `loading` so a fast click-through fires one fetch, not five, and on
   * canLoadMore so it stops at the true end rather than asking forever.
   */
  /**
   * FETCHING MORE IS AN EVENT, NEVER AN EFFECT. This was an effect that fired whenever
   * `page >= pageCount`, and it ate a machine's RAM.
   *
   * `usePaged` CLAMPS page to pageCount, so `page >= pageCount` is true at page 1 of 1 —
   * it does not mean "you paged past the end", it means "there is one page". With any
   * filter on, `visible` stays under one page no matter how much arrives, so pageCount
   * stayed 1, the fetch landed, `loading` flipped false, the effect re-ran on its own
   * output and fired again. An unbounded loop pulling all three catalogues into one tab,
   * 90 rows and a batch of image lookups at a time, with nothing ever released.
   *
   * An effect that re-triggers on the state its own fetch writes has no natural end. So
   * the pager offers ONE page beyond what is loaded while the server still has rows, and
   * only a click on it fetches. A click cannot recur on its own.
   *
   * `setPage` stores the raw number and `usePaged` clamps it on render, so asking for a
   * page that does not exist yet is safe: it shows the last real page now and settles on
   * the requested one as the rows arrive.
   */
 const pagesWithMore = paged.pageCount + (canLoadMore ? 1 : 0)
 const goToPage = (n: number) => {
 if (n > paged.pageCount) {
 if (!canLoadMore || loading) return
 void loadMore()
    }
 paged.setPage(n)
  }

 return (
    // No title — the "All suppliers" tab already names it. The toolbar is the top of the card.
    <SectionCard>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <SearchField
          value={search}
          onChange={setSearch}
          width="md"
          placeholder={tl("allSuppliers", "Search all blanks by name, brand, style, SKU…")}
        />
        {total > 0 && <span className="text-xs text-muted-foreground">{total.toLocaleString()} blanks</span>}
        {isAdmin && (
          <>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
            {/* ONE IMPORT, not one per supplier. Only Otto actually needs a file — they
 publish no catalogue API, just a Product Data export — but a button labelled
                "Import Otto" made that look like Otto's quirk rather than the rule it is.
                The window says which suppliers need a file and which refresh themselves. */}
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={importing}>
              {importing ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} weight="bold" />} Import
            </Button>
            {/* ONE refresh. "Sync SanMar" re-read a file a host cron already re-reads at
                04:20, and "Refresh" only warmed the S&S image cache — two buttons for work
 that now happens on a schedule. What is left is the deliberate one: a full
                S&S catalogue pull, which is the only sync a person has any reason to force. */}
            <Button size="sm" variant="outline" onClick={onSyncAll} disabled={importing || refreshing}
 title={tl("allSuppliers", "Force a full S&S catalogue pull now. SanMar refreshes nightly on the server; Otto is a file import.")}>
              {tl("allSuppliers", "Refresh all styles")}
            </Button>
          </>
        )}
        {/* The sync controls live in THIS row now. They had a strip of their own that was
 empty whenever a sync wasn't running, which is nearly always — a full-width
 border and 3rem of padding to hold one button. Progress still appears, but
 below, and only while there is progress to show. */}
        <SsSyncPanel />
      <SupplierDetailDialog
 open={!!detail}
 onOpenChange={(o) => { if (!o) setDetail(null) }}
 supplier={detail?.supplier ?? null}
 styleId={detail?.styleId ?? null}
 seed={detail?.seed}
 added={detail ? added.has(keyOf(detail.item)) : false}
 onAddToCatalog={detail ? () => addToCatalog(detail.item) : undefined}
        /* Hands off to the SAME quick-order flow the tile uses, rather than writing a
 second path into the cart. That flow is what resolves a colour and size to the
 sku the supplier will actually accept — a cart line carrying our own guess at a
 code is a purchase order that gets rejected. The variant chosen here rides along
 as the preselection. */
 onAddToCart={detail && isAdmin ? async (sel) => {
 const it = detail.item
 const base = quickOrderFor(it)
 setDetail(null)
 const r = it.supplier === "otto"
            ? await loadOttoVariants(it.id)
 : it.supplier === "sanmar"
              ? await loadSanmarVariants(it.id)
 : await loadSsVariants(it.id)
 setQuickOrder(r.sizes.length
            ? { ...base, sizes: r.sizes, preselect: { color: sel.colour, size: sel.size, qty: sel.qty } }
 : { ...base, loadError: r.error ?? undefined })
        } : undefined}
      />
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tl("allSuppliers", "Import a supplier catalogue")}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {IMPORT_SOURCES.map((src) => (
              <div key={src.key} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{src.name}</span>
                  {src.needsFile ? (
                    <Button size="sm" onClick={() => { setImportOpen(false); fileRef.current?.click() }} disabled={importing}>
                      <UploadSimple size={13} weight="bold" /> {tl("allSuppliers", "Choose file")}
                    </Button>
                  ) : (
                    <span className="shrink-0 whitespace-nowrap text-2xs font-medium text-shipped">{tl("allSuppliers", "Automatic")}</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{src.how}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      </div>

      {/* Filters — brand / category / price, applied to what's loaded */}
      {items !== null && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm">
          <select value={sup} onChange={(e) => { setSup(e.target.value as "" | "ss" | "otto" | "sanmar"); setBrand(""); setCat("") }} className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <option value="">{tl("allSuppliers", "All suppliers")}</option>
            <option value="ss">{tl("allSuppliers", "S&S Activewear")}</option>
            <option value="otto">{tl("allSuppliers", "Otto Cap")}</option>
            <option value="sanmar">{tl("allSuppliers", "SanMar")}</option>
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <option value="">{tl("allSuppliers", "All brands")}</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <option value="">{tl("allSuppliers", "All categories")}</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">$</span>
            <Input value={minP} onChange={(e) => setMinP(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={allFilters?.priceMin != null ? String(allFilters.priceMin) : "min"} inputMode="decimal" className="h-8 w-16 px-2" />
            <span className="text-muted-foreground">–</span>
            <Input value={maxP} onChange={(e) => setMaxP(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={allFilters?.priceMax != null ? String(allFilters.priceMax) : "max"} inputMode="decimal" className="h-8 w-16 px-2" />
          </div>
          {anyFilter && <button onClick={clearFilters} className="text-xs font-medium text-primary hover:underline">{tl("allSuppliers", "Clear filters")}</button>}
          <span className="ml-auto text-xs text-muted-foreground">{visible.length.toLocaleString()} shown</span>
        </div>
      )}

      {msg && <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">{msg}</div>}

      {items === null ? (
        <Loading label={tl("allSuppliers", "Loading catalog…")} />
      ) : (
        <>
          {visible.length === 0 ? (
            <EmptyState
              icon={Package}
              title={anyFilter ? tl("allSuppliers", "No loaded blanks match these filters") : tl("allSuppliers", "No blanks match that search")}
              note={anyFilter ? tl("allSuppliers", "Load more to widen the pool.") : `Nothing loaded matches “${debounced}”.`}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
              {paged.pageItems.map((it) => (
                <SupplierProductCard
 key={keyOf(it)}
 data={cardData(it)}
 supplierLabel={it.supplier === "ss" ? "S&S" : it.supplier === "otto" ? "Otto" : "SanMar"}
 onOpenDetail={() => {
 const c = cardData(it)
 setDetail({
 item: it,
 supplier: it.supplier,
 styleId: String(c.id),
                      // Otto and SanMar are keyed by their real style code, so the id IS the
                      // number. S&S is keyed by an internal row id, and its number comes
                      // alongside — without this the window opened saying "16".
 seed: { name: c.title, brand: c.brand, image: c.image,
 styleNo: it.supplier === "ss" ? (it.ss.styleName || it.ss.partNumber || null) : String(c.id),
 price: c.price != null ? (c.priceMax != null && c.priceMax !== c.price ? `$${c.price}–$${c.priceMax}` : `$${c.price}`) : null },
                    })
                  }}
 added={added.has(keyOf(it)) || addedIds.has(catalogIdOf(it))}
 adding={addingId === keyOf(it)}
 onAdd={() => addToCatalog(it)}
                  // ORDERING IS ADMIN. An operator browses these catalogues to build OUR
                  // catalogue from them; committing money to a supplier is not their call.
                  // Passing undefined removes the button rather than disabling it — the card
                  // gives Add to Products the full row when Order isn't offered, so an
                  // operator sees a complete control, not a greyed-out one they must ask
                  // about. The server agrees regardless: /api/purchase* is requireAdmin.
 onQuickOrder={!isAdmin ? undefined : async () => {
 const base = quickOrderFor(it)
                    // Otto sizes have no sku on the card; fetch the real ones so what's
                    // ordered is a code the supplier recognises.
                    // BOTH suppliers need their real variants fetched: an S&S card only
                    // has sizes once it's been expanded, so quick-ordering an unexpanded
                    // one showed "this product lists no sizes" for a product that has 40.
 const r = it.supplier === "otto"
                      ? await loadOttoVariants(it.id)
 : it.supplier === "sanmar"
                        ? await loadSanmarVariants(it.id)
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
          {/* Shown whenever there is more to reach, not only when what is loaded overflows
 one page — under a filter the loaded rows often fit on one page while the
 server still holds thousands, and hiding the pager there left no way forward. */}
          {(visible.length > paged.perPage || canLoadMore) && (
            <Pagination page={paged.page} pageCount={pagesWithMore} perPage={paged.perPage}
 total={paged.total} start={paged.start}
 onPage={goToPage} onPerPage={paged.setPerPage} perPageOptions={[48, 96, 192]} />
          )}
          {/* The "Load more (180/9,239)" row is gone — but NOT because pagination replaced
 it. They did different jobs: the pager walks what is already loaded, the
 button fetched the next chunk from the server. Deleting it alone would have
 capped browsing at the first 180 of 9,239 blanks.
              So Next reaches one page past what is loaded and fetches the chunk on click,
 and the only thing left is a quiet line saying it is happening. */}
          {loading && items.length > 0 && (
            <div className="flex items-center justify-center gap-2 border-t border-border p-3 text-xs text-muted-foreground">
              <CircleNotch size={13} className="animate-spin" /> {tl("allSuppliers", "Loading more blanks…")}
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
 nextSku={previewNextSku}
 title={tl("allSuppliers", "Review before adding")}
 ctaLabel="Add to Products"
 stockByColor={previewStock}
      />
      <QuickOrderDialog
 product={quickOrder}
 onClose={() => setQuickOrder(null)}
 onAdded={() => setMsg("Added to the order list — review and place it on the Purchase page.")}
      />
    </SectionCard>
  )
}
