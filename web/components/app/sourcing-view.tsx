"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Trash, ArrowSquareOut, CircleNotch, Calculator, DownloadSimple, Binoculars, X, Package, CaretRight } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Loading } from "@/components/app/loading"
import { AlibabaStatus } from "@/components/app/alibaba-status"
import { AlibabaBrowse } from "@/components/app/alibaba-browse"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSourcing, saveSourcing, deleteSourcing, fetchSourcingPrice, getSpydeckSaves,
         SOURCING_STAGES, type SourcingRow, type SourcingStage, type SavedListing } from "@/lib/api"
import { computeProfit, money, pct, FEE_MODELS, PAYMENT_DEFAULT } from "@/lib/profit"
import { useConfirm } from "@/components/app/confirm-dialog"
import { SampleOrderDialog, SampleOrdersPanel } from "@/components/app/sample-orders"
import { SupplierTerms } from "@/components/app/supplier-terms"

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

/**
 * Alibaba's CDN bakes the size into the filename ("…U.png_220x220.png"), so a row saved
 * before the search started asking for full resolution still holds a 220px thumbnail —
 * blurry in anything bigger than a stamp. Stripping the suffix returns the stored original
 * (522x522 on the sample measured) at the same request count, and upgrades rows we already
 * have rather than only new ones. A url without a suffix is returned untouched.
 */
const fullImg = (u?: string | null): string =>
  typeof u === "string" ? u.replace(/_\d+x\d+\.(?:png|jpe?g|webp)$/i, "") : ""

/**
 * The stage, and WHY it says that.
 *
 * Derived server-side from sample orders, so it can't be argued with — which is exactly why
 * it has to explain itself. "Approved" with no reason given is as opaque as the dropdown
 * that never moved; "a sample was received" is a fact someone can go and check.
 *
 * Colours stay off the reserved factory-status set (emerald shipped, amber hold, red alert):
 * these are sourcing states, and they must not read as floor states on a glance.
 */
const STAGE_PILL: Record<string, string> = {
  prospect: "bg-muted text-muted-foreground",
  talking:  "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  sampling: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  rotation: "bg-primary/10 text-primary",
  archived: "bg-muted text-muted-foreground",
}
const STAGE_WHY: Record<string, string> = {
  prospect: "Saved to compare. Nothing has happened against this supplier yet — no exchange recorded, no sample placed.",
  talking:  "An exchange with this supplier has been recorded, and no sample placed yet.",
  sampling: "A sample order is on this supplier and has not been received yet.",
  rotation: "A sample from this supplier was received — that is what approved it.",
  archived: "Archived.",
}

export function SourcingView() {
  const confirm = useConfirm()
  // Which view is showing, and whether the second one exists at all.
  const [tab, setTab] = useState<"prospects" | "find">("prospects")
  const [canBrowse, setCanBrowse] = useState(false)
  // A keyword handed over from SpyDeck's Find-suppliers dialog. Read once, deferred —
  // window doesn't exist during the prerender.
  const [incoming, setIncoming] = useState<string | undefined>(undefined)
  useEffect(() => {
    const t = setTimeout(() => {
      const kw = new URLSearchParams(window.location.search).get("q")
      if (kw) { setIncoming(kw); setTab("find") }
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const [rows, setRows] = useState<SourcingRow[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<SourcingStage | "">("")

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

  // Counts drive the stage chips; several rows for the same product can sit at Saved at
  // once, which is the point — you shortlist a few and one graduates.
  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows ?? []) c[r.stage || "prospect"] = (c[r.stage || "prospect"] ?? 0) + 1
    return c
  }, [rows])
  const shown = useMemo(
    () => (rows ?? []).filter((r) => !stageFilter || (r.stage || "prospect") === stageFilter),
    [rows, stageFilter])

  // Which prospect the sample dialog is for, and a counter that re-reads the panel after
  // one is placed or resolved.
  const [sampleFor, setSampleFor] = useState<SourcingRow | null>(null)
  const [samplesKey, setSamplesKey] = useState(0)

  // setStage is gone with the dropdown. The stage is derived server-side from sample
  // orders now, so there is nothing here to set — writing one back would let a picker
  // overwrite a fact.

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
      {/* TWO VIEWS, ONE AT A TIME — not stacked. Stacking pushed the prospect table below a
          grid of 24 cards, so the list you came to read was off-screen. They answer different
          questions ("what could we buy" vs "what are we already talking to"), and only one is
          ever the current one.
          The toggle only appears when there is a second view to reach: without Alibaba
          connected, or for a non-admin, this is just the prospect table as it always was. */}
      {canBrowse && (
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {([["prospects", "Suppliers"], ["find", "Search"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={"rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors " + (tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
              {id === "prospects" && rows.length > 0 && (
                <span className={"ml-1.5 tabular-nums " + (tab === id ? "text-primary-foreground/70" : "text-muted-foreground/70")}>{rows.length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* MOUNTED ALWAYS, hidden when it isn't the current view — not conditionally rendered.
          It is what reports whether Alibaba is connected (onConnectedChange), and the toggle
          that reaches it only appears once that has been reported. Mounting it only for
          tab === "find" made those two depend on each other: the component never ran, so
          canBrowse stayed false, so the toggle never appeared, so nothing could ever set tab
          to "find". The search was still there and simply could not be reached. */}
      <div className={tab === "find" ? undefined : "hidden"}>
        <AlibabaBrowse onConnectedChange={setCanBrowse} initialQuery={incoming} onSaved={load} />
      </div>

      <div className={canBrowse && tab === "find" ? "hidden" : undefined}>
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Sourcing</h2>
            <p className="text-xs text-muted-foreground">
              Where each product comes from and what it lands at, once freight is spread over the MOQ.
            </p>
          </div>
          {/* ONE LINE, not a panel. Whether Alibaba is connected is a fact about this page,
              and the only action it ever needs is Connect — which is nobody's job but an
              admin's, and only once. A card for it would out-weigh the search it enables. */}
          <AlibabaStatus />
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

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
            <button onClick={() => setStageFilter("")}
                    className={"rounded-full px-2.5 py-1 text-xs font-medium transition-colors " + (stageFilter === "" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
              All {rows.length}
            </button>
            {SOURCING_STAGES.map((st) => (
              <button key={st.id} onClick={() => setStageFilter(stageFilter === st.id ? "" : st.id)} title={st.hint}
                      className={"rounded-full px-2.5 py-1 text-xs font-medium transition-colors " + (stageFilter === st.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
                {st.label} {stageCounts[st.id] ?? 0}
              </button>
            ))}
          </div>
        )}

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
                        ? <img src={fullImg(l.thumb || l.image)} alt="" className="size-10 shrink-0 rounded object-cover" />
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
                  <img src={fullImg(draft.image)} alt="" className="size-9 shrink-0 rounded border border-border object-cover" />
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
                  <th className="px-4 py-2 text-left font-medium">Source</th>
                  <th className="px-4 py-2 text-right font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">MOQ</th>
                  <th className="px-4 py-2 text-right font-medium">Freight/unit</th>
                  <th className="px-4 py-2 text-right font-medium">Landed</th>
                  <th className="px-4 py-2 text-right font-medium">Lead</th>
                  <th className="px-4 py-2 text-left font-medium">Stage</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const moq = Math.max(1, r.moq ?? 1)
                  const freightUnit = (r.shipTotal ?? 0) / moq
                  const landed = (r.cost ?? 0) + (r.decorationCost ?? 0) + freightUnit
                  const isSel = r.id === selected
                  return (
                    <Fragment key={r.id}>
                    <tr onClick={() => setSelected(isSel ? null : r.id)}
                        className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/50 ${isSel ? "bg-accent" : ""}`}>
                      <td className="py-2 pl-4 pr-0">
                        {r.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={fullImg(r.image)} alt="" className="size-9 rounded border border-border object-cover" />
                          : <span className="flex size-9 items-center justify-center rounded border border-dashed border-border text-3xs text-muted-foreground">—</span>}
                      </td>
                      {/* A CARET, because the row expanding was the page's best feature and
                          nothing said so. The profit calculator, the rival comparison and
                          the agreed terms all live in that panel, and the only way to find
                          out was to click a row that gave no sign it would do anything. */}
                      <td className="px-4 py-2 font-medium">
                        <span className="flex items-center gap-1.5">
                          <CaretRight size={12} weight="bold"
                                      className={"shrink-0 text-muted-foreground transition-transform " + (isSel ? "rotate-90" : "")} />
                          {r.title}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.supplierRef ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{r.supplierRef}</span> : (r.shop || "—")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(r.cost)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{moq.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{freightUnit ? money(freightUnit) : "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(landed)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.leadDays != null ? `${r.leadDays}d` : "—"}</td>
                      {/* DERIVED, so it is read. It was a dropdown, and every row sat at the
                          first stage — because changing it changed nothing, and a label with
                          no consequence is one nobody maintains. It now comes from what
                          actually happened: a sample placed reads Sampling, a sample
                          received reads Approved. The title says which fact put it here,
                          because a stage you cannot argue with should still explain itself. */}
                      <td className="px-4 py-2">
                        <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + STAGE_PILL[r.stage || "prospect"]}
                              title={STAGE_WHY[r.stage || "prospect"]}>
                          {SOURCING_STAGES.find((s) => s.id === (r.stage || "prospect"))?.label ?? "Saved"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer"
                               onClick={(e) => e.stopPropagation()}
                               className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent" /* "Open listing", not a chat. Confirmed from a live response rather than the
                                 docs: an Alibaba product carries exactly five fields — image, price,
                                 product_id, permalink, title. There is no company id or company name,
                                 so no supplier chat or store link can be constructed, and we genuinely
                                 cannot say which seller it is. Their "Contact Supplier" lives on the
                                 product page, which is where this goes. */
                              title="Open the listing on Alibaba — their Contact Supplier is there. The search API returns no seller name.">
                              <ArrowSquareOut size={14} />
                            </a>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setSampleFor(r) }}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                  title="Record a sample order — books its cost to the factory wallet">
                            <Package size={14} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); remove(r) }}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                                  title="Archive">
                            <Trash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* THE DETAIL SITS UNDER ITS OWN ROW. It used to render after the whole
                        table, so opening the first of three prospects put its panel below
                        the third — the reader had to work out which row it belonged to. A
                        second <tr> spanning every column keeps it adjacent to the thing it
                        describes.
                        Rendered inside the map rather than lifted into its own component:
                        it reads a dozen pieces of this component's state (sell price, ship
                        charged, outbound, fee, and the derived result), and threading all of
                        that through props would be a far larger change than moving it. It
                        only ever renders for the selected row, so nothing is duplicated. */}
                    {isSel && active && result && (
                      <tr className="border-b border-border/60">
                        <td colSpan={10} className="bg-accent/30 p-3">
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

                {/* Terms and the conversation sit UNDER the maths, in the same panel. The
                    numbers above are what the deal earns; these are what the deal actually
                    is, and someone deciding between two suppliers needs both in one place.
                    Remounted per row so a half-typed note can't follow you to another
                    supplier. */}
                <SupplierTerms key={active.id} row={active} onSaved={load} />
              </SectionCard>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Samples sit UNDER the prospects, not on their own page: a sample only exists
          because of a row above it, and the money it cost is the reason a prospect
          graduates or doesn't. */}
      <SampleOrdersPanel reloadKey={samplesKey} />
      </div>

      <SampleOrderDialog
        open={!!sampleFor}
        onOpenChange={(v) => { if (!v) setSampleFor(null) }}
        supplierId={sampleFor?.id}
        supplierTitle={sampleFor?.title}
        onPlaced={() => { setSamplesKey((n) => n + 1); load() }}
      />
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
