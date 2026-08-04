"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Trash, ArrowSquareOut, CircleNotch, Calculator, DownloadSimple, Binoculars, X } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Loading } from "@/components/app/loading"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSourcing, saveSourcing, deleteSourcing, fetchSourcingPrice, getSpydeckSaves,
         type SourcingRow, type SavedListing } from "@/lib/api"
import { computeProfit, money, pct, FEE_MODELS, PAYMENT_DEFAULT } from "@/lib/profit"
import { useConfirm } from "@/components/app/confirm-dialog"

/**
 * Sourcing — where a blank comes from, what it lands at, and what it earns.
 *
 * This is a COST BOOK, not a bookmark list. A supplier quote is only comparable once
 * freight is spread over the MOQ: "$3.10 a unit" at MOQ 100 with $85 shipping is really
 * $3.95, and it arrives weeks after the domestic blank at $8.42 with no minimum. Every
 * figure shown here is per-unit-landed for that reason.
 *
 * Admin-only, enforced server-side (manual_suppliers is requireAdmin) — these rows are what
 * we pay and what we make.
 */

type Draft = Partial<SourcingRow> & { title: string }

const EMPTY: Draft = {
  title: "", url: "", cost: null, moq: 1, shipTotal: null, leadDays: null,
  decorationCost: null, sellPrice: null, note: "",
}

const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function SourcingView() {
  const confirm = useConfirm()
  const [rows, setRows] = useState<SourcingRow[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  // Calculator inputs that aren't a property of the supplier row.
  const [feeId, setFeeId] = useState("etsy")
  const [sellPrice, setSellPrice] = useState("")
  const [shipCharged, setShipCharged] = useState("")
  const [outbound, setOutbound] = useState("4.50")

  const load = useCallback(() => {
    getSourcing()
      .then((r) => setRows(r.items ?? []))
      .catch(() => setRows([]))
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const active = useMemo(() => (rows ?? []).find((r) => r.id === selected) ?? null, [rows, selected])
  const fee = FEE_MODELS.find((f) => f.id === feeId) ?? FEE_MODELS[0]

  const landedOf = (r: SourcingRow) =>
    (r.cost ?? 0) + (r.decorationCost ?? 0) + (r.shipTotal ?? 0) / Math.max(1, r.moq ?? 1)
  const activeLanded = active ? landedOf(active) : 0
  // The cheapest OTHER row for the same product — the comparison this page exists to make.
  // Matched on the title, which is what someone types twice when pricing one product across
  // two suppliers.
  const rival = useMemo(() => {
    if (!active) return null
    const others = (rows ?? []).filter(
      (r) => r.id !== active.id && r.title.trim().toLowerCase() === active.title.trim().toLowerCase())
    if (!others.length) return null
    return others.reduce((best, r) => (landedOf(r) < landedOf(best) ? r : best))
  }, [rows, active])
  const rivalLanded = rival ? landedOf(rival) : 0

  // Seed the sell price from the row's own figure the first time one is picked, so the
  // calculator opens with a real number rather than zeros.
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      setSellPrice(active.sellPrice != null ? String(active.sellPrice) : "")
    }, 0)
    return () => clearTimeout(t)
  }, [active])

  // What the calculation is actually missing. Showing "Landed $0.00 / Profit -$5.00" for a
  // row with no unit price and no sell price is an empty state dressed as an answer — the
  // -$5.00 is just fees plus outbound shipping on a product we know nothing about.
  const missing = useMemo(() => {
    if (!active) return []
    const m: string[] = []
    if (active.cost == null) m.push("a unit price")
    if (!(Number(sellPrice) > 0)) m.push("your sell price")
    return m
  }, [active, sellPrice])

  const result = useMemo(() => {
    if (!active) return null
    return computeProfit({
      sellPrice: Number(sellPrice) || 0,
      shippingCharged: Number(shipCharged) || 0,
      unitCost: active.cost ?? 0,
      decorationCost: active.decorationCost ?? 0,
      shipTotal: active.shipTotal ?? 0,
      moq: active.moq ?? 1,
      outboundShipping: Number(outbound) || 0,
      feePct: fee.pct, feeFlat: fee.flat,
      paymentPct: PAYMENT_DEFAULT.pct, paymentFlat: PAYMENT_DEFAULT.flat,
    })
  }, [active, sellPrice, shipCharged, outbound, fee])

  const save = async () => {
    if (!draft || !draft.title.trim()) { setMsg("Give it a name — a row with only a link is unfindable later."); return }
    setSaving(true); setMsg(null)
    try {
      const r = await saveSourcing(draft)
      if (r.error) throw new Error(r.error)
      setDraft(null); load()
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save.") } finally { setSaving(false) }
  }

  const remove = async (row: SourcingRow) => {
    const ok = await confirm({
      title: `Archive “${row.title}”?`,
      body: "It stops appearing here but is kept — an order placed months ago may still point at this source.",
      confirmLabel: "Archive",
    })
    if (!ok) return
    await deleteSourcing(row.id).catch(() => {})
    load()
  }

  // One safe server-side fetch returns price, title AND image. Only fills blanks — never
  // overwrites something already typed, or pasting a link would silently undo your edits.
  const [fetching, setFetching] = useState(false)
  const tryFetch = async () => {
    if (!draft?.url) return
    setFetching(true); setMsg(null)
    const r = await fetchSourcingPrice(draft.url).catch(() => null)
    setFetching(false)
    if (!r) { setMsg("Couldn't reach that link."); return }
    const next = { ...draft }
    const got: string[] = []
    if (r.price != null && next.cost == null) { next.cost = r.price; got.push(`price $${r.price}`) }
    if (r.title && !next.title.trim()) { next.title = r.title; got.push("name") }
    if (r.image && !next.image) { next.image = r.image; got.push("image") }
    setDraft(next)
    setMsg(got.length
      ? `Read ${got.join(", ")} off the page.`
      : (r.error || "Nothing new to read — everything is already filled in."))
  }

  /**
   * The automated path. Rather than typing a product in, pick one you already saved in
   * SpyDeck: title, image and the competitor's price come across as-is.
   *
   * The competitor price becomes YOUR sell price — it's the market rate for the thing, which
   * is exactly what the calculator needs. The supplier cost is deliberately left BLANK: that
   * is the one number a listing cannot tell you, and inventing it would produce a confident
   * margin resting on nothing.
   */
  const [picker, setPicker] = useState<SavedListing[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const openPicker = async () => {
    setPickerOpen(true); setMsg(null)
    if (picker) return
    const saves = await getSpydeckSaves().catch(() => [])
    setPicker(saves)
  }
  const fromListing = (l: SavedListing) => {
    setDraft({
      ...EMPTY,
      title: l.title.slice(0, 120),
      image: l.thumb || l.image || null,
      sellPrice: l.price_usd ?? l.price ?? null,
      productId: String(l.listing_id),
      note: `From SpyDeck${l.shop_name ? ` — seen on ${l.shop_name}` : ""}`,
      url: "",
    })
    setPickerOpen(false)
    setMsg("Prefilled from SpyDeck. Add the supplier link and unit price to see profit.")
  }

  const exportCsv = () => {
    const head = ["Product", "Supplier", "Unit", "MOQ", "Freight", "Landed/unit", "Lead days", "Link"]
    const body = (rows ?? []).map((r) => {
      const landed = (r.cost ?? 0) + (r.decorationCost ?? 0) + (r.shipTotal ?? 0) / Math.max(1, r.moq ?? 1)
      return [r.title, r.shop ?? r.supplierRef ?? "", r.cost ?? "", r.moq ?? "", r.shipTotal ?? "",
        landed.toFixed(2), r.leadDays ?? "", r.url ?? ""]
    })
    const csv = [head, ...body].map((line) =>
      line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url; a.download = "sourcing.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  if (rows === null) return <Loading />

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Sourcing</h2>
            <p className="text-xs text-muted-foreground">
              Where each product comes from and what it lands at, once freight is spread over the MOQ.
            </p>
          </div>
          {rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <DownloadSimple size={14} weight="bold" /> Export
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={openPicker} disabled={!!draft}>
            <Binoculars size={14} weight="bold" /> From SpyDeck
          </Button>
          <Button size="sm" onClick={() => setDraft({ ...EMPTY })} disabled={!!draft}>
            <Plus size={14} weight="bold" /> Add source
          </Button>
        </div>

        {msg && <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs">{msg}</div>}

        {pickerOpen && (
          <div className="border-b border-border p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold">Your SpyDeck saves</span>
              <button onClick={() => setPickerOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X size={14} /></button>
            </div>
            {picker === null ? <Loading />
              : picker.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing saved yet. Heart a listing in SpyDeck and it will show up here.
                </p>
              ) : (
                <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                  {picker.map((l) => (
                    <button key={l.listing_id} onClick={() => fromListing(l)}
                            className="flex items-center gap-2 rounded-lg border border-border p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent">
                      {(l.thumb || l.image)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={l.thumb || l.image || ""} alt="" className="size-10 shrink-0 rounded object-cover" />
                        : <span className="size-10 shrink-0 rounded bg-muted" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{l.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {l.price_usd != null ? money(l.price_usd) : l.price != null ? money(l.price) : "no price"}
                          {l.shop_name ? ` · ${l.shop_name}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
          </div>
        )}

        {draft && (
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs sm:col-span-2">
              <span className="text-muted-foreground">What it is</span>
              <Input className="mt-1 h-9" value={draft.title} placeholder="Cat mom hoodie — blank"
                     onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="text-muted-foreground">Link (optional)</span>
              <div className="mt-1 flex gap-2">
                <Input className="h-9" value={draft.url ?? ""} placeholder="https://…"
                       onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
                <Button size="sm" variant="outline" onClick={tryFetch} disabled={!draft.url || fetching}>
                  {fetching && <CircleNotch size={14} className="animate-spin" />} Read listing
                </Button>
              </div>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Unit price</span>
              <Input className="mt-1 h-9" inputMode="decimal" value={draft.cost ?? ""}
                     onChange={(e) => setDraft({ ...draft, cost: numOrNull(e.target.value) })} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">MOQ</span>
              <Input className="mt-1 h-9" inputMode="numeric" value={draft.moq ?? ""}
                     onChange={(e) => setDraft({ ...draft, moq: numOrNull(e.target.value) })} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Freight (whole order)</span>
              <Input className="mt-1 h-9" inputMode="decimal" value={draft.shipTotal ?? ""}
                     onChange={(e) => setDraft({ ...draft, shipTotal: numOrNull(e.target.value) })} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Lead time (days)</span>
              <Input className="mt-1 h-9" inputMode="numeric" value={draft.leadDays ?? ""}
                     onChange={(e) => setDraft({ ...draft, leadDays: numOrNull(e.target.value) })} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Decoration / unit</span>
              <Input className="mt-1 h-9" inputMode="decimal" value={draft.decorationCost ?? ""}
                     onChange={(e) => setDraft({ ...draft, decorationCost: numOrNull(e.target.value) })} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Your sell price</span>
              <Input className="mt-1 h-9" inputMode="decimal" value={draft.sellPrice ?? ""}
                     onChange={(e) => setDraft({ ...draft, sellPrice: numOrNull(e.target.value) })} />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="text-muted-foreground">Image URL</span>
              <div className="mt-1 flex items-center gap-2">
                <Input className="h-9" value={draft.image ?? ""} placeholder="filled in by 'Read listing', or paste one"
                       onChange={(e) => setDraft({ ...draft, image: e.target.value || null })} />
                {draft.image && /^https?:\/\//i.test(draft.image) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.image} alt="" className="size-9 shrink-0 rounded border border-border object-cover" />
                )}
              </div>
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="text-muted-foreground">Note</span>
              <Input className="mt-1 h-9" value={draft.note ?? ""} placeholder="contact, sample sent, quality…"
                     onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
            <div className="flex items-end gap-2 lg:col-span-4">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <CircleNotch size={14} className="animate-spin" />} Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setMsg(null) }}>Cancel</Button>
            </div>
          </div>
        )}

        {rows.length === 0 && !draft ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No sources saved yet. Add one to compare what a product lands at across suppliers.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="w-12 px-4 py-2" />
                  <th className="px-4 py-2 text-left font-medium">Product</th>
                  <th className="px-4 py-2 text-left font-medium">Supplier</th>
                  <th className="px-4 py-2 text-right font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">MOQ</th>
                  <th className="px-4 py-2 text-right font-medium">Freight/unit</th>
                  <th className="px-4 py-2 text-right font-medium">Landed</th>
                  <th className="px-4 py-2 text-right font-medium">Lead</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const moq = Math.max(1, r.moq ?? 1)
                  const freightUnit = (r.shipTotal ?? 0) / moq
                  const landed = (r.cost ?? 0) + (r.decorationCost ?? 0) + freightUnit
                  const isSel = r.id === selected
                  return (
                    <tr key={r.id}
                        onClick={() => setSelected(isSel ? null : r.id)}
                        className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/50 ${isSel ? "bg-accent" : ""}`}>
                      <td className="py-2 pl-4 pr-0">
                        {r.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={r.image} alt="" className="size-9 rounded border border-border object-cover" />
                          : <span className="flex size-9 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2 font-medium">{r.title}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.supplierRef ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{r.supplierRef}</span> : (r.shop || "—")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(r.cost)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{moq.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{freightUnit ? money(freightUnit) : "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(landed)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.leadDays != null ? `${r.leadDays}d` : "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer"
                               onClick={(e) => e.stopPropagation()}
                               className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent" title="Open listing">
                              <ArrowSquareOut size={14} />
                            </a>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); remove(r) }}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                                  title="Archive">
                            <Trash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {active && result && (
        <SectionCard>
          {/* The supplier belongs in this heading, not just the product name. The core use of
              this page is the SAME product from two sources — without it, two rows called
              "Cat mom hoodie" produce two different answers and nothing says which is which. */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <Calculator size={16} weight="bold" className="text-primary" />
            <h2 className="text-sm font-semibold">{active.title}</h2>
            <span className="text-sm text-muted-foreground">from</span>
            {active.supplierRef
              ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{active.supplierRef}</span>
              : <span className="text-sm font-medium">{active.shop || "an unnamed supplier"}</span>}
            {rival && (
              <span className="ml-auto text-xs text-muted-foreground">
                vs {rival.supplierRef || rival.shop}: landed{" "}
                <strong className="text-foreground">{money(rivalLanded)}</strong>
                {rivalLanded > 0 && (
                  <> · {rivalLanded < activeLanded
                    ? <span className="text-destructive">{money(activeLanded - rivalLanded)} cheaper there</span>
                    : <span>{money(rivalLanded - activeLanded)} dearer there</span>}</>
                )}
              </span>
            )}
          </div>

          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs">
              <span className="text-muted-foreground">Sell price</span>
              <Input className="mt-1 h-9" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Shipping charged</span>
              <Input className="mt-1 h-9" inputMode="decimal" value={shipCharged} placeholder="0.00" onChange={(e) => setShipCharged(e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Your outbound shipping</span>
              <Input className="mt-1 h-9" inputMode="decimal" value={outbound} onChange={(e) => setOutbound(e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Channel</span>
              <select value={feeId} onChange={(e) => setFeeId(e.target.value)}
                      className="eg-select mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm">
                {FEE_MODELS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
          </div>

          {missing.length > 0 && (
            // Honesty rule: an empty state must not look like a working feature. Without a
            // unit price the "profit" is just fees on nothing, so say what's missing rather
            // than render a confident number.
            <div className="border-b border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
              Add {missing.join(" and ")} to see profit. Everything below is incomplete until then.
            </div>
          )}

          <div className={`grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4 ${missing.length ? "opacity-40" : ""}`}>
            <Stat label="Landed cost / unit" value={missing.includes("a unit price") ? "—" : money(result.landedUnitCost)}
                  sub={result.freightPerUnit ? `incl. ${money(result.freightPerUnit)} freight` : "no freight"} />
            <Stat label="Fees" value={money(result.fees)} sub={`${fee.label} ${fee.pct}% + card ${PAYMENT_DEFAULT.pct}%`} />
            <Stat label="Profit / unit" value={missing.length ? "—" : money(result.profit)}
                  sub={missing.length ? "not enough entered" : pct(result.marginPct) + " margin"}
                  tone={missing.length ? undefined : result.profit >= 0 ? "good" : "bad"} />
            <Stat label={`Profit at MOQ ${(active.moq ?? 1).toLocaleString()}`}
                  value={missing.length ? "—" : money(result.profitAtMoq)}
                  sub={active.leadDays != null ? `${active.leadDays} day lead time` : undefined}
                  tone={missing.length ? undefined : result.profitAtMoq >= 0 ? "good" : "bad"} />
          </div>

          <div className={`p-4 text-xs text-muted-foreground ${missing.includes("a unit price") ? "hidden" : ""}`}>
            Break-even sell price is <strong className="text-foreground">{money(result.breakEvenPrice)}</strong>
            {result.unitsToCoverFreight != null && <> · {result.unitsToCoverFreight} units cover the freight</>}
            {(active.moq ?? 1) > 1 && (
              <> · you commit <strong className="text-foreground">
                {money((active.cost ?? 0) * (active.moq ?? 1) + (active.shipTotal ?? 0))}
              </strong> up front</>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-foreground" : ""}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
