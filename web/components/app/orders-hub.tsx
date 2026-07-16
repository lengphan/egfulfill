"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Package, CircleNotch, ArrowRight, CheckCircle, PenNib, Truck, Printer, DownloadSimple, Warning, Flag, MapPin } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { StageBadge } from "@/components/app/stage-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrders, postItemStatus, updateOrder, getDesignCards, saveDesignCards, buyUspsLabel, type OrderRow, type OrderItem, type DesignCard, type ShipAddress, type UspsLabelResult } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { FACTORY_STAGES, EXCEPTION_STAGES, ALL_STATUSES, normalizeStage, nextStage, stageMeta, orderStage, isException } from "@/lib/factory-status"
import { itemImage } from "@/lib/order-image"
import { usePaged, Pagination } from "@/components/app/pagination"

const numOf = (o: OrderRow) => (o.seq ? `#${o.seq}` : o.id)
const variantOf = (it: OrderItem) => [it.color, it.size, it.print_type].filter(Boolean).join(" · ")
const addrLine = (o: OrderRow) => {
  const a = (o.address ?? {}) as Record<string, string>
  return [a.city, a.state, a.zip].filter(Boolean).join(", ")
}
const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
const nowId = () => Date.now()
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"]

// USPS mail classes offered for a direct label buy (Labels 3.0 values).
const MAIL_CLASSES: { id: string; label: string }[] = [
  { id: "USPS_GROUND_ADVANTAGE", label: "Ground Advantage" },
  { id: "PRIORITY_MAIL", label: "Priority Mail" },
  { id: "PRIORITY_MAIL_EXPRESS", label: "Priority Express" },
]

// Warehouse return address — set once, persisted locally (used as the label "from").
const FROM_STORE = "eg_ship_from"
const BLANK_ADDR: ShipAddress = { name: "", street: "", street2: "", city: "", state: "", zip: "" }

// Pull a shippable recipient out of an order's stored address (handles Etsy + manual key shapes).
const toAddrOf = (o: OrderRow): ShipAddress => {
  const a = (o.address ?? {}) as Record<string, string>
  return {
    name: o.customer?.name || a.name || "",
    street: a.street || a.first_line || a.line1 || a.address1 || "",
    street2: a.street2 || a.second_line || a.line2 || a.address2 || "",
    city: a.city || "",
    state: a.state || a.province || "",
    zip: a.zip || a.postal_code || a.postcode || "",
  }
}
const addrComplete = (a: ShipAddress) => !!(a.street && a.city && a.state && a.zip)

// Open a bought label in a new tab, whatever shape it came back as (URL / base64 / mock HTML).
const openLabel = (r: UspsLabelResult) => {
  if (r.labelUrl) { window.open(r.labelUrl, "_blank"); return }
  const w = window.open("", "_blank")
  if (!w) return
  if (r.labelHtml) { w.document.write(r.labelHtml); w.document.close(); return }
  if (r.labelImage) {
    const mime = (r.imageType || "").toUpperCase() === "PDF" ? "application/pdf" : "image/png"
    const src = r.labelImage.startsWith("data:") ? r.labelImage : `data:${mime};base64,${r.labelImage}`
    if (mime === "application/pdf") w.location.href = src
    else { w.document.write(`<img src="${src}" style="max-width:100%"/>`); w.document.close() }
  }
}

// Filters derive from the canonical pipeline so they always match the status model.
const FILTERS: { label: string; id: string }[] = [
  { label: "All", id: "all" },
  { label: "New", id: "" },
  ...FACTORY_STAGES.map((s) => ({ label: s.label, id: s.id })),
  { label: "Issues", id: "issues" },
]

// ONE order page for the whole factory team. The queue + item controls are shared; the
// action set adapts to the role: operators review artwork + drive production, warehouse
// receives + ships, admin does everything.
export function OrdersHub() {
  const role = getUser()?.role || ""
  const isAdmin = role === "admin"
  const canFulfill = role === "warehouse" || isAdmin // receive (intake) + ship
  const canDesign = role === "operator" || isAdmin // send to designer + set arbitrary status

  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [filter, setFilter] = useState("all")
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [shipOpen, setShipOpen] = useState<string | null>(null)
  const [carrier, setCarrier] = useState("USPS")
  const [tracking, setTracking] = useState("")

  // ── Label buy (USPS-direct) ──
  const [from, setFrom] = useState<ShipAddress>(BLANK_ADDR)
  const [to, setTo] = useState<ShipAddress>(BLANK_ADDR)
  const [pkg, setPkg] = useState({ weightOz: 6, length: 10, width: 8, height: 1, mailClass: "USPS_GROUND_ADVANTAGE" })
  const [labelErr, setLabelErr] = useState<string | null>(null)
  const [labels, setLabels] = useState<Record<string, UspsLabelResult>>({})

  const load = useCallback(() => {
    if (!getToken()) { setOrders([]); return }
    getOrders().then((rows) => setOrders(rows ?? [])).catch(() => setOrders([]))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])
  // Restore the saved warehouse "from" address.
  useEffect(() => {
    const id = setTimeout(() => {
      try { const raw = localStorage.getItem(FROM_STORE); if (raw) setFrom({ ...BLANK_ADDR, ...JSON.parse(raw) }) } catch {}
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const patchItem = (orderId: string, sku: string, to: string) =>
    setOrders((prev) => (prev ?? []).map((o) => (o.id !== orderId ? o : { ...o, items: (o.items ?? []).map((it) => (it.sku === sku ? { ...it, factory_status: to } : it)) })))

  const advanceItem = async (order: OrderRow, item: OrderItem, to: string) => {
    if (!item.sku) return
    const key = `${order.id}:${item.sku}`
    setBusy(key)
    patchItem(order.id, item.sku, to)
    try { await postItemStatus(order.id, item.sku, to) } catch { load() } finally { setBusy(null) }
  }
  const advanceOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) {
      const to = nextStage(it.factory_status)
      if (to && to !== "shipped") await advanceItem(order, it, to)
    }
  }
  // Warehouse intake: move every unstarted item into the scan flow.
  const receiveOrder = async (order: OrderRow) => {
    for (const it of order.items ?? []) if (it.sku && !normalizeStage(it.factory_status)) await advanceItem(order, it, "awaiting_scan")
  }
  // Ship: mark every line shipped + record tracking/carrier on the order.
  const shipOrder = async (order: OrderRow) => {
    setBusy(`ship:${order.id}`)
    try {
      for (const it of order.items ?? []) if (it.sku) { patchItem(order.id, it.sku, "shipped"); await postItemStatus(order.id, it.sku, "shipped") }
      await updateOrder(order.id, { tracking: tracking.trim() || undefined, carrier, factoryStatus: "shipped", status: "shipped" })
      setShipOpen(null); setTracking(""); load()
    } catch { load() } finally { setBusy(null) }
  }
  // Open the fulfill panel for an order — prefill recipient from the order address.
  const openFulfill = (o: OrderRow) => {
    setShipOpen(o.id); setLabelErr(null); setCarrier("USPS"); setTracking("")
    setTo(toAddrOf(o))
  }
  // Buy a real USPS-direct label (directUsps → skips the Shippo/EasyPost aggregator).
  // On success the server writes tracking + flips the order to shipped; we mirror locally.
  const buyLabel = async (o: OrderRow) => {
    setLabelErr(null)
    if (!addrComplete(to)) { setLabelErr("Recipient needs a street, city, state and ZIP."); return }
    if (!addrComplete(from)) { setLabelErr("Set your warehouse 'From' address (street, city, state, ZIP)."); return }
    setBusy(`label:${o.id}`)
    try {
      try { localStorage.setItem(FROM_STORE, JSON.stringify(from)) } catch {}
      const r = await buyUspsLabel({ to, from, orderId: o.id, ...pkg })
      if (!r.ok) { setLabelErr(r.error || "USPS couldn't create the label."); return }
      setLabels((prev) => ({ ...prev, [o.id]: r }))
      for (const it of o.items ?? []) if (it.sku) patchItem(o.id, it.sku, "shipped")
      openLabel(r)
      setShipOpen(null); load()
    } catch (e) {
      setLabelErr(e instanceof Error ? e.message : "Label request failed.")
    } finally { setBusy(null) }
  }
  // Order-level status: flag / hold / advance every line at once.
  const setOrderStatus = async (o: OrderRow, to: string) => {
    setBusy(`ord:${o.id}`)
    try {
      for (const it of o.items ?? []) if (it.sku) { patchItem(o.id, it.sku, to); await postItemStatus(o.id, it.sku, to) }
      await updateOrder(o.id, { factoryStatus: to }).catch(() => {})
    } catch { load() } finally { setBusy(null) }
  }
  // Send a line item to the Designer board as a new card (whole-board upsert).
  const sendToDesigner = async (o: OrderRow, it: OrderItem) => {
    const key = `${o.id}:${it.sku}`
    setBusy(`dsn:${key}`)
    try {
      const cards = await getDesignCards().catch(() => [])
      const dup = (cards ?? []).some((c) => c.order_id === o.id && c.sku === it.sku)
      if (!dup) {
        const card: DesignCard = {
          id: nowId(), order_id: o.id, sku: it.sku || undefined,
          title: it.name || it.sku || "Design", product: variantOf(it),
          type: it.print_type || undefined, thumb: itemImage(it) || null,
          col: "incoming", pay_status: "pending", payment: 0,
          customer: o.customer?.name ?? null, is_emb: /emb/i.test(it.print_type || ""),
        }
        await saveDesignCards([...(cards ?? []), card])
      }
      setSent((prev) => new Set(prev).add(key))
    } catch { /* ignore */ } finally { setBusy(null) }
  }

  const stats = useMemo(() => {
    const list = orders ?? []
    const by = (id: string) => list.filter((o) => orderStage(o.items ?? []) === id).length
    const inProd = ["awaiting_scan", "scanned", "printing", "packing"]
    return {
      newCount: by(""),
      production: list.filter((o) => inProd.includes(orderStage(o.items ?? []))).length,
      ready: by("packing"),
      shipped: by("shipped"),
    }
  }, [orders])

  const filtered = useMemo(() => {
    const list = orders ?? []
    if (filter === "all") return list
    if (filter === "issues") return list.filter((o) => isException(orderStage(o.items ?? [])))
    return list.filter((o) => orderStage(o.items ?? []) === filter)
  }, [orders, filter])

  const paged = usePaged(filtered, 25)

  const subtitle = isAdmin
    ? "Every order across the team — production to shipping."
    : canFulfill ? "Receive, pack, and ship orders out the door."
      : "Review artwork and drive orders through production."

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="New" value={String(stats.newCount)} sub="awaiting start" tone={stats.newCount ? "neg" : undefined} />
        <StatCard label="In production" value={String(stats.production)} sub="scan → pack" />
        <StatCard label="Ready to ship" value={String(stats.ready)} sub="packed" tone={stats.ready ? "pos" : undefined} />
        <StatCard label="Shipped" value={String(stats.shipped)} sub="complete" tone="pos" />
      </StatGrid>

      <SectionCard title="Production queue">
        <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={"rounded-full px-3 py-1 text-sm font-medium transition-colors " + (filter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {f.label}
            </button>
          ))}
        </div>

        {orders === null ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Package size={24} weight="duotone" />
            <div className="font-medium text-foreground">Nothing here</div>
            <div className="text-sm">{(orders.length ?? 0) === 0 ? "No orders are in production yet." : "No orders match this filter."}</div>
          </div>
        ) : (
          <>
          <div className="divide-y divide-border">
            {paged.pageItems.map((o) => {
              const items = o.items ?? []
              const stage = orderStage(items)
              const allShipped = items.length > 0 && items.every((it) => normalizeStage(it.factory_status) === "shipped")
              const units = items.reduce((n, it) => n + (Number(it.qty) || 1), 0)
              const label = labels[o.id]
              const track = label?.trackingNumber || o.tracking
              return (
                <div key={o.id} className="p-5">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{numOf(o)}</span>
                        <StageBadge status={stage} />
                        <span className="truncate text-sm font-medium">{o.customer?.name || "—"}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-medium capitalize">{o.store || o.source || "manual"}</span>
                        <span>{fmtDate(o.created_at)}</span>
                        <span>· {items.length} item{items.length === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"}</span>
                        {addrLine(o) && <span className="inline-flex items-center gap-0.5"><MapPin size={11} weight="fill" /> {addrLine(o)}</span>}
                        {track && <span className="inline-flex items-center gap-0.5 font-medium text-emerald-600"><Truck size={11} weight="fill" /> {o.carrier || label?.carrier || "USPS"} {track}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Order-level status / flag — applies to every line at once */}
                      {(canDesign || canFulfill) && !allShipped && (
                        <div className="relative">
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) setOrderStatus(o, e.target.value) }}
                            disabled={busy === `ord:${o.id}`}
                            className="h-8 rounded-md border border-input bg-transparent pl-7 pr-2 text-xs font-medium"
                            aria-label="Flag or set order status"
                            title="Flag or set order status"
                          >
                            <option value="">Flag / status…</option>
                            <optgroup label="Set all items to">
                              {ALL_STATUSES.filter((s) => !EXCEPTION_STAGES.some((x) => x.id === s.id)).map((s) => <option key={s.id || "new"} value={s.id}>{s.label}</option>)}
                            </optgroup>
                            <optgroup label="Exceptions">
                              {EXCEPTION_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </optgroup>
                          </select>
                          <Flag size={13} weight="fill" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        </div>
                      )}
                      {canFulfill && stage === "" && (
                        <Button size="sm" onClick={() => receiveOrder(o)} disabled={busy?.startsWith(o.id)}>Receive <ArrowRight size={13} weight="bold" /></Button>
                      )}
                      {allShipped ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle size={14} weight="fill" /> Shipped</span>
                      ) : (
                        <>
                          {label && <Button size="sm" variant="ghost" onClick={() => openLabel(label)} title="Reopen label"><Printer size={14} weight="bold" /> Label</Button>}
                          {canFulfill && shipOpen !== o.id && (
                            <Button size="sm" onClick={() => openFulfill(o)}><Truck size={14} weight="bold" /> Label &amp; ship</Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => advanceOrder(o)}>Advance all <ArrowRight size={13} weight="bold" /></Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Fulfill panel (warehouse/admin): buy a USPS-direct label, or record tracking manually */}
                  {canFulfill && shipOpen === o.id && (
                    <div className="mb-3 space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        {/* Ship to — prefilled from the order */}
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship to</div>
                          <Input value={to.name ?? ""} onChange={(e) => setTo({ ...to, name: e.target.value })} placeholder="Recipient name" className="h-9" />
                          <Input value={to.street ?? ""} onChange={(e) => setTo({ ...to, street: e.target.value })} placeholder="Street address" className="h-9" />
                          <Input value={to.street2 ?? ""} onChange={(e) => setTo({ ...to, street2: e.target.value })} placeholder="Apt, suite (optional)" className="h-9" />
                          <div className="grid grid-cols-[1fr_4rem_5rem] gap-2">
                            <Input value={to.city ?? ""} onChange={(e) => setTo({ ...to, city: e.target.value })} placeholder="City" className="h-9" />
                            <Input value={to.state ?? ""} onChange={(e) => setTo({ ...to, state: e.target.value })} placeholder="ST" className="h-9" />
                            <Input value={to.zip ?? ""} onChange={(e) => setTo({ ...to, zip: e.target.value })} placeholder="ZIP" className="h-9" />
                          </div>
                        </div>
                        {/* Ship from — your warehouse, saved for next time */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ship from</span>
                            <span className="text-[10px] text-muted-foreground">saved for next time</span>
                          </div>
                          <Input value={from.name ?? ""} onChange={(e) => setFrom({ ...from, name: e.target.value })} placeholder="Warehouse / sender name" className="h-9" />
                          <Input value={from.street ?? ""} onChange={(e) => setFrom({ ...from, street: e.target.value })} placeholder="Street address" className="h-9" />
                          <Input value={from.street2 ?? ""} onChange={(e) => setFrom({ ...from, street2: e.target.value })} placeholder="Suite (optional)" className="h-9" />
                          <div className="grid grid-cols-[1fr_4rem_5rem] gap-2">
                            <Input value={from.city ?? ""} onChange={(e) => setFrom({ ...from, city: e.target.value })} placeholder="City" className="h-9" />
                            <Input value={from.state ?? ""} onChange={(e) => setFrom({ ...from, state: e.target.value })} placeholder="ST" className="h-9" />
                            <Input value={from.zip ?? ""} onChange={(e) => setFrom({ ...from, zip: e.target.value })} placeholder="ZIP" className="h-9" />
                          </div>
                        </div>
                      </div>

                      {/* Package + service */}
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Service</span>
                          <select value={pkg.mailClass} onChange={(e) => setPkg({ ...pkg, mailClass: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                            {MAIL_CLASSES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                        </label>
                        <label className="flex w-20 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Weight oz</span>
                          <Input type="number" min={1} value={pkg.weightOz} onChange={(e) => setPkg({ ...pkg, weightOz: Number(e.target.value) })} className="h-9" />
                        </label>
                        <label className="flex w-16 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">L in</span>
                          <Input type="number" min={1} value={pkg.length} onChange={(e) => setPkg({ ...pkg, length: Number(e.target.value) })} className="h-9" />
                        </label>
                        <label className="flex w-16 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">W in</span>
                          <Input type="number" min={1} value={pkg.width} onChange={(e) => setPkg({ ...pkg, width: Number(e.target.value) })} className="h-9" />
                        </label>
                        <label className="flex w-16 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">H in</span>
                          <Input type="number" min={1} value={pkg.height} onChange={(e) => setPkg({ ...pkg, height: Number(e.target.value) })} className="h-9" />
                        </label>
                        <Button size="sm" onClick={() => buyLabel(o)} disabled={busy === `label:${o.id}`} className="ml-auto">
                          {busy === `label:${o.id}` ? <CircleNotch size={14} className="animate-spin" /> : <><Printer size={14} weight="bold" /> Buy USPS label</>}
                        </Button>
                      </div>

                      {labelErr && <div className="flex items-center gap-1.5 text-sm text-destructive"><Warning size={14} weight="fill" /> {labelErr}</div>}

                      {/* Manual fallback — record a label bought elsewhere */}
                      <details className="rounded-lg border border-border bg-card">
                        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">Already have a label? Record tracking manually</summary>
                        <div className="flex flex-wrap items-end gap-2 border-t border-border p-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Carrier</span>
                            <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                              {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-1 flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Tracking number</span>
                            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 9400 1000 0000 0000 0000 00" className="h-9" />
                          </label>
                          <Button size="sm" variant="outline" onClick={() => shipOrder(o)} disabled={busy === `ship:${o.id}`}>
                            {busy === `ship:${o.id}` ? <CircleNotch size={14} className="animate-spin" /> : <><Truck size={14} weight="bold" /> Mark shipped</>}
                          </Button>
                        </div>
                      </details>

                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setShipOpen(null)}>Close</Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {items.map((it, i) => {
                      const to = nextStage(it.factory_status)
                      const toMeta = to ? stageMeta(to) : null
                      const key = `${o.id}:${it.sku}`
                      const img = itemImage(it)
                      return (
                        <div key={it.sku ?? i} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2.5">
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {img ? <Image src={img} alt="" fill unoptimized sizes="48px" className="object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground/50"><Package size={16} weight="duotone" /></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{it.name || it.sku || "Item"}</div>
                            <div className="truncate text-xs text-muted-foreground">{variantOf(it) || "—"}{it.qty ? ` · ×${it.qty}` : ""}</div>
                          </div>
                          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                          {canDesign && (
                            <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-primary" title="Send to designer board" disabled={busy === `dsn:${key}` || sent.has(key)} onClick={() => sendToDesigner(o, it)}>
                              {busy === `dsn:${key}` ? <CircleNotch size={13} className="animate-spin" /> : sent.has(key) ? <CheckCircle size={14} weight="fill" className="text-emerald-600" /> : <PenNib size={14} weight="bold" />}
                            </Button>
                          )}
                          <StageBadge status={it.factory_status} />
                          {canDesign && (
                            <select value={normalizeStage(it.factory_status)} onChange={(e) => advanceItem(o, it, e.target.value)} disabled={busy === key} className="h-8 shrink-0 rounded-md border border-input bg-transparent px-1.5 text-xs" aria-label="Set status" title="Set status">
                              <optgroup label="Production">
                                {ALL_STATUSES.filter((s) => !EXCEPTION_STAGES.some((x) => x.id === s.id)).map((s) => <option key={s.id || "new"} value={s.id}>{s.label}</option>)}
                              </optgroup>
                              <optgroup label="Exceptions">
                                {EXCEPTION_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                              </optgroup>
                            </select>
                          )}
                          {to ? (
                            <Button size="sm" disabled={busy === key} onClick={() => advanceItem(o, it, to)} className="shrink-0">
                              {busy === key ? <CircleNotch size={13} className="animate-spin" /> : <>{toMeta?.label}</>}
                            </Button>
                          ) : (
                            <span className="inline-flex shrink-0 items-center gap-1 px-2 text-xs font-medium text-emerald-600"><CheckCircle size={14} weight="fill" /> {isException(it.factory_status) ? stageMeta(normalizeStage(it.factory_status))?.label : "Done"}</span>
                          )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <Pagination page={paged.page} pageCount={paged.pageCount} perPage={paged.perPage} total={paged.total} start={paged.start} onPage={paged.setPage} onPerPage={paged.setPerPage} perPageOptions={[25, 50, 100]} />
          </>
        )}
      </SectionCard>

      <p className="text-center text-xs text-muted-foreground">Stages: {FACTORY_STAGES.map((s) => s.label).join(" → ")}</p>
    </div>
  )
}
