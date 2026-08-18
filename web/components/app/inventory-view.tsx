"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { Package, MagnifyingGlass, Trash, CircleNotch, Check, ClockCounterClockwise, ArrowUp, ArrowDown, CaretDown } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { ConsignmentPanel } from "@/components/app/consignment-panel"
import { InboundPanel } from "@/components/app/inbound-panel"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Barcode } from "@/components/app/barcode"
import { ScanQr } from "@/components/app/scan-code"
import { LabelSheet } from "@/components/app/label-sheet"
import { usePaged, Pagination } from "@/components/app/pagination"
import { getInventory, patchInventoryItem, addInventoryItem, deleteInventoryItem, getScanHistory, resolveSuppliers, getCatalogProducts, type CatalogProduct, type InventoryItem, type OrderItem, type ScanRow, type SkuVisibility } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { resolveProduct } from "@/lib/variant-resolve"
import { variantSku, variantLabel, productSizes, productColors } from "@/lib/variant-sku"
import { prettyColorName } from "@/lib/color-name"
import { PageTitle } from "@/components/app/page-title"
import { TabLabel } from "@/components/app/tab-label"

const num = (v: unknown) => Number(v) || 0

/**
 * THE PICTURE OF THE THING ON THE SHELF.
 *
 * An inventory row is a sku and a number, which is enough to audit and not enough to pick:
 * "Adidas Ultimate365 Polo" and "Otto Cap Digital Camo 6-Panel" are the same amount of grey
 * text, and the person reading this table is holding a garment. The catalogue already has
 * the photo — the row just never asked for it.
 *
 * Colour-specific when we can: a row whose variant names a colourway gets THAT colourway's
 * photo, because a black tee and a white tee are the difference the picker is checking.
 */
const imageFor = (p: CatalogProduct | null, variant?: string | null): string => {
  if (!p) return ""
  const ci = p.colorImages ?? {}
  const v = (variant || "").toLowerCase()
  if (v) {
    for (const [c, url] of Object.entries(ci)) {
      if (!c || !url) continue
      if (v.includes(c.toLowerCase()) || v.includes(prettyColorName(c).toLowerCase())) return url
    }
  }
  return p.img || p.image || p.hero || p.images?.[0] || Object.values(ci).find(Boolean) || ""
}

/**
 * How far a SKU may travel. A row written before the column existed reads back undefined,
 * and the safe reading of "we don't know" is the closed one — never assume a blank means
 * published.
 */
const VIS: { id: SkuVisibility; label: string; pill: string }[] = [
  /* `pill` is kept for the summary row's plain label; the control itself no longer tints. */
  { id: "factory", label: "Factory only", pill: "text-muted-foreground" },
  { id: "seller", label: "Sellers", pill: "text-sky-700 dark:text-sky-400" },
  { id: "public", label: "Public", pill: "text-violet-700 dark:text-violet-400" },
]
const visOf = (it: InventoryItem): SkuVisibility => (it.visibility === "seller" || it.visibility === "public" ? it.visibility : "factory")
const avail = (it: InventoryItem) => num(it.in_stock) - num(it.reserved)
const isOut = (it: InventoryItem) => num(it.in_stock) <= 0
const isLow = (it: InventoryItem) => !isOut(it) && num(it.in_stock) <= (it.reorder_at ?? 25)

// `embedded` hides the mobile hero when this sits inside the Inventory tab shell.
export function InventoryView({ embedded = false, pool }: { embedded?: boolean; pool?: "own" | "consigned" }) {
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [search, setSearch] = useState("")
  const [cat, setCat] = useState("")
  const [vis, setVis] = useState<"" | SkuVisibility>("")
  /** Show only the rows no supplier catalogue still lists — the ones to review and clear. */
  const [onlyUnavailable, setOnlyUnavailable] = useState(false)
  /** Supplier/variant resolved per sku — see the effect below. Declared here because
   *  the filter reads it, and the filter is computed before that effect is defined. */
  const [meta, setMeta] = useState<Record<string, { supplier?: string | null; variant?: string | null; api?: string | null }>>({})
  const [saving, setSaving] = useState(false)
  // When the Inventory shell drives the pool (its single Our stock · Incoming stock · Scan
  // nav), follow it and hide the in-view toggle; standalone, keep our own.
  const [ownTab, setOwnTab] = useState<"own" | "consigned">("own")
  const tab = pool ?? ownTab
  const [saved, setSaved] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [histSku, setHistSku] = useState<string | null>(null)
  // Label printing: pick the variants you actually need, and how many of each.
  // Printing the whole filtered list one-each wasted a roll every time.
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [zoomSku, setZoomSku] = useState<string | null>(null)
  const [copies, setCopies] = useState<Record<string, number>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The catalogue, for the row photo and for "Add from catalogue". Read once; a product's
   *  picture doesn't change while a stock count is being typed. */
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  /** Which product groups are expanded. Collapsed by default — the point of grouping is a
   *  table of PRODUCTS, and a page that opens with every variant showing is the flat list
   *  again with extra indentation. */
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    if (!getToken()) { setItems([]); return }
    getInventory().then((r) => setItems(r ?? [])).catch(() => setItems([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])
  useEffect(() => {
    const id = setTimeout(() => {
      if (!getToken()) return
      getCatalogProducts().then((r) => setCatalog(r ?? [])).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Edits are optimistic locally, then flushed as PER-FIELD PATCHes (debounced).
  // Never save the whole array: that would re-send this page's snapshot of every
  // row and wipe out stock the warehouse scanned in while the page sat open.
  const pending = useRef<Map<string, Partial<InventoryItem>>>(new Map())
  const flush = useCallback(() => {
    const batch = Array.from(pending.current.entries())
    pending.current.clear()
    if (!batch.length) return
    setSaving(true)
    Promise.all(batch.map(([sku, fields]) => patchInventoryItem(sku, fields).catch(() => {})))
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500) })
      .finally(() => setSaving(false))
  }, [])

  const edit = (sku: string, field: "in_stock" | "reserved" | "reorder_at", value: number) => {
    setItems((prev) => (prev ?? []).map((it) => (it.sku === sku ? { ...it, [field]: value } : it)))
    pending.current.set(sku, { ...(pending.current.get(sku) ?? {}), [field]: value })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 600)
  }
  // Sent immediately rather than through the 600ms debounce the number cells use: this is
  // a deliberate choice about who can see stock, not a value being typed, and a dropped
  // debounce on THIS field is the one that publishes something by accident.
  const setVisibility = (sku: string, next: SkuVisibility) => {
    const before = (items ?? []).find((i) => i.sku === sku)
    setItems((prev) => (prev ?? []).map((it) => (it.sku === sku ? { ...it, visibility: next } : it)))
    patchInventoryItem(sku, { visibility: next }).catch(() => {
      // Put the row back rather than leaving the table claiming a change that never
      // landed — a visibility that only looks applied is worse than one that failed.
      setItems((prev) => (prev ?? []).map((it) => (it.sku === sku ? { ...it, visibility: before?.visibility } : it)))
    })
  }
  const remove = (sku: string) => {
    setItems((prev) => (prev ?? []).filter((it) => it.sku !== sku))
    pending.current.delete(sku)
    deleteInventoryItem(sku).catch(() => load())
  }
  /** One row or a product's whole size run — the catalogue path adds several at once, and
   *  they go in as individual POSTs so a failure loses one row rather than the batch. */
  const add = (batch: InventoryItem[]) => {
    const skus = new Set(batch.map((b) => b.sku))
    setItems((prev) => [...batch, ...(prev ?? []).filter((x) => !skus.has(x.sku))])
    setAddOpen(false)
    Promise.all(batch.map((it) => addInventoryItem(it).catch(() => null))).then((r) => {
      // Re-read if any POST failed, rather than leaving the table showing a row the
      // server never took.
      if (r.some((x) => x === null)) load()
    })
  }

  const cats = useMemo(() => Array.from(new Set((items ?? []).map((i) => i.category).filter(Boolean))).sort() as string[], [items])
  const filtered = useMemo(() => (items ?? []).filter((it) => {
    if (cat && it.category !== cat) return false
    if (vis && visOf(it) !== vis) return false
    // Only rows we have ASKED about and been told nothing for. A row still resolving is
    // unknown, not unavailable, and must not be swept into a list headed "remove these".
    if (onlyUnavailable && !(meta[it.sku] !== undefined && !meta[it.sku]?.supplier && !it.supplier)) return false
    if (!search) return true
    return `${it.sku} ${it.name ?? ""} ${it.variant ?? ""}`.toLowerCase().includes(search.toLowerCase())
  }), [items, cat, vis, search, onlyUnavailable, meta])

  const stats = useMemo(() => {
    const list = items ?? []
    return { total: list.length, low: list.filter(isLow).length, out: list.filter(isOut).length, reserved: list.reduce((s, i) => s + num(i.reserved), 0) }
  }, [items])

  /**
   * ONE ROW PER PRODUCT, variants underneath it.
   *
   * Stock is held per variant, so the table was one row per sku — 8 sizes of one tee read
   * as 8 unrelated products, and "do we have this polo?" meant reading eight rows and adding
   * them up. Grouped, the answer is the row: the total is the product's, and the caret opens
   * the sizes when the question is which one.
   *
   * Grouped by the CATALOGUE PRODUCT the sku resolves to, not by a prefix of the string —
   * `resolveProduct` is the same matcher an order line uses, so a row groups with the
   * product it will actually be picked for. Unresolved rows fall back to their name, and
   * anything left is its own group of one, which renders exactly as it always did.
   */
  const groups = useMemo(() => {
    const out: { key: string; name: string; product: CatalogProduct | null; image: string; rows: InventoryItem[] }[] = []
    const by = new Map<string, number>()
    for (const it of filtered) {
      const p = catalog.length ? resolveProduct({ sku: it.sku } as OrderItem, catalog) : null
      const key = p ? "p:" + String(p.id ?? p.sku ?? p.name) : it.name?.trim() ? "n:" + it.name.trim().toLowerCase() : "s:" + it.sku
      const at = by.get(key)
      if (at === undefined) {
        by.set(key, out.length)
        out.push({ key, name: p?.name || it.name || it.sku, product: p, image: imageFor(p, it.variant), rows: [it] })
      } else {
        out[at].rows.push(it)
      }
    }
    return out
  }, [filtered, catalog])

  const paged = usePaged(groups, 25)
  /** Every sku on the page, open or not — what "select all" and the supplier resolver mean
   *  by "this page". A collapsed group still selects its variants: the checkbox is on the
   *  product, and the labels are printed per variant. */
  const pageSkus = useMemo(() => paged.pageItems.flatMap((g) => g.rows.map((r) => r.sku)), [paged.pageItems])

  /**
   * WHO SELLS THIS, AND CAN WE STILL GET IT.
   *
   * An inventory row records what we hold, not where it came from — `supplier` is free text
   * someone may or may not have typed. So restocking meant looking the blank up again in a
   * supplier catalogue, every time, which is the search this table should be ending.
   *
   * resolve-suppliers answers it from the sku (the same call that prices a PO line), and the
   * answer doubles as an availability check: a sku that resolves to NOTHING is no longer in
   * any catalogue we can buy from — discontinued, renamed, or from a supplier we dropped.
   *
   * NOT auto-deleted. A resolver that is briefly down would otherwise wipe the shelf, and
   * stock we physically hold is real whether or not the supplier still lists it. It is
   * flagged, and removing it stays a decision someone makes per row.
   */
  useEffect(() => {
    const missing = pageSkus.filter(Boolean).filter((k) => meta[k] === undefined)
    if (!missing.length) return
    let alive = true
    const t = setTimeout(() => {
      resolveSuppliers(missing)
        .then((r) => {
          if (!alive) return
          // Cache a key for every sku ASKED, including the ones with no answer — otherwise
          // the effect re-fires forever on exactly the rows we most want to flag.
          const add: Record<string, { supplier?: string | null; variant?: string | null; api?: string | null }> = {}
          for (const k of missing) add[k] = (r?.bySku ?? {})[k] ?? {}
          setMeta((m) => ({ ...m, ...add }))
        })
        .catch(() => { /* leave them unknown — unknown is not the same as unavailable */ })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSkus])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* Icon+title hidden on desktop (the top bar names the page); the Saving
            indicator on the right stays. On mobile the hero is the title. */}
        {!embedded && (<>
          <Package size={18} weight="regular"  className="shrink-0 text-primary md:hidden" />
          <div className="min-w-0 md:hidden">
            <PageTitle>Inventory</PageTitle>
            <p className="truncate text-sm text-muted-foreground">Track stock per variant, flag low/out, and print SKU barcodes.</p>
          </div>
        </>)}
        <div className="ml-auto flex items-center gap-2">
          {saving ? <span className="text-xs text-muted-foreground"><CircleNotch size={13} className="inline animate-spin" /> Saving…</span> : saved ? <span className="inline-flex items-center gap-1 text-xs text-success"><Check size={13} weight="bold" /> Saved</span> : null}
        </div>
      </div>

      {/* Standalone only: the two pools (stock WE own vs stock sellers consigned to us).
          When embedded in the Inventory shell, these are two of its top tabs instead — no
          second stacked pill row. */}
      {!pool && (
        <div className="flex w-fit rounded-full border border-border p-0.5">
          {([{ id: "own", label: "Our stock" }, { id: "consigned", label: "Incoming stock" }] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setOwnTab(t.id)}
              className={"eg-tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <TabLabel>{t.label}</TabLabel>
            </button>
          ))}
        </div>
      )}

      {tab === "consigned" ? (
        /* Two things are inbound and neither was visible from this screen: stock we BOUGHT
           and have not received (placed POs, Alibaba included), and stock a SELLER sent us
           to hold. Both end with someone opening a carton at this desk. */
        <div className="space-y-4">
          <InboundPanel />
          <ConsignmentPanel />
        </div>
      ) : (
      <>
      <StatGrid>
        <StatCard label="SKUs" value={String(stats.total)} sub="variants tracked" />
        <StatCard label="Low stock" value={String(stats.low)} sub="at/below reorder" tone={stats.low ? "neg" : undefined} />
        <StatCard label="Out of stock" value={String(stats.out)} sub="need reorder" tone={stats.out ? "neg" : undefined} />
        <StatCard label="Reserved" value={String(stats.reserved)} sub="on open orders" />
      </StatGrid>

      <SectionCard title="Stock">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <div className="relative max-w-md flex-1">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU, name, variant…" className="h-9 pl-9" />
          </div>
          {cats.length > 0 && (
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="eg-select eg-control pr-8">
              <option value="">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {/* The clean-up filter. Off by default: this table's job is what we HOLD, and a
              blank we can no longer buy is still stock on a shelf until someone decides
              otherwise. */}
          <label className="flex eg-control cursor-pointer">
            <input type="checkbox" checked={onlyUnavailable} onChange={(e) => setOnlyUnavailable(e.target.checked)} className="size-3.5 accent-[var(--primary)]" />
            No longer stocked
          </label>
          <select
            value={vis}
            onChange={(e) => setVis(e.target.value as "" | SkuVisibility)}
            aria-label="Filter by visibility"
            className="eg-select eg-control pr-8"
          >
            <option value="">All visibility</option>
            {VIS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          {sel.size > 0 && (
            <Button variant="ghost" onClick={() => setSel(new Set())}>Clear ({sel.size})</Button>
          )}
          <Button variant="outline" onClick={() => setPrintOpen(true)} disabled={filtered.length === 0}>
            {sel.size ? `Print ${sel.size} selected` : "Print labels"}
          </Button>
          <Button onClick={() => setAddOpen(true)}>Add item</Button>
        </div>

        {/* THE PARAGRAPH IS GONE. Four sentences with three words bolded inside them, above
            a table — five type weights in a strip whose job was to define a dropdown that
            has three options in it. The definitions live on the control: each option's
            meaning is one line under the select in the Add-item dialog, which is where
            somebody is actually choosing. */}

        {items === null ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{(items.length ?? 0) === 0 ? "No inventory yet — add an item." : "No items match."}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left eg-label text-muted-foreground">
                  <tr>
                    <th className="py-2.5 pl-3 pr-1">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={pageSkus.length > 0 && pageSkus.every((k) => sel.has(k))}
                        onChange={(e) => {
                          const next = new Set(sel)
                          // Only this page — ticking a header shouldn't silently select
                          // hundreds of rows the user can't see. Every VARIANT on the page,
                          // including the ones inside collapsed groups: the group is a way
                          // of reading the table, not a subset of what it holds.
                          pageSkus.forEach((k) => (e.target.checked ? next.add(k) : next.delete(k)))
                          setSel(next)
                        }}
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 font-medium hidden md:table-cell">SKU</th>
                    {/* LABELS waits for a wide screen. It is the sticker count, which only matters
                        once something is ticked for printing — and it was taking 90px of a laptop
                        away from the column that holds the row's only control. */}
                    <th className="hidden px-2 py-2.5 text-center font-medium xl:table-cell">Labels</th>
                    <th className="px-4 py-2.5 text-center font-medium">In stock</th>
                    {/* RESERVED and REORDER AT stand down under 1536px. Eleven columns did not fit a
                        laptop, so the table scrolled sideways and Visibility — the one CONTROL in
                        the row — sat off the right edge where nobody found it. These two are
                        reference numbers you look up, not ones you scan down. */}
                    <th className="hidden px-4 py-2.5 text-center font-medium 2xl:table-cell">Reserved</th>
                    <th className="px-4 py-2.5 text-center font-medium">Available</th>
                    <th className="hidden px-4 py-2.5 text-center font-medium 2xl:table-cell">Reorder&nbsp;at</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium hidden md:table-cell">Visibility</th>
                    <th className="sticky right-0 z-10 bg-card px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((g) => {
                    const one = g.rows.length === 1
                    const isOpen = openKeys.has(g.key)
                    const allSel = g.rows.every((r) => sel.has(r.sku))
                    return (
                      <ProductGroup
                        key={g.key}
                        group={g}
                        open={isOpen}
                        onToggle={() => setOpenKeys((p) => { const n = new Set(p); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}
                        selected={allSel}
                        onSelect={(on) => {
                          const next = new Set(sel)
                          for (const r of g.rows) { if (on) next.add(r.sku); else next.delete(r.sku) }
                          setSel(next)
                        }}
                        single={one}
                        meta={meta}
                        sel={sel} setSel={setSel} copies={copies} setCopies={setCopies}
                        edit={edit} setVisibility={setVisibility} remove={remove} onHistory={setHistSku} onZoom={setZoomSku}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]} noun="products" />
          </>
        )}
      </SectionCard>

      </>
      )}

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onAdd={add} existing={(items ?? []).map((i) => i.sku)} catalog={catalog} />
      <ScanHistoryDialog sku={histSku} onClose={() => setHistSku(null)} />

      {/* Selected variants only — or the whole filtered list if nothing is ticked,
          which keeps the old one-click behaviour for "print everything". */}
      <LabelSheet
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        labels={(sel.size ? filtered.filter((i) => sel.has(i.sku)) : filtered).map((i) => ({
          sku: i.sku, name: i.name, variant: i.variant, copies: copies[i.sku] ?? 1,
        }))}
      />
      <BarcodeZoom sku={zoomSku} onClose={() => setZoomSku(null)} />
    </div>
  )
}

type Group = { key: string; name: string; product: CatalogProduct | null; image: string; rows: InventoryItem[] }

/** The photo, or the letter — never an empty tile, and never a stock photo of something
 *  else. A blank square with an initial says "no picture"; a placeholder garment would say
 *  "this is the garment", which is a lie the picker acts on. */
function Thumb({ src, name, size = 60 }: { src: string; name: string; size?: number }) {
  return src ? (
    <span className="block shrink-0 overflow-hidden rounded-md border border-border bg-muted/40" style={{ width: size, height: size }}>
      <Image src={src} alt="" width={size * 2} height={size * 2} unoptimized className="size-full object-cover" />
    </span>
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-md border border-border bg-muted/40 text-sm font-semibold text-muted-foreground"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * A product and its variants — one <tbody> row when there is one variant, a summary row
 * plus an openable list when there are several.
 *
 * THE SUMMARY ROW DOES NOT TAKE EDITS. Its numbers are sums across sizes, and there is no
 * honest answer to "set in stock to 40" on a row that stands for eight skus — it would have
 * to pick one, or spread, and either is a number nobody typed. Editing lives on the variant,
 * which is where the count is actually held.
 */
function ProductGroup({
  group, open, onToggle, selected, onSelect, single, meta, sel, setSel, copies, setCopies, edit, setVisibility, remove, onHistory, onZoom,
}: {
  group: Group
  open: boolean
  onToggle: () => void
  selected: boolean
  onSelect: (on: boolean) => void
  single: boolean
  meta: Record<string, { supplier?: string | null; variant?: string | null; api?: string | null }>
  sel: Set<string>
  setSel: (s: Set<string>) => void
  copies: Record<string, number>
  setCopies: (c: Record<string, number>) => void
  edit: (sku: string, field: "in_stock" | "reserved" | "reorder_at", value: number) => void
  setVisibility: (sku: string, v: SkuVisibility) => void
  remove: (sku: string) => void
  onHistory: (sku: string) => void
  onZoom: (sku: string) => void
}) {
  const row = (it: InventoryItem, indented: boolean) => (
    <tr key={it.sku} className={"border-t border-border " + (sel.has(it.sku) ? "bg-primary/[0.04]" : "") + (indented ? " bg-muted/30" : "")}>
      {/* THE DISCLOSURE LIVES BESIDE THE CHECKBOX, in its own column, on every row —
          expandable or not. It used to sit inside the Item cell, so a grouped product's
          photo started 20px right of a single product's and the thumbnails never lined up.
          A column of pictures that is not a column is harder to scan than no pictures. */}
      <td className="py-2 pl-3 pr-1">
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            aria-label={`Select ${it.sku}`}
            checked={sel.has(it.sku)}
            onChange={(e) => {
              const next = new Set(sel)
              if (e.target.checked) next.add(it.sku); else next.delete(it.sku)
              setSel(next)
            }}
          />
          <span className="size-5 shrink-0" aria-hidden />
        </div>
      </td>
      <td className="px-4 py-2">
        {/* THE CARET GETS ITS OWN COLUMN, on every row, expandable or not. It used to sit
            inside the flex only where there was something to expand, so a grouped product's
            photo started 20px right of a single product's and the thumbnails never lined
            up — a column of pictures that is not a column is harder to scan than no
            pictures at all. */}
        <div className={"flex w-auto min-w-0 items-center gap-2.5 md:w-[23rem] " + (indented ? "pl-[4.25rem]" : "")}>
          {!indented && <span className="hidden md:contents"><Thumb src={group.image} name={group.name} /></span>}
          <div className="min-w-0">
            {/* TWO LINES, then ellipsis. One line at 220px cut "OTTO CAP OTTO FLEX Fitte…"
                off before the part that tells it from the next Otto cap; letting it run
                free would hand one column the whole row. Two lines is enough for a real
                product name and still a bounded row height. */}
            <div className="line-clamp-2 font-medium leading-tight" title={indented ? undefined : (it.name || group.name || undefined)}>
              {indented ? (it.variant || meta[it.sku]?.variant || it.sku) : (it.name || group.name || "—")}
            </div>
            {/* Variant first — it is what tells two rows of one style apart. Then who sells
                it: typed if someone typed it, else resolved from the supplier catalogues by
                sku, so the next restock does not start with a search. */}
            {!indented && (it.variant || meta[it.sku]?.variant) && (
              <div className="truncate text-xs text-muted-foreground">{it.variant || meta[it.sku]?.variant}</div>
            )}
            {(it.supplier || meta[it.sku]?.supplier) && (
              <div className="truncate text-2xs text-muted-foreground">{it.supplier || meta[it.sku]?.supplier}</div>
            )}
            {/* NO "not in any supplier catalogue" BADGE. It landed on nearly every row —
                anything we stock that isn't a live S&S/Otto sku, which is most of what a
                factory holds — so it read as a warning about the table rather than about a
                row, and it pushed every line onto two. The same answer is still one click
                away and deliberate: the "No longer stocked" filter above lists exactly these
                rows when that is the question being asked. */}
          </div>
        </div>
      </td>
      <td className="px-4 py-2 hidden md:table-cell">
        {/* SKU as TEXT. The inline barcode was a 22px thumbnail no scanner could read, and
            the icon beside it spent a column on a dialog nobody opened twice — the SKU
            itself opens it, for the one moment someone wants to scan off the screen. */}
        <button
          type="button"
          onClick={() => onZoom(it.sku)}
          title={`Show a scannable code for ${it.sku}`}
          className="block w-[8.5rem] break-all text-left font-mono text-xs font-medium underline-offset-2 hover:underline"
        >
          {it.sku}
        </button>
      </td>
      <td className="hidden px-2 py-2 text-center xl:table-cell">
        {/* How many stickers for THIS variant. Only meaningful once it's ticked, so it's
            disabled until then. */}
        <Input
          value={String(copies[it.sku] ?? 1)}
          onChange={(e) => setCopies({ ...copies, [it.sku]: Math.max(1, Number(e.target.value.replace(/[^0-9]/g, "")) || 1) })}
          disabled={!sel.has(it.sku)}
          inputMode="numeric"
          aria-label={`Label copies for ${it.sku}`}
          className="mx-auto h-8 w-14 text-center"
        />
      </td>
      <td className="px-2 py-2 text-center"><Input value={String(num(it.in_stock))} onChange={(e) => edit(it.sku, "in_stock", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-14 text-center" /></td>
      {/* RESERVED IS NOT TYPED ANY MORE — the system holds it. Accepting an order into
          production reserves its blanks and shipping or cancelling releases them, tracked
          per order, so a number typed here would be silently corrected the next time either
          happens. Shown, because it is the difference between In stock and Available. */}
      <td className="hidden px-2 py-2 text-center 2xl:table-cell">
        <span
          className={"inline-block w-14 text-center tabular-nums " + (num(it.reserved) > 0 ? "font-medium" : "text-muted-foreground")}
          title={num(it.reserved) > 0 ? `${num(it.reserved)} held for orders in production` : "Nothing held for production"}
        >
          {num(it.reserved)}
        </span>
      </td>
      <td className="px-4 py-2 text-center font-semibold tabular-nums">{avail(it)}</td>
      <td className="hidden px-2 py-2 text-center 2xl:table-cell"><Input value={String(it.reorder_at ?? 25)} onChange={(e) => edit(it.sku, "reorder_at", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-14 text-center" /></td>
      <td className="px-4 py-2">
        {/* nowrap: the visibility column narrowed this one enough that "In stock" wrapped
            onto two lines and the row grew a step. */}
        {isOut(it) ? <span className="whitespace-nowrap text-xs font-medium text-red-700">Out</span>
          : isLow(it) ? <span className="whitespace-nowrap text-xs font-medium text-amber-700">Low</span>
            : <span className="whitespace-nowrap text-xs font-medium text-emerald-700">In stock</span>}
      </td>
      <td className="sticky right-14 z-10 hidden bg-card px-4 py-2 md:table-cell">
        <select
          value={visOf(it)}
          onChange={(e) => setVisibility(it.sku, e.target.value as SkuVisibility)}
          aria-label={`Visibility for ${it.sku}`}
          /* NO TINTED CAPSULE, and no fixed-height pill for a control that has to hold
             "Factory only" plus a caret. The fill was clipped by the table's own
             horizontal scroll box at the right edge, and it was the last coloured pill in
             a table whose statuses are now words. A bordered select, like every other
             select in the app. */
          className="eg-select h-7 w-full min-w-[8.5rem] rounded-md border border-border bg-transparent py-0 pl-2 pr-6 text-xs font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {VIS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </td>
      <td className="sticky right-0 z-10 bg-card px-4 py-2">
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => onHistory(it.sku)} title="Scan history" className="text-muted-foreground hover:text-foreground"><ClockCounterClockwise size={15} /></button>
          <button onClick={() => remove(it.sku)} title="Remove" className="text-muted-foreground hover:text-red-600"><Trash size={15} /></button>
        </div>
      </td>
    </tr>
  )

  if (single) return row(group.rows[0], false)

  const stock = group.rows.reduce((n, r) => n + num(r.in_stock), 0)
  const reserved = group.rows.reduce((n, r) => n + num(r.reserved), 0)
  const out = group.rows.filter(isOut).length
  const low = group.rows.filter(isLow).length

  return (
    <>
      <tr className={"border-t border-border " + (selected ? "bg-primary/[0.04]" : "")}>
        <td className="py-2 pl-3 pr-1">
          <div className="flex items-center gap-1">
            <input type="checkbox" aria-label={`Select all ${group.rows.length} variants of ${group.name}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
            {/* Points DOWN at what it will reveal and flips up when it is open — the two
                states are the same glyph rotated, so the row never changes width. */}
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} the ${group.rows.length} variants of ${group.name}`}
              className={"grid size-5 shrink-0 place-items-center rounded transition-colors hover:bg-accent "
                + (open ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <CaretDown size={12} weight="bold" className={"transition-transform " + (open ? "rotate-180" : "")} />
            </button>
          </div>
        </td>
        <td className="px-4 py-2">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-auto min-w-0 items-center gap-2.5 md:w-[23rem] text-left">
            <Thumb src={group.image} name={group.name} />
            <span className="min-w-0">
              <span className="line-clamp-2 font-medium leading-tight" title={group.name}>{group.name}</span>
              <span className="block text-xs text-muted-foreground">{group.rows.length} variants</span>
            </span>
          </button>
        </td>
        <td className="px-4 py-2 text-xs text-muted-foreground hidden md:table-cell">
          {/* NOT one of the variants' skus. Printing the first would read as the product's
              own code and get scanned as one. */}
          <span className="font-mono">{group.rows.length} SKUs</span>
        </td>
        <td className="px-2 py-2 hidden md:table-cell" />
        <td className="px-2 py-2 text-center font-semibold tabular-nums">{stock}</td>
        <td className="px-2 py-2 text-center tabular-nums hidden md:table-cell">{reserved}</td>
        <td className="px-4 py-2 text-center font-semibold tabular-nums">{stock - reserved}</td>
        <td className="px-2 py-2 hidden md:table-cell" />
        <td className="px-4 py-2">
          {out === group.rows.length ? <span className="whitespace-nowrap text-xs font-medium text-red-700">All out</span>
            : out || low ? <span className="whitespace-nowrap text-xs font-medium text-amber-700">{out ? `${out} out` : `${low} low`}</span>
              : <span className="whitespace-nowrap text-xs font-medium text-emerald-700">In stock</span>}
        </td>
        <td className="px-4 py-2 text-xs text-muted-foreground hidden md:table-cell">
          {/* One word only when the variants agree. Showing the first row's setting as if it
              were the product's is how a public sku hides behind a "Factory only" label. */}
          {group.rows.every((r) => visOf(r) === visOf(group.rows[0]))
            ? (VIS.find((v) => v.id === visOf(group.rows[0]))?.label ?? "")
            : "Mixed"}
        </td>
        <td className="px-4 py-2" />
      </tr>
      {open && group.rows.map((it) => row(it, true))}
    </>
  )
}

/**
 * One SKU's barcode, big enough to scan off the screen.
 *
 * The surround is dark so the phone's exposure settles on the code instead of a bright
 * page, but the barcode itself stays BLACK ON WHITE. Inverting it — light bars on a
 * dark field — is what breaks scanning: BarcodeDetector and ZXing both expect dark
 * bars on a light quiet zone, and most handheld guns won't read an inverted code at
 * all. So: dark room, white card.
 *
 * Deliberately dark in BOTH themes rather than following light mode. The darkness is
 * doing a job — it isolates the code and stops a bright page dragging the camera's
 * auto-exposure down onto the white card. A light surround in day mode would undo
 * that. Tinted toward the app's violet (hue 280) so it reads as ours and not as a
 * black void.
 */
function BarcodeZoom({ sku, onClose }: { sku: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!sku} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="border-none bg-[oklch(0.19_0.05_280)] sm:max-w-xl">
        <DialogHeader><DialogTitle className="text-white">Scan this code</DialogTitle></DialogHeader>
        {sku && (
          <div className="space-y-3 pb-2">
            {/* Generous white padding IS the quiet zone — Code-128 needs a clear margin
                either side or the scanner can't find the start/stop guards. */}
            {/* QR, not Code-128 — this is a SCREEN.
                A 25-character SKU is 310 Code-128 modules, which in this box is 0.8px per
                bar against the ~2px a camera needs. It was never scannable, whatever the
                decoder did. The same SKU as a QR is 29 modules, about 8.5px each. The
                1D code is still what goes on a PRINTED label, where the physical width
                is there to spend. */}
            <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-8">
              <ScanQr value={sku} size={260} />
              {/* Kept underneath for a handheld gun, which reads 1D off a screen far
                  better than a phone camera does. */}
              <Barcode value={sku} height={70} width={2} fontSize={0} displayValue={false} fit />
            </div>
            <p className="text-center font-mono text-sm text-white/70">{sku}</p>
            <p className="text-center text-xs text-white/50">
              Phone camera: use the square code. Handheld gun: either. Hold 15–25cm away and
              turn screen brightness up if it won&apos;t read.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Every stock movement for one SKU — who scanned it, which way, and when. This is
// how an admin audits a count that looks wrong without digging through the DB.
function ScanHistoryDialog({ sku, onClose }: { sku: string | null; onClose: () => void }) {
  const [rows, setRows] = useState<ScanRow[] | null>(null)

  useEffect(() => {
    let live = true
    const id = setTimeout(() => {
      if (!sku) { setRows(null); return }
      getScanHistory(sku, 100).then((r) => { if (live) setRows(r ?? []) }).catch(() => { if (live) setRows([]) })
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [sku])

  const net = (rows ?? []).reduce((n, r) => n + (r.direction === "in" ? r.qty : -r.qty), 0)
  const when = (s?: string) => {
    if (!s) return "—"
    const d = new Date(s)
    return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  }

  return (
    <Dialog open={!!sku} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClockCounterClockwise size={17} weight="duotone" /> Scan history</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
          <span className="font-mono text-xs font-medium">{sku}</span>
          {rows && rows.length > 0 && <span className="text-xs text-muted-foreground">Net <b className={net >= 0 ? "text-success" : "text-red-600"}>{net >= 0 ? "+" : ""}{net}</b> over {rows.length} scan{rows.length === 1 ? "" : "s"}</span>}
        </div>
        {rows === null ? (
          <div className="flex justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No scans recorded for this SKU yet.</div>
        ) : (
          <div className="max-h-80 divide-y divide-border overflow-auto">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <span className={"flex size-6 shrink-0 items-center justify-center rounded-md " + (r.direction === "in" ? "bg-emerald-100 text-success" : "bg-amber-100 text-amber-700")}>
                  {r.direction === "in" ? <ArrowDown size={12} weight="bold" /> : <ArrowUp size={12} weight="bold" />}
                </span>
                <span className={"w-10 shrink-0 text-sm font-semibold tabular-nums " + (r.direction === "in" ? "text-success" : "text-red-600")}>
                  {r.direction === "in" ? "+" : "−"}{r.qty}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{r.by_name || "Unknown user"}</div>
                  {r.order_ref && <div className="truncate font-mono text-xs text-muted-foreground">order {r.order_ref}</div>}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{when(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * ADD A ROW, OR ADD A PRODUCT'S WHOLE SIZE RUN.
 *
 * Typing a sku by hand is how every row got here, and it is the step that gets them wrong:
 * the sku has to match what an order line resolves to, and nothing on the form said what
 * that was. Picking the product instead derives it — `variantSku`, the same function the
 * product editor writes stock with — so a size run added here and one stocked on the product
 * card are the SAME rows rather than two spellings of them.
 *
 * PER SIZE, not per size × colour, because that is what the product editor now holds. Two
 * screens writing two different key shapes for one shelf is the split that made "do we have
 * it?" unanswerable in the first place.
 */
/**
 * ADD A BLANK TO THE INVENTORY LIST — exported, because the other place this is needed is an
 * ORDER LINE. A line whose blank is not on the list reads "Not tracked", and the answer to
 * that is this dialog; opening the Inventory page, finding the blank and typing its sku again
 * is the same work done by hand. §5: import it, don't build a second one.
 *
 * `seedQuery` pre-fills the catalogue search so the caller can hand it the sku it is asking
 * about. It is a SEARCH, not a selection — the person still picks, because a sku that matches
 * nothing must not silently add the wrong blank.
 */
export function AddItemDialog({ open, onOpenChange, onAdd, existing, catalog, seedQuery }: { open: boolean; onOpenChange: (v: boolean) => void; onAdd: (items: InventoryItem[]) => void; existing: string[]; catalog: CatalogProduct[]; seedQuery?: string }) {
  const [mode, setMode] = useState<"catalog" | "manual">("catalog")
  const [sku, setSku] = useState("")
  const [name, setName] = useState("")
  const [variant, setVariant] = useState("")
  const [stock, setStock] = useState("")
  const [reorder, setReorder] = useState("25")
  const [category, setCategory] = useState("")
  const [supplier, setSupplier] = useState("")
  // Starts closed. Adding a row by hand is still not a decision to publish it, and the
  // dialog should not be the place that quietly differs from receiving.
  const [visibility, setVisibility] = useState<SkuVisibility>("factory")
  const [err, setErr] = useState<string | null>(null)
  // Catalogue path
  const [q, setQ] = useState("")
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      setMode(catalog.length ? "catalog" : "manual")
      setSku(""); setName(""); setVariant(""); setStock(""); setReorder("25"); setCategory(""); setSupplier(""); setVisibility("factory"); setErr(null)
      setQ(seedQuery ?? ""); setPickedId(null); setChosen(new Set())
    }, 0)
    return () => clearTimeout(id)
  }, [open, catalog.length, seedQuery])

  const withSku = useMemo(() => catalog.filter((p) => String(p.sku || "").trim()), [catalog])
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = t ? withSku.filter((p) => `${p.name ?? ""} ${p.sku ?? ""}`.toLowerCase().includes(t)) : withSku
    return list.slice(0, 40)
  }, [withSku, q])
  const picked = useMemo(() => withSku.find((p) => String(p.id ?? p.sku) === pickedId) ?? null, [withSku, pickedId])
  const pickedSizes = useMemo(() => (picked ? productSizes(picked) : []), [picked])
  const pickedColors = useMemo(() => (picked ? productColors(picked) : []), [picked])

  /**
   * ONE ROW PER VARIANT — colour AND size, because that is what the shelf holds and what an
   * order line asks for ("Red · L/XL"). Filing per size alone produced counts no line could
   * draw from, and printed "Not tracked" beside blanks that were in the building.
   *
   * `chosen` holds the sku itself rather than a size, since the grid is now two dimensions
   * and a size string can no longer name a row on its own.
   */
  const rows = useMemo(() => {
    if (!picked) return []
    const base = String(picked.sku || "").trim()
    const szs = pickedSizes.length ? pickedSizes : [""]
    const cls = pickedColors.length ? pickedColors : [""]
    const out: { size: string; color: string; sku: string; exists: boolean }[] = []
    for (const c of cls) for (const sz of szs) {
      const k = variantSku(base, sz || null, c || null)
      out.push({ size: sz, color: c, sku: k, exists: existing.some((e) => e.toUpperCase() === k.toUpperCase()) })
    }
    return out
  }, [picked, pickedSizes, pickedColors, existing])

  const pick = (p: CatalogProduct) => {
    setPickedId(String(p.id ?? p.sku))
    /**
     * EVERY VARIANT, TICKED. A product's whole colour × size run is what "add this product
     * to inventory" means — the shelf should be able to say "none of that one" as a FACT,
     * and it can only do that for a variant it has a row for. A blank row is silence; a row
     * at 0 is an answer, and it is the answer the order board needs to stop reading a real
     * garment as untracked.
     *
     * Ones already stocked stay out: re-adding them would rewrite a real count with a zero.
     */
    const base = String(p.sku || "").trim()
    // The product's OWN variants, as the editor saved them — the supplier's full run is
    // not what we hold.
    const szs = productSizes(p)
    const cls = productColors(p)
    const next = new Set<string>()
    for (const c of (cls.length ? cls : [""])) for (const sz of (szs.length ? szs : [""])) {
      const k = variantSku(base, sz || null, c || null)
      if (k && !existing.some((e) => e.toUpperCase() === k.toUpperCase())) next.add(k)
    }
    setChosen(next)
    setErr(null)
  }

  const saveManual = () => {
    const s = sku.trim()
    if (!s) { setErr("A SKU is required."); return }
    if (existing.includes(s)) { setErr("That SKU already exists."); return }
    onAdd([{ sku: s, name: name.trim() || undefined, variant: variant.trim() || undefined, in_stock: Number(stock) || 0, reorder_at: Number(reorder) || 25, category: category.trim() || undefined, supplier: supplier.trim() || undefined, visibility }])
  }

  const saveCatalog = () => {
    if (!picked) { setErr("Pick a product first."); return }
    const take = rows.filter((r) => chosen.has(r.sku) && !r.exists)
    if (!take.length) { setErr("Nothing to add — every ticked variant is already on the shelf."); return }
    onAdd(take.map((r) => ({
      sku: r.sku,
      name: picked.name || undefined,
      variant: (r.size || r.color) ? variantLabel(r.size || null, r.color || null) : undefined,
      in_stock: Number(stock) || 0,
      reorder_at: Number(reorder) || 25,
      category: picked.type || category.trim() || undefined,
      /**
       * THE SUPPLIER COMES WITH IT — I had this the other way round, on the reasoning that a
       * supplier name is factory-only. It is, and this is a factory field: GET /api/inventory
       * is staff-only and the partner stock feed selects sku/name/variant/counts and never
       * this. §2.9 is about what we PUBLISH.
       *
       * It matters because replenishment groups a shortfall by `inventory.supplier`. Without
       * it, a row we created from a catalogue product that plainly names its supplier still
       * reaches the cart as "Unassigned · order by hand" — a line nobody can place.
       */
      supplier: picked.supplier?.trim() || undefined,
      visibility,
    })))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add inventory item</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {catalog.length > 0 && (
            <div className="flex w-fit rounded-full border border-border p-0.5">
              {([{ id: "catalog", label: "From catalogue" }, { id: "manual", label: "By hand" }] as const).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setMode(t.id); setErr(null) }}
                  className={"eg-tap rounded-full px-3 py-1 text-xs font-medium transition-colors " + (mode === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {mode === "catalog" ? (
            <>
              {!picked ? (
                <>
                  <div className="relative">
                    <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalogue…" className="h-9 pl-9" autoFocus />
                  </div>
                  <div className="max-h-72 divide-y divide-border overflow-auto rounded-lg border border-border">
                    {matches.length === 0 ? (
                      <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {withSku.length === 0 ? "No catalogue product has a SKU yet — stock is held against it, so add one on the product first." : "No product matches."}
                      </div>
                    ) : matches.map((p) => (
                      <button
                        key={String(p.id ?? p.sku)}
                        type="button"
                        onClick={() => pick(p)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <Thumb src={imageFor(p, null)} name={p.name ?? "?"} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name || "Untitled"}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">{p.sku}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{productColors(p).length || 1} × {productSizes(p).length || 1}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5 rounded-lg border border-border p-2.5">
                    <Thumb src={imageFor(picked, null)} name={picked.name ?? "?"} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{picked.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{picked.sku}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { setPickedId(null); setChosen(new Set()) }}>Change</Button>
                  </div>
                  {/* GROUPED BY COLOURWAY, sizes inside it. A flat list of 66 variants is a
                      scroll; the question anyone actually has is "which colours are we
                      stocking, and in what sizes", and that is two shallow lists. */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Variants to stock{chosen.size ? ` — ${chosen.size} picked` : ""}</span>
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => setChosen(chosen.size ? new Set() : new Set(rows.filter((r) => !r.exists).map((r) => r.sku)))}
                      >
                        {chosen.size ? "Clear" : "Select all"}
                      </button>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border p-2">
                      {Object.entries(rows.reduce((acc, r) => {
                        (acc[r.color] ??= []).push(r); return acc
                      }, {} as Record<string, typeof rows>)).map(([color, group]) => {
                        const free = group.filter((r) => !r.exists)
                        const allOn = free.length > 0 && free.every((r) => chosen.has(r.sku))
                        return (
                          <div key={color || "one"}>
                            <div className="mb-1 flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={allOn}
                                disabled={free.length === 0}
                                aria-label={`All sizes of ${color ? prettyColorName(color) : "this product"}`}
                                onChange={(e) => setChosen((prev) => {
                                  const n = new Set(prev)
                                  for (const r of free) { if (e.target.checked) n.add(r.sku); else n.delete(r.sku) }
                                  return n
                                })}
                                className="size-3.5 accent-[var(--primary)]"
                              />
                              <span className="text-xs font-medium">{color ? prettyColorName(color) : "All sizes"}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 pl-5">
                              {group.map((r) => (
                                <label
                                  key={r.sku}
                                  title={r.exists ? `${r.sku} — already stocked` : r.sku}
                                  className={"inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs "
                                    + (r.exists ? "border-border opacity-40"
                                      : chosen.has(r.sku) ? "cursor-pointer border-primary bg-primary/10 text-primary"
                                        : "cursor-pointer border-border")}
                                >
                                  <input
                                    type="checkbox"
                                    checked={chosen.has(r.sku)}
                                    disabled={r.exists}
                                    onChange={(e) => setChosen((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.sku); else n.delete(r.sku); return n })}
                                    className="sr-only"
                                  />
                                  {r.size || "One size"}
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">SKU</span><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="G2000-BLK-L" className="h-9 font-mono" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Name</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gildan Ultra Cotton Tee" className="h-9" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Variant</span><Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="Black · L" className="h-9" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Supplier</span><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="S&S Activewear / Otto Cap" className="h-9" /></label>
            </>
          )}

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">In stock</span><Input value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" inputMode="numeric" className="h-9" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Reorder at</span><Input value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="h-9" /></label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Category</span>
              <Input value={mode === "catalog" ? (picked?.type ?? "") : category} onChange={(e) => setCategory(e.target.value)} disabled={mode === "catalog"} placeholder="Apparel" className="h-9" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Visibility</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as SkuVisibility)}
              className="eg-select eg-control pr-8"
            >
              {VIS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <span className="text-2xs text-muted-foreground">
              {visibility === "factory" ? "Internal only — nothing outside the factory sees this SKU."
                : visibility === "seller" ? "Published in the partner stock feed."
                  : "Cleared for unauthenticated surfaces too. Nothing reads that yet — this records the decision."}
            </span>
          </label>
          {mode === "manual" && sku.trim() && <div className="flex justify-center rounded-lg border border-border bg-muted/30 py-2"><Barcode value={sku.trim()} height={40} /></div>}
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {mode === "catalog" ? (
              <Button onClick={saveCatalog} disabled={!picked || chosen.size === 0}>
                Add {chosen.size || ""} item{chosen.size === 1 ? "" : "s"}
              </Button>
            ) : (
              <Button onClick={saveManual}>Add item</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
