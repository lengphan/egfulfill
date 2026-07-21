"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ShoppingCart, CircleNotch, Plus, Truck, CheckCircle, Trash, PaperPlaneTilt, BookmarkSimple, ArrowUUpLeft, CaretRight, ArrowClockwise } from "@phosphor-icons/react"
import { usePaged, Pagination } from "@/components/app/pagination"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getInventory, saveInventory, getPurchaseOrders, savePurchaseOrder, deletePurchaseOrder,
  getFactoryList, saveFactoryList,
  ssOrder, ottoOrder, type InventoryItem, type PurchaseOrder, type POLine, type SavedPOLine,
} from "@/lib/api"
import { POAddItems } from "@/components/app/po-add-items"
import { getToken } from "@/lib/auth"

const num = (v: unknown) => Number(v) || 0
const isLow = (it: InventoryItem) => num(it.in_stock) <= (it.reorder_at ?? 25)
const suggestQty = (it: InventoryItem) => Math.max(1, (it.reorder_at ?? 25) * 2 - num(it.in_stock))
const supKey = (s?: string | null) => (s || "Unassigned")
const nextNum = () => "PO-" + Date.now().toString(36).toUpperCase()
// Which supplier API (if any) can place this PO automatically.
const placer = (supplier?: string | null): "ss" | "otto" | null => {
  const s = (supplier || "").toLowerCase()
  if (s.includes("otto")) return "otto"
  if (s.includes("s&s") || s.includes("ss") || s.includes("activewear")) return "ss"
  return null
}

export function PurchaseView() {
  const [inv, setInv] = useState<InventoryItem[] | null>(null)
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Lines pulled out of a draft but kept for a later order. Factory-global (staff
  // share one list), so it survives the browser that removed the line.
  const [saved, setSaved] = useState<SavedPOLine[]>([])
  const [addTo, setAddTo] = useState<PurchaseOrder | null>(null)
  // Which history rows are expanded. A set, not a single id — comparing two past POs
  // side by side is the normal reason to open them.
  const [open, setOpen] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    if (!getToken()) { setInv([]); setPos([]); return }
    getInventory().then((r) => setInv(r ?? [])).catch(() => setInv([]))
    getPurchaseOrders().then((r) => setPos(r ?? [])).catch(() => setPos([]))
    getFactoryList<SavedPOLine[]>("po_saved").then((r) => setSaved(Array.isArray(r) ? r : [])).catch(() => {})
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // Low-stock items grouped by supplier → reorder suggestions.
  const suggestions = useMemo(() => {
    const low = (inv ?? []).filter(isLow)
    const g: Record<string, InventoryItem[]> = {}
    for (const it of low) (g[supKey(it.supplier)] ??= []).push(it)
    return g
  }, [inv])

  const drafts = (pos ?? []).filter((p) => p.status === "draft")
  // History grows forever — every PO ever placed — so it pages. Drafts are the working
  // set and stay whole; there are never many, and hiding one behind a page would mean
  // missing something you're mid-way through.
  const history = (pos ?? []).filter((p) => p.status !== "draft")
  const pagedHistory = usePaged(history, 20)

  const createDraft = async (supplier: string, items: InventoryItem[]) => {
    setBusy("new"); setMsg(null)
    const lines: POLine[] = items.map((it) => ({ sku: it.sku, name: it.name || undefined, variant: it.variant || undefined, qty: suggestQty(it), price: 0 }))
    const po: PurchaseOrder = { num: nextNum(), supplier, items: lines, status: "draft" }
    try { await savePurchaseOrder(po); load() } catch { /* ignore */ } finally { setBusy(null) }
  }

  const patchPO = (po: PurchaseOrder, items: POLine[]) => {
    setPos((prev) => (prev ?? []).map((p) => (p.num === po.num ? { ...p, items } : p)))
    savePurchaseOrder({ ...po, items }).catch(() => {})
  }
  const setLineQty = (po: PurchaseOrder, sku: string, qty: number) =>
    patchPO(po, po.items.map((l) => (l.sku === sku ? { ...l, qty } : l)))
  const removeLine = (po: PurchaseOrder, sku: string) =>
    patchPO(po, po.items.filter((l) => l.sku !== sku))

  // Persist the shared saved-for-later list. Optimistic: the UI moves immediately,
  // the blob is replaced wholesale (that's the factory_lists contract).
  const putSaved = (next: SavedPOLine[]) => {
    setSaved(next)
    saveFactoryList("po_saved", next).catch(() => {})
  }
  /** Pull a line OUT of the draft but keep it — the common "not this order, next one" case. */
  const saveForLater = (po: PurchaseOrder, l: POLine) => {
    removeLine(po, l.sku)
    if (saved.some((s) => s.sku === l.sku)) return          // already parked
    putSaved([...saved, { ...l, supplier: po.supplier ?? null, savedAt: new Date().toISOString() }])
  }
  /** Put a parked line back on a draft, merging the qty if the sku is already there. */
  const restore = (l: SavedPOLine) => {
    const target = drafts.find((p) => supKey(p.supplier) === supKey(l.supplier)) ?? drafts[0]
    if (!target) { setMsg({ ok: false, text: "No draft PO open — create one first, then restore into it." }); return }
    const hit = target.items.find((x) => x.sku === l.sku)
    patchPO(target, hit
      ? target.items.map((x) => (x.sku === l.sku ? { ...x, qty: num(x.qty) + num(l.qty) } : x))
      : [...target.items, { sku: l.sku, name: l.name, variant: l.variant, qty: num(l.qty) || 1, price: l.price }])
    putSaved(saved.filter((s) => s.sku !== l.sku))
  }
  /** Merge lines into an existing set, combining quantities on a repeated sku. Pure, so
   *  the "add items" path and the reorder path can't drift apart. */
  const mergeLines = (existing: POLine[], add: POLine[]): POLine[] => {
    const next = existing.map((l) => ({ ...l }))
    for (const l of add) {
      const hit = next.find((x) => x.sku === l.sku)
      if (hit) hit.qty = num(hit.qty) + (num(l.qty) || 1)
      else next.push({ ...l, qty: num(l.qty) || 1 })
    }
    return next
  }
  /** Add picked supplier-catalog / inventory lines onto a draft, merging by sku. */
  const addLines = (po: PurchaseOrder, lines: POLine[]) => patchPO(po, mergeLines(po.items, lines))

  const place = async (po: PurchaseOrder) => {
    const lines = po.items.filter((l) => num(l.qty) > 0).map((l) => ({ sku: l.sku, qty: num(l.qty) }))
    if (!lines.length) { setMsg({ ok: false, text: "Add at least one item with a quantity." }); return }
    setBusy(po.num); setMsg(null)
    try {
      const p = placer(po.supplier)
      let resp: unknown = { manual: true }
      if (p === "otto") { const r = await ottoOrder(lines); if (r.error) throw new Error(r.error); resp = r }
      else if (p === "ss") { const r = await ssOrder(lines); if (r.error) throw new Error(r.error); resp = r }
      await savePurchaseOrder({ ...po, status: "placed", meta: { response: resp, placedAt: new Date().toISOString() } })
      setMsg({ ok: true, text: p ? `Sent to ${po.supplier} (test/dry-run — set live keys to place for real).` : "Marked placed (no supplier API — record manually)." })
      load()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't place the order." })
    } finally { setBusy(null) }
  }

  // Receive: add each line's qty into inventory, mark the PO received.
  const receive = async (po: PurchaseOrder) => {
    setBusy(po.num); setMsg(null)
    try {
      const bySku = new Map((inv ?? []).map((it) => [it.sku, it]))
      const next = [...(inv ?? [])]
      for (const l of po.items) {
        const existing = bySku.get(l.sku)
        if (existing) { const i = next.findIndex((x) => x.sku === l.sku); next[i] = { ...existing, in_stock: num(existing.in_stock) + num(l.qty) } }
        else next.push({ sku: l.sku, name: l.name, variant: l.variant, in_stock: num(l.qty), reorder_at: 25, supplier: po.supplier })
      }
      await saveInventory(next)
      await savePurchaseOrder({ ...po, status: "received", meta: { ...(po.meta || {}), receivedAt: new Date().toISOString() } })
      setInv(next); setMsg({ ok: true, text: "Received into inventory." }); load()
    } catch { setMsg({ ok: false, text: "Couldn't receive." }) } finally { setBusy(null) }
  }

  const del = async (po: PurchaseOrder) => { setBusy(po.num); try { await deletePurchaseOrder(po.num); load() } catch { /* ignore */ } finally { setBusy(null) } }

  const poTotal = (po: PurchaseOrder) => po.items.reduce((s, l) => s + num(l.qty), 0)

  /** When a past PO actually happened — received beats placed, both beat the row's birth. */
  const poDate = (po: PurchaseOrder) => {
    const m = (po.meta || {}) as Record<string, unknown>
    const raw = (m.receivedAt || m.placedAt || po.created_at) as string | undefined
    if (!raw) return ""
    const d = new Date(raw)
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  }

  const toggle = (n: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (!next.delete(n)) next.add(n)
    return next
  })

  /**
   * Buy a past PO again — the whole thing, or one line of it.
   *
   * Merges into the supplier's existing draft when there is one rather than opening a
   * second: two drafts for the same supplier get placed as two orders, which splits a
   * shipment and forfeits whatever break the combined quantity would have earned.
   * Quantities are copied as they were, since "the same order again" is the request —
   * the draft is editable before it goes anywhere.
   */
  const reorder = async (po: PurchaseOrder, only?: POLine) => {
    const src = (only ? [only] : po.items).filter((l) => num(l.qty) > 0)
    if (!src.length) { setMsg({ ok: false, text: "Nothing on that order to reorder." }); return }
    const lines: POLine[] = src.map((l) => ({ sku: l.sku, name: l.name, variant: l.variant, qty: num(l.qty), price: l.price }))

    const target = drafts.find((p) => supKey(p.supplier) === supKey(po.supplier))
    setBusy(po.num); setMsg(null)
    try {
      if (target) {
        // Await it: this used to fire and forget, so a failed merge reported success and
        // the line silently wasn't on the draft anyone was about to place.
        const merged = mergeLines(target.items, lines)
        await savePurchaseOrder({ ...target, items: merged })
        setPos((prev) => (prev ?? []).map((p) => (p.num === target.num ? { ...p, items: merged } : p)))
        setMsg({ ok: true, text: `Added ${lines.length} line${lines.length === 1 ? "" : "s"} to the open draft ${target.num} — review the quantities before placing.` })
      } else {
        const draft: PurchaseOrder = { num: nextNum(), supplier: po.supplier ?? null, items: lines, status: "draft" }
        const r = await savePurchaseOrder(draft)
        // savePurchaseOrder resolves with {error} for some refusals rather than throwing,
        // so checking only for a thrown error reported a failure as a success.
        if (r?.error) throw new Error(r.error)
        setMsg({ ok: true, text: `Drafted ${draft.num} from ${po.num} — review the quantities before placing.` })
        load()
      }
    } catch (e) {
      // Say what actually went wrong. The generic message here hid the server's reason,
      // which is the only thing that makes this fixable rather than mysterious.
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't create the reorder draft." })
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 md:hidden">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShoppingCart size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Purchase</h1>
          <p className="truncate text-sm text-muted-foreground">Restock low inventory — draft POs per supplier, place via S&amp;S / Otto, receive into stock.</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="Low stock" value={String((inv ?? []).filter(isLow).length)} sub="need reorder" tone={(inv ?? []).some(isLow) ? "neg" : undefined} />
        <StatCard label="Draft POs" value={String(drafts.length)} sub="awaiting review" />
        <StatCard label="Placed" value={String((pos ?? []).filter((p) => p.status === "placed").length)} sub="sent to suppliers" />
        <StatCard label="Received" value={String((pos ?? []).filter((p) => p.status === "received").length)} sub="into inventory" tone="pos" />
      </StatGrid>

      {msg && <div className={"rounded-lg border px-4 py-2 text-sm " + (msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/30 bg-destructive/10 text-destructive")}>{msg.text}</div>}

      {/* Reorder suggestions */}
      <SectionCard title="Reorder suggestions" description="Low/out-of-stock items grouped by supplier">
        {inv === null ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
        ) : Object.keys(suggestions).length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Everything is above its reorder point.</div>
        ) : (
          <div className="divide-y divide-border">
            {Object.entries(suggestions).map(([sup, items]) => (
              <div key={sup} className="flex flex-wrap items-center gap-2 px-5 py-3">
                <span className="font-medium">{sup}</span>
                <span className="text-sm text-muted-foreground">{items.length} item{items.length > 1 ? "s" : ""} low</span>
                <Button size="sm" className="ml-auto" onClick={() => createDraft(sup, items)} disabled={busy === "new"}>
                  {busy === "new" ? <CircleNotch size={13} className="animate-spin" /> : <Plus size={13} weight="bold" />} Draft PO
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Draft POs */}
      {drafts.map((po) => (
        <SectionCard key={po.num} title={<span className="flex items-center gap-2"><span className="font-mono">{po.num}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{po.supplier}</span></span>}
          actions={<div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{poTotal(po)} units</span>
            <Button size="sm" variant="outline" onClick={() => setAddTo(po)}><Plus size={13} weight="bold" /> Add items</Button>
            <button onClick={() => del(po)} className="text-muted-foreground hover:text-red-600" title="Delete"><Trash size={15} /></button>
            <Button size="sm" onClick={() => place(po)} disabled={busy === po.num}>{busy === po.num ? <CircleNotch size={13} className="animate-spin" /> : <PaperPlaneTilt size={13} weight="bold" />} Place order</Button>
          </div>}>
          <div className="divide-y divide-border">
            {po.items.map((l) => (
              <div key={l.sku} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.name || l.sku}</div>
                  <div className="truncate text-xs text-muted-foreground">{l.variant || l.sku}</div>
                </div>
                <Input value={String(num(l.qty))} onChange={(e) => setLineQty(po, l.sku, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} inputMode="numeric" className="h-8 w-20 text-center" />
                {/* Two distinct exits: park it for the next order, or drop it for good.
                    One button doing both would make "not now" indistinguishable from
                    "never" — and the parked list is how a short blank survives a PO
                    that gets placed without it. */}
                <button onClick={() => saveForLater(po, l)} className="text-muted-foreground hover:text-foreground" title="Save for later — keep it out of this PO but don't lose it"><BookmarkSimple size={15} /></button>
                <button onClick={() => removeLine(po, l.sku)} className="text-muted-foreground hover:text-red-600" title="Remove from this PO"><Trash size={14} /></button>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}

      {/* Saved for later — only shown when it has something in it, so it never sits
          on the page as an empty card competing with the drafts. */}
      {saved.length > 0 && (
        <SectionCard title="Saved for later" description="Pulled off a PO but not dropped — restore onto a draft when you're ready">
          <div className="divide-y divide-border">
            {saved.map((l) => (
              <div key={l.sku} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.name || l.sku}</div>
                  <div className="truncate text-xs text-muted-foreground">{[l.variant || l.sku, l.supplier].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="text-xs text-muted-foreground">×{num(l.qty)}</span>
                <Button size="sm" variant="outline" onClick={() => restore(l)}><ArrowUUpLeft size={13} weight="bold" /> Restore</Button>
                <button onClick={() => putSaved(saved.filter((s) => s.sku !== l.sku))} className="text-muted-foreground hover:text-red-600" title="Drop for good"><Trash size={14} /></button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* History — one row per PO, collapsed to a summary. The lines are the reason you
          open a past order at all ("what exactly did we buy last time"), so they're one
          click away rather than on a separate page. */}
      <SectionCard title="Order history" description="Past POs — open one to see its items, or reorder it onto a new draft">
        {pos === null ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No placed orders yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {pagedHistory.pageItems.map((po) => {
              const isOpen = open.has(po.num)
              return (
                <div key={po.num}>
                  <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                    {/* The whole summary toggles — a caret-sized hit target on a row this
                        wide is a miss waiting to happen. */}
                    <button onClick={() => toggle(po.num)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
                      <CaretRight size={13} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (isOpen ? "rotate-90" : "")} />
                      <span className="font-mono text-sm font-medium">{po.num}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {supKey(po.supplier)} · {poTotal(po)} units · {po.items.length} line{po.items.length === 1 ? "" : "s"}
                        {poDate(po) ? " · " + poDate(po) : ""}
                      </span>
                    </button>
                    {po.status === "placed" ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">Placed</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle size={11} weight="fill" /> Received</span>}
                    <Button size="sm" variant="outline" onClick={() => reorder(po)} disabled={busy === po.num} title="Copy these items onto a new draft PO">
                      <ArrowClockwise size={13} weight="bold" /> Reorder
                    </Button>
                    {po.status === "placed" && (
                      <Button size="sm" variant="outline" onClick={() => receive(po)} disabled={busy === po.num}>
                        {busy === po.num ? <CircleNotch size={13} className="animate-spin" /> : <Truck size={13} weight="bold" />} Receive into stock
                      </Button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="border-t border-border bg-muted/30 px-5 py-1">
                      {po.items.length === 0 ? (
                        <div className="py-3 text-sm text-muted-foreground">No lines on this PO.</div>
                      ) : po.items.map((l) => (
                        <div key={l.sku} className="flex items-center gap-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{l.name || l.sku}</div>
                            <div className="truncate text-xs text-muted-foreground">{l.variant || l.sku}</div>
                          </div>
                          {/* A single line can be re-ordered on its own — restocking one
                              short blank shouldn't drag the whole past PO along with it. */}
                          <span className="text-muted-foreground">×{num(l.qty)}</span>
                          <button onClick={() => reorder(po, l)} className="text-muted-foreground hover:text-foreground" title="Reorder just this line">
                            <ArrowClockwise size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
            {history.length > 20 && (
              <Pagination page={pagedHistory.page} pageCount={pagedHistory.pageCount} perPage={pagedHistory.perPage}
                total={pagedHistory.total} start={pagedHistory.start}
                onPage={pagedHistory.setPage} onPerPage={pagedHistory.setPerPage} perPageOptions={[20, 50, 100]} />
            )}
      </SectionCard>

      <POAddItems
        key={addTo?.num ?? "none"}
        po={addTo}
        onClose={() => setAddTo(null)}
        inventory={inv ?? []}
        onAdd={(lines) => { if (addTo) addLines(addTo, lines) }}
      />
    </div>
  )
}
