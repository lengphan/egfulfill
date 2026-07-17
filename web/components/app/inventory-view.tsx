"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Package, MagnifyingGlass, Plus, Printer, Trash, CircleNotch, Check, ClockCounterClockwise, ArrowUp, ArrowDown } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Barcode } from "@/components/app/barcode"
import { usePaged, Pagination } from "@/components/app/pagination"
import { getInventory, patchInventoryItem, addInventoryItem, deleteInventoryItem, getScanHistory, type InventoryItem, type ScanRow } from "@/lib/api"
import { getToken } from "@/lib/auth"

const num = (v: unknown) => Number(v) || 0
const avail = (it: InventoryItem) => num(it.in_stock) - num(it.reserved)
const isOut = (it: InventoryItem) => num(it.in_stock) <= 0
const isLow = (it: InventoryItem) => !isOut(it) && num(it.in_stock) <= (it.reorder_at ?? 25)

export function InventoryView() {
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [search, setSearch] = useState("")
  const [cat, setCat] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [histSku, setHistSku] = useState<string | null>(null)
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
    if (!search) return true
    return `${it.sku} ${it.name ?? ""} ${it.variant ?? ""}`.toLowerCase().includes(search.toLowerCase())
  }), [items, cat, search])

  const stats = useMemo(() => {
    const list = items ?? []
    return { total: list.length, low: list.filter(isLow).length, out: list.filter(isOut).length, reserved: list.reduce((s, i) => s + num(i.reserved), 0) }
  }, [items])

  const paged = usePaged(filtered, 25)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="truncate text-sm text-muted-foreground">Track stock per variant, flag low/out, and print SKU barcodes.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {saving ? <span className="text-xs text-muted-foreground"><CircleNotch size={13} className="inline animate-spin" /> Saving…</span> : saved ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check size={13} weight="bold" /> Saved</span> : null}
        </div>
      </div>

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
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <Button size="sm" variant="outline" onClick={() => setPrintOpen(true)} disabled={filtered.length === 0}><Printer size={14} weight="bold" /> Print labels</Button>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus size={14} weight="bold" /> Add item</Button>
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
                    <th className="px-4 py-2.5 font-medium">SKU</th>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 text-center font-medium">In stock</th>
                    <th className="px-4 py-2.5 text-center font-medium">Reserved</th>
                    <th className="px-4 py-2.5 text-center font-medium">Available</th>
                    <th className="px-4 py-2.5 text-center font-medium">Reorder&nbsp;at</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((it) => (
                    <tr key={it.sku} className="border-t border-border">
                      <td className="px-4 py-2"><div className="flex flex-col gap-0.5"><span className="font-mono text-xs font-medium">{it.sku}</span><Barcode value={it.sku} height={22} width={1} fontSize={0} displayValue={false} className="max-w-[120px]" /></div></td>
                      <td className="px-4 py-2"><div className="max-w-[220px] truncate font-medium">{it.name || "—"}</div>{it.variant && <div className="max-w-[220px] truncate text-xs text-muted-foreground">{it.variant}</div>}</td>
                      <td className="px-2 py-2 text-center"><Input value={String(num(it.in_stock))} onChange={(e) => edit(it.sku, "in_stock", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-16 text-center" /></td>
                      <td className="px-2 py-2 text-center"><Input value={String(num(it.reserved))} onChange={(e) => edit(it.sku, "reserved", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-16 text-center" /></td>
                      <td className="px-4 py-2 text-center font-semibold tabular-nums">{avail(it)}</td>
                      <td className="px-2 py-2 text-center"><Input value={String(it.reorder_at ?? 25)} onChange={(e) => edit(it.sku, "reorder_at", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="mx-auto h-8 w-16 text-center" /></td>
                      <td className="px-4 py-2">
                        {isOut(it) ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Out</span>
                          : isLow(it) ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Low</span>
                            : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">In stock</span>}
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

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onAdd={add} existing={(items ?? []).map((i) => i.sku)} />
      <ScanHistoryDialog sku={histSku} onClose={() => setHistSku(null)} />

      {printOpen && (
        <div className="fixed inset-0 z-50 overflow-auto bg-background">
          <div className="no-print sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
            <span className="font-medium">{filtered.length} labels</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPrintOpen(false)}>Close</Button>
              <Button size="sm" onClick={() => window.print()}><Printer size={14} weight="bold" /> Print</Button>
            </div>
          </div>
          <div className="print-area grid grid-cols-3 gap-3 p-4 sm:grid-cols-4">
            {filtered.map((it) => (
              <div key={it.sku} className="flex flex-col items-center gap-1 rounded border border-border p-2 text-center">
                <div className="w-full truncate text-xs font-medium">{it.name || it.sku}</div>
                {it.variant && <div className="w-full truncate text-[10px] text-muted-foreground">{it.variant}</div>}
                <Barcode value={it.sku} height={46} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
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
          {rows && rows.length > 0 && <span className="text-xs text-muted-foreground">Net <b className={net >= 0 ? "text-emerald-600" : "text-red-600"}>{net >= 0 ? "+" : ""}{net}</b> over {rows.length} scan{rows.length === 1 ? "" : "s"}</span>}
        </div>
        {rows === null ? (
          <div className="flex justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No scans recorded for this SKU yet.</div>
        ) : (
          <div className="max-h-80 divide-y divide-border overflow-auto">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <span className={"flex size-6 shrink-0 items-center justify-center rounded-md " + (r.direction === "in" ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-700")}>
                  {r.direction === "in" ? <ArrowDown size={12} weight="bold" /> : <ArrowUp size={12} weight="bold" />}
                </span>
                <span className={"w-10 shrink-0 text-sm font-semibold tabular-nums " + (r.direction === "in" ? "text-emerald-600" : "text-red-600")}>
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
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { if (open) { const id = setTimeout(() => { setSku(""); setName(""); setVariant(""); setStock(""); setReorder("25"); setCategory(""); setSupplier(""); setErr(null) }, 0); return () => clearTimeout(id) } }, [open])

  const save = () => {
    const s = sku.trim()
    if (!s) { setErr("A SKU is required."); return }
    if (existing.includes(s)) { setErr("That SKU already exists."); return }
    onAdd({ sku: s, name: name.trim() || undefined, variant: variant.trim() || undefined, in_stock: Number(stock) || 0, reorder_at: Number(reorder) || 25, category: category.trim() || undefined, supplier: supplier.trim() || undefined })
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
