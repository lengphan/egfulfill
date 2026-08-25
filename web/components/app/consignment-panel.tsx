"use client"

import { useLabelT, useDateFormat } from "@/lib/i18n"
import { useEffect, useState, useCallback } from "react"
import { Package, Barcode, MapPin, Warning, CircleNotch, Plus } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LabelSheet, type LabelSpec } from "@/components/app/label-sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
 getConsignmentShipments, receiveConsignment, getWarehouseBins, createWarehouseBin,
 getConsignmentStock, createConsignmentShipment,
 type ConsignmentShipment, type WarehouseBin, type ConsignmentStock,
} from "@/lib/api"

function useFmtDate() {
  const fmtDate = useDateFormat()
  return useCallback((s?: string | null) => {
 if (!s) return "—"
 const d = new Date(s)
 return isNaN(d.getTime()) ? "—" : fmtDate(d, { month: "short", day: "numeric", year: "numeric" })
}, [fmtDate])
}

const STATUS_TONE: Record<string, string> = {
 announced: "bg-muted text-muted-foreground",
 in_transit: "bg-hold/15 text-hold",
 received: "bg-blue-100 text-blue-700",
 shelved: "bg-shipped/12 text-shipped",
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
  const fmtDate = useFmtDate()
  const tl = useLabelT()
 const [shipments, setShipments] = useState<ConsignmentShipment[] | null>(null)
 const [stock, setStock] = useState<ConsignmentStock[]>([])
 const [bins, setBins] = useState<WarehouseBin[]>([])
 const [counts, setCounts] = useState<Record<number, { qty: string; loc: string }>>({})
 const [busy, setBusy] = useState<string | null>(null)
 const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
 const [newBin, setNewBin] = useState("")
  // Announcing a shipment is the ENTRY POINT to this whole flow — without it the board
  // can only ever show empty states, which is exactly how it shipped.
 const [asnOpen, setAsnOpen] = useState(false)
 const [asn, setAsn] = useState<{ carrier: string; tracking: string; expected: string; note: string }>({ carrier: "", tracking: "", expected: "", note: "" })
 const [asnLines, setAsnLines] = useState<{ name: string; seller_sku: string; qty: string }[]>([{ name: "", seller_sku: "", qty: "1" }])
 const [asnBusy, setAsnBusy] = useState(false)
  // Barcode labels for what was just received. The internal SKU is minted at receive
  // time, so this is the first moment a label CAN be printed — and the box needs one
  // before it goes on a shelf, or the bin index is the only thing linking them.
 const [labels, setLabels] = useState<LabelSpec[]>([])
 const [labelsOpen, setLabelsOpen] = useState(false)

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
      // One label per UNIT — a 12-piece line needs 12 barcodes on the floor, which is
      // what LabelSheet's `copies` is for.
 const printed: LabelSpec[] = (r.lines ?? [])
        .filter((l) => l.internal_sku && (Number(l.qty_received) || 0) > 0)
        .map((l) => {
 const src = s.lines.find((x) => x.id === l.id)
 return {
 sku: l.internal_sku!,
 name: src?.name || src?.seller_sku || "Consigned item",
 variant: [s.seller_name, l.location].filter(Boolean).join(" · ") || null,
 copies: Number(l.qty_received) || 1,
          }
        })
 if (printed.length) { setLabels(printed); setLabelsOpen(true) }
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

 const stats = {
 inbound: inbound.length,
 unitsIn: inbound.reduce((n, s) => n + s.lines.reduce((m, l) => m + (Number(l.qty_declared) || 0), 0), 0),
 onHand: stock.reduce((n, r) => n + (Number(r.on_hand) || 0) - (Number(r.reserved) || 0), 0),
 sellers: new Set(stock.map((r) => r.seller_id)).size,
  }

 const submitAsn = async () => {
 const lines = asnLines
      .filter((l) => l.name.trim() || l.seller_sku.trim())
      .map((l) => ({ name: l.name.trim(), seller_sku: l.seller_sku.trim(), qty_declared: Number(l.qty) || 0 }))
 if (!lines.length) { setMsg({ tone: "err", text: "Add at least one line — we need to know what's arriving." }); return }
 setAsnBusy(true); setMsg(null)
 try {
 const r = await createConsignmentShipment({
 carrier: asn.carrier || undefined, tracking: asn.tracking || undefined,
 expected_at: asn.expected || undefined, note: asn.note || undefined, lines,
      })
 if (r.error) throw new Error(r.error)
 setMsg({ tone: "ok", text: `Announced ${r.id}. It'll show under Inbound until it's received.` })
 setAsnOpen(false)
 setAsn({ carrier: "", tracking: "", expected: "", note: "" })
 setAsnLines([{ name: "", seller_sku: "", qty: "1" }])
 load()
    } catch (e) {
 setMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't announce that shipment." })
    } finally { setAsnBusy(false) }
  }

 return (
    <div className="space-y-4">
      {msg && (
        <div className={"rounded-lg border p-3 text-sm " + (msg.tone === "ok" ? "border-shipped/30 bg-shipped/12 text-shipped" : "border-hold/30 bg-hold/10 text-hold")}>
          {msg.text}
        </div>
      )}

      <StatGrid>
        <StatCard label={tl("consignment", "Inbound")} value={String(stats.inbound)} sub={tl("consignment", "shipments announced")} />
        <StatCard label={tl("consignment", "Units expected")} value={String(stats.unitsIn)} sub={tl("consignment", "declared, not yet counted")} />
        <StatCard label={tl("consignment", "On hand")} value={String(stats.onHand)} sub={tl("consignment", "available to pick")} />
        <StatCard label={tl("consignment", "Sellers")} value={String(stats.sellers)} sub={tl("consignment", "with stock here")} />
      </StatGrid>

      {/* 1. Inbound — the declaration, so nothing arrives unannounced. */}
      <SectionCard
 title={tl("consignment", "Inbound shipments")}
 actions={<Button size="sm" onClick={() => setAsnOpen(true)}><Plus size={13} weight="bold" /> {tl("consignment", "Announce shipment")}</Button>}
      >
        {shipments === null ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><CircleNotch size={15} className="animate-spin" /> {tl("consignment", "Loading…")}</div>
        ) : inbound.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">
            {tl("consignment", "Nothing inbound yet. Use")} <span className="font-medium text-foreground">{tl("consignment", "Announce shipment")}</span> {tl("consignment", "when a seller tells you stock is on the way — the declaration is what the counted quantities get checked against.")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {inbound.map((s) => (
              <div key={s.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-sm font-semibold">{s.id}</span>
                    <span className={"rounded-full px-2 py-0.5 eg-label " + (STATUS_TONE[s.status] ?? "bg-muted text-muted-foreground")}>
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
                        <div className="truncate text-sm font-medium">{l.name || l.seller_sku || tl("consignment", "Item")}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.seller_sku ? `Seller SKU ${l.seller_sku}` : tl("consignment", "No seller SKU")} · declared {l.qty_declared}
                        </div>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        {tl("consignment", "Counted")}
                        <Input
 value={counts[l.id]?.qty ?? String(l.qty_declared)}
 onChange={(e) => setCounts((p) => ({ ...p, [l.id]: { qty: e.target.value.replace(/[^0-9]/g, ""), loc: p[l.id]?.loc ?? "" } }))}
 inputMode="numeric" className="h-8 w-16 text-xs"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        {tl("consignment", "Bin")}
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
                  <span className="text-xs text-muted-foreground">{tl("consignment", "Blank bin = we pick one for you")}</span>
                  <Button size="sm" onClick={() => receive(s)} disabled={busy === s.id}>
                    {busy === s.id ? <CircleNotch size={14} className="animate-spin" /> : null}
                    Receive &amp; shelve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 2. On hand — whose stock, where. */}
      <SectionCard title={tl("consignment", "Seller stock on hand")}>
        {stock.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">{tl("consignment", "No consigned stock yet.")}</div>
        ) : (
          <div className="divide-y divide-border">
            {stock.map((r) => (
              <div key={`${r.internal_sku}-${r.location}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Package size={16} weight="duotone" className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name || r.seller_sku || tl("consignment", "Item")}</div>
                  <div className="truncate tabular-nums text-2xs text-muted-foreground">{r.internal_sku}</div>
                </div>
                <span className="text-xs text-muted-foreground">{r.seller_name}</span>
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-2xs font-medium">
                  <MapPin size={11} weight="fill" className="text-muted-foreground" /> {r.location || "unassigned"}
                </span>
                <span className="w-20 text-right text-sm tabular-nums">
                  {r.on_hand - r.reserved}<span className="text-muted-foreground"> / {r.on_hand}</span>
                </span>
                <button
 onClick={() => {
 setLabels([{ sku: r.internal_sku ?? "", name: r.name || r.seller_sku, variant: [r.seller_name, r.location].filter(Boolean).join(" · ") || null, copies: 1 }])
 setLabelsOpen(true)
                  }}
 title={tl("consignment", "Reprint this barcode")}
 className="eg-tap flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Barcode size={14} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Barcode labels for the units just received — printed straight after counting,
 because that's when the boxes are open and the SKUs exist. */}
      <LabelSheet labels={labels} open={labelsOpen} onClose={() => setLabelsOpen(false)} title={tl("consignment", "consigned stock labels")} />

      {/* Announce — the declaration that starts the flow. Kept deliberately light: a
 seller telling you what's coming shouldn't be a data-entry chore, and the
 counted quantities at receiving are what actually matter. */}
      <Dialog open={asnOpen} onOpenChange={(v) => { if (!asnBusy) setAsnOpen(v) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{tl("consignment", "Announce an inbound shipment")}</DialogTitle></DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("consignment", "Carrier")}</span>
                <Input value={asn.carrier} onChange={(e) => setAsn({ ...asn, carrier: e.target.value })} placeholder="UPS" className="h-9" />
              </label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("consignment", "Tracking")}</span>
                <Input value={asn.tracking} onChange={(e) => setAsn({ ...asn, tracking: e.target.value })} placeholder="1Z…" className="h-9" />
              </label>
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("consignment", "Expected")}</span>
                <Input type="date" value={asn.expected} onChange={(e) => setAsn({ ...asn, expected: e.target.value })} className="h-9" />
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">{tl("consignment", "What’s arriving")}</div>
              {asnLines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input
 value={l.name}
 onChange={(e) => setAsnLines((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
 placeholder={tl("consignment", "Item name")} className="h-9 min-w-0 flex-1"
                  />
                  <Input
 value={l.seller_sku}
 onChange={(e) => setAsnLines((p) => p.map((x, j) => (j === i ? { ...x, seller_sku: e.target.value } : x)))}
 placeholder={tl("consignment", "Their SKU")} className="h-9 w-32"
                  />
                  <Input
 value={l.qty}
 onChange={(e) => setAsnLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^0-9]/g, "") } : x)))}
 inputMode="numeric" placeholder={tl("consignment", "Qty")} className="h-9 w-20"
                  />
                  {asnLines.length > 1 && (
                    <button onClick={() => setAsnLines((p) => p.filter((_, j) => j !== i))} aria-label={tl("consignment", "Remove line")}
 className="eg-tap flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive">×</button>
                  )}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setAsnLines((p) => [...p, { name: "", seller_sku: "", qty: "1" }])}>
                <Plus size={13} weight="bold" /> {tl("consignment", "Add line")}
              </Button>
            </div>

            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{tl("consignment", "Note (optional)")}</span>
              <Input value={asn.note} onChange={(e) => setAsn({ ...asn, note: e.target.value })} placeholder={tl("consignment", "Anything the floor should know")} className="h-9" />
            </label>

            <p className="text-xs text-muted-foreground">
              {tl("consignment", "We keep this declaration and check the counted quantities against it, so a short or over shipment shows as a discrepancy instead of quietly becoming the new truth.")}
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsnOpen(false)} disabled={asnBusy}>{tl("consignment", "Cancel")}</Button>
            <Button onClick={submitAsn} disabled={asnBusy}>{asnBusy ? tl("consignment", "Announcing…") : tl("consignment", "Announce shipment")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3. Bins. Chaotic storage with an index — any SKU may live in any bin, so what
 matters is capacity and the scan that binds SKU to location. */}
      <SectionCard
 title={tl("consignment", "Bins")}
 actions={
          <div className="flex items-center gap-2">
            <Input value={newBin} onChange={(e) => setNewBin(e.target.value.toUpperCase())} placeholder="A-03-2" className="h-8 w-28 text-xs" />
            <Button size="sm" variant="outline" onClick={addBin}><Plus size={13} weight="bold" /> {tl("consignment", "Add bin")}</Button>
          </div>
        }
      >
        {bins.length === 0 ? (
          <div className="flex items-start gap-2 p-5 text-sm text-muted-foreground">
            <Warning size={16} className="mt-0.5 shrink-0 text-hold" />
            {tl("consignment", "No bins defined yet — add some before receiving, or stock lands unassigned.")}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 p-5">
            {bins.map((b) => {
 const pct = b.capacity > 0 ? Math.min(100, Math.round((b.used / b.capacity) * 100)) : 0
 return (
                <div key={b.code} className="w-32 rounded-lg border border-border p-2">
                  <div className="tabular-nums text-xs font-semibold">{b.code}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={"h-full " + (pct > 85 ? "bg-hold" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-2xs text-muted-foreground">{b.used}/{b.capacity} units</div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
