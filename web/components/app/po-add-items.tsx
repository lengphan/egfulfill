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
      onClick={() => onToggle(line)}
      className={"flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors " + (on ? "bg-primary/5" : "hover:bg-muted/50")}
    >
      <span className={"flex size-5 shrink-0 items-center justify-center rounded border " + (on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
        {on && <Check size={12} weight="bold" />}
      </span>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" className="size-10 shrink-0 rounded border border-border bg-white object-contain" />
      ) : (
        <span className="size-10 shrink-0 rounded border border-dashed border-border" aria-hidden />
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
    getSsProducts({ search: q, limit: 60 }).then((r) => {
      const found = r?.products ?? []
      setSs(found)
      // Nothing locally? Ask the STYLE list, which is cached whole and covers everything
      // S&S sell. The style is what a person knows; its skus are fetched when opened.
      if (!found.length && q) {
        getSsStylesAll({ search: q, limit: 40 }).then((sr) => setSsStyleHits(sr?.styles ?? [])).catch(() => setSsStyleHits([]))
      } else setSsStyleHits(null)
    }).catch(() => setSs([]))
  }, [q])
  const loadOtto = useCallback(() => {
    setOtto(null)
    getOttoProducts({ search: q, limit: 60 }).then((r) => setOtto(r?.items ?? [])).catch(() => setOtto([]))
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
    return inventory.filter((i) => !t || `${i.sku} ${i.name ?? ""} ${i.variant ?? ""}`.toLowerCase().includes(t)).slice(0, 60)
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

  return (
    <Dialog open={!!po} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl">
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

        <div className="max-h-[46vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
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
              : ss.length === 0 && ssStyleHits && ssStyleHits.length > 0 ? (
                // Not synced, but S&S DO sell it. Open a style to pull its skus live —
                // they're cached on the way through, so it's searchable from then on.
                <>
                  <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                    Not in your synced catalogue yet — open a style to load its sizes and colours from S&amp;S.
                  </div>
                  {ssStyleHits.map((st) => (
                    <div key={st.styleID}>
                      <button type="button" onClick={() => expandSs(String(st.styleID))}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                        {st.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={st.image} alt="" loading="lazy" className="size-10 shrink-0 rounded border border-border bg-white object-contain" />
                          : <span className="size-10 shrink-0 rounded border border-dashed border-border" aria-hidden />}
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
              : ss.length === 0 ? <Empty>{q ? "No S&S products match, and no style of that name either." : "Search a style name, number or colour — anything S&S sell is reachable."}</Empty>
                : ss.map((p) => (
                  <PickRow key={p.sku}
                    line={{ sku: p.sku, name: ssTitle(p), variant: [p.color, p.size].filter(Boolean).join(" / ") || undefined, qty: 1, price: num(p.price) }}
                    image={p.image ?? null}
                    title={ssTitle(p) || p.sku}
                    sub={[p.color, p.size].filter(Boolean).join(" / ")}
                    // The two numbers that identify an S&S line, LABELLED. The sku is what
                    // actually gets ordered; the style is what a person recognises and what
                    // every S&S page and invoice is organised by. Showing one bare number
                    // meant guessing which of the two it was.
                    meta={[
                      p.style_id ? { k: "Style", v: String(p.style_id) } : null,
                      { k: "SKU", v: p.sku },
                    ].filter(Boolean) as { k: string; v: string }[]}
                    right={money(p.price)}
                    on={!!picked[p.sku]} onToggle={toggle} />
                ))
          )}

          {tab === "otto" && (
            otto === null ? <Loading />
              : otto.length === 0 ? <Empty>{q ? "No Otto Cap styles match." : "Sync the Otto Cap catalog first, or search for a style."}</Empty>
                : otto.map((s) => (
                  <div key={s.style}>
                    {/* A style isn't orderable — expand it to its skus and pick one. */}
                    <button type="button" onClick={() => expand(s.style)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
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
