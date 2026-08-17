"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { TShirt, MagnifyingGlass } from "@phosphor-icons/react"
import { ACCENT, HEADING, SURFACE, Pill, PlateHero, Rise } from "@/components/marketing/bold-kit"
import type { PublicProduct } from "@/lib/api"
import { framingStyle } from "@/lib/product-framing"
import { swatchBg, colorFamily, COLOR_FAMILIES } from "@/lib/color-swatch"
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
const NEUTRAL_CHIP = "#c7c4bd"
function chipStyle(c: { name: string; image?: string | null }) {
  const bg = swatchBg(c.name)
  if (bg) return { background: bg }
  if (c.image) return { backgroundImage: `url(${c.image})`, backgroundSize: "340%" }
  return { background: NEUTRAL_CHIP }
}

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
        "rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors " +
        (on
          ? "border-[#0B0B0C] bg-[#0B0B0C] text-[#FAF8F3]"
          : "border-black/[0.14] text-black/70 hover:border-black/40 hover:text-[#0B0B0C]")
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
        "size-6 rounded-full border border-black/20 transition-shadow " +
        (on ? "ring-2 ring-[#0B0B0C] ring-offset-2 ring-offset-[#F2F1EC]" : "hover:ring-2 hover:ring-black/20 hover:ring-offset-2 hover:ring-offset-[#F2F1EC]")
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
          className="group overflow-hidden rounded-2xl border border-black/[0.09] bg-white transition-colors hover:border-black/30">
      <Link href={`/catalog/${p.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden" style={{ background: ACCENT }}>
          {src ? (
            <div className="absolute inset-0" style={framingStyle(p)}>
              <Image
                src={src}
                alt={p.name}
                fill
                unoptimized
                sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
          ) : (
            <div className="flex size-full items-center justify-center text-[#FAF8F3]/45">
              <TShirt size={40} weight="duotone" />
            </div>
          )}
        </div>
        <div className="p-4">
          {showCategory && p.category && (
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">{p.category}</div>
          )}
          <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.name}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            {/* "FROM" ONLY WHEN IT IS TRUE. A 5XL costs more to buy and to ship than an S, so
                one figure was quoting a price you cannot always order at — and a product with
                a single price must not be dressed up as a range either. The server says which
                it is (priceVaries); this only reads it. */}
            <span className="text-lg font-black tabular-nums">
              {p.priceVaries && <span className="mr-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-black/45">from</span>}
              {usd(from)}
            </span>
            {sizeRangeLabel(p.sizes) && (
              <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-black/45">
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
                    (hovered && hovered === c.image ? "scale-125 border-black/60" : "border-black/15")
                  }
                  style={chipStyle(c)}
                />
              ))}
              {p.colors.length > 5 && (
                <span className="text-[12px] font-medium text-black/45">+{p.colors.length - 5}</span>
              )}
            </div>
          )}
        </div>
      </Link>
    </Rise>
  )
}

export function BoldCatalog({ products }: { products: PublicProduct[] | null }) {
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
    const spec: [FacetKey, string, boolean][] = [
      ["size", "Size", false], ["color", "Colour", true],
      ["method", "Print", false], ["category", "Type", false],
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
   * BROWSE BY KIND, before any filtering — the row every print-on-demand catalogue opens
   * with, and the thing this page had no equivalent of.
   *
   * The filter rail answers "narrow this down"; it does not answer "what do you make?",
   * which is the question a first-time visitor arrives with. A rail of chips is also a
   * control you have to read before the products start, so the page opened on its own
   * furniture and a long scroll of unlabelled cards.
   *
   * BUILT FROM THE CATALOGUE, never a hardcoded list of kinds we wish we sold: a tile
   * exists because products in it exist, it carries one of their real photographs, and it
   * says how many there are. A category we stop stocking disappears on its own.
   *
   * Clicking one IS the category filter — the same `sel` the rail writes, so the two can
   * never disagree about what is selected, and a tile shows as active when it is on.
   */
  const kinds = useMemo(() => {
    const by = new Map<string, { name: string; count: number; image: string | null }>()
    for (const p of all) {
      const name = p.category?.trim()
      if (!name) continue
      const cur = by.get(name) ?? { name, count: 0, image: null }
      cur.count++
      if (!cur.image && p.image) cur.image = p.image
      by.set(name, cur)
    }
    // Two is the floor, for the same reason the facets have one: a single tile is not a
    // choice. Biggest first — the kind we make most of is the one worth leading with.
    const out = [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return out.length >= 2 ? out : []
  }, [all])

  const activeCount = (Object.keys(sel) as FacetKey[]).reduce((n, k) => n + sel[k].length, 0)
  const toggle = (key: FacetKey, value: string) =>
    setSel((s) => ({
      ...s,
      [key]: s[key].includes(value) ? s[key].filter((v) => v !== value) : [...s[key], value],
    }))

  // Group by category so a long list reads as a catalogue rather than a wall. Anything
  // without one collects under "More" instead of being dropped.
  const groups = new Map<string, PublicProduct[]>()
  for (const p of list) {
    const k = p.category?.trim() || "More"
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  // GROUPING HAS TO EARN ITS KEEP. Each heading is display-sized, so a category holding one
  // product produced a giant title above a single card with three empty cells beside it —
  // four of those in a row made a young catalogue look broken rather than small. Below the
  // threshold everything renders as one dense grid, which reads as deliberate at four
  // products and still scales, because the headings return the moment there is enough to
  // sort. Category is not lost: it stays on the card.
  const grouped = list.length >= 8 && [...groups.values()].filter((g) => g.length > 1).length >= 2
  const sections: [string, PublicProduct[]][] = grouped ? [...groups.entries()] : [["", list]]

  return (
    <div className="text-[#0B0B0C]" style={{ background: SURFACE }}>
      <PlateHero
        title="What we"
        accent="can make."
        sub="Live from our catalogue — every product here is one you can order today, at the price shown."
      />

      {/* WIDER THAN THE PROSE PAGES, on purpose. A catalogue is scanned, not read: nothing
          in the grid runs left-to-right, so width buys products per row rather than costing
          legibility. The hero above keeps the narrower measure every other marketing page
          uses, because that IS read. Widening both would have made the headline worse to
          make the grid better. */}
      {/* THE BROWSE ROW. Above the filters and above the grid, because it answers the
          question that comes first. Scrolls sideways on a phone rather than wrapping to
          three ragged rows — a category strip is read across, like the shelf it stands
          for. */}
      {!failed && kinds.length > 0 && (
        <section className="mx-auto max-w-[88rem] px-6 pt-14">
          <h2 className="text-[22px] font-bold tracking-tight">What we print on</h2>
          <p className="mt-1 text-[15px] text-black/55">
            {all.length} product{all.length === 1 ? "" : "s"} you can order today. Pick a kind to narrow the list.
          </p>
          <div className="-mx-6 mt-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2 sm:mx-0 sm:px-0">
            {kinds.map((k) => {
              const on = sel.category.includes(k.name)
              return (
                <button
                  key={k.name}
                  type="button"
                  onClick={() => toggle("category", k.name)}
                  aria-pressed={on}
                  className={
                    "group w-40 shrink-0 snap-start overflow-hidden rounded-2xl border bg-white text-left transition-colors sm:w-44 " +
                    (on ? "border-[#0B0B0C]" : "border-black/[0.09] hover:border-black/40")
                  }
                >
                  <div className="relative aspect-square overflow-hidden" style={{ background: ACCENT }}>
                    {k.image ? (
                      <Image
                        src={k.image}
                        alt=""
                        fill
                        unoptimized
                        sizes="176px"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-[#FAF8F3]/45">
                        <TShirt size={32} weight="duotone" />
                      </div>
                    )}
                  </div>
                  <div className="px-3.5 py-3">
                    <div className="text-[15px] font-bold tracking-tight">{k.name}</div>
                    {/* The count is the point of a tile over a chip: it says how deep the
                        shelf is before you open it. */}
                    <div className="mt-0.5 text-[13px] text-black/55">
                      {k.count} product{k.count === 1 ? "" : "s"}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* THE SHELF SOMEBODY CHOSE. Above the filters, below the kinds — the order a person
          reads: what do you make, where do I start, then let me narrow it. Four across at
          most: a curated row that scrolls stops being a recommendation and becomes a second
          catalogue. */}
      {/* THE HAND-PICKED SHELF is gone with the flag that filled it.
          "Starter essentials" was `products.filter(featured).slice(0,4)`, and the only way
          to set featured was a tick in the product editor beside a Status that already
          decides whether the public site shows a product at all. With the tick removed this
          row could only ever be empty, or — worse — hold whatever was ticked months ago and
          never revisited. A curated row is worth having; one nothing can curate is not. */}

      <section className="mx-auto max-w-[88rem] px-6 py-16">
        {failed ? (
          <Rise className="rounded-2xl border border-black/[0.09] bg-white px-8 py-16 text-center">
            <h2 className="text-xl font-bold tracking-tight">We couldn&apos;t load the catalogue</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-black/55">
              This is a problem on our side, not an empty catalogue — please try again shortly.
            </p>
          </Rise>
        ) : all.length === 0 ? (
          <Rise className="rounded-2xl border border-black/[0.09] bg-white px-8 py-16 text-center">
            <h2 className="text-xl font-bold tracking-tight">The catalogue isn&apos;t published yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-black/55">
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
              <aside className="mb-10 border-b border-black/[0.09] pb-8 lg:sticky lg:top-24 lg:mb-0 lg:w-52 lg:shrink-0 lg:border-b-0 lg:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-black/40">Filter</span>
                  {/* Only ever shown when there is something TO clear — a permanent Clear
                      button on an unfiltered page is a control that does nothing. */}
                  {activeCount > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSel(NO_SELECTION); setQuery("") }}
                      className="text-[12px] font-semibold underline underline-offset-4 text-black/55 hover:text-[#0B0B0C]"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {facets.map((f) => (
                  <div key={f.key} className="mt-6">
                    <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">
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
                  <div className="mt-7 border-t border-black/[0.09] pt-4 text-[13px] font-semibold">
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
                <MagnifyingGlass size={15} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products"
                  aria-label="Search products"
                  className="h-10 w-full rounded-full border border-black/[0.12] bg-white pl-9 pr-3 text-[14px] outline-none placeholder:text-black/35 focus:border-black/40"
                />
              </label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Sort products"
                className="h-10 rounded-full border border-black/[0.12] bg-white px-3 text-[14px] font-semibold outline-none focus:border-black/40"
              >
                <option value="newest">Newest</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="name">Name: A–Z</option>
              </select>
              {/* Always present, not only when filtered: "13 products" is the scale of the
                  catalogue, and it is the first thing a buyer sizing us up wants. */}
              <span className="ml-auto text-[13px] font-semibold text-black/55">
                {list.length === all.length
                  ? `${all.length} product${all.length === 1 ? "" : "s"}`
                  : `${list.length} of ${all.length}`}
              </span>
            </div>
            {list.length === 0 ? (
              /* A filter that matched nothing is NOT an empty catalogue, and must not borrow
                 its words — the products are still there and one click brings them back. */
              <div className="rounded-2xl border border-black/[0.09] bg-white px-8 py-16 text-center">
                <h2 className="text-xl font-bold tracking-tight">Nothing matches that</h2>
                <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-black/55">
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
              sections.map(([cat, items], gi) => (
            <div key={cat || "all"} className={gi ? "mt-16" : ""}>
              {cat && <h2 className="font-display font-black leading-[0.95] tracking-[-0.035em]" style={HEADING}>{cat}</h2>}
              {/* Four across on a wide desktop, not three. A catalogue is scanned rather than
                  read, and three 355px cards on a 1,400px screen made a browsing page feel
                  like a landing page — you saw six products before scrolling.
                  The fourth column waits for xl BECAUSE OF THE RAIL: it appears at lg and
                  takes 16rem out of the row, so four columns at a 1024px window would be
                  165px cards. Three there, four once there is width to pay for it. */}
              <div className={(cat ? "mt-8" : "") + " grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"}>
                {items.map((p, i) => (
                  <ProductCard key={p.slug} p={p} showCategory={!grouped} index={i} />
                ))}
              </div>
            </div>
              ))
            )}
            </div>
          </div>
        )}
      </section>


      <section className="px-6 pb-16">
        <Rise preset="settle" className="mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center" style={{ background: ACCENT }}>
          <h2 className="mx-auto max-w-2xl font-display font-black leading-[0.95] tracking-[-0.035em]" style={{ ...HEADING, color: SURFACE }}>
            Pick a blank, upload art, ship it.
          </h2>
          <div className="mt-8 flex justify-center">
            <Pill href="/signup" tone="ink">Start free</Pill>
          </div>
        </Rise>
      </section>
    </div>
  )
}
