"use client"

import { useEffect, useState } from "react"
import { Package, Barcode, MapPin, Warning, CircleNotch, Plus } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getConsignmentShipments, receiveConsignment, getWarehouseBins, createWarehouseBin,
  getConsignmentStock, type ConsignmentShipment, type WarehouseBin, type ConsignmentStock,
} from "@/lib/api"

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const STATUS_TONE: Record<string, string> = {
  announced: "bg-muted text-muted-foreground",
  in_transit: "bg-amber-100 text-amber-700",
  received: "bg-blue-100 text-blue-700",
  shelved: "bg-emerald-100 text-emerald-700",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
}

/**
 * Inventory services — seller-owned stock we store and fulfil from.
 *
 * Three surfaces, in the order the work actually happens: what's inbound (declared
 * before it arrives, so the floor isn't opening surprise boxes), what's on hand per
 * seller, and the bins it lives in.
 */
export function ConsignmentPanel() {
  const [shipments, setShipments] = useState<ConsignmentShipment[] | null>(null)
  const [stock, setStock] = useState<ConsignmentStock[]>([])
  const [bins, setBins] = useState<WarehouseBin[]>([])
  const [counts, setCounts] = useState<Record<number, { qty: string; loc: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
  const [newBin, setNewBin] = useState("")

  const load = () => {
    getConsignmentShipments().then((r) => setShipments(r ?? [])).catch(() => setShipments([]))
    getConsignmentStock().then((r) => setStock(r ?? [])).catch(() => {})
    getWarehouseBins().then((r) => setBins(r ?? [])).catch(() => {})
  }
  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [])

  const receive = async (s: ConsignmentShipment) => {
    setBusy(s.id); setMsg(null)
    try {
      const lines = s.lines.map((l) => ({
        id: l.id,
        // Default to the declared quantity — the common case is "it all arrived", and
        // typing every line again invites transcription errors.
        qty_received: Number(counts[l.id]?.qty ?? l.qty_declared) || 0,
        location: (counts[l.id]?.loc || l.location || "").toUpperCase() || undefined,
      }))
      const r = await receiveConsignment(s.id, lines)
      if (r.error) throw new Error(r.error)
      setMsg({
        tone: r.discrepancy ? "err" : "ok",
        text: r.discrepancy
          ? `${s.id} received — counts differ from the declaration. Logged as a discrepancy.`
          : `${s.id} received and shelved.`,
      })
      load()
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Could not receive that shipment." })
    } finally { setBusy(null) }
  }

  const addBin = async () => {
    const code = newBin.toUpperCase().trim()
    if (!code) return
    try {
      const r = await createWarehouseBin({ code })
      if (r.error) throw new Error(r.error)
      setNewBin(""); setMsg({ tone: "ok", text: `Bin ${code} added.` }); load()
    } catch (e) { setMsg({ tone: "err", text: e instanceof Error ? e.message : "Could not add that bin." }) }
  }

  const inbound = (shipments ?? []).filter((s) => !["shelved", "closed", "cancelled"].includes(s.status))

  return (
    <div className="space-y-4">
      {msg && (
        <div className={"rounded-lg border p-3 text-sm " + (msg.tone === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800")}>
          {msg.text}
        </div>
      )}

      {/* 1. Inbound — the declaration, so nothing arrives unannounced. */}
      <SectionCard title="Inbound shipments" description="Stock sellers have told us they're sending">
        {shipments === null ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><CircleNotch size={15} className="animate-spin" /> Loading…</div>
        ) : inbound.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">Nothing inbound. Announced shipments appear here before they arrive.</div>
        ) : (
          <div className="divide-y divide-border">
            {inbound.map((s) => (
              <div key={s.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{s.id}</span>
                    <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " + (STATUS_TONE[s.status] ?? "bg-muted text-muted-foreground")}>
                      {s.status.replace(/_/g, " ")}
                    </span>
                    {s.seller_name && <span className="text-sm text-muted-foreground">{s.seller_name}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.carrier || "—"} {s.tracking ? `· ${s.tracking}` : ""} · expected {fmtDate(s.expected_at)}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {s.lines.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{l.name || l.seller_sku || "Item"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.seller_sku ? `Seller SKU ${l.seller_sku}` : "No seller SKU"} · declared {l.qty_declared}
                        </div>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Counted
                        <Input
                          value={counts[l.id]?.qty ?? String(l.qty_declared)}
                          onChange={(e) => setCounts((p) => ({ ...p, [l.id]: { qty: e.target.value.replace(/[^0-9]/g, ""), loc: p[l.id]?.loc ?? "" } }))}
                          inputMode="numeric" className="h-8 w-16 text-xs"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Bin
                        <Input
                          value={counts[l.id]?.loc ?? l.location ?? ""}
                          onChange={(e) => setCounts((p) => ({ ...p, [l.id]: { qty: p[l.id]?.qty ?? String(l.qty_declared), loc: e.target.value.toUpperCase() } }))}
                          placeholder="auto" className="h-8 w-24 text-xs"
                        />
                      </label>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <span className="text-xs text-muted-foreground">Blank bin = we pick one for you</span>
                  <Button size="sm" onClick={() => receive(s)} disabled={busy === s.id}>
                    {busy === s.id ? <CircleNotch size={14} className="animate-spin" /> : <Barcode size={14} weight="bold" />}
                    Receive &amp; shelve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 2. On hand — whose stock, where. */}
      <SectionCard title="Seller stock on hand" description="Reserved for that seller's orders only">
        {stock.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">No consigned stock yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {stock.map((r) => (
              <div key={`${r.internal_sku}-${r.location}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Package size={16} weight="duotone" className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name || r.seller_sku || "Item"}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{r.internal_sku}</div>
                </div>
                <span className="text-xs text-muted-foreground">{r.seller_name}</span>
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium">
                  <MapPin size={11} weight="fill" className="text-muted-foreground" /> {r.location || "unassigned"}
                </span>
                <span className="w-20 text-right text-sm tabular-nums">
                  {r.on_hand - r.reserved}<span className="text-muted-foreground"> / {r.on_hand}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 3. Bins. Chaotic storage with an index — any SKU may live in any bin, so what
             matters is capacity and the scan that binds SKU to location. */}
      <SectionCard
        title="Bins"
        description="Aisle-bay-shelf, e.g. A-03-2. Any SKU may live in any bin."
        actions={
          <div className="flex items-center gap-2">
            <Input value={newBin} onChange={(e) => setNewBin(e.target.value.toUpperCase())} placeholder="A-03-2" className="h-8 w-28 text-xs" />
            <Button size="sm" variant="outline" onClick={addBin}><Plus size={13} weight="bold" /> Add bin</Button>
          </div>
        }
      >
        {bins.length === 0 ? (
          <div className="flex items-start gap-2 p-5 text-sm text-muted-foreground">
            <Warning size={16} className="mt-0.5 shrink-0 text-amber-600" />
            No bins defined yet — add some before receiving, or stock lands unassigned.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 p-5">
            {bins.map((b) => {
              const pct = b.capacity > 0 ? Math.min(100, Math.round((b.used / b.capacity) * 100)) : 0
              return (
                <div key={b.code} className="w-32 rounded-lg border border-border p-2">
                  <div className="font-mono text-xs font-semibold">{b.code}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={"h-full " + (pct > 85 ? "bg-amber-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{b.used}/{b.capacity} units</div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
