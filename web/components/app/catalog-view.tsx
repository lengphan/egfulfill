"use client"

import Link from "next/link"
import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, Warning, DownloadSimple, Percent, Tag } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/app/section-card"
import { SearchField } from "@/components/app/search-field"
import {
 getCatalogProducts, setCatalogSelection, setCatalogPrice, applyCatalogMarkup,
 catalogExportUrl, type CatalogProduct,
} from "@/lib/api"
import { CatalogPrint } from "@/components/app/catalog-print"
import { ProductThumb } from "@/components/app/product-thumb"
import { ImageLightbox } from "@/components/app/image-lightbox"
import { SupplierStylesPicker } from "@/components/app/supplier-styles-picker"
import { CatalogExportHistory } from "@/components/app/catalog-export-history"
import { PartnerSheets } from "@/components/app/partner-sheets"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { colorsOf } from "@/components/app/products-catalog"
import { sizesOf } from "@/lib/variant-resolve"
import { EmptyState } from "@/components/app/empty-state"

const money = (n: number | string | null | undefined) =>
 n == null || n === "" ? "—" : `$${(Number(n) || 0).toFixed(2)}`

/** The base cost, under the three spellings the row has carried. One reader, so a card and
 *  a margin cannot disagree about which field is the cost. */
const costOf = (p: CatalogProduct) =>
  Number((p as unknown as { base_price?: number; basePrice?: number; price?: number }).base_price
    ?? (p as unknown as { basePrice?: number }).basePrice
    ?? (p as unknown as { price?: number }).price)

/**
 * WHAT A CATALOGUE PRICE EARNS — computed off the DRAFT, never off what is saved.
 *
 * The price field saves on blur, so a margin read from `catalogPrice` lags one field behind
 * the number being typed: you would set a price, look for what it earns, and be shown the
 * answer for the previous one. Watching it move while you decide is the whole reason it is
 * on the card.
 *
 * `null` when there is nothing to say. An unpriced product is not one that earns nothing —
 * it is one nobody has decided about, and §4 forbids rendering those the same.
 */
function marginOf(raw: string, cost: number): { amount: number; pct: number } | null {
  const sell = Number(raw)
  if (!raw || !isFinite(sell) || sell <= 0 || !isFinite(cost) || cost <= 0) return null
  return { amount: sell - cost, pct: Math.round(((sell - cost) / sell) * 100) }
}

/**
 * ONE PRODUCT, AS SOMETHING YOU CHOOSE BY EYE.
 *
 * This was a table row, and the row was right about the DATA and wrong about the JOB: the
 * question on this screen is which garments go in a printed catalogue, and that is answered
 * from a photograph. A 96px thumbnail beside three number columns left most of the row empty
 * and the picture the smallest thing in it.
 *
 * The three money values stay, ruled apart and labelled, because keeping them apart is the
 * point — the risk this screen carries is someone editing the catalogue price believing it
 * is what a seller pays. Only one of the three is a field, and it is the only one that is.
 *
 * WHAT THE CARD COSTS, stated because it is real: margins no longer read down a single
 * column. On a table you can scan them in one pass; here you compare card to card. That is
 * the trade the grid makes, and it is why the table is still one press away under Sorted by
 * margin.
 *
 * Module scope, not defined in render: a component declared in a render body is a new type
 * every render, so React remounts every card on each keystroke in any price field — which is
 * exactly what `react-hooks/static-components` exists to catch.
 */
function CatalogCard({
  p, id, image, checked, disabled, draftValue, onDraft, onSave, onToggle, onZoom,
}: {
  p: CatalogProduct
  id: string
  image: string
  checked: boolean
  disabled: boolean
  draftValue: string
  onDraft: (v: string) => void
  onSave: () => void
  onToggle: (include: boolean) => void
  onZoom: () => void
}) {
  /**
   * THE HOOK, NOT A `label` PROP.
   *
   * This took its strings through a `label(s)` callback passed down from the parent, and the
   * result was that every one of them was INVISIBLE to tools/check-i18n.mjs — the gate scans
   * for the literal two-argument call, so ten strings reported as fully covered while none
   * of them had Vietnamese. A gate you have routed around is worse than no gate, because it
   * still says PASS. (It scans comments too, so this one deliberately does not spell the
   * call out — writing the example created a tenth phantom key.)
   */
  const tl = useLabelT()
  const cost = costOf(p)
  const m = marginOf(draftValue, cost)
  const colours = colorsOf(p).length
  const sizes = sizesOf(p)

  return (
    <div
      className={
        "flex flex-col overflow-hidden rounded-xl border bg-card transition-colors " +
        (checked ? "border-foreground ring-1 ring-foreground" : "border-border")
      }
    >
      <div className="relative">
        {/* WHITE, not the lookbook's plate. These are cut-out-on-white photos, so a white
            tile lets the garment sit with no visible box around it — the edge is already the
            card's border. The printed sheet keeps its grey precisely because those wells
            have none. Same photographs, two surfaces, and the plate is load-bearing on one. */}
        {/**
          * THE PICTURE ZOOMS; IT DOES NOT NAVIGATE (owner's call).
          *
          * It was a link to the product page, which is the wrong answer to the only question
          * anyone asks it here: "which garment is that". Leaving the catalogue to find out
          * loses the whole set you were choosing between, and coming back is a fresh load
          * and a lost scroll position — for a look at a photograph.
          *
          * So it opens the SHARED lightbox. Not a new one: image-lightbox.tsx exists because
          * six surfaces had each grown their own and no two agreed on whether Escape closed
          * them (§4 — a rule with nothing to import regresses at the speed new files are
          * created). The product page is still one click away on the name, where a link is
          * what a name is.
          */}
        <button
          type="button"
          onClick={() => onZoom()}
          aria-label={`${tl("catalog", "Enlarge the photo of")} ${p.name || id}`}
          className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          {/* ProductThumb hardcodes `size-24`, so `w-full` widened the tile and left it 96px
              TALL — a 270px card with a 96px band of photograph in it, which is why the
              garment read as small. The height override has to be important because both
              rules are the same Tailwind utility group and source order decides otherwise.

              4/5 was a garment ratio, and the grid is not all garments — a cap fills about
              half of it and the rest is the white the photo was shot on, so a row of caps
              read as mostly empty card. 8/9 keeps the portrait a tee needs and takes 10% of
              the dead air off every row. */}
          <ProductThumb src={image} alt={p.name || id} className="!h-auto !w-full aspect-[8/9] rounded-none border-0 p-3" />
        </button>
        {/* THE TICK IS THE STATE, and it sits on the picture because the picture is what you
            are deciding about. Not dimming an unticked card: fading is the language of
            "unavailable", and these are the ones you are here to pick. */}
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={`${checked ? tl("catalog", "Remove") : tl("catalog", "Add")} ${p.name || id} ${checked ? tl("catalog", "from the catalogue") : tl("catalog", "to the catalogue")}`}
          onChange={(e) => onToggle(e.target.checked)}
          className="absolute left-2.5 top-2.5 size-5 cursor-pointer accent-foreground"
        />
      </div>

      <div className="min-w-0 px-3 pt-2.5">
        <div className="truncate text-sm font-medium">
          <Link href={`/products/${encodeURIComponent(id)}`} className="hover:underline">{p.name || id}</Link>
        </div>
        <div className="mt-0.5 truncate text-2xs text-muted-foreground">
          <span className="tabular-nums">{p.sku || id}</span>
          {(colours > 0 || sizes.length > 0) && (
            <> · {colours} {colours === 1 ? tl("catalog", "colour") : tl("catalog", "colours")} · {sizes.length} {sizes.length === 1 ? tl("catalog", "size") : tl("catalog", "sizes")}</>
          )}
        </div>
      </div>

      {/**
        * THE THREE FIGURES — the price on its own line, the two it produces beneath it.
        *
        * They were three equal columns, which is what the mock-up showed and what the real
        * card could not hold: at four-up a cell is ~90px and "SELLER PAYS" is wider than
        * that, so the labels ran into each other and the input clipped its own digits.
        *
        * SHORTENING THE LABEL WAS NOT AVAILABLE. "Seller pays" cannot become "Cost" — this
        * figure is what a SELLER pays US, and our own cost is a different number that is
        * staff-only. A label that invites the second reading on the screen where catalogue
        * prices are set is the one mistake this layout exists to prevent (it is why the two
        * prices sit side by side and labelled in the first place).
        *
        * So the field takes a full row, and the two read-only figures split the one below.
        * Every label gets half a card instead of a third, the ruling that keeps them
        * distinct survives, and no word has to be shortened into something less true.
        *
        * mt-auto so every card in a row ends on the same line however long its name wrapped.
        */}
      <div className="mt-auto border-t border-border">
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">{tl("catalog", "Catalogue")}</span>
          <Input
            value={draftValue}
            onChange={(e) => onDraft(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={onSave}
            onKeyDown={(e) => { if (e.key === "Enter") onSave() }}
            /* "0.00", not "not set". It is a PRICE field and the shape of a price is what
               tells you what to type. Still a placeholder, so an unpriced card stays
               genuinely empty and cannot be read as one priced at zero. */
            placeholder="0.00"
            inputMode="decimal"
            aria-label={`${tl("catalog", "Catalogue price for")} ${p.name || id}`}
            className="ml-auto h-7 w-20 px-2 text-right text-sm tabular-nums"
          />
        </div>
        <div className="flex items-stretch border-t border-border">
          <div className="min-w-0 flex-1 border-r border-border px-2.5 py-1.5">
            {/* Labelled as what it is, and not editable here. The two prices side by side is
                the point — it is how someone sees they are different things rather than
                finding out later. */}
            <span className="block truncate text-2xs uppercase tracking-wide text-muted-foreground">{tl("catalog", "Seller pays")}</span>
            <span className="block text-sm tabular-nums text-muted-foreground">{money(cost)}</span>
          </div>
          <div className="min-w-0 flex-1 px-2.5 py-1.5">
            <span className="block truncate text-2xs uppercase tracking-wide text-muted-foreground">{tl("catalog", "Margin")}</span>
            {/* NEGATIVE IS THE ONE THAT NEEDS A COLOUR. A catalogue price under what the
                seller pays us loses money on every sale, and it is entirely possible to
                type — the two figures are separate fields and nothing else compares them. */}
            <span className={"block truncate text-sm tabular-nums " + (m ? (m.amount < 0 ? "font-medium text-destructive" : "text-foreground") : "text-muted-foreground")}>
              {m ? <>{money(m.amount)} <span className="text-muted-foreground">· {m.pct}%</span></> : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * ONE SHEET OF THE LOOKBOOK, at the shape it really is.
 *
 * catalog-print.tsx is `@page { size: A4 landscape }` — 297×210mm, ONE STYLE PER PAGE, laid
 * out as a 92mm photo plate beside the copy. Those three facts are the whole thumbnail, and
 * they are the reason this strip runs along the BOTTOM rather than beside the picker: a
 * landscape page in a side rail gets ~400px and one sheet, where the full width takes five.
 *
 * A preview that invents a layout is worse than no preview — the first attempt drew a
 * two-up portrait grid, which is a page the lookbook has never printed. So the ratio and the
 * plate are measured off the sheet, not chosen.
 */
function LookbookSheet({
  image, name, price, n, coverImages,
}: {
  image: string
  name: string
  price: string
  n: number | "cover"
  /** Cover only: the products it leads with. */
  coverImages?: string[]
}) {
  const tl = useLabelT()
  const cover = n === "cover"
  return (
    <div className="w-[168px] shrink-0">
      <div className="aspect-[297/210] overflow-hidden rounded-md border border-border bg-white p-1.5">
        {cover ? (
          /* THE COVER IS A FOUR-UP, and drawing it as a product sheet was wrong — the
             thumbnail said "page 1" twice and only the caption disagreed. catalog-print.tsx
             lays the cover out as grid-cols-4 of the styles it leads with; four squares is
             what that is at this size. */
          <div className="flex size-full flex-col justify-center gap-1.5 px-1">
            <div className="h-2 w-2/5 rounded-sm bg-foreground/70" />
            <div className="h-1 w-3/5 rounded-sm bg-foreground/15" />
            <div className="mt-1 grid grid-cols-4 gap-1">
              {(coverImages ?? []).slice(0, 4).map((src, i) => (
                <div key={i} className="aspect-square overflow-hidden rounded-sm bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="size-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex size-full gap-1.5">
            <div className="grid w-[31%] shrink-0 place-items-center overflow-hidden rounded bg-muted">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="size-full object-contain p-0.5" />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
              <div className="h-1.5 w-3/4 rounded-sm bg-foreground/25" />
              <div className="h-0.5 w-full rounded-sm bg-foreground/10" />
              <div className="h-0.5 w-full rounded-sm bg-foreground/10" />
              <div className="h-0.5 w-1/2 rounded-sm bg-foreground/10" />
            </div>
          </div>
        )}
      </div>
      <div className="mt-1 truncate text-2xs text-muted-foreground">
        {cover ? tl("catalog", "Cover") : <><span className="tabular-nums">{n}</span> · {name} — <span className="tabular-nums">{price}</span></>}
      </div>
    </div>
  )
}


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
  const tl = useLabelT()
 const [rows, setRows] = useState<CatalogProduct[] | null>(null)
 const [q, setQ] = useState("")
 const [busy, setBusy] = useState(false)
  /** Rows with a publish/unpublish in flight. Per row on purpose — a page-wide flag makes
   * one tick disable every other one. */
 const [pending, setPending] = useState<Set<string>>(new Set())
 const [err, setErr] = useState<string | null>(null)
 const [note, setNote] = useState<string | null>(null)
 const [pct, setPct] = useState("60")
 const [draft, setDraft] = useState<Record<string, string>>({})
 const [printOpen, setPrintOpen] = useState(false)
  /** The photograph being looked at, if any. Carries the NAME too: a picture on its own,
   *  full screen, has nothing left on it saying which product it is. */
 const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null)
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

 /** The sheets, in the order the lookbook prints them. Named once so the strip and the
  *  count cannot disagree about what "published" means. */
 const publishedRows = (rows ?? []).filter((p) => p.inCatalog)
 const published = publishedRows.length
 /** What the cover leads with. catalog-print.tsx lays it out grid-cols-4, so four is not a
  *  choice made here — it is the page. */
 const coverImages = publishedRows.slice(0, 4).map(imageOf)

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
   * already takes a list, and forty round trips is forty chances to half-finish. */
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
 title={tl("catalog", "Published catalogue")}
 actions={
        <div className="flex items-center gap-2">
          {/* TWO FORMATS, because they are two jobs. The PDF is what you show a buyer —
 images, colours, sizes, price, laid out. The CSV is what someone imports into
 their own system. A spreadsheet of image URLs is not a catalogue, and a
 lookbook is not importable. */}
          <Button size="sm" onClick={() => setPrintOpen(true)}
 title={tl("catalog", "A printable catalogue with images — save it as PDF")}>
            {tl("catalog", "Create lookbook")}
          </Button>
          <a href={catalogExportUrl()} download>
            <Button size="sm" variant="outline" disabled={!published}
 title={published ? tl("catalog", "Spreadsheet — one row per variant, for importing") : tl("catalog", "Publish something first — the file would be empty")}>
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
            <TabsTrigger value="mine">{tl("catalog", "Our products")}</TabsTrigger>
            <TabsTrigger value="supplier">{tl("catalog", "Supplier styles")}</TabsTrigger>
            {/* A partner's own workbook, filled from this same catalogue. It lives beside
 the lookbook and the CSV because they are three renderings of one picked
 set, not three features. */}
            <TabsTrigger value="partners">{tl("catalog", "Partner sheets")}</TabsTrigger>
            <TabsTrigger value="history">{tl("catalog", "Sent catalogues")}</TabsTrigger>
          </TabsList>
          {tab === "mine" && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{published} published</span>
              <SearchField
                value={q}
                onChange={setQ}
                width="sm"
                placeholder={tl("catalog", "Search name or SKU…")}
              />
            </div>
          )}
        </div>
        <TabsContent value="supplier"><SupplierStylesPicker onChanged={load} /></TabsContent>
        <TabsContent value="partners"><PartnerSheets /></TabsContent>
        <TabsContent value="history"><CatalogExportHistory onOpen={setReopenId} /></TabsContent>
        <TabsContent value="mine">
      <div className="space-y-3 px-5 py-4">
        {/* ONE TOOLBAR, not two. Select-all was the table's first column header and has
            nowhere to live on a grid, so it joins the pricing controls — and both are things
            you do to "the products currently shown", which is what makes them one bar rather
            than two that happen to sit together. */}
        {shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {/* Every row the current SEARCH shows, not every row in the catalogue: the
                  visible set is the one somebody just narrowed to, and a tick that reaches
                  past it is a bulk action nobody aimed.
                  Indeterminate while some are in — a box reading "off" over a mixed set is
                  the only state that would lie about what one click does. */}
              <input
                type="checkbox"
                ref={(el) => { if (el) el.indeterminate = someShown && !allShown }}
                checked={allShown}
                disabled={busy || shown.length === 0}
                aria-label={allShown ? tl("catalog", "Remove all shown products from the catalogue") : tl("catalog", "Add all shown products to the catalogue")}
                title={allShown ? tl("catalog", "Remove all shown from the catalogue") : tl("catalog", "Add all shown to the catalogue")}
                onChange={(e) => void toggleAllShown(e.target.checked)}
                className="size-4 accent-foreground"
              />
              {tl("catalog", "Select all shown")}
              <span className="tabular-nums">({shown.length})</span>
            </label>

            {(rows ?? []).some((p) => p.inCatalog) && (
              <div className="ml-auto flex items-center gap-2">
                {/* No publish/remove buttons: the tick already is that decision, and two ways
                    to express one thing is how they drifted apart. This only prices. */}
                <span className="text-xs text-muted-foreground">{tl("catalog", "Base +")}</span>
                <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))}
                  className="h-8 w-16 text-center text-xs tabular-nums" inputMode="decimal" aria-label={tl("catalog", "Markup percent")} />
                <Button size="sm" variant="outline" onClick={markup} disabled={busy}>
                  {busy ? <CircleNotch size={14} className="animate-spin" /> : <><Percent size={14} weight="bold" /> {tl("catalog", "Price these")} {(rows ?? []).filter((p) => p.inCatalog).length}</>}
                </Button>
              </div>
            )}
          </div>
        )}

        {note && <div className="rounded-lg border border-shipped/30 bg-shipped/12 px-3 py-2 text-xs text-shipped">{note}</div>}
        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        {rows === null ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" /> {tl("catalog", "Loading products…")}
          </div>
        ) : shown.length === 0 ? (
          /* THREE OUTCOMES, NOT TWO. A failed load is not an empty catalogue, and the
             honesty rule turns on exactly this: if a thing cannot be READ versus does not
             EXIST, say which. The icon changes too — a warning, not a tag. */
          <EmptyState
            icon={err ? Warning : Tag}
            title={err ? tl("catalog", "Couldn't load the catalogue") : q ? tl("catalog", "Nothing matches that search") : tl("catalog", "No products yet")}
            note={err
              ? tl("catalog", "So this isn't empty — it's unknown. Try again in a moment.")
              : q ? `${tl("catalog", "Nothing in the catalogue matches")} \u201c${q}\u201d.`
              : tl("catalog", "Products you publish appear here.")}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => {
              const id = idOf(p)
              return (
                <CatalogCard
                  key={id}
                  p={p}
                  id={id}
                  image={imageOf(p)}
                  checked={!!p.inCatalog}
                  disabled={busy || pending.has(id)}
                  draftValue={draft[id] ?? (p.catalogPrice == null ? "" : String(p.catalogPrice))}
                  onDraft={(v) => setDraft((d) => ({ ...d, [id]: v }))}
                  onSave={() => void savePrice(id)}
                  onToggle={(include) => void toggleOne(id, include)}
                  onZoom={() => setZoom({ src: imageOf(p), name: p.name || id })}
                />
              )
            })}
          </div>
        )}
      </div>

      {/**
        * THE CATALOGUE YOU ARE BUILDING, along the bottom.
        *
        * "Create lookbook" opened the document on another surface, so the thing every tick on
        * this page is FOR was the one thing the page never showed. The sheets are here now,
        * in order, and a tick inserts one.
        *
        * ALONG THE BOTTOM because the sheet is LANDSCAPE. In a side rail it gets ~400px and
        * one page fits; across the full width, five do. The axis follows the document.
        *
        * Sticky, so it stays put while the grid scrolls past it — the running order is the
        * thing you are checking as you tick, and a preview you have to scroll to find is one
        * you stop looking at.
        */}
      {published > 0 && (
        <div className="sticky bottom-0 z-10 border-t border-border bg-card px-5 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium">{tl("catalog", "Lookbook")}</span>
            <span className="text-xs text-muted-foreground">
              {tl("catalog", "Cover")} + {published} {published === 1 ? tl("catalog", "sheet") : tl("catalog", "sheets")} · {tl("catalog", "A4 landscape")}
            </span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setPrintOpen(true)}>
              {tl("catalog", "Open")}
            </Button>
          </div>
          {/* eg-scroll-x: the strip scrolls, and it must never make the CARD scroll — a
              landscape row of 40 sheets is ~7,000px of max-content, and until something
              clips it the layout above sizes to it. */}
          <div className="flex gap-3 overflow-x-auto pb-1">
            <LookbookSheet image="" name="" price="" n="cover" coverImages={coverImages} />
            {publishedRows.map((p, i) => (
              <LookbookSheet
                key={idOf(p)}
                image={imageOf(p)}
                name={p.name || idOf(p)}
                price={money(p.catalogPrice)}
                n={i + 1}
              />
            ))}
          </div>
        </div>
      )}
        </TabsContent>
      </Tabs>
      <ImageLightbox src={zoom?.src ?? null} label={zoom?.name ?? null} onClose={() => setZoom(null)} />
      {printOpen && <CatalogPrint onClose={() => setPrintOpen(false)} />}
      {reopenId && <CatalogPrint exportId={reopenId} onClose={() => setReopenId(null)} />}
    </SectionCard>
  )
}
