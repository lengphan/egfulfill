"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, MagnifyingGlass, Plus, Check } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { driveImg } from "@/lib/supplier-catalog"
import {
  getSsProducts, getOttoProducts, getSsStyleSkus, getSsStylesAll, type SsStyle, type OttoVariant, getOttoStyle,
  type InventoryItem, type PurchaseOrder, type POLine, type SsProduct, type OttoStyle,
} from "@/lib/api"

type Tab = "inventory" | "ss" | "otto"

// Defined at module scope, not inside the component: a component created during
// render gets a new identity every pass, so React unmounts and remounts the whole
// list on each keystroke (and eslint's react-hooks/static-components rejects it).
function PickRow({ line, title, sub, right, meta, image, on, onToggle }: {
  line: POLine; title: string; sub?: string; right?: string
  /** Small (_fs) product thumbnail. S&S publish three sizes by filename suffix, so this
   *  costs no storage — it's a URL through our proxy, not a stored image. Picking a blank
   *  by name alone is how the wrong colourway ends up on a PO. */
  image?: string | null
  /** Labelled identifiers (Style / SKU). Labelled because a bare number leaves you
   *  guessing which of a supplier's two ids you're looking at — and they're ordered by
   *  one and discussed by the other. */
  meta?: { k: string; v: string }[]
  on: boolean; onToggle: (l: POLine) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(image ? { ...line, image } : line)}
      className={"flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors " + (on ? "bg-primary/5" : "hover:bg-muted/50")}
    >
      <span className={"flex size-5 shrink-0 items-center justify-center rounded border " + (on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
        {on && <Check size={12} weight="bold" />}
      </span>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" className="size-14 shrink-0 rounded border border-border bg-white object-contain" />
      ) : (
        <span className="size-14 shrink-0 rounded border border-dashed border-border" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
        {meta && meta.length > 0 && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {meta.map((m) => (
              <span key={m.k} className="text-[11px] text-muted-foreground">
                {m.k} <span className="font-mono text-foreground/70">{m.v}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      {right && <span className="shrink-0 text-xs text-muted-foreground">{right}</span>}
    </button>
  )
}
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="py-12 text-center text-sm text-muted-foreground">{children}</div>
)
const Loading = () => (
  <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
)

const num = (v: unknown) => Number(v) || 0

/**
 * An S&S product's display name, without the doubled brand.
 *
 * The style sync already prepends the brand when it builds `title` (ss.js), so
 * `style_name` usually arrives as "Gildan Gildan Unisex DryBlend..." once the picker
 * prepends `brand` a second time. Only add the brand when the name doesn't already
 * start with it.
 */
function ssTitle(p: { brand?: string | null; style_name?: string | null }): string | undefined {
  const brand = (p.brand ?? "").trim()
  const name = (p.style_name ?? "").trim()
  if (!name) return brand || undefined
  if (!brand) return name
  return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`
}
const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : ""
}

/**
 * "Add items" for a draft PO. Three sources, because a restock line comes from one
 * of exactly three places:
 *   • Inventory — a blank we already stock and just want more of
 *   • S&S       — searched at SKU level, since a PO line needs a real orderable sku
 *                 (a style is a family; you can't order "a t-shirt")
 *   • Otto      — searched by style, then expanded to its skus
 *
 * Picking is staged: you tick lines, see the count, then commit. Adding on click
 * would make a mis-tap an edit to a purchase order.
 */
export function POAddItems({
  po, onClose, inventory, onAdd,
}: {
  po: PurchaseOrder | null
  onClose: () => void
  inventory: InventoryItem[]
  onAdd: (lines: POLine[]) => void
}) {
  const [tab, setTab] = useState<Tab>("inventory")
  const [term, setTerm] = useState("")
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Record<string, POLine>>({})

  const [ss, setSs] = useState<SsProduct[] | null>(null)
  const [otto, setOtto] = useState<OttoStyle[] | null>(null)
  const [openStyle, setOpenStyle] = useState<string | null>(null)
  // Full variant rows per style, not bare skus. A sku on its own isn't orderable
  // information — you can't tell which colourway you're buying from a code.
  const [styleSkus, setStyleSkus] = useState<Record<string, OttoVariant[]>>({})
  // S&S styles matching the search that are NOT in the local table. The picker searches
  // what's been synced, so an unsynced style read as "no products match" — which is a
  // different claim from "nobody has fetched that yet", and only one of them was true.
  const [ssStyleHits, setSsStyleHits] = useState<SsStyle[] | null>(null)
  const [ssStyleSkus, setSsStyleSkus] = useState<Record<string, SsProduct[]>>({})
  const [openSsStyle, setOpenSsStyle] = useState<string | null>(null)

  /**
   * S&S results grouped into one row per STYLE.
   *
   * The API returns a row per colour AND size, so searching "gildan" produced forty rows
   * with the same name and a different swatch — unreadable, and impossible to tell how
   * many distinct products matched. A style is what a person is looking for; the colour
   * and size are how they narrow it once found.
   */
  /** Style hits that AREN'T already covered by a local result — the rest of the range. */
  const extraStyleHits = useMemo(() => {
    if (!ssStyleHits) return []
    const have = new Set((ss ?? []).map((p) => String(p.style_id ?? "")))
    return ssStyleHits.filter((st) => !have.has(String(st.styleID)))
  }, [ssStyleHits, ss])

  const ssStyles = useMemo(() => {
    const g = new Map<string, { key: string; title: string; brand: string | null; styleNo: string | null; image: string | null; priceLo: number; priceHi: number; rows: SsProduct[] }>()
    for (const p of ss ?? []) {
      const key = String(p.style_id ?? p.style_name ?? p.sku)
      if (!g.has(key)) {
        g.set(key, {
          key, title: ssTitle(p) || p.sku, brand: p.brand ?? null,
          styleNo: p.style_id ? String(p.style_id) : null,
          image: p.image ?? null, priceLo: Infinity, priceHi: 0, rows: [],
        })
      }
      const grp = g.get(key)!
      grp.rows.push(p)
      const pr = num(p.price)
      if (pr > 0) { grp.priceLo = Math.min(grp.priceLo, pr); grp.priceHi = Math.max(grp.priceHi, pr) }
      // First row with a picture represents the style — S&S have no single "parent"
      // image on a product row, so the first colourway stands in.
      if (!grp.image && p.image) grp.image = p.image
    }
    return [...g.values()]
  }, [ss])

  // Per-PO reset is done by the PARENT keying this component on po.num, so opening a
  // different draft remounts it with fresh state. Resetting in an effect instead
  // would mean a render pass where last PO's picks are still on screen — and stale
  // picks landing on the wrong purchase order is not a cosmetic bug.

  // Debounce so typing doesn't fire a request per keystroke against the supplier tables.
  useEffect(() => {
    const id = setTimeout(() => setQ(term.trim()), 300)
    return () => clearTimeout(id)
  }, [term])

  const loadSs = useCallback(() => {
    setSs(null)
    getSsProducts({ search: q, limit: 200 }).then((r) => {
      const found = r?.products ?? []
      setSs(found)
      // ALWAYS ask the style list too, not only when the local table came back empty.
      // Firing it only on zero results meant one synced style hid every other style S&S
      // sell under the same word — searching "comfort" returned the two Comfort Colors
      // rows already synced and silently suppressed the rest of the range.
      if (q) {
        getSsStylesAll({ search: q, limit: 120 }).then((sr) => setSsStyleHits(sr?.styles ?? [])).catch(() => setSsStyleHits([]))
      } else setSsStyleHits(null)
    }).catch(() => setSs([]))
  }, [q])
  const loadOtto = useCallback(() => {
    setOtto(null)
    getOttoProducts({ search: q, limit: 200 }).then((r) => setOtto(r?.items ?? [])).catch(() => setOtto([]))
  }, [q])

  // Deferred by a 0ms timer (the pattern used across the app pages): both loaders
  // setState synchronously, and calling that straight from an effect body is a
  // cascading render — react-hooks/set-state-in-effect rejects it.
  useEffect(() => {
    if (!po || tab !== "ss") return
    const id = setTimeout(loadSs, 0)
    return () => clearTimeout(id)
  }, [po, tab, loadSs])
  useEffect(() => {
    if (!po || tab !== "otto") return
    const id = setTimeout(loadOtto, 0)
    return () => clearTimeout(id)
  }, [po, tab, loadOtto])

  const invRows = useMemo(() => {
    const t = q.toLowerCase()
    return inventory.filter((i) => !t || `${i.sku} ${i.name ?? ""} ${i.variant ?? ""}`.toLowerCase().includes(t)).slice(0, 300)
  }, [inventory, q])

  const toggle = (line: POLine) =>
    setPicked((p) => {
      const next = { ...p }
      if (next[line.sku]) delete next[line.sku]
      else next[line.sku] = line
      return next
    })

  /** Pull one S&S style's orderable skus live, and cache them so it's searchable after. */
  const expandSs = async (styleId: string) => {
    setOpenSsStyle((s) => (s === styleId ? null : styleId))
    if (ssStyleSkus[styleId]) return
    try {
      const d = await getSsStyleSkus(styleId)
      setSsStyleSkus((m) => ({ ...m, [styleId]: d?.products ?? [] }))
    } catch { setSsStyleSkus((m) => ({ ...m, [styleId]: [] })) }
  }

  const expand = async (style: string) => {
    setOpenStyle((s) => (s === style ? null : style))
    if (styleSkus[style]) return
    try {
      const d = await getOttoStyle(style)
      // Prefer the rich rows; fall back to bare skus so a server that predates them
      // still lists something rather than showing an empty style.
      const vs: OttoVariant[] = Array.isArray(d?.variants) && d.variants.length
        ? d.variants
        : (Array.isArray(d?.skus) ? d.skus : []).map((sku) => ({ sku, color: null, size: null, price: null, image: null }))
      setStyleSkus((m) => ({ ...m, [style]: vs }))
    } catch { setStyleSkus((m) => ({ ...m, [style]: [] })) }
  }

  const chosen = Object.values(picked)
  const commit = () => { if (chosen.length) onAdd(chosen); onClose() }

  /** One already-synced style, expandable to the variants we hold locally. */
  const renderLocalStyle = (g: { key: string; title: string; brand: string | null; styleNo: string | null; image: string | null; priceLo: number; priceHi: number; rows: SsProduct[] }) => {

                  const open = openSsStyle === g.key
                  const chosen = g.rows.filter((r) => picked[r.sku]).length
                  return (
                    <div key={g.key}>
                      {/* One row per product. The count is the useful part — "42 colours
                          & sizes" says at a glance whether this is the thing you want. */}
                      <button type="button" onClick={() => setOpenSsStyle((s2) => (s2 === g.key ? null : g.key))}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                        {g.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={g.image} alt="" loading="lazy" className="size-14 shrink-0 rounded border border-border bg-white object-contain" />
                          : <span className="size-14 shrink-0 rounded border border-dashed border-border" aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{g.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {g.styleNo ? `Style ${g.styleNo} · ` : ""}{g.rows.length} colour{g.rows.length === 1 ? "" : "s"} &amp; size{g.rows.length === 1 ? "" : "s"}
                            {chosen > 0 ? ` · ${chosen} picked` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {g.priceHi > 0
                            ? (g.priceLo === g.priceHi ? money(g.priceHi) : `${money(g.priceLo)}–${money(g.priceHi)}`)
                            : ""}
                        </span>
                        <Plus size={13} weight="bold" className={"shrink-0 transition-transform " + (open ? "rotate-45" : "")} />
                      </button>
                      {open && (
                        <div className="border-t border-border bg-muted/30 pl-6">
                          {g.rows.map((p) => (
                            <PickRow key={p.sku}
                              line={{ sku: p.sku, name: ssTitle(p), variant: [p.color, p.size].filter(Boolean).join(" / ") || undefined, qty: 1, price: num(p.price) }}
                              image={p.image ?? null}
                              title={[p.color, p.size].filter(Boolean).join(" / ") || p.sku}
                              meta={[{ k: "SKU", v: p.sku }]}
                              right={money(p.price)}
                              on={!!picked[p.sku]} onToggle={toggle} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
  }

  return (
    <Dialog open={!!po} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add items{po?.supplier ? ` · ${po.supplier}` : ""}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {([["inventory", "Inventory"], ["ss", "S&S"], ["otto", "Otto Cap"]] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={"flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " + (tab === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={tab === "inventory" ? "Search your stocked blanks…" : "Search the supplier catalog…"}
            className="pl-9"
          />
        </div>

        <div className="max-h-[60vh] min-h-[24rem] divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {tab === "inventory" && (
            invRows.length === 0
              ? <Empty>{q ? "Nothing matches that." : "No inventory yet."}</Empty>
              : invRows.map((i) => (
                <PickRow key={i.sku}
                  line={{ sku: i.sku, name: i.name ?? undefined, variant: i.variant ?? undefined, qty: 1 }}
                  // Stocked blanks carry no image of their own — inventory rows are
                  // sku/name/qty. The dashed placeholder says "no picture", not "loading".
                  title={i.name || i.sku}
                  sub={[i.variant, i.sku].filter(Boolean).join(" · ")}
                  right={`${num(i.in_stock)} in stock`}
                  on={!!picked[i.sku]} onToggle={toggle} />
              ))
          )}

          {tab === "ss" && (
            ss === null ? <Loading />
              : (ss.length > 0 || extraStyleHits.length > 0) ? (
                // Synced styles first, then the rest of the range. Gating the style search
                // on "no local results" meant one synced style hid every other style S&S
                // sell under the same word.
                <>
                  {/* Already-synced styles, expandable to the variants we hold. */}
                  {ssStyles.map(renderLocalStyle)}
                  {extraStyleHits.length > 0 && ss.length > 0 && (
                    <div className="border-y border-border bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                      More from S&amp;S — open one to load its colours and sizes
                    </div>
                  )}
                  {extraStyleHits.map((st) => (
                    <div key={st.styleID}>
                      <button type="button" onClick={() => expandSs(String(st.styleID))}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                        {st.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={st.image} alt="" loading="lazy" className="size-14 shrink-0 rounded border border-border bg-white object-contain" />
                          : <span className="size-14 shrink-0 rounded border border-dashed border-border" aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{st.title || st.styleID}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {st.brand}{st.styleName ? ` · Style ${st.styleName}` : ""}
                          </span>
                        </span>
                        <Plus size={13} weight="bold" className={"shrink-0 transition-transform " + (openSsStyle === String(st.styleID) ? "rotate-45" : "")} />
                      </button>
                      {openSsStyle === String(st.styleID) && (
                        <div className="border-t border-border bg-muted/30 pl-6">
                          {ssStyleSkus[String(st.styleID)] === undefined ? <Loading />
                            : ssStyleSkus[String(st.styleID)].length === 0 ? <Empty>S&amp;S list no orderable skus for this style.</Empty>
                              : ssStyleSkus[String(st.styleID)].map((p) => (
                                <PickRow key={p.sku}
                                  line={{ sku: p.sku, name: ssTitle(p), variant: [p.color, p.size].filter(Boolean).join(" / ") || undefined, qty: 1, price: num(p.price) }}
                                  image={p.image ?? null}
                                  title={[p.color, p.size].filter(Boolean).join(" / ") || p.sku}
                                  sub={ssTitle(p)}
                                  meta={[{ k: "SKU", v: p.sku }]}
                                  on={!!picked[p.sku]} onToggle={toggle} />
                              ))}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )
              : <Empty>{q ? "No S&S products match, and no style of that name either." : "Search a style name, number or colour — anything S&S sell is reachable."}</Empty>
          )}

          {tab === "otto" && (
            otto === null ? <Loading />
              : otto.length === 0 ? <Empty>{q ? "No Otto Cap styles match." : "Sync the Otto Cap catalog first, or search for a style."}</Empty>
                : otto.map((s) => (
                  <div key={s.style}>
                    {/* A style isn't orderable — expand it to its skus and pick one. */}
                    <button type="button" onClick={() => expand(s.style)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                      {driveImg(s.image)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={driveImg(s.image)} alt="" loading="lazy" className="size-14 shrink-0 rounded border border-border bg-white object-contain" />
                        : <span className="size-14 shrink-0 rounded border border-dashed border-border" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.name || s.style}</span>
                        <span className="block truncate text-xs text-muted-foreground">{s.style}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{money(s.price)}</span>
                      <Plus size={13} weight="bold" className={"shrink-0 transition-transform " + (openStyle === s.style ? "rotate-45" : "")} />
                    </button>
                    {openStyle === s.style && (
                      <div className="border-t border-border bg-muted/30 pl-6">
                        {styleSkus[s.style] === undefined ? <Loading />
                          : styleSkus[s.style].length === 0 ? <Empty>No skus listed for this style.</Empty>
                            : styleSkus[s.style].map((v) => (
                              <PickRow key={v.sku}
                                line={{ sku: v.sku, name: s.name ?? undefined,
                                        variant: [v.color, v.size].filter(Boolean).join(" / ") || undefined,
                                        qty: 1, price: num(v.price ?? s.price) }}
                                title={[v.color, v.size].filter(Boolean).join(" / ") || v.sku}
                                sub={s.name ?? undefined}
                                meta={[{ k: "SKU", v: v.sku }]}
                                // Per-COLOUR picture. Ordering a colourway from a photo of
                                // a different colour is exactly the mistake to prevent.
                                image={driveImg(v.image || s.image) || null}
                                on={!!picked[v.sku]} onToggle={toggle} />
                            ))}
                      </div>
                    )}
                  </div>
                ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={commit} disabled={!chosen.length}>
            Add {chosen.length || ""} item{chosen.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
