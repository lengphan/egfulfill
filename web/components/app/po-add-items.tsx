"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, MagnifyingGlass, Plus, Check } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { driveImg } from "@/lib/supplier-catalog"
import { clickableProps } from "@/lib/a11y"
import {
  getSsProducts, getOttoProducts, getSsStyleSkus, getSsStylesAll, type SsStyle, type OttoVariant, getOttoStyle,
  getSanmarCatalog, getSanmarCatalogStyle, type SanmarCatalogStyle, resolveSuppliers,
  type InventoryItem, type PurchaseOrder, type POLine, type SsProduct, type OttoStyle,
} from "@/lib/api"

type Tab = "inventory" | "ss" | "otto" | "sanmar"

// Defined at module scope, not inside the component: a component created during
// render gets a new identity every pass, so React unmounts and remounts the whole
// list on each keystroke (and eslint's react-hooks/static-components rejects it).

/**
 * ONE ROW PER COLOUR, sizes inside it.
 *
 * A style with 20 colourways in 6 sizes is 120 rows, and finding "Bay in L" meant scrolling
 * past Bay/S and Bay/M to reach it — the list was sorted by a key nobody searches on. The
 * question is always colour FIRST ("do we want Bay?") and size second ("which of them?"),
 * so the colour is the row and the sizes are chips within it.
 *
 * Quantity appears against each size actually chosen, because that is the only place a
 * number means anything: 24 of Bay/L and 12 of Bay/M is one colour and two answers.
 */
function ColourGroups({ variants, name, picked, onToggle, onQty }: {
  variants: { sku: string; color?: string | null; size?: string | null; price?: number | null; image?: string | null }[]
  name?: string
  picked: Record<string, POLine>
  onToggle: (l: POLine) => void
  onQty: (sku: string, n: number) => void
}) {
  // Insertion order, so the supplier's own colour ordering survives — they group families
  // (all the blues together) and re-sorting alphabetically scatters them.
  const groups = new Map<string, typeof variants>()
  for (const v of variants) {
    const key = String(v.color ?? "—")
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(v)
  }

  return (
    <>
      {[...groups.entries()].map(([colour, rows]) => {
        const pickedHere = rows.filter((r) => picked[r.sku])
        const thumb = rows.find((r) => r.image)?.image ?? null
        return (
          <div key={colour} className="flex gap-3 px-4 py-3">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" loading="lazy" className="size-20 shrink-0 rounded border border-border bg-white object-contain" />
            ) : (
              <span className="size-20 shrink-0 rounded border border-dashed border-border" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{colour}</div>
              {name && <div className="truncate text-xs text-muted-foreground">{name}</div>}
              {/* Every size the colour comes in. Picked ones are filled — the chip IS the
                  state, so there is no second control saying the same thing. */}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {rows.map((r) => {
                  const on = !!picked[r.sku]
                  const label = r.size || r.sku
                  return (
                    <button
                      key={r.sku}
                      type="button"
                      title={`SKU ${r.sku}`}
                      onClick={() => onToggle({ sku: r.sku, name, variant: [r.color, r.size].filter(Boolean).join(" / ") || undefined, qty: 1, price: num(r.price), image: r.image ?? undefined })}
                      className={"rounded-md border px-2 py-0.5 text-xs font-medium transition-colors "
                        + (on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              {/* How many of each chosen size. Only what is chosen, so the row stays a row
                  until you have actually decided something. */}
              {pickedHere.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {pickedHere.map((r) => (
                    <span key={r.sku} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1">
                      <span className="text-2xs text-muted-foreground">{r.size || r.sku}</span>
                      <input
                        type="number" min={1}
                        value={picked[r.sku]?.qty ?? 1}
                        onChange={(e) => onQty(r.sku, parseInt(e.target.value, 10) || 1)}
                        aria-label={`Quantity for ${colour} ${r.size ?? ""}`}
                        className="h-6 w-14 rounded border border-border bg-background px-1.5 text-xs tabular-nums"
                      />
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {rows[0]?.price != null ? `$${num(rows[0].price).toFixed(2)}` : ""}
            </div>
          </div>
        )
      })}
    </>
  )
}

function PickRow({ line, title, sub, right, meta, image, on, onToggle, qty, onQty }: {
  line: POLine; title: string; sub?: string; right?: string
  /** Current quantity once the line is picked, and how to change it. Absent → no stepper,
   *  which is how the callers that only ever add one still behave. */
  qty?: number; onQty?: (n: number) => void
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
  // A DIV, not a button: the row now carries a number input and its own Add control, and
  // both inside a <button> is invalid markup. Same click-to-pick behaviour, same keyboard
  // route, through the shared helper.
  return (
    <div
      {...clickableProps(() => onToggle(image ? { ...line, image } : line), `Select ${title}`)}
      className={"flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors " + (on ? "bg-primary/5" : "hover:bg-muted/50")}
    >
      <span className={"flex size-5 shrink-0 items-center justify-center rounded border " + (on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
        {on && <Check size={12} weight="bold" />}
      </span>
      {image ? (
        // Bigger, because this picture is doing real work: it is the only thing that tells
        // Navy from Columbia Blue at a glance, and a 56px thumbnail of a cap does not.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" className="size-20 shrink-0 rounded border border-border bg-white object-contain" />
      ) : (
        <span className="size-20 shrink-0 rounded border border-dashed border-border" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
        {meta && meta.length > 0 && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {meta.map((m) => (
              <span key={m.k} className="text-2xs text-muted-foreground">
                {m.k} <span className="font-mono text-foreground/70">{m.v}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      {right && <span className="shrink-0 text-xs text-muted-foreground">{right}</span>}
      {/* QUANTITY WHERE THE CHOICE IS MADE. Picking a colourway and then typing 24 is the
          whole job; sending every line at 1 and correcting the numbers on the draft
          afterwards is the same work done twice, in the screen with less context.
          Only once the line is IN — a stepper on an unpicked row is a number that means
          nothing yet. stopPropagation because the row itself is the pick target. */}
      {onQty && (
        <input
          type="number"
          min={1}
          value={on ? (qty ?? 1) : 1}
          disabled={!on}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onQty(parseInt(e.target.value, 10) || 1)}
          aria-label={`Quantity for ${title}`}
          className="h-8 w-16 shrink-0 rounded-lg border border-border bg-card px-2 text-sm tabular-nums disabled:opacity-40"
        />
      )}
      {/* No pill. It was a <span> styled as a button, so "Added" read as a control you had
          already pressed and could press again — and it duplicated the tick on the left,
          which is the actual state. The row is the control; the checkbox is the answer. */}
    </div>
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
  /**
   * SANMAR, browsable from a PO at last.
   *
   * The catalogue has been imported and searchable elsewhere for weeks — 4,081 styles — but
   * this picker hardcoded three tabs, so the one supplier whose ordering is still a DRY RUN
   * was also the only one you could not put on a purchase order. Same shape as Otto: a
   * style expands to its variants and you pick the sku, because a style is not orderable.
   */
  const [sanmar, setSanmar] = useState<SanmarCatalogStyle[] | null>(null)
  /**
   * WHAT A STOCKED BLANK ACTUALLY IS — picture, supplier, variant.
   *
   * Inventory rows carry sku, name, variant and a count; no image, so every row in this tab
   * was a dashed grey square. That is the tab you reach for when restocking something you
   * have bought before, and it was the one place that showed you the least: you could not
   * tell a black hoodie from a white tee, or which supplier it came from, without going
   * away and looking it up — which is the search this tab exists to save.
   *
   * resolve-suppliers already answers all three from a list of skus (it is what prices the
   * PO lines), so this asks it for the rows on screen. Best-effort: no answer just leaves
   * the row as it was, because a missing picture must not cost you the ability to order.
   */
  const [skuMeta, setSkuMeta] = useState<Record<string, { image?: string | null; supplier?: string | null; variant?: string | null }>>({})
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
          // "Style 5000", not "Style 16". style_id is S&S's internal row id — printing it
          // under a label that says Style put a number on screen that matches nothing on
          // the spec sheet you're ordering from. Still grouped BY style_id; only shown as
          // style_no. Falls back to the id so a row synced before this stays identifiable.
          styleNo: p.style_no ? String(p.style_no) : p.style_id ? String(p.style_id) : null,
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
    setSanmar(null)
    getSanmarCatalog({ search: q, limit: 200 }).then((r) => setSanmar(r?.items ?? [])).catch(() => setSanmar([]))
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

  /** Set a picked line's quantity. Picking a colourway and then typing "24" is the whole
   *  job here — sending every line at 1 and fixing the numbers on the draft afterwards is
   *  the same work done twice, in the screen with less context. */
  const setQty = (sku: string, qty: number) =>
    setPicked((p) => (p[sku] ? { ...p, [sku]: { ...p[sku], qty: Math.max(1, qty || 1) } } : p))

  /** Pull one S&S style's orderable skus live, and cache them so it's searchable after. */
  useEffect(() => {
    if (tab !== "inventory") return
    const skus = invRows.slice(0, 60).map((i) => i.sku).filter(Boolean)
    const missing = skus.filter((k) => skuMeta[k] === undefined)
    if (!missing.length) return
    let alive = true
    const t = setTimeout(() => {
      resolveSuppliers(missing)
        .then((r) => {
          if (!alive) return
          // Every sku asked for gets a key, even when the answer is empty — otherwise the
          // effect re-fires forever on rows the resolver has nothing to say about.
          const add: Record<string, { image?: string | null; supplier?: string | null; variant?: string | null }> = {}
          for (const k of missing) add[k] = (r?.bySku ?? {})[k] ?? {}
          setSkuMeta((m) => ({ ...m, ...add }))
        })
        .catch(() => {
          if (!alive) return
          const add: Record<string, Record<string, never>> = {}
          for (const k of missing) add[k] = {}
          setSkuMeta((m) => ({ ...m, ...add }))
        })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, invRows])

  const expandSs = async (styleId: string) => {
    setOpenSsStyle((s) => (s === styleId ? null : styleId))
    if (ssStyleSkus[styleId]) return
    try {
      const d = await getSsStyleSkus(styleId)
      setSsStyleSkus((m) => ({ ...m, [styleId]: d?.products ?? [] }))
    } catch { setSsStyleSkus((m) => ({ ...m, [styleId]: [] })) }
  }

  const [openSanmar, setOpenSanmar] = useState<string | null>(null)
  const [sanmarSkus, setSanmarSkus] = useState<Record<string, { color: string | null; size: string | null; sku: string; price: number | null; image: string | null }[]>>({})
  const expandSanmar = async (style: string) => {
    setOpenSanmar((s) => (s === style ? null : style))
    if (sanmarSkus[style]) return
    try {
      const d = await getSanmarCatalogStyle(style)
      setSanmarSkus((m) => ({ ...m, [style]: d?.variants ?? [] }))
    } catch { setSanmarSkus((m) => ({ ...m, [style]: [] })) }
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
                              qty={picked[p.sku]?.qty} onQty={(n) => setQty(p.sku, n)}
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
          {([["inventory", "Inventory"], ["ss", "S&S"], ["otto", "Otto Cap"], ["sanmar", "SanMar"]] as [Tab, string][]).map(([k, label]) => (
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
                  title={i.name || i.sku}
                  // Variant, sku, and WHO STOCKS IT — the last one is why this row exists.
                  // Restocking a blank you have bought before should not require remembering
                  // which supplier it came from.
                  sub={[i.variant || skuMeta[i.sku]?.variant, i.sku, skuMeta[i.sku]?.supplier]
                    .filter(Boolean).join(" · ")}
                  // Resolved from the supplier catalogue by sku, since an inventory row has
                  // no picture of its own. Absent → PickRow's own dashed placeholder, which
                  // says "no picture" rather than "loading".
                  image={skuMeta[i.sku]?.image || null}
                  right={`${num(i.in_stock)} in stock`}
                  qty={picked[i.sku]?.qty} onQty={(n) => setQty(i.sku, n)}
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
                    <div className="border-y border-border px-4 py-1.5 text-xs font-medium text-muted-foreground">
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
                              : <ColourGroups
                                  variants={ssStyleSkus[String(st.styleID)].map((p) => ({ sku: p.sku, color: p.color, size: p.size, price: num(p.price), image: p.image ?? null }))}
                                  name={ssTitle(ssStyleSkus[String(st.styleID)][0])}
                                  picked={picked} onToggle={toggle} onQty={setQty} />}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )
              : <Empty>{q ? "No S&S products match, and no style of that name either." : "Search a style name, number or colour — anything S&S sell is reachable."}</Empty>
          )}

          {tab === "sanmar" && (
            sanmar === null ? <Loading />
              : sanmar.length === 0 ? <Empty>{q ? "No SanMar styles match." : "Import the SanMar catalogue first, or search for a style."}</Empty>
                : sanmar.map((s2) => (
                  <div key={s2.style}>
                    <button type="button" onClick={() => expandSanmar(s2.style)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                      {s2.image
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={s2.image} alt="" loading="lazy" className="size-14 shrink-0 rounded border border-border bg-white object-contain" />
                        : <span className="size-14 shrink-0 rounded border border-dashed border-border" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s2.name || s2.style}</span>
                        {/* Brand as well as style: SanMar carry other people's labels, so
                            "PC61" alone doesn't say Port & Company the way an Otto code does. */}
                        <span className="block truncate text-xs text-muted-foreground">{[s2.brand, s2.style].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{money(s2.price)}</span>
                      <Plus size={13} weight="bold" className={"shrink-0 transition-transform " + (openSanmar === s2.style ? "rotate-45" : "")} />
                    </button>
                    {openSanmar === s2.style && (
                      <div className="border-t border-border bg-muted/30 pl-6">
                        {sanmarSkus[s2.style] === undefined ? <Loading />
                          : sanmarSkus[s2.style].length === 0 ? <Empty>No skus listed for this style.</Empty>
                            : <ColourGroups
                                variants={sanmarSkus[s2.style].map((v) => ({ sku: v.sku, color: v.color, size: v.size, price: num(v.price ?? s2.price), image: v.image || s2.image || null }))}
                                name={s2.name ?? undefined}
                                picked={picked} onToggle={toggle} onQty={setQty} />}
                      </div>
                    )}
                  </div>
                ))
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
                            : <ColourGroups
                                variants={styleSkus[s.style].map((v) => ({ sku: v.sku, color: v.color, size: v.size, price: num(v.price ?? s.price), image: driveImg(v.image || s.image) || null }))}
                                name={s.name ?? undefined}
                                picked={picked} onToggle={toggle} onQty={setQty} />}
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
