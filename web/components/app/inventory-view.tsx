"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Package, MagnifyingGlass, Plus, Printer, Trash, CircleNotch, Check, ClockCounterClockwise, ArrowUp, ArrowDown, Barcode as BarcodeIcon } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { ConsignmentPanel } from "@/components/app/consignment-panel"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Barcode } from "@/components/app/barcode"
import { ScanQr } from "@/components/app/scan-code"
import { LabelSheet } from "@/components/app/label-sheet"
import { usePaged, Pagination } from "@/components/app/pagination"
import { getInventory, patchInventoryItem, addInventoryItem, deleteInventoryItem, getScanHistory, resolveSuppliers, type InventoryItem, type ScanRow, type SkuVisibility } from "@/lib/api"
import { getToken } from "@/lib/auth"

const num = (v: unknown) => Number(v) || 0

/**
 * How far a SKU may travel. A row written before the column existed reads back undefined,
 * and the safe reading of "we don't know" is the closed one — never assume a blank means
 * published.
 */
const VIS: { id: SkuVisibility; label: string; pill: string }[] = [
  { id: "factory", label: "Factory only", pill: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { id: "seller", label: "Sellers", pill: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
  { id: "public", label: "Public", pill: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" },
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
  // When the Inventory shell drives the pool (its single Our stock · Seller stock · Scan
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

  const load = useCallback(() => {
    if (!getToken()) { setItems([]); return }
    getInventory().then((r) => setItems(r ?? [])).catch(() => setItems([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

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
  const add = (it: InventoryItem) => {
    setItems((prev) => [it, ...(prev ?? []).filter((x) => x.sku !== it.sku)])
    setAddOpen(false)
    addInventoryItem(it).catch(() => load())
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

  const paged = usePaged(filtered, 25)

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
    const skus = paged.pageItems.map((i) => i.sku).filter(Boolean)
    const missing = skus.filter((k) => meta[k] === undefined)
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
  }, [paged.pageItems])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* Icon+title hidden on desktop (the top bar names the page); the Saving
            indicator on the right stays. On mobile the hero is the title. */}
        {!embedded && (<>
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary md:hidden"><Package size={18} weight="fill" /></span>
          <div className="min-w-0 md:hidden">
            <h1 className="font-title text-2xl font-semibold tracking-tight">Inventory</h1>
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
          {([{ id: "own", label: "Our stock" }, { id: "consigned", label: "Seller stock" }] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setOwnTab(t.id)}
              className={"eg-tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "consigned" ? (
        <ConsignmentPanel />
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
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <option value="">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {/* The clean-up filter. Off by default: this table's job is what we HOLD, and a
              blank we can no longer buy is still stock on a shelf until someone decides
              otherwise. */}
          <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-2xl border border-border bg-card px-3 text-sm">
            <input type="checkbox" checked={onlyUnavailable} onChange={(e) => setOnlyUnavailable(e.target.checked)} className="size-3.5 accent-[var(--primary)]" />
            No longer stocked
          </label>
          <select
            value={vis}
            onChange={(e) => setVis(e.target.value as "" | SkuVisibility)}
            aria-label="Filter by visibility"
            className="eg-select h-9 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="">All visibility</option>
            {VIS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          {sel.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear ({sel.size})</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setPrintOpen(true)} disabled={filtered.length === 0}>
            <Printer size={14} weight="bold" /> {sel.size ? `Print ${sel.size} selected` : "Print labels"}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus size={14} weight="bold" /> Add item</Button>
        </div>

        <div className="border-b border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Factory only</span> never leaves the building — stock arrives this way,
          because receiving a blank is not a decision to sell it.{" "}
          <span className="font-medium text-foreground">Sellers</span> publishes the SKU in the partner stock feed.{" "}
          <span className="font-medium text-foreground">Public</span> additionally clears it for unauthenticated surfaces —
          nothing reads that yet, so today it records the decision rather than changing what is served.
        </div>

        {items === null ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{(items.length ?? 0) === 0 ? "No inventory yet — add an item." : "No items match."}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={paged.pageItems.length > 0 && paged.pageItems.every((i) => sel.has(i.sku))}
                        onChange={(e) => {
                          const next = new Set(sel)
                          // Only this page — ticking a header shouldn't silently select
                          // hundreds of rows the user can't see.
                          paged.pageItems.forEach((i) => (e.target.checked ? next.add(i.sku) : next.delete(i.sku)))
                          setSel(next)
                        }}
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">SKU</th>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-2 py-2.5 text-center font-medium">Labels</th>
                    <th className="px-4 py-2.5 text-center font-medium">In stock</th>
                    <th className="px-4 py-2.5 text-center font-medium">Reserved</th>
                    <th className="px-4 py-2.5 text-center font-medium">Available</th>
                    <th className="px-4 py-2.5 text-center font-medium">Reorder&nbsp;at</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Visibility</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((it) => (
                    <tr key={it.sku} className={"border-t border-border " + (sel.has(it.sku) ? "bg-primary/[0.04]" : "")}>
                      <td className="px-3 py-2">
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
                      </td>
                      <td className="px-4 py-2">
                        {/* SKU as TEXT, with the code one tap away.
                            The inline barcode was a 22px-tall thumbnail — unreadable by any
                            scanner, which is worse than showing none: it looks scannable, so
                            people aim a phone at it and conclude the scanner is broken. It
                            also cost the column ~24px of height on every row for a picture
                            nobody could use.
                            The SKU itself is the thing people read off this table; the code
                            is for the one moment someone wants to scan, and that now opens
                            at a size that actually decodes. */}
                        <div className="flex w-[150px] items-center gap-1.5">
                          <span className="min-w-0 flex-1 break-all font-mono text-xs font-medium">{it.sku}</span>
                          <button
                            type="button"
                            onClick={() => setZoomSku(it.sku)}
                            title={`Show a scannable code for ${it.sku}`}
                            aria-label={`Show a scannable code for ${it.sku}`}
                            className="eg-tap shrink-0 rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <BarcodeIcon size={14} weight="bold" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="max-w-[220px] truncate font-medium">{it.name || "—"}</div>
                        {/* Variant first — it is what tells two rows of one style apart.
                            Then who sells it: typed if someone typed it, else resolved from
                            the supplier catalogues by sku, so the next restock does not
                            start with a search. */}
                        {(it.variant || meta[it.sku]?.variant) && (
                          <div className="max-w-[220px] truncate text-xs text-muted-foreground">{it.variant || meta[it.sku]?.variant}</div>
                        )}
                        {(it.supplier || meta[it.sku]?.supplier) && (
                          <div className="max-w-[220px] truncate text-2xs text-muted-foreground">{it.supplier || meta[it.sku]?.supplier}</div>
                        )}
                        {/* Only once we have ASKED and been told nothing — `meta[sku]` is
                            undefined while unresolved, and an empty object once answered. */}
                        {meta[it.sku] !== undefined && !meta[it.sku]?.supplier && !it.supplier && (
                          <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-2xs font-medium text-amber-700">
                            Not in any supplier catalogue
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {/* How many stickers for THIS variant. Only meaningful once it's
                            ticked, so it's disabled until then. */}
                        <Input
                          value={String(copies[it.sku] ?? 1)}
                          onChange={(e) => setCopies({ ...copies, [it.sku]: Math.max(1, Number(e.target.value.replace(/[^0-9]/g, "")) || 1) })}
                          disabled={!sel.has(it.sku)}
                          inputMode="numeric"
                          aria-label={`Label copies for ${it.sku}`}
                          className="mx-auto h-8 w-14 text-center"
                        />
                      </td>
                      <td className="px-2 py-2 text-center"><Input value={String(num(it.in_stock))} onChange={(e) => edit(it.sku, "in_stock", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-16 text-center" /></td>
                      <td className="px-2 py-2 text-center"><Input value={String(num(it.reserved))} onChange={(e) => edit(it.sku, "reserved", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-16 text-center" /></td>
                      <td className="px-4 py-2 text-center font-semibold tabular-nums">{avail(it)}</td>
                      <td className="px-2 py-2 text-center"><Input value={String(it.reorder_at ?? 25)} onChange={(e) => edit(it.sku, "reorder_at", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-16 text-center" /></td>
                      <td className="px-4 py-2">
                        {/* nowrap: the visibility column narrowed this one enough that
                            "In stock" wrapped onto two lines and the row grew a step. */}
                        {isOut(it) ? <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Out</span>
                          : isLow(it) ? <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Low</span>
                            : <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">In stock</span>}
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={visOf(it)}
                          onChange={(e) => setVisibility(it.sku, e.target.value as SkuVisibility)}
                          aria-label={`Visibility for ${it.sku}`}
                          className={"eg-select h-7 rounded-full border-0 py-0 pl-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " + (VIS.find((v) => v.id === visOf(it))?.pill ?? "")}
                        >
                          {VIS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setHistSku(it.sku)} title="Scan history" className="text-muted-foreground hover:text-foreground"><ClockCounterClockwise size={15} /></button>
                          <button onClick={() => remove(it.sku)} title="Remove" className="text-muted-foreground hover:text-red-600"><Trash size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]} />
          </>
        )}
      </SectionCard>

      </>
      )}

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onAdd={add} existing={(items ?? []).map((i) => i.sku)} />
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

function AddItemDialog({ open, onOpenChange, onAdd, existing }: { open: boolean; onOpenChange: (v: boolean) => void; onAdd: (it: InventoryItem) => void; existing: string[] }) {
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

  useEffect(() => { if (open) { const id = setTimeout(() => { setSku(""); setName(""); setVariant(""); setStock(""); setReorder("25"); setCategory(""); setSupplier(""); setVisibility("factory"); setErr(null) }, 0); return () => clearTimeout(id) } }, [open])

  const save = () => {
    const s = sku.trim()
    if (!s) { setErr("A SKU is required."); return }
    if (existing.includes(s)) { setErr("That SKU already exists."); return }
    onAdd({ sku: s, name: name.trim() || undefined, variant: variant.trim() || undefined, in_stock: Number(stock) || 0, reorder_at: Number(reorder) || 25, category: category.trim() || undefined, supplier: supplier.trim() || undefined, visibility })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add inventory item</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">SKU</span><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="G2000-BLK-L" className="h-9 font-mono" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Name</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gildan Ultra Cotton Tee" className="h-9" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Variant</span><Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="Black · L" className="h-9" /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">In stock</span><Input value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" inputMode="numeric" className="h-9" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Reorder at</span><Input value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="h-9" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Category</span><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Apparel" className="h-9" /></label>
          </div>
          <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Supplier</span><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="S&S Activewear / Otto Cap" className="h-9" /></label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Visibility</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as SkuVisibility)}
              className="eg-select h-9 rounded-2xl border border-border bg-card px-3 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {VIS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <span className="text-2xs text-muted-foreground">
              {visibility === "factory" ? "Internal only — nothing outside the factory sees this SKU."
                : visibility === "seller" ? "Published in the partner stock feed."
                  : "Cleared for unauthenticated surfaces too. Nothing reads that yet — this records the decision."}
            </span>
          </label>
          {sku.trim() && <div className="flex justify-center rounded-lg border border-border bg-muted/30 py-2"><Barcode value={sku.trim()} height={40} /></div>}
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save}>Add item</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
