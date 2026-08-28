"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { TShirt, MagnifyingGlass } from "@phosphor-icons/react"
import { ACCENT, ACCENT_INK, CARD, HEADING, INK, SURFACE, Pill, Rise } from "@/components/marketing/bold-kit"
import { PageBanner } from "@/components/marketing/page-banner"
import { ProductField } from "@/components/marketing/product-field"
import type { PageHead } from "@/lib/site-content"
import type { PublicProduct } from "@/lib/api"
import { framingStyle } from "@/lib/product-framing"
import { swatchBg, swatchChipStyle, NEUTRAL_CHIP, colorFamily, COLOR_FAMILIES } from "@/lib/color-swatch"
import { bySize, isOneSize, sizeRangeLabel } from "@/lib/size-order"

/**
 * Products, showing the REAL catalogue rather than a written-out list of categories.
 *
 * The old page listed four categories with hand-typed example prices, which drift the moment
 * anyone edits the catalogue — and quietly become wrong rather than visibly missing. These
 * cards come from the published products themselves, so the page is right by construction and
 * an admin publishing a product IS the act of putting it on the marketing site.
 *
 * When nothing is published the page says so plainly instead of rendering an empty grid that
 * looks like a broken query. That distinction is the house rule: a thing that can't be read
 * must not look like a thing that doesn't exist.
 */
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A colourway's chip. `swatchBg` is the canonical resolver — it already knows the supplier
 *  spellings ("Blk/Dk.Grn", "016 - White") and paints a two-tone name as a split, which the
 *  private eighteen-entry map that used to live here did not. A name it can't place falls
 *  back to a CLOSE CROP of that colourway's photo: bg-cover scaled a whole garment-on-white
 *  shot into a 16px circle, so the chip showed a tiny shirt silhouette — mostly background —
 *  instead of the colour it exists to communicate. 340% centred lands inside the body of the
 *  garment, which is fabric on every product shot we hold. A neutral is the last resort: a
 *  wrong colour chip is worse than a plain one. */
const chipStyle = (c: { name: string; image?: string | null }) => swatchChipStyle(c.name, c.image)

/* ── Facets ──────────────────────────────────────────────────────────────────
   Derived from the products themselves, never a written-out list: a hand-typed set of
   filters goes wrong the moment someone publishes a product that doesn't fit it, and goes
   wrong SILENTLY — the product is still on the page, just unreachable by every control
   beside it. Everything below reads what is actually in the catalogue.                    */

const ONE_SIZE = "One size"

/** Sizes as the filter offers them: the ladder as stored, with every spelling of one-size
 *  ("OSFA", "OSFM - Adult", "One Size") collapsed to a single choice. Three chips that each
 *  select the same caps is three ways to ask one question. */
const sizesOf = (p: PublicProduct) =>
  (p.sizes ?? []).map((s) => String(s || "").trim()).filter(Boolean)
    .map((s) => (isOneSize(s) ? ONE_SIZE : s))

/** Print methods, SPLIT AND NORMALISED. The field is free text and arrives both ways: one
 *  product stores "DTG", the next stores "DTG printing / Embroidery / DTF printing" as a
 *  single string. Taken at face value those are four unrelated options, two of which are the
 *  same method spelled differently, and picking "DTG" would miss the product that offers it
 *  alongside two others. */
const methodsOf = (p: PublicProduct) =>
  (p.methods ?? []).flatMap((m) => String(m || "").split("/"))
    .map((s) => s.trim().replace(/\s+printing$/i, "")).filter(Boolean)

const familiesOf = (p: PublicProduct) => {
  const out = new Set<string>()
  for (const c of p.colors ?? []) { const f = colorFamily(c.name); if (f) out.add(f) }
  return [...out]
}

const categoriesOf = (p: PublicProduct) => (p.category?.trim() ? [p.category.trim()] : [])

type FacetKey = "size" | "color" | "method" | "category"
type Facet = { key: FacetKey; label: string; options: string[]; swatch?: boolean }
const FACET_VALUES: Record<FacetKey, (p: PublicProduct) => string[]> = {
  size: sizesOf, color: familiesOf, method: methodsOf, category: categoriesOf,
}
type Selection = Record<FacetKey, string[]>
const NO_SELECTION: Selection = { size: [], color: [], method: [], category: [] }

/** One filter chip. Defined at module scope — `react-hooks/static-components` forbids
 *  declaring a component inside a render, and a chip redefined every keystroke remounts. */
function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        "rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px] font-semibold transition-colors " +
        (on
          ? "border-[var(--mk-ink)] bg-[var(--mk-ink)] text-[var(--mk-accent-ink)]"
          : "border-[var(--mk-auth-edge)] text-[var(--mk-ink)]/70 hover:border-[var(--mk-ink)] hover:text-[var(--mk-ink)]")
      }
    >
      {label}
    </button>
  )
}

/**
 * Colour is a DOT, not a labelled chip.
 *
 * Twelve chips reading "Black · Grey · White · Cream · Brown · Red …" is the row that made
 * the bar look cluttered — it is the widest facet by a distance, and the only one whose
 * label duplicates something the eye can already read off the swatch. Twelve dots fit two
 * rows of a 13rem rail; twelve labelled chips need seven.
 *
 * The name is not lost, it moves: `aria-label` carries it for a screen reader and `title`
 * for a pointer, so nothing here is colour-as-the-only-channel — the selected state is a
 * ring and an offset, not a hue.
 */
function SwatchDot({ name, on, onClick }: { name: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={name}
      title={name}
      className={
        "size-6 rounded-full border border-[var(--mk-ink)]/20 transition-shadow " +
        (on ? "ring-2 ring-[var(--mk-ink)] ring-offset-2 ring-offset-[var(--mk-surface)]" : "hover:ring-2 hover:ring-[var(--mk-ink)]/20 hover:ring-offset-2 hover:ring-offset-[var(--mk-surface)]")
      }
      style={{ background: swatchBg(name) ?? NEUTRAL_CHIP }}
    />
  )
}

/* The parcel-fee band table used to sit under this grid. It lives on the PRODUCT page now
   and nowhere else: there it is one number for the thing you are looking at, where here it
   was a four-row price list for categories, printed under a page whose whole job is to show
   what we make. */

/**
 * ONE PRODUCT CARD.
 *
 * Lifted out of the grid so it can hold state: hovering a colour chip swaps the photo to
 * that colourway. The chips were already there and were decoration — a row of dots that
 * says "six colours" without letting you see one is the shop equivalent of a locked
 * cabinet, and every catalogue in this trade swaps on hover.
 *
 * Module scope, like the other two: `react-hooks/static-components` forbids declaring a
 * component inside a render, and a card redefined on every keystroke of the search box
 * would remount — losing the hover it exists to hold.
 *
 * Hover only, no click. The card is a LINK, and a button inside an anchor is invalid
 * markup; a chip that navigated on click would also fight the card's own job. The detail
 * page is where a colourway is chosen — this is where it is glanced at.
 */
function ProductCard({ p, showCategory, index }: { p: PublicProduct; showCategory: boolean; index: number }) {
  const [hovered, setHovered] = useState<string | null>(null)
  // The hovered colourway's photo, or the product's own. Falls back the moment a colour has
  // no picture of its own, so a chip can never blank the card.
  const src = hovered || p.image
  const from = p.priceVaries ? (p.priceFrom ?? p.price) : p.price
  return (
    <Rise preset="bloom" index={Math.min(index, 6)}
          /* NO BORDER. A white card on the paper page is held by its own value — that is the
             entire depth model here, and it is why there are no shadows either. The hover
             was a darkening border, which is a second hover on a card whose photo already
             scales; the picture is the affordance. */
          className="group overflow-hidden rounded-[26px]" style={{ background: CARD }}>
      <Link href={`/catalog/${p.slug}`} className="block">
        {/* WHITE UNDER A PHOTO, accent only when there ISN'T one — the same rule the product
            page follows for its hero. This well was accent unconditionally, and the photos are
            object-contain on a supplier's white studio field, so every shot that didn't fill
            the square was framed in violet bars. The accent is for plates and CTA bands
            (CLAUDE.md 4); a colour behind a garment competes with the garment.
            The no-photo branch below prints a cream icon, which needs the accent to stay. */}
        <div className="relative aspect-square overflow-hidden" style={{ background: src ? "#fff" : ACCENT }}>
          {src ? (
            <div className="absolute inset-0" style={framingStyle(p)}>
              <Image
                src={src}
                alt={p.name}
                fill
                unoptimized
                sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                className="object-contain transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
          ) : (
            <div className="flex size-full items-center justify-center text-[var(--mk-accent-ink)]/45">
              <TShirt size={40} weight="duotone" />
            </div>
          )}
        </div>
        <div className="p-4">
          {showCategory && p.category && (
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--mk-ink)]/45">{p.category}</div>
          )}
          <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.name}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            {/* "FROM" ONLY WHEN IT IS TRUE. A 5XL costs more to buy and to ship than an S, so
                one figure was quoting a price you cannot always order at — and a product with
                a single price must not be dressed up as a range either. The server says which
                it is (priceVaries); this only reads it. */}
            <span className="text-lg font-semibold tabular-nums">
              {p.priceVaries && <span className="mr-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--mk-ink)]/50">from</span>}
              {usd(from)}
            </span>
            {sizeRangeLabel(p.sizes) && (
              <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--mk-ink)]/50">
                {sizeRangeLabel(p.sizes)}
              </span>
            )}
          </div>
          {p.colors.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5" onMouseLeave={() => setHovered(null)}>
              {p.colors.slice(0, 5).map((c) => (
                <span
                  key={c.name}
                  title={c.name}
                  onMouseEnter={() => setHovered(c.image)}
                  className={
                    "size-4 rounded-full border bg-center transition-transform " +
                    (hovered && hovered === c.image ? "scale-125 border-[var(--mk-ink)]/60" : "border-[var(--mk-ink)]/20")
                  }
                  style={chipStyle(c)}
                />
              ))}
              {p.colors.length > 5 && (
                <span className="text-[12px] font-medium text-[var(--mk-ink)]/50">+{p.colors.length - 5}</span>
              )}
            </div>
          )}
        </div>
      </Link>
    </Rise>
  )
}

export function BoldCatalog({ products, head }: { products: PublicProduct[] | null; head: PageHead }) {
  // null = the catalogue could not be READ; [] = it is genuinely empty. The house rule is
  // that those two must never look the same, so the caller distinguishes them and this
  // renders each honestly.
  const failed = products === null
  const all = useMemo(() => products ?? [], [products])
  const [sel, setSel] = useState<Selection>(NO_SELECTION)
  /** Free text over name, brand and category. A catalogue this size is scanned; one at 50
   *  is searched, and the box has to exist before the day it is needed rather than after. */
  const [query, setQuery] = useState("")
  /**
   * SORT ORDER. "Newest" is the catalogue's own order — created_at desc, exactly as the
   * server sent it — so it is a no-op rather than a sort, and the default for that reason.
   * Price and name are the two questions people actually re-sort by.
   *
   * It replaced "Featured", which sorted on a flag set by a tick in the product editor. That
   * tick is gone (Status already decides whether the public site shows a product), so the
   * option would have sorted on something nothing could set.
   */
  const [sort, setSort] = useState<"newest" | "price-asc" | "price-desc" | "name">("newest")

  /**
   * The filter controls, built from the WHOLE catalogue and not from what is currently
   * showing. Recomputing options against the filtered result makes them disappear as you
   * pick — you choose Blue, every other colour vanishes, and there is no way back to the
   * catalogue except a Clear you have to find. Options are also state derived from state
   * derived from those options, which is the shape that loops.
   *
   * A facet with fewer than two options is NOT RENDERED: it can only ever select everything
   * or nothing, so it is a control that does not control anything. That is why there is no
   * Category row today — every published product has a null category, and a row of one chip
   * reading "More" would imply a choice the catalogue can't offer.
   */
  const facets = useMemo<Facet[]>(() => {
    /**
     * NO TYPE ROW. Two kinds across thirteen products is not a filter — picking one of two
     * is the same gesture as reading the page, and it was the last of three places the same
     * fact was being presented (tiles, section headings, chips). The facet stays in the
     * table below so it returns the day the catalogue has kinds worth choosing between;
     * what is removed is the row, not the data.
     */
    const spec: [FacetKey, string, boolean][] = [
      ["size", "Size", false], ["color", "Colour", true],
      ["method", "Print", false],
    ]
    return spec.flatMap(([key, label, swatch]) => {
      const seen = new Set<string>()
      for (const p of all) for (const v of FACET_VALUES[key](p)) seen.add(v)
      let options = [...seen]
      if (key === "size") options.sort(bySize)
      else if (key === "color") options = COLOR_FAMILIES.filter((f) => seen.has(f))
      else options.sort((a, b) => a.localeCompare(b))
      return options.length >= 2 ? [{ key, label, options, swatch }] : []
    })
  }, [all])

  /** OR inside a facet, AND across them — pick two sizes and you widen, pick a size and a
   *  colour and you narrow. Anything else surprises: selecting a second size should never
   *  return fewer products than the first did. */
  const list = useMemo(() => {
    const active = (Object.keys(sel) as FacetKey[]).filter((k) => sel[k].length)
    const q = query.trim().toLowerCase()
    let out = all
    if (active.length) {
      out = out.filter((p) =>
        active.every((k) => {
          const has = new Set(FACET_VALUES[k](p))
          return sel[k].some((v) => has.has(v))
        })
      )
    }
    // NAME, BRAND, CATEGORY — the three things someone types. Not the description: matching
    // a word buried in supplier prose returns products whose relevance nobody can see, and a
    // result you cannot explain reads as a broken search.
    if (q) {
      out = out.filter((p) =>
        [p.name, p.brand, p.category].some((v) => String(v ?? "").toLowerCase().includes(q))
      )
    }
    // "Newest" is the server's own order — created_at desc — so it needs no sort at all,
    // which is also why it stays the default: the unsorted list IS the answer.
    if (sort === "newest") {
      /* the order the server sent */
    } else if (sort === "name") {
      out = [...out].sort((a, b) => a.name.localeCompare(b.name))
    } else {
      const at = (p: PublicProduct) => (p.priceVaries ? (p.priceFrom ?? p.price) : p.price)
      out = [...out].sort((a, b) => (sort === "price-asc" ? at(a) - at(b) : at(b) - at(a)))
    }
    return out
  }, [all, sel, query, sort])

  /**
   * THE HAND-PICKED SHELF — the four products someone chose to lead with.
   *
   * Hidden the moment a filter, a search or a re-sort is on: a curated row is a starting
   * point, and repeating four products in front of a narrowed result is noise where the
   * answer should be.
   */
  const picked = useMemo(() => (all.filter((p) => p.featured).slice(0, 4)), [all])


  const activeCount = (Object.keys(sel) as FacetKey[]).reduce((n, k) => n + sel[k].length, 0)
  const toggle = (key: FacetKey, value: string) =>
    setSel((s) => ({
      ...s,
      [key]: s[key].includes(value) ? s[key].filter((v) => v !== value) : [...s[key], value],
    }))

  /**
   * ONE GRID, NO CATEGORY SECTIONS.
   *
   * The page grouped by category, tiled the categories above the filters, and labelled each
   * card with its own — three presentations of one fact on a catalogue holding two kinds.
   * At 13 products across Apparel and Headwear that is furniture, not navigation: a heading
   * over ten cards and a heading over three, with a browse row above repeating both.
   *
   * The FILTER is where a kind belongs when there are few of them, and it is still there
   * under Type. Grouping earns its keep again at the width a real catalogue has — the
   * threshold it used to carry (two groups of more than one) is exactly that judgement, and
   * removing the sections rather than the data is what keeps it cheap to bring back.
   */

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      {/* Head copy moved to stored content verbatim; the GRID below stays live from the API.
          A catalogue whose products could be edited as text would be a page that disagrees
          with what is actually stocked. */}
      <PageBanner head={head} pathPrefix="catalogPage" />

      {/* ── WHAT WE MAKE, AS OBJECTS ───────────────────────────────────────────────
          Twelve blanks on the page's own colour before the grid begins. This page opened
          straight onto a filter row and a table of cards — a catalogue with no photography in
          it at all — so the first thing a visitor met was a control rather than a product.

          THIS REPLACED A SCATTER OF FOUR, and the reason is worth keeping. The note here used
          to argue for "four silhouettes, not four colours" — a tee, a crew, a hoodie and a cap
          because four tees in four colours read as a repeat. That was half right and it made
          the page look unfinished: four garments in four UNRELATED colours are four one-offs,
          which is a repeat of a different kind. What reads as a collection is one colour across
          many forms, so both axes are used at once — down the page is colour, across it is
          form, and neither alone would carry it.

          The colours are real orderable ones, not a mood board: Natural, Charcoal and Iris are
          all in the live Gildan colourway list, and Iris is the house periwinkle at 5 degrees
          of hue from the brand value rather than a shade invented for this page.

          The interaction is a product truth rather than a flourish: clicking a blank ports the
          whole field to that colour, which is the question a buyer actually has. Nothing
          reveals, nothing parallaxes. */}
      <ProductField products={products} />

      {/* WIDER THAN THE PROSE PAGES, on purpose. A catalogue is scanned, not read: nothing
          in the grid runs left-to-right, so width buys products per row rather than costing
          legibility. The hero above keeps the narrower measure every other marketing page
          uses, because that IS read. Widening both would have made the headline worse to
          make the grid better. */}
      {/* Drawn from PUBLISHED products only, which is what keeps it from going stale: a
          product ticked months ago and since set back to Draft is not on this page at all,
          so it cannot be in this row either. Empty until someone ticks something, and the
          row simply doesn't render then. */}
      {/* TEMPORARILY HIDDEN — the scatter is the page while it is being judged. Flip both
          flags back to bring the browse grid and the starter row back. */}
      {false && !failed && picked.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 pt-10 sm:px-10">
          <h2 className="text-[22px] font-bold tracking-tight">Starter essentials</h2>
          <p className="mt-1 text-[15px] text-[var(--mk-ink)]/60">
            Hand-picked blanks to start with — the ones we keep stocked and know print well.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {picked.map((p, i) => (
              <ProductCard key={p.slug} p={p} showCategory index={i} />
            ))}
          </div>
        </section>
      )}

      {/* pt-8: the browse row and the shelf above already separate this from the hero, and
          64px more put the first product below the fold on a laptop. */}
      <section className="mx-auto hidden max-w-[88rem] px-6 pb-16 pt-8 sm:px-10">
        {failed ? (
          /* THE THREE EMPTY REGIONS ON THIS PAGE NOW SHARE ONE SHAPE — a white block, no
             border, text flush left. They were centred bordered boxes, which is a fourth
             alignment and one more outlined card; and §4's own rule is that a region that
             cannot be read must not look like one that does not exist, which is carried by
             the WORDS here, not by the chrome. All three keep their distinct sentence. */
          <Rise className="rounded-[26px] px-8 py-16" style={{ background: CARD }}>
            <h2 className="text-xl font-bold tracking-tight">We couldn&apos;t load the catalogue</h2>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.6 }}>
              This is a problem on our side, not an empty catalogue — please try again shortly.
            </p>
          </Rise>
        ) : all.length === 0 ? (
          <Rise className="rounded-[26px] px-8 py-16" style={{ background: CARD }}>
            <h2 className="text-xl font-bold tracking-tight">The catalogue isn&apos;t published yet</h2>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.6 }}>
              Products appear here as soon as they&apos;re published. Nothing is hidden — there is
              simply nothing to show yet.
            </p>
          </Rise>
        ) : (
          /* A RAIL DOWN THE EDGE, not a bar across the top.
             Stacked in one column each facet gets its own line and its own heading, so three
             groups read as three questions — across the top they ran together into one band
             of forty chips that had to be parsed before the products could be. It also stops
             the controls pushing the first row of products off the fold, which is the actual
             cost of a horizontal filter: the page opens on its own furniture.
             Below lg it goes back to a block above the grid, because a 13rem rail beside a
             phone-width grid leaves neither enough room. */
          <div className="lg:flex lg:items-start lg:gap-12">
            {/* NO Rise on the controls. Everything else on these pages enters on scroll, but a
                filter that fades in is a filter that is briefly unclickable, and one whose
                entrance doesn't fire is a page that looks like it has no filters at all. */}
            {facets.length > 0 && (
              <aside className="mb-10 border-b border-[var(--mk-hairline)] pb-8 lg:sticky lg:top-24 lg:mb-0 lg:w-52 lg:shrink-0 lg:border-b-0 lg:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--mk-ink)]/45">Filter</span>
                  {/* Only ever shown when there is something TO clear — a permanent Clear
                      button on an unfiltered page is a control that does nothing. */}
                  {activeCount > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSel(NO_SELECTION); setQuery("") }}
                      className="text-[12px] font-semibold underline underline-offset-4 text-[var(--mk-ink)]/60 hover:text-[var(--mk-ink)]"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {facets.map((f) => (
                  <div key={f.key} className="mt-6">
                    <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--mk-ink)]/45">
                      {f.label}
                    </div>
                    <div className={f.swatch ? "flex flex-wrap gap-2.5" : "flex flex-wrap gap-1.5"}>
                      {f.options.map((o) =>
                        f.swatch ? (
                          <SwatchDot key={o} name={o} on={sel[f.key].includes(o)} onClick={() => toggle(f.key, o)} />
                        ) : (
                          <Chip key={o} label={o} on={sel[f.key].includes(o)} onClick={() => toggle(f.key, o)} />
                        )
                      )}
                    </div>
                  </div>
                ))}

                {/* The count is the honest part: with filters on, say what was set aside as
                    well as what is showing, so a short grid reads as a narrow filter rather
                    than a small catalogue. */}
                {activeCount > 0 && (
                  <div className="mt-7 border-t border-[var(--mk-hairline)] pt-4 text-[13px] font-semibold">
                    {list.length} of {all.length} products
                  </div>
                )}
              </aside>
            )}

            {/* min-w-0: a grid track inside a flex row will otherwise size to its widest
                item's max-content and push the whole page sideways. Same failure the product
                page's thumbnail rail caused. */}
            <div className="min-w-0 flex-1">
            {/* SEARCH AND SORT SIT WITH THE RESULTS, not in the rail. The rail answers
                "which kind"; these two act on what came back, and a person reaches for them
                while looking at the grid. Both are plain controls on purpose — a catalogue
                is not the place to invent a select. */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <label className="relative min-w-0 flex-1 sm:max-w-xs">
                <MagnifyingGlass size={15} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mk-ink)]/45" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products"
                  aria-label="Search products"
                  className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--mk-auth-edge)] bg-[var(--mk-card)] pl-9 pr-3 text-[14px] outline-none placeholder:text-[var(--mk-ink)]/40 focus:border-[var(--mk-ink)]"
                />
              </label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Sort products"
                className="h-10 rounded-[var(--radius-control)] border border-[var(--mk-auth-edge)] bg-[var(--mk-card)] px-3 text-[14px] font-semibold outline-none focus:border-[var(--mk-ink)]"
              >
                <option value="newest">Newest</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="name">Name: A–Z</option>
              </select>
              {/* Always present, not only when filtered: "13 products" is the scale of the
                  catalogue, and it is the first thing a buyer sizing us up wants. */}
              <span className="ml-auto text-[13px] font-semibold text-[var(--mk-ink)]/60">
                {list.length === all.length
                  ? `${all.length} product${all.length === 1 ? "" : "s"}`
                  : `${list.length} of ${all.length}`}
              </span>
            </div>
            {list.length === 0 ? (
              /* A filter that matched nothing is NOT an empty catalogue, and must not borrow
                 its words — the products are still there and one click brings them back. */
              <div className="rounded-[26px] px-8 py-16" style={{ background: CARD }}>
                <h2 className="text-xl font-bold tracking-tight">Nothing matches that</h2>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed" style={{ color: INK, opacity: 0.6 }}>
                  All {all.length} products are still here — no combination of what you picked
                  or typed appears on one of them.
                </p>
                <button
                  type="button"
                  onClick={() => { setSel(NO_SELECTION); setQuery("") }}
                  className="mt-5 text-[15px] font-semibold underline underline-offset-4"
                >
                  Clear filters and search
                </button>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {list.map((p, i) => (
                  <ProductCard key={p.slug} p={p} showCategory={false} index={i} />
                ))}
              </div>
            )}
            </div>
          </div>
        )}
      </section>


      <section className="px-6 py-24 sm:px-10" style={{ background: ACCENT }}>
        <div className="mx-auto max-w-[88rem]">
          <h2 className="max-w-[48rem] font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={{ ...HEADING, color: ACCENT_INK }}>
            Pick a blank, upload art, ship it.
          </h2>
          <div className="mt-10">
            <Pill href="/signup" tone="invert" ring>Start free</Pill>
          </div>
        </div>
      </section>
    </div>
  )
}
