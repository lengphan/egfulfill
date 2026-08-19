"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { Package, MagnifyingGlass, Trash, CircleNotch, Check, ClockCounterClockwise, ArrowUp, ArrowDown, CaretDown, QrCode as QrCodeIcon, DotsThree } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { ConsignmentPanel } from "@/components/app/consignment-panel"
import { InboundPanel } from "@/components/app/inbound-panel"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Barcode } from "@/components/app/barcode"
import { ScanQr } from "@/components/app/scan-code"
import { LabelSheet } from "@/components/app/label-sheet"
import { usePaged, Pagination } from "@/components/app/pagination"
import { getInventory, patchInventoryItem, addInventoryItem, deleteInventoryItem, getScanHistory, resolveSuppliers, getCatalogProducts, getPurchaseOrders, type CatalogProduct, type InventoryItem, type OrderItem, type ScanRow, type SkuVisibility } from "@/lib/api"
import { getToken } from "@/lib/auth"
import { resolveProduct } from "@/lib/variant-resolve"
import { variantSku, variantLabel, productSizes, productColors } from "@/lib/variant-sku"
import { prettyColorName } from "@/lib/color-name"
import { bySize } from "@/lib/size-order"
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The catalogue, for the row photo and for "Add from catalogue". Read once; a product's
   *  picture doesn't change while a stock count is being typed. */
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  /**
   * UNITS ON A PLACED PO, per sku.
   *
   * A row reading "0 · Out" while six are on a purchase order arriving Friday is the state
   * that gets them ordered twice — the Purchasing board knew and Inventory did not. Read
   * once, joined by sku; no new column, because the answer belongs beside the word that
   * would otherwise send somebody shopping.
   */
  const [onOrder, setOnOrder] = useState<Record<string, number>>({})
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
      // PLACED only. A draft has not been sent to anyone, so nothing is coming; received is
      // already counted in in_stock and would be promised twice.
      getPurchaseOrders().then((rows) => {
        const by: Record<string, number> = {}
        for (const po of rows ?? []) {
          if (String(po.status || "") !== "placed") continue
          for (const l of po.items ?? []) {
            const k = String(l.sku || "").trim().toUpperCase()
            if (k) by[k] = (by[k] ?? 0) + (Number(l.qty) || 0)
          }
        }
        setOnOrder(by)
      }).catch(() => {})
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
          {/* FILTERS LEFT, ACTIONS RIGHT. They were one undifferentiated run, so "Add item"
              sat in the middle of the things that narrow the list — and the eye has no way
              to know which half of a row it is in. ml-auto is the whole separation: a gap
              says "these do something to the list, those do something to the world". */}
          <div className="ml-auto flex items-center gap-2">
            {sel.size > 0 && (
              <Button variant="ghost" onClick={() => setSel(new Set())}>Clear ({sel.size})</Button>
            )}
            <Button variant="outline" onClick={() => setPrintOpen(true)} disabled={filtered.length === 0}>
              {sel.size ? `Print ${sel.size} selected` : "Print labels"}
            </Button>
            <Button onClick={() => setAddOpen(true)}>Add item</Button>
          </div>
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
                    <th className="py-2.5 whitespace-nowrap pl-3 pr-1">
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
                    {/*
                      * SIX COLUMNS, NOT ELEVEN.
                      *
                      * Eleven never fitted, and the table had been coping by hiding five of
                      * them at breakpoints — Labels under xl, SKU and Visibility under md,
                      * Reserved and Reorder-at under 1536px. So a laptop showed a different
                      * table from the one the design assumed, and the columns that vanished
                      * were picked by what could be spared rather than by what the row is.
                      *
                      * Folded instead of dropped. Stock, Reserved and Available were three
                      * columns holding one sentence — 40, 2 held, 38 to sell — where only
                      * the first is typed and the third is arithmetic on the other two.
                      * Labels belongs to printing and now lives in the print sheet, which
                      * is the only place a sticker count means anything. Reorder-at and
                      * Visibility are set once and read rarely; they are on the row's own
                      * menu, and Visibility still shows on the row when it is NOT the
                      * default, because "this sku is public" is worth seeing unasked.
                      */}
                    <th className="px-4 py-2.5 whitespace-nowrap">Item</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">SKU</th>
                    <th className="px-4 py-2.5 whitespace-nowrap text-center">Stock</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="sticky right-0 z-10 bg-card px-4 py-2.5 whitespace-nowrap" />
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((g) => {
                    const one = g.rows.length === 1
                    /**
                     * A SEARCH THAT MATCHES A VARIANT MUST SHOW THE VARIANT.
                     *
                     * The filter already reads `it.variant`, so typing "camo green" did
                     * narrow the table correctly — to a COLLAPSED product row that named
                     * the cap and said "17 variants", with nothing to say which one matched
                     * or that anything had. The search worked and looked broken.
                     *
                     * Derived, not an effect that opens groups into `openKeys`: writing the
                     * search's findings into the same state the caret uses means clearing
                     * the box leaves those groups hanging open, and every keystroke
                     * rewrites a set the user also controls.
                     */
                    const isOpen = openKeys.has(g.key) || (!!search && !one)
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
                        sel={sel} setSel={setSel}
                        edit={edit} setVisibility={setVisibility} remove={remove} onHistory={setHistSku} onZoom={setZoomSku}
                        onOrder={onOrder}
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
        key={printOpen ? "print-open" : "print-closed"}
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        labels={(sel.size ? filtered.filter((i) => sel.has(i.sku)) : filtered).map((i) => ({
          sku: i.sku, name: i.name, variant: i.variant,
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
  group, open, onToggle, selected, onSelect, single, meta, sel, setSel, edit, setVisibility, remove, onHistory, onZoom, onOrder,
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
  edit: (sku: string, field: "in_stock" | "reserved" | "reorder_at", value: number) => void
  setVisibility: (sku: string, v: SkuVisibility) => void
  remove: (sku: string) => void
  onHistory: (sku: string) => void
  onZoom: (sku: string) => void
  /** sku (upper) → units on a placed purchase order. */
  onOrder: Record<string, number>
}) {
  /**
   * THE ROW TINT HAS TO REACH THE STICKY COLUMNS.
   *
   * Visibility and the row actions are `position: sticky` and carry `bg-card`, because a
   * sticky cell must be opaque or the columns scrolling under it show through. That
   * background is painted on the CELL, and a cell's own background covers the row's — so a
   * variant row's tint stopped dead at Status and the last two columns stayed white. On a
   * 17-variant product that reads as a rendering fault, which is exactly what it looked
   * like: the shading that says "these belong to the product above" simply gave up
   * two-thirds of the way across.
   *
   * The tint goes on as a pseudo-element OVER the opaque base rather than as a second
   * background (an element only gets one). Selected beats indented explicitly — both
   * classes used to be emitted at once and which won was left to stylesheet order.
   */
  const tintOf = (it: InventoryItem, indented: boolean) =>
    sel.has(it.sku) ? "bg-primary/[0.04]" : indented ? "bg-muted/30" : ""
  const stickyTint = (it: InventoryItem, indented: boolean) =>
    sel.has(it.sku)
      ? " before:absolute before:inset-0 before:bg-primary/[0.04] before:content-['']"
      : indented
        ? " before:absolute before:inset-0 before:bg-muted/30 before:content-['']"
        : ""

  const row = (it: InventoryItem, indented: boolean) => (
    <tr key={it.sku} className={"border-t border-border " + tintOf(it, indented)}>
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
      <td className="px-4 py-2">
        {/* SKU as TEXT, and the code is one click on it. The inline barcode was a 22px
            thumbnail no scanner could read, and a separate icon column was too much width
            for it — that reasoning still holds and the column is still not coming back.

            WHAT IT LACKED WAS ANY SIGN OF BEING A CONTROL. Styled as plain mono text with
            hover:underline and nothing at rest, so on a table of 17 variants it read as a
            column of data — and the only visible route to a code was tick, Print labels,
            pick a type, which is three steps to answer "what do I point the phone at".
            The glyph is inside the cell, not beside it: it costs no column, and it is the
            thing that says a code is here. */}
        {/* PLAIN TEXT AGAIN. The sku was a button carrying a small code glyph, so on
            seventeen variants a column of data grew seventeen tiny marks and every sku
            looked pressable for a reason nobody could guess. The code is a named item in
            the row menu now — "Barcode" says what it is, which a 13px glyph never did. */}
        <span className="block w-[15rem] max-w-full break-all font-mono text-xs font-medium">
          {it.sku}
        </span>
        {/* VISIBILITY SPEAKS UP ONLY WHEN IT IS NOT THE DEFAULT.
            The control moved to the row menu, and a setting behind a menu is a setting
            nobody audits — but "Factory only" is what almost every row is, and printing it
            on all of them is the column we just removed. So the quiet default stays quiet
            and the two that let a sku out of the building say so. */}
        {visOf(it) !== "factory" && (
          <span className={"mt-0.5 block text-2xs font-medium " + (VIS.find((v) => v.id === visOf(it))?.pill ?? "")}>
            {VIS.find((v) => v.id === visOf(it))?.label}
          </span>
        )}
      </td>
      {/*
        * ONE CELL, ONE SENTENCE: what is here, what is spoken for, what is left.
        *
        * These were three columns and a fourth off-screen, and only the first is a fact
        * anyone types. Reserved is held by the system — accepting an order into production
        * reserves its blanks and shipping or cancelling releases them — and Available is
        * arithmetic on the other two. Three headings for one answer, two of which stood
        * down on a laptop, so the number people actually act on was the one most often
        * missing.
        *
        * The held/available line only appears when something IS held: on a shelf with
        * nothing reserved, "0 held → 40 available" is two numbers restating the one above.
        */}
      {/* The other half of the column's right edge — the group row above is right-aligned
          too, so a product's figure and its variants' land on the same x. */}
      <td className="px-4 py-2 text-right">
        <div className="flex flex-col items-end gap-0.5">
          <Input
            value={String(num(it.in_stock))}
            onChange={(e) => edit(it.sku, "in_stock", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
            inputMode="numeric"
            aria-label={`In stock for ${it.sku}`}
            className="relative z-[1] h-8 w-16 text-right tabular-nums"
          />
          {num(it.reserved) > 0 && (
            <span
              className="whitespace-nowrap text-2xs text-muted-foreground tabular-nums"
              title={`${num(it.reserved)} held for orders in production`}
            >
              {num(it.reserved)} held → <span className="font-medium text-foreground">{avail(it)}</span> free
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2">
        {/* nowrap: the visibility column narrowed this one enough that "In stock" wrapped
            onto two lines and the row grew a step. */}
        {isOut(it) ? <span className="whitespace-nowrap text-xs font-medium text-red-700">Out</span>
          : isLow(it) ? <span className="whitespace-nowrap text-xs font-medium text-amber-700">Low</span>
            : <span className="whitespace-nowrap text-xs font-medium text-emerald-700">In stock</span>}
        {/* ON ORDER, beside the word that would otherwise send somebody shopping. Only when
            the shelf is short — a count of what is coming means nothing next to "In stock",
            and it is the Out and Low rows that get bought twice. */}
        {(isOut(it) || isLow(it)) && (onOrder[String(it.sku).toUpperCase()] ?? 0) > 0 && (
          <span className="block whitespace-nowrap text-2xs text-muted-foreground"
                title="Units on a purchase order that has been placed but not yet received">
            {onOrder[String(it.sku).toUpperCase()]} on order
          </span>
        )}
      </td>
      {/*
        * THE SETTINGS THAT ARE SET ONCE LIVE ON THE ROW'S OWN MENU.
        *
        * Reorder-at and Visibility each held a column all day for a value that is chosen
        * when a sku is created and then read a handful of times a year — and both were
        * hidden on a laptop anyway, so the columns were paying rent on a wide monitor and
        * disappearing on the machine most of this work happens on.
        *
        * Not a DropdownMenu: these are a number field and a select, which is a form, and a
        * menu is a list of commands. Scan history and Remove come along because this is now
        * the one place a row's actions are, rather than two loose glyphs beside a select.
        */}
      <td className={"sticky right-0 z-10 bg-card px-4 py-2" + stickyTint(it, indented)}>
        <div className="relative z-[1] flex items-center justify-end">
          <Popover>
            <PopoverTrigger
              aria-label={`Settings and actions for ${it.sku}`}
              title="Reorder point, visibility, history, remove"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <DotsThree size={18} weight="bold" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3 p-3">
              <div className="truncate font-mono text-2xs text-muted-foreground">{it.sku}</div>
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">Reorder at</span>
                <Input
                  value={String(it.reorder_at ?? 25)}
                  onChange={(e) => edit(it.sku, "reorder_at", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
                  inputMode="numeric"
                  aria-label={`Reorder point for ${it.sku}`}
                  className="h-8 w-16 text-center"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Visibility</span>
                <select
                  value={visOf(it)}
                  onChange={(e) => setVisibility(it.sku, e.target.value as SkuVisibility)}
                  aria-label={`Visibility for ${it.sku}`}
                  className="eg-select h-8 w-full rounded-md border border-border bg-transparent py-0 pl-2 pr-6 text-xs font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {VIS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </label>
              {/* BARCODE, NAMED. It used to be a 13px glyph welded to the sku, which said a
                  code existed only if you already knew the mark. Here it is a word, next to
                  the other two things you do to a row. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2">
                <button
                  onClick={() => onZoom(it.sku)}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <QrCodeIcon size={14} /> Barcode
                </button>
                <button
                  onClick={() => { navigator.clipboard?.writeText(it.sku).catch(() => {}) }}
                  title="Copy this sku to the clipboard"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Copy SKU
                </button>
                <button
                  onClick={() => onHistory(it.sku)}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ClockCounterClockwise size={14} /> Scan history
                </button>
                <button
                  onClick={() => remove(it.sku)}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-red-600"
                >
                  <Trash size={14} /> Remove
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </td>
    </tr>
  )

  if (single) return row(group.rows[0], false)

  const stock = group.rows.reduce((n, r) => n + num(r.in_stock), 0)
  const reserved = group.rows.reduce((n, r) => n + num(r.reserved), 0)
  const out = group.rows.filter(isOut).length
  const low = group.rows.filter(isLow).length

  /** Two axes to lay out, and a catalogue product to take them from. Anything else keeps
   *  the rows it always had — see StockMatrix. */
  const matrixable = !!group.product && (productSizes(group.product).length > 0 || productColors(group.product).length > 0)

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
        <td className="px-4 py-2 text-xs text-muted-foreground">
          {/* NOT one of the variants' skus. Printing the first would read as the product's
              own code and get scanned as one. */}
          <span className="font-mono">{group.rows.length} SKUs</span>
          {/* VISIBILITY ONLY WHEN IT IS NOT THE DEFAULT, and only when the variants agree.
              Showing the first row's setting as if it were the product's is how a public
              sku hides behind a "Factory only" label — so disagreement says so instead. */}
          {(() => {
            const same = group.rows.every((r) => visOf(r) === visOf(group.rows[0]))
            if (!same) return <span className="block text-2xs text-amber-700">Mixed visibility</span>
            const v = visOf(group.rows[0])
            if (v === "factory") return null
            const meta = VIS.find((x) => x.id === v)
            return <span className={"block text-2xs font-medium " + (meta?.pill ?? "")}>{meta?.label}</span>
          })()}
        </td>
        {/* ONE RIGHT EDGE FOR THE WHOLE COLUMN. A product row printed a bare number and a
            variant row a centred pill, so the two never landed on the same x — a column
            meant for comparing figures down the page could not be. */}
        <td className="px-4 py-2 text-right">
          {/* ONE FIGURE, AND THE SPLIT ON HOVER.
              First it was a second line under the count ("3 held → -3 free"), which turned a
              column of numbers into a column of sentences. Then it was a superscript, which
              was worse in a different way: it hung above the baseline of the one column whose
              job is to be read straight down, so no two figures sat on the same line.
              What is held is in the title. The column is for the count. */}
          <span
            className="font-semibold tabular-nums"
            title={reserved > 0 ? `${stock} on the shelf · ${reserved} held for orders in production · ${stock - reserved} free` : `${stock} on the shelf`}
          >
            {stock}
          </span>
        </td>
        <td className="px-4 py-2">
          {/**
            * THE SAME THREE WORDS AS A VARIANT ROW — Out, Low, In stock. A product and a
            * variant are in the same three states and there is no reason to say them
            * differently. This column read "All out" on one line and "Out" on the next,
            * "3 out" here and "Low" below: four spellings of three states, stacked.
            *
            * The count is the DETAIL, so it sits beside the word in the quieter weight
            * rather than replacing it.
            */}
          {out === group.rows.length ? <span className="whitespace-nowrap text-xs font-medium text-red-700">Out</span>
            : out || low ? (
              <span className="whitespace-nowrap text-xs font-medium text-amber-700">
                Low <span className="font-normal text-muted-foreground">{out ? `· ${out} out` : `· ${low}`}</span>
              </span>
            )
              : <span className="whitespace-nowrap text-xs font-medium text-emerald-700">In stock</span>}
        </td>
        <td className="px-4 py-2" />
      </tr>
      {/* THE GRID WHEN IT CAN BE ONE, the list when it cannot.
          StockMatrix returns null for anything it can't lay out on two axes — no catalogue
          product, or a product with neither sizes nor colours — and those fall through to
          the rows they always had. Nothing is hidden either way: a variant the grid can't
          place is named underneath it. */}
      {open && (matrixable ? (
        <tr className="border-t border-border">
          {/* SEVEN, which is how many the table has — a checkbox, the disclosure, the
              picture, Item, SKU, Stock and Status. It said four, so the panel stopped
              two-thirds across and the tinted band ended in mid-air with the Stock and
              Status columns hanging past it. A panel that doesn't span its row reads as a
              broken cell, not as the product's own area. */}
          <td colSpan={7} className="bg-muted/20 p-0">
            <StockMatrix
              group={group}
              edit={(sku, _f, v) => edit(sku, "in_stock", v)}
              lowAt={(it) => Number(it.reorder_at ?? 25)}
            />
          </td>
        </tr>
      ) : group.rows.map((it) => row(it, true)))}
    </>
  )
}

/**
 * A PRODUCT'S STOCK AS A GRID — colours down, sizes across.
 *
 * Stock is held per variant, and a variant has TWO axes. A list flattens them into one, so
 * a tee in five colours and eight sizes became forty rows that you had to read and add up
 * to answer either question anyone actually asks: "do we stock this" (the whole grid) and
 * "can I make Navy in L" (one cell). Grouping helped the first and left the second buried
 * under a caret.
 *
 * Every apparel system settles here for the same reason. Forty numbers in a 5×8 grid are
 * read at a glance, and a hole in the shelf is a coloured cell rather than a row you have
 * to find.
 *
 * IT STAYS EDITABLE. Losing inline editing was the real cost of a grid and there is no need
 * to pay it — a cell is an input, exactly as the list's count was.
 *
 * Degenerates on purpose: a cap has one size, so it is a column of colours; a product with
 * neither is one cell. Anything whose sku doesn't land in the grid is listed underneath as
 * a plain row, because a variant this cannot place must not vanish.
 */
/**
 * A ZERO IS A FACT, NOT AN ALARM. Every cell filled red turned a product we simply don't
 * stock into a page of warnings — seventeen filled pills reading as seventeen problems.
 * The number carries the colour and the border marks it; the fill is gone.
 */
function cellTone(it: InventoryItem, lowAt: (x: InventoryItem) => number) {
  const stock = Number(it.in_stock) || 0
  if (stock <= 0) return "border-red-200 text-red-700 dark:border-red-900/40 dark:text-red-300"
  if (stock <= lowAt(it)) return "border-amber-200 text-amber-800 dark:border-amber-900/40 dark:text-amber-300"
  return "border-border"
}

/** "and N more with nothing on the shelf" — the way back to the empties. */
function EmptyToggle({ hidden, showAll, onToggle }: { hidden: number; showAll: boolean; onToggle: () => void }) {
  if (!hidden && !showAll) return null
  return (
    <button type="button" onClick={onToggle}
      className="text-2xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
      {showAll ? "Hide the empty ones" : `Show ${hidden} more with nothing on the shelf`}
    </button>
  )
}

/** The variants a grid could not place — named, never dropped. */
function LeftoverNote({ rows }: { rows: InventoryItem[] }) {
  return (
    <p className="text-2xs text-muted-foreground">
      {rows.length} variant{rows.length === 1 ? "" : "s"}{" "}not on this grid — the sku doesn&apos;t match the
      product&apos;s sizes and colours: <span className="font-mono">{rows.map((r) => r.sku).join(", ")}</span>
    </p>
  )
}

function StockMatrix({ group, edit, lowAt }: {
  group: { product: CatalogProduct | null; rows: InventoryItem[] }
  edit: (sku: string, field: "in_stock", value: number) => void
  lowAt: (it: InventoryItem) => number
}) {
  const [showAll, setShowAll] = useState(false)
  const p = group.product
  if (!p) return null

  /**
   * THE AXES COME FROM THE SHELF, NOT THE CATALOGUE.
   *
   * Built the other way round first, and both failure modes showed up on real data at once.
   * A product declaring 40 colours and 9 sizes produced 360 input boxes for a shelf holding
   * a handful of skus; and most inventory skus here are SIZE ONLY — `EG-1006-L`, no colour
   * — so a colour axis matched nothing and every cell rendered as an empty dot beneath a
   * product that plainly had stock.
   *
   * So each row is asked what it IS: try the sku against size+colour, then size alone, then
   * colour alone. Only the sizes and colours that actually appear become axes, which makes
   * the grid exactly as big as the shelf and never bigger.
   */
  const declaredSizes = productSizes(p)
  const declaredColors = productColors(p)
  const norm = (v: string) => String(v || "").trim().toUpperCase()

  const placed = new Map<string, { size: string; color: string; it: InventoryItem }>()
  for (const it of group.rows) {
    const sku = norm(it.sku)
    let hit: { size: string; color: string } | null = null
    for (const z of declaredSizes) {
      for (const c of declaredColors) {
        if (norm(variantSku(p.sku, z, c) || "") === sku) { hit = { size: z, color: c }; break }
      }
      if (hit) break
      if (norm(variantSku(p.sku, z, null) || "") === sku) { hit = { size: z, color: "" }; break }
    }
    if (!hit) {
      for (const c of declaredColors) {
        if (norm(variantSku(p.sku, null, c) || "") === sku) { hit = { size: "", color: c }; break }
      }
    }
    if (hit) placed.set(sku, { ...hit, it })
  }
  if (!placed.size) return null                       // nothing resolves — the list is honest

  /**
   * WHAT IS ON THE SHELF, NOT WHAT THE CATALOGUE COULD HOLD.
   *
   * A cap declares seventeen colours and stocks none of them; a hoodie declares sixty
   * variants and stocks none. Drawing every one gave seventeen chips reading 0 and sixty
   * cells reading 0 — pages of a number that means "nothing here", with the two or three
   * that matter lost among them. Zero is the answer to a question nobody asked.
   *
   * So a row has to EARN its place: something on the shelf, or something held for an order.
   * Everything else is behind one toggle, because you do still need it — setting a count on
   * a variant that has never had one is exactly when you want the empties.
   */
  const has = (x: { it: InventoryItem }) => (Number(x.it.in_stock) || 0) !== 0 || (Number(x.it.reserved) || 0) !== 0
  const stocked = [...placed.values()].filter(has)
  const hidden = placed.size - stocked.length
  const shown = showAll || !stocked.length ? [...placed.values()] : stocked

  const sizes = [...new Set(shown.map((x) => x.size).filter(Boolean))].sort(bySize)
  const colors = [...new Set(shown.map((x) => x.color).filter(Boolean))]
  const leftover = group.rows.filter((r) => !placed.has(norm(r.sku)))
  const at = (size: string, color: string) =>
    shown.find((x) => x.size === size && x.color === color)?.it ?? null

  const cell = (it: InventoryItem | null, key: string) =>
    it ? (
      <Input
        key={key}
        value={String(Number(it.in_stock) || 0)}
        onChange={(e) => edit(it.sku, "in_stock", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
        inputMode="numeric"
        aria-label={`In stock for ${it.sku}`}
        title={`${it.sku} · ${Number(it.in_stock) || 0} on the shelf`}
        className={"h-7 w-12 text-center tabular-nums " + cellTone(it, lowAt)}
      />
    ) : <span key={key} className="inline-block w-12 text-center text-muted-foreground/30">·</span>

  /**
   * ONE AXIS IS NOT A MATRIX. A cap has one size and seventeen colours; a table of that is
   * a column seventeen rows tall — the pile of rows this was built to replace. With one
   * axis the honest layout is a wrapped set, so seventeen colours are three short lines.
   */
  /**
   * AN AXIS WITH ONE VALUE IS NOT AN AXIS. A cap's sku carries both a size and a colour —
   * `…-ADJUSTABLE-RED` — so two axes resolve and the table renders twelve rows one column
   * wide, which is the pile of rows this exists to replace wearing a header. What matters
   * is which axis VARIES, not how many were found.
   */
  /**
   * NOTHING ON THE SHELF IS A SENTENCE, NOT A GRID. A product we stock none of drew
   * seventeen zeros; one line says the same thing and leaves the row readable.
   */
  if (!stocked.length && !showAll) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs text-muted-foreground">
        <span>Nothing on the shelf in any of the {placed.size} variants.</span>
        <EmptyToggle hidden={placed.size} showAll={false} onToggle={() => setShowAll(true)} />
      </div>
    )
  }

  if (sizes.length <= 1 || colors.length <= 1) {
    const oneSize = sizes[0] ?? ""
    const oneColor = colors[0] ?? ""
    const axis = sizes.length > 1
      ? sizes.map((z) => ({ label: z, it: at(z, oneColor) }))
      : colors.length > 1
        ? colors.map((c) => ({ label: prettyColorName(c), it: at(oneSize, c) }))
        // Neither varies: one cell, labelled by whatever it is.
        : [{ label: [oneSize, oneColor ? prettyColorName(oneColor) : ""].filter(Boolean).join(" · ") || "Stock",
             it: at(oneSize, oneColor) }]
    return (
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {axis.map(({ label, it }) => (
            <span key={label} className="flex items-center gap-1.5 text-xs">
              <span className="whitespace-nowrap text-muted-foreground">{label}</span>
              {cell(it, label)}
            </span>
          ))}
        </div>
        {leftover.length > 0 && <LeftoverNote rows={leftover} />}
      </div>
    )
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-2 py-1 text-left font-medium">Colour</th>
              {sizes.map((z) => <th key={z} className="min-w-14 px-2 py-1 text-center font-medium">{z}</th>)}
            </tr>
          </thead>
          <tbody>
            {colors.map((c) => (
              <tr key={c} className="border-t border-border">
                <td className="whitespace-nowrap px-2 py-1 font-medium">{prettyColorName(c)}</td>
                {sizes.map((z) => <td key={z} className="px-1 py-1 text-center">{cell(at(z, c), c + z)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {leftover.length > 0 && <LeftoverNote rows={leftover} />}
    </div>
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
