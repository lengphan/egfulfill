"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, Warning, DownloadSimple, MagnifyingGlass, Percent } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/app/section-card"
import {
  getCatalogProducts, setCatalogSelection, setCatalogPrice, applyCatalogMarkup,
  catalogExportUrl, type CatalogProduct,
} from "@/lib/api"
import { CatalogPrint } from "@/components/app/catalog-print"
import { ProductThumb } from "@/components/app/product-thumb"
import { SupplierStylesPicker } from "@/components/app/supplier-styles-picker"
import { CatalogExportHistory } from "@/components/app/catalog-export-history"
import { PartnerSheets } from "@/components/app/partner-sheets"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { colorsOf } from "@/components/app/products-catalog"
import { sizesOf } from "@/lib/variant-resolve"

const money = (n: number | string | null | undefined) =>
  n == null || n === "" ? "—" : `$${(Number(n) || 0).toFixed(2)}`

/**
 * Curate the published catalogue: what appears, what it costs, and the download.
 *
 * TWO PRICES, KEPT APART ON SCREEN because they are kept apart in the database. The
 * catalogue price is what a buyer is shown; the seller price is what an order charges.
 * They are shown side by side and labelled, because the whole risk in this feature is
 * someone editing one believing it is the other — this window is where that mistake would
 * be made, so it is the place to make it impossible.
 *
 * Nothing here can change what a seller is billed. The only writable field is the
 * catalogue price, and the markup writes to the same column.
 */
export function CatalogView() {
  const [rows, setRows] = useState<CatalogProduct[] | null>(null)
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  /** Rows with a publish/unpublish in flight. Per row on purpose — a page-wide flag makes
   *  one tick disable every other one. */
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pct, setPct] = useState("60")
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [printOpen, setPrintOpen] = useState(false)
  // Which saved catalogue to reopen. Separate from printOpen because the two show
  // different documents — one live, one as it was sent.
  const [reopenId, setReopenId] = useState<string | null>(null)
  // Controlled, because the search box now sits on the tab bar and must only appear for
  // the tab it filters.
  const [tab, setTab] = useState("mine")

  const load = useCallback(() => {
    getCatalogProducts()
      .then((r) => setRows(r ?? []))
      .catch((e: Error) => { setErr(e.message); setRows([]) })
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const idOf = (p: CatalogProduct) => String(p.id ?? "")
  const imageOf = (p: CatalogProduct) =>
    (p as unknown as { image?: string; img?: string }).image ?? (p as unknown as { img?: string }).img ?? ""
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = rows ?? []
    if (!term) return list
    return list.filter((p) => [p.name, p.sku, p.id].some((f) => String(f ?? "").toLowerCase().includes(term)))
  }, [rows, q])

  const published = (rows ?? []).filter((p) => p.inCatalog).length

  /**
   * Publish or unpublish ONE product, immediately — the tick is the decision.
   *
   * OPTIMISTIC, AND LOCAL TO ONE ROW. This used to set the page-wide `busy` flag and then
   * re-read the whole catalogue: every checkbox on screen went disabled for the round trip
   * and the entire table re-rendered from a fresh array when it came back, which is the
   * flash — one tick greying out and repainting forty rows that did not change.
   *
   * The tick moves at once because the answer is already known; only the row being toggled
   * waits, and it waits without going grey. A failure puts the box back and says so, which
   * is the one case where the screen must not keep a state the server refused.
   */
  const toggleOne = async (id: string, include: boolean) => {
    setErr(null); setNote(null)
    setRows((prev) => (prev ?? []).map((p) => (idOf(p) === id ? { ...p, inCatalog: include } : p)))
    setPending((prev) => new Set(prev).add(id))
    try {
      const r = await setCatalogSelection([id], include)
      if (r.error) throw new Error(r.error)
      // updated:0 is a SUCCESSFUL response that changed nothing — an id no row matched. The
      // tick has to go back, or the screen keeps a decision the catalogue never recorded.
      if (r.updated === 0) throw new Error("That product is no longer in the catalogue list — reload and try again.")
    } catch (e) {
      setRows((prev) => (prev ?? []).map((p) => (idOf(p) === id ? { ...p, inCatalog: !include } : p)))
      setErr((e as Error).message)
    } finally {
      setPending((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }


  /** Publish or unpublish everything the current filter shows, in ONE call — the endpoint
   *  already takes a list, and forty round trips is forty chances to half-finish. */
  const shownIds = shown.map(idOf).filter(Boolean)
  const allShown = shownIds.length > 0 && shown.every((p) => p.inCatalog)
  const someShown = shown.some((p) => p.inCatalog)
  const toggleAllShown = async (include: boolean) => {
    if (!shownIds.length) return
    setErr(null); setNote(null); setBusy(true)
    const before = rows
    setRows((prev) => (prev ?? []).map((p) => (shownIds.includes(idOf(p)) ? { ...p, inCatalog: include } : p)))
    try {
      const r = await setCatalogSelection(shownIds, include)
      if (r.error) throw new Error(r.error)
    } catch (e) {
      // Put every row back: a half-applied bulk tick is worse than one that did not happen.
      setRows(before)
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  const markup = async () => {
    const inCat = (rows ?? []).filter((p) => p.inCatalog)
    if (!inCat.length) return
    const n = Number(pct)
    if (!isFinite(n) || n < 0) { setErr("Markup must be a number, and not negative."); return }
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await applyCatalogMarkup((rows ?? []).filter((p) => p.inCatalog).map(idOf), n)
      if (r.error) throw new Error(r.error)
      // Names the products it COULDN'T price. A silent partial run here means a buyer sees
      // a blank where a price should be, and nobody knows which ones until they look.
      const skipped = r.skippedNoCost?.length ?? 0
      setNote(skipped
        ? `Priced ${r.priced ?? 0}. ${skipped} skipped — no base cost on record, so there was nothing to mark up: ${r.skippedNoCost!.slice(0, 4).join(", ")}${skipped > 4 ? "…" : ""}`
        : `Priced ${r.priced ?? 0} at base + ${n}%.`)
      load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const savePrice = async (id: string) => {
    const raw = draft[id]
    if (raw === undefined) return
    const price = raw.trim() === "" ? null : Math.max(0, Number(raw))
    if (price !== null && !isFinite(price)) { setErr("That price isn't a number."); return }
    try {
      const r = await setCatalogPrice({ id, price })
      if (r.error) throw new Error(r.error)
      setDraft((d) => { const n = { ...d }; delete n[id]; return n })
      load()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <SectionCard
      title="Published catalogue"
      actions={
        <div className="flex items-center gap-2">
          {/* TWO FORMATS, because they are two jobs. The PDF is what you show a buyer —
              images, colours, sizes, price, laid out. The CSV is what someone imports into
              their own system. A spreadsheet of image URLs is not a catalogue, and a
              lookbook is not importable. */}
          <Button size="sm" onClick={() => setPrintOpen(true)}
            title="A printable catalogue with images — save it as PDF">
            Create lookbook
          </Button>
          <a href={catalogExportUrl()} download>
            <Button size="sm" variant="outline" disabled={!published}
              title={published ? "Spreadsheet — one row per variant, for importing" : "Publish something first — the file would be empty"}>
              <DownloadSimple size={14} weight="bold" /> CSV
            </Button>
          </a>
        </div>
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        {/* Search rides the tab bar rather than owning a row under it — it filters ONE
            tab's table, so it belongs beside the tab it acts on, and it's hidden on the
            other two where it would do nothing. */}
        <div className="mx-5 mt-4 flex flex-wrap items-center gap-2">
          <TabsList>
            {/* TWO SOURCES, ONE CATALOGUE. Products we built carry our own SKU and print
                method; supplier styles are published by reference and read live from the
                sync. Both land in the same PDF and the same CSV — the tabs are about where
                a thing comes FROM, not about two separate catalogues. */}
            <TabsTrigger value="mine">Our products</TabsTrigger>
            <TabsTrigger value="supplier">Supplier styles</TabsTrigger>
            {/* A partner's own workbook, filled from this same catalogue. It lives beside
                the lookbook and the CSV because they are three renderings of one picked
                set, not three features. */}
            <TabsTrigger value="partners">Partner sheets</TabsTrigger>
            <TabsTrigger value="history">Sent catalogues</TabsTrigger>
          </TabsList>
          {tab === "mine" && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{published} published</span>
              <div className="relative">
                <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU…" className="h-9 w-64 pl-8" />
              </div>
            </div>
          )}
        </div>
        <TabsContent value="supplier"><SupplierStylesPicker onChanged={load} /></TabsContent>
        <TabsContent value="partners"><PartnerSheets /></TabsContent>
        <TabsContent value="history"><CatalogExportHistory onOpen={setReopenId} /></TabsContent>
        <TabsContent value="mine">
      <div className="space-y-3 px-5 py-4">
        {(rows ?? []).some((p) => p.inCatalog) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            {/* No publish/remove buttons: the tick already is that decision, and two ways
                to express one thing is how they drifted apart. This bar only prices. */}
            <span className="text-xs text-muted-foreground">Base +</span>
            <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-8 w-16 text-center text-xs tabular-nums" inputMode="decimal" aria-label="Markup percent" />
            <Button size="sm" variant="outline" onClick={markup} disabled={busy}>
              {busy ? <CircleNotch size={14} className="animate-spin" /> : <><Percent size={14} weight="bold" /> Price these {(rows ?? []).filter((p) => p.inCatalog).length}</>}
            </Button>
          </div>
        )}

        {note && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{note}</div>}
        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        {rows === null ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" /> Loading products…
          </div>
        ) : shown.length === 0 ? (
          // THREE different nothings, and they must not read alike: the read failed, the
          // search matched nothing, or there genuinely are no products. This was printing
          // "No products in the catalogue yet" directly under its own "Not signed in"
          // banner — asserting a fact about data it had just said it couldn't read. Same
          // mistake the shipments list made; worth not making twice.
          <p className="py-12 text-center text-sm text-muted-foreground">
            {err
              ? "Couldn't load products, so this isn't empty — it's unknown."
              : q ? `Nothing matches “${q}”.`
                : "No products in the catalogue yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left eg-label text-muted-foreground">
                  {/* SELECT ALL — every row the current search shows, not every row in the
                      catalogue, because the visible set is the one somebody just narrowed to
                      and a tick that reaches past it is a bulk action nobody aimed.
                      Indeterminate while some are in: a box that reads "off" over a mixed
                      column is the only state that would lie about what one click does. */}
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      ref={(el) => { if (el) el.indeterminate = someShown && !allShown }}
                      checked={allShown}
                      disabled={busy || shown.length === 0}
                      aria-label={allShown ? "Remove all shown products from the catalogue" : "Add all shown products to the catalogue"}
                      title={allShown ? "Remove all shown from the catalogue" : "Add all shown to the catalogue"}
                      onChange={(e) => void toggleAllShown(e.target.checked)}
                    />
                  </th>
                  <th className="px-2 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium">Catalogue price</th>
                  {/* Labelled as what it is, and not editable here. The two prices sitting
                      side by side is the point — it's how someone sees they are different
                      things rather than discovering it later. */}
                  <th className="px-2 py-2 font-medium">Seller pays</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const id = idOf(p)
                  return (
                    // NOT dimmed when unpublished. Fading a row is the language of
                    // "unavailable", and these are the rows you are here to pick — it read
                    // as two of three products being disabled. Published is stated by the
                    // chip instead, which says the thing rather than implying it.
                    <tr key={id} className="border-b border-border/60 last:border-0">
                      <td className="px-2 py-2">
                        {/* THE TICK IS THE STATE. It reflected a local selection, so a
                            product already in the catalogue came back unticked — you had to
                            tick it (which changed nothing) and press Remove to get it out.
                            The box was describing what you had clicked this session rather
                            than what is true, which is the same fault the supplier tab had.
                            Now: ticked means in the catalogue, unticking removes it. */}
                        <input
                          type="checkbox"
                          checked={!!p.inCatalog}
                          disabled={busy || pending.has(id)}
                          aria-label={`${p.inCatalog ? "Remove" : "Add"} ${p.name || id} ${p.inCatalog ? "from" : "to"} the catalogue`}
                          onChange={(e) => void toggleOne(id, e.target.checked)}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {/* The picture, the colourways and the sizes — the things you are
                            actually choosing between. A name and a SKU is a spreadsheet;
                            a catalogue is chosen by eye. */}
                        <div className="flex items-start gap-3">
                          {/* 56px was smaller than the row of colour chips beside it, on the
                              screen where you decide which products go in a printed catalogue
                              — a choice made by eye, from a thumbnail too small to see the
                              garment in. 96px now.
                              WHITE, not the lookbook's plate. These are cut-out-on-white
                              photos, so a white tile lets the garment sit on the card with no
                              visible box around it — and the edge this needs is already there
                              in the border. The printed lookbook keeps its grey precisely
                              because those wells have no border, so white there would leave a
                              white shirt with nothing to define it. Same photographs, two
                              surfaces, and the plate is only load-bearing on one. */}
                          <ProductThumb src={imageOf(p)} alt={p.name || id} />
                          <div className="min-w-0">
                            <div className="max-w-[20rem] truncate font-medium">{p.name || id}</div>
                            {/* Just the sku. The "published" pill repeated the tick in this
                                row's own first column, and the price warning repeated the
                                price cell beside it — three readings of two facts, on the
                                screen where the facts are already the columns. */}
                            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                              <span className="font-mono">{p.sku || id}</span>
                            </div>
                            {/* Colourways as their own supplier photos where we have them.
                                Capped at eight with a count — a 40-colour style would
                                otherwise make one row taller than the rest of the table. */}
                            {/* COUNTS, NOT CHIPS — the same line the supplier styles tab
                                uses, and for the same reason: a 40-colour style owned the
                                row with a wall of dots that answered nothing you ask on this
                                screen, which is what to publish and what to charge. The
                                colours themselves are on the product page and in the printed
                                catalogue, where they are the point. */}
                            {(colorsOf(p).length > 0 || sizesOf(p).length > 0) && (
                              <div className="mt-1 truncate text-2xs text-muted-foreground">
                                {colorsOf(p).length} colour{colorsOf(p).length === 1 ? "" : "s"} · {sizesOf(p).length} size{sizesOf(p).length === 1 ? "" : "s"}
                                {sizesOf(p).length > 0 && <> · {sizesOf(p).slice(0, 8).join(" ")}{sizesOf(p).length > 8 ? "…" : ""}</>}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          value={draft[id] ?? (p.catalogPrice == null ? "" : String(p.catalogPrice))}
                          onChange={(e) => setDraft((d) => ({ ...d, [id]: e.target.value.replace(/[^\d.]/g, "") }))}
                          onBlur={() => savePrice(id)}
                          onKeyDown={(e) => { if (e.key === "Enter") savePrice(id) }}
                          /* "0.00", not "not set". It is a PRICE field, and the shape of a
                             price is what tells you what to type in it — the words were
                             wider than the column and read as a status rather than a hint.
                             Still a placeholder, so an unpriced row stays genuinely empty
                             and cannot be mistaken for one priced at zero: the "needs a
                             price to show publicly" badge on the row is what says it. */
                          placeholder="0.00"
                          inputMode="decimal"
                          aria-label={`Catalogue price for ${p.name || id}`}
                          className="h-8 w-24 text-right text-xs tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">
                        {money(p.base_price ?? p.basePrice ?? p.price)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </TabsContent>
      </Tabs>
      {printOpen && <CatalogPrint onClose={() => setPrintOpen(false)} />}
      {reopenId && <CatalogPrint exportId={reopenId} onClose={() => setReopenId(null)} />}
    </SectionCard>
  )
}
