"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { TShirt, ArrowLeft, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { ACCENT, ACCENT_INK, ACID, HEADING, SURFACE, Pill, Rise, INK_ON_ACID } from "@/components/marketing/bold-kit"
import { swatchChipStyle } from "@/lib/color-swatch"
import { ShippingFees } from "@/components/shipping-fees"
import type { PublicProduct } from "@/lib/api"
import { framingStyle } from "@/lib/product-framing"

/**
 * One published product, in public shape.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT HAVE, because we do not have the data:
 *
 *   ratings / review counts   We collect no reviews. A star row is the single easiest thing
 *                             to fake on a product page and the single most dishonest — it
 *                             is a claim other people vouched for this.
 *   delivery estimates        Lead time depends on method, queue depth and destination, none
 *                             of which this unauthenticated route knows. A date here would be
 *                             a guess printed as a promise.
 *   stock / "only 3 left"     Stock is held against the BLANK sku, which is exactly what the
 *                             public shape withholds (it identifies our supplier).
 *
 * The house rule is that an empty state must not look like a broken feature. The inverse
 * matters just as much: an invented figure must not look like a measured one.
 */

/**
 * What we need from a customer, by decoration method.
 *
 * OURS, not the supplier's — a manufacturer's feed describes the garment, not what a print
 * shop needs to receive. `methods: []` means it applies to every method. Kept deliberately
 * short: this is the answer to "what do I send you", not a prepress manual.
 */
/**
 * Where a decoration can physically go, by method. OURS — a supplier feed describes the
 * garment, not our machines. Embroidery is shorter than print because a hoop has to reach
 * the area: a hooped chest or cuff is routine, a full back on a finished garment is not.
 */
const PLACEMENTS: Record<string, string[]> = {
  EMB: ["Left chest", "Right chest", "Centre chest", "Left sleeve", "Right sleeve", "Cap front"],
  DTG: ["Front print", "Back print", "Left sleeve", "Right sleeve", "Inside label"],
  DTF: ["Front print", "Back print", "Left sleeve", "Right sleeve", "Inside label"],
  SUB: ["All-over print", "Front print", "Back print"],
  DEFAULT: ["Front print", "Back print"],
}

const FILE_GUIDES: { label: string; body: string; methods: string[] }[] = [
  { label: "File type", methods: [], body: "PNG with a transparent background, or a vector PDF/SVG/AI. JPGs work but cannot hold transparency." },
  { label: "Resolution", methods: [], body: "300 DPI at the size it will be printed. A 1000px image blown up to 12 inches will look soft on the garment." },
  { label: "Colour", methods: ["DTG", "DTF", "SUB"], body: "sRGB. We convert for the printer; artwork sent in CMYK can shift on the way." },
  { label: "Stitch files", methods: ["EMB"], body: "Send a .DST, .PES or .EMB and we run it as-is. Send a PNG instead and we digitise it for you." },
  { label: "Small text", methods: ["EMB"], body: "Anything under 5mm tall tends to close up in stitches. Larger, or set it in a heavier face." },
  { label: "Placement", methods: [], body: "Tell us where it goes and how wide — or leave it and we'll centre it at a standard size." },
  /* Was a paragraph hanging under the grid, which left the last column carrying one card and
     the reassurance orphaned below all three. It is the same kind of statement as the rest —
     what to do about a file — so it is a guideline, and it squares the flow at six. KEEP IT
     LAST: the list is numbered by index, and "not sure" only reads right after the specifics. */
  { label: "Not sure?", methods: [], body: "Send what you have. We check every file before it goes on a machine, and we'll tell you if something won't hold up." },
]

/** How many swatches show before the row folds — three rows at the widths this column takes. */
const COLOR_FOLD = 24

/**
 * THE TECHNIQUES, AS SEPARATE THINGS.
 *
 * `methods` arrives as ONE STRING PER ROW — "DTG printing / Embroidery / DTF printing" — because
 * that is how the catalogue import wrote it, and every reader here has to take it apart before
 * it means anything. Nothing did, and it was already wrong on the page: `PLACEMENTS` is matched
 * with `includes`, and its first key is EMB, so a garment we both print and embroider matched
 * EMB and only ever showed the hooped placements. It also made one pill out of three techniques.
 *
 * Split, trimmed, de-duplicated, order kept — the first one named is the one the factory leads
 * with, and re-sorting it would quietly re-rank them.
 */
function techniquesOf(methods: string[]): string[] {
  return [...new Set(methods.flatMap((m) => m.split("/").map((x) => x.trim()).filter(Boolean)))]
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function BoldProduct({ product, shipping }: {
  product: PublicProduct
  /** First unit / each additional unit in the same parcel. The garment price alone is the
   *  half of the answer that flatters us. */
  shipping?: { extra: number } | null
}) {
  // The colourway the visitor is looking at. Selection is REAL feedback even when that colour
  // carries no photo — it is a choice a buyer genuinely makes — but the hero only swaps for a
  // colour that actually has an image, rather than blanking to a placeholder mid-browse.
  const [colorIdx, setColorIdx] = useState<number | null>(null)
  /**
   * THE SIZE A VISITOR IS ASKING ABOUT.
   *
   * The sizes were a read-only list beside a single figure, on a product whose price MOVES
   * by size — so the page showed "from $7.16" and no way to find out what the 3XL you
   * actually sell costs. A chart of measurements answered a different question entirely.
   */
  const [size, setSize] = useState<string | null>(null)
  /**
   * THE TECHNIQUE, AND WHY IT IS A PICKER TOO.
   *
   * This was a `Spec` — a row of read-only pills — on the argument that a marketing page has
   * nowhere to submit a choice to. The sizes broke that rule first, because the price moved
   * by size and the answer was a fact rather than a submission. The same is true here: two
   * whole sections of this page ARE the answer to "which technique" — where we can put it,
   * and what file to send — and they were showing all of them at once, so a shop that only
   * ever does embroidery read three paragraphs about ink to find the one about stitches.
   *
   * Null means "all of them", which is the honest default: nobody has chosen yet.
   */
  const [method, setMethod] = useState<string | null>(null)
  /** How many colourways are shown before the row is folded. See the swatch grid. */
  const [allColors, setAllColors] = useState(false)
  /** What one costs in a given size. A size with no tier of its own is charged the base —
   *  the same rule the server prices the order by. */
  const priceOfSize = (s: string | null) =>
    (s ? product.sizePrices?.find((t) => t.size === s)?.price : undefined) ?? product.price
  const shown = priceOfSize(size)
  const chosen = colorIdx == null ? null : product.colors[colorIdx] ?? null
  const hero = chosen?.image ?? product.image
  /*
   * THE COLOURWAYS THAT ACTUALLY CARRY A PHOTO — what the arrows step through.
   *
   * Not every colour has one, and stepping onto a colour with no image would blank the hero
   * mid-browse. The rail already only renders the ones with photos; this is the same set,
   * named once so the two cannot disagree.
   */
  const shots = product.colors.map((c, i) => (c.image ? i : -1)).filter((i) => i >= 0)
  const atShot = colorIdx == null ? -1 : shots.indexOf(colorIdx)
  const stepShot = (d: number) => {
    if (!shots.length) return
    const next = atShot < 0 ? (d > 0 ? 0 : shots.length - 1) : (atShot + d + shots.length) % shots.length
    setColorIdx(shots[next])
  }
  // The chart, pivoted from the supplier's flat {size, spec, value} rows into columns.
  const specs = product.specs ?? []
  const specNames = [...new Set(specs.map((x) => x.spec))]
  const sizeNames = [...new Set(specs.map((x) => x.size))]
  const specAt = (size: string, spec: string) => specs.find((x) => x.size === size && x.spec === spec)?.value ?? ""
  // The guidelines that apply to THIS product: the universal ones (no methods declared) plus
  // any whose technique the product actually names. Hoisted out of the JSX because the COUNT
  // is what decides the track count below.
  /** Every technique this garment is offered in, one per entry. */
  const methods = techniquesOf(product.methods)
  // The techniques in play: the picked one, or all of them while nobody has picked.
  const inPlay = method && methods.includes(method) ? [method] : methods
  const guides = FILE_GUIDES.filter((g) => g.methods.length === 0 || inPlay.some((m) => g.methods.some((k) => m.toUpperCase().includes(k))))
  // THREE TRACKS ONLY WHEN THE LIST DIVIDES INTO THEM. Six cards fill three columns exactly;
  // four or five leave a hole under the short track, which is what made the section read as
  // unfinished. Two columns take any even-or-odd count without a visible gap.
  const guideCols = guides.length % 3 === 0 ? "sm:columns-2 lg:columns-3" : "sm:columns-2"

  return (
    <div className="text-[var(--mk-ink)]" style={{ background: SURFACE }}>
      {/* AS WIDE AS THE GRID IT CAME FROM. This was max-w-6xl (1152px) while the catalogue,
          the homepage and every other marketing section run max-w-[88rem] with a 40px gutter —
          so clicking a product stepped the page IN by 256px and the hero photo, the one thing
          the page is for, came out smaller than the card that linked to it. */}
      <div className="mx-auto max-w-[88rem] px-6 pb-20 pt-10 sm:px-10">
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mk-ink)]/60 transition-colors hover:text-[var(--mk-ink)]"
        >
          <ArrowLeft size={14} weight="bold" /> All products
        </Link>

        {/* The picture takes the extra width, not the column of facts: a 1.2/0.8 split on the
            wider container grows the hero and holds the reading measure where it was — text
            past ~600px is harder to read, a garment photo is not. */}
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16">
          {/* ── The picture ──────────────────────────────────────────────── */}
          {/* The two hero columns arrive from DIFFERENT directions — the picture settles down
              into place, the copy drifts in from the side. Both rising together is one slab
              moving, which is the gesture that made every page feel like the last one. */}
          {/* min-w-0 because a grid item's default `min-width: auto` lets it push PAST its own
              track, and the phone layout puts a 6,200px-wide thumbnail strip inside this one:
              the track measured a correct 357px while the item sat at 5,916 and took the page
              with it. The track can only hold what the item agrees to shrink to. */}
          {/* THE PICTURE STAYS WHILE THE FACTS SCROLL.
              The photo column is one square; the facts column is price, shipping, colours,
              sizes and the CTA — so the left half ran out halfway down and the rest of the
              page was read against an empty white field. Sticky needs the item to size to its
              own content, hence `self-start`: a grid item stretches by default and a
              full-height box has nothing to stick to. Below lg the two are stacked and it
              stays in flow. */}
          <Rise preset="settle" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            {/* Rail LEFT of the hero, not under it. A vertical strip is how every product
                page of this kind is read — thumbnails scanned down the edge while the main
                shot holds its size — and it stops the hero being pushed up the page by a
                row of squares beneath it. Falls back to a single column on phones, where a
                64px rail beside the image would leave the hero too narrow to judge. */}
            {/* items-start, and the rail SCROLLS rather than growing.
                `aspect-square` on the hero is a ratio, not a height, and it loses outright to
                a flex row's default stretch: the rail is one thumbnail per colourway, so an
                82-colour tee made the row ~6,600px tall, dragged the hero to 468×6,600 and
                left object-cover upscaling a 500px photo thirteen times over — the product
                page opened on a blank white field with a smear of garment far below the fold.
                A rail can't be allowed to set the height of the picture it sits beside. */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start">
              {product.colors.some((c) => c.image) && (
                /* The strip is taken OUT OF FLOW at sm and up (absolute inset-0), so its
                   length can't reach the row: this box stretches to the hero's own square and
                   the thumbnails scroll inside it. In the phone layout it stays in flow, where
                   it is a horizontal strip above the picture and its height is wanted. */
                /* THE SCROLL CONTAINER MOVES BETWEEN THE TWO ELEMENTS, and it has to.
                   Below sm it is this box: a row of 82 thumbnails is ~6,200px of max-content,
                   and until something clips it the grid track above sizes to it — the phone
                   layout went out to 5,916px wide the moment the strip alone carried the
                   overflow and this wrapper did not. Above sm the strip is out of flow instead,
                   so there is nothing here to clip and the scrolling belongs to the strip. */
                <div className="relative shrink-0 overflow-x-auto sm:w-20 sm:self-stretch sm:overflow-x-visible">
                  <div className="flex gap-3 sm:absolute sm:inset-0 sm:flex-col sm:overflow-y-auto">
                  {product.colors.map((c, i) =>
                    c.image ? (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => setColorIdx(i)}
                        aria-label={c.name}
                        aria-pressed={colorIdx === i}
                        className={
                          "relative aspect-square w-16 shrink-0 overflow-hidden rounded-xl border transition-colors sm:w-full " +
                          (colorIdx === i ? "border-[var(--mk-ink)]" : "border-[var(--mk-hairline)] hover:border-[var(--mk-ink)]")
                        }
                      >
                        <Image src={c.image} alt="" fill unoptimized sizes="80px" className="object-cover" />
                      </button>
                    ) : null
                  )}
                  </div>
                </div>
              )}
              <div
                className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-[26px] border border-[var(--mk-hairline)] bg-[var(--mk-card)]"
                style={{ background: hero ? "#fff" : ACCENT }}
              >
                {hero ? (
                  <Image
                    src={hero}
                    alt={chosen ? `${product.name} — ${chosen.name}` : product.name}
                    fill
                    unoptimized
                    priority
                    sizes="(max-width:1024px) 100vw, 60vw"
                    className="object-contain"
                    /* The crop set in the product editor. The public pages were the last
                       surface still ignoring it, so a product framed for the app arrived
                       here uncropped — see lib/product-framing. */
                    style={framingStyle(product)}
                  />
                ) : (
                  /* Accent, not a grey box — a product without a photo should read as
                     unfinished rather than as a failed image request. */
                  <div className="flex size-full flex-col items-center justify-center gap-3 text-[var(--mk-accent-ink)]/50">
                    <TShirt size={56} weight="duotone" />
                    <span className="text-sm font-semibold">Photo coming</span>
                  </div>
                )}
                {/* ONE PHOTO AT A TIME, AND A WAY TO THE NEXT ONE.
                    The rail is the whole navigation today, which means browsing colourways is
                    a scroll down a 64px strip — fine when you know which colour you want, no
                    use at all for "show me what this comes in". The arrows step through the
                    same set the rail holds, so nothing can land on a colour with no picture.
                    Only when there is more than one: a single arrow pair over one photo is a
                    control that lies about having somewhere to go. */}
                {shots.length > 1 && (
                  <>
                    {[-1, 1].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => stepShot(d)}
                        aria-label={d < 0 ? "Previous colour" : "Next colour"}
                        className={
                          "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-[var(--mk-hairline)] text-[var(--mk-ink)] transition-transform hover:scale-105 " +
                          (d < 0 ? "left-3" : "right-3")
                        }
                        style={{ background: SURFACE }}
                      >
                        {d < 0 ? <CaretLeft size={16} weight="bold" /> : <CaretRight size={16} weight="bold" />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </Rise>

          {/* ── The facts ────────────────────────────────────────────────── */}
          <Rise preset="drift">
            {(product.category || product.brand) && (
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--mk-ink)]/50">
                {[product.brand, product.category].filter(Boolean).join(" · ")}
              </div>
            )}
            <h1 className="mt-3 font-display font-semibold leading-[0.95] tracking-[-0.03em]" style={HEADING}>
              {product.name}
            </h1>

            <div className="mt-7 border-y border-[var(--mk-hairline)] py-6">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {/* "from" ONLY while no size is chosen. Once one is, this is not a range any
                    more — it is the price of that size, and still calling it "from" would be
                    hedging a number we now know exactly. */}
                {product.priceVaries && !size && (
                  <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-[var(--mk-ink)]/50">from</span>
                )}
                <span className="text-4xl font-semibold tracking-tight tabular-nums">{usd(size ? shown : (product.priceFrom ?? product.price))}</span>
                {size && <span className="text-sm font-semibold text-[var(--mk-ink)]/60">for {size}</span>}
              </div>
              {/* Say WHOSE price this is. It's what a seller pays us to make and ship one —
                  not a retail price, and not our cost. Leaving that ambiguous on a public
                  page invites both wrong readings. */}
              <p className="mt-2 text-sm leading-relaxed text-[var(--mk-ink)]/60">
                What you pay us to make one, before your own retail markup. Shipping is
                charged per parcel, below.
              </p>
              {/* THIS product's fee, not the catalogue's average. `ship` is resolved
                  server-side by the same function that bills the order, so the figure a
                  visitor reads here is the one they are charged. */}
              {shipping && <ShippingFees first={product.ship} extra={shipping.extra} tone="marketing" className="mt-4" />}
            </div>

            {/* THE SUPPLIER'S DESCRIPTION IS NOT PUBLISHED HERE ANY MORE (2026-08-24).
                It was the manufacturer's own bullet list, and read on the page it was a wall
                of fabric arithmetic between the price and the thing a buyer came to do:
                "5.3 oz./yd² (US), 8.8 oz./L yd (CA), 100% U.S. cotton, 20 singles" followed
                by every colourway that is a different blend, in one 82-name run. It pushed
                the colours and sizes below the fold, and the swatches underneath already say
                what the colour list was trying to.
                `descriptionLines` stays — the app's product page still uses it, where a
                spec dump belongs to someone reading specs. */}

            {methods.length > 0 && (
              <div className="mt-6">
                <div className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--mk-ink)]/50">
                  <span>Print method <span className="text-[var(--mk-ink)]/35">· {methods.length}</span></span>
                  {method && <span className="normal-case tracking-normal text-[var(--mk-ink)]/45">guidelines below follow this</span>}
                </div>
                {/* SAME PILL AS THE SIZES, because it is the same kind of choice — and the
                    house rule is that shape says KIND. A second shape here would say these
                    two rows do different things when they do not. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {methods.map((m) => {
                    const on = method === m
                    return (
                      <button
                        key={m}
                        type="button"
                        // Pressing the chosen one again clears it, exactly as the sizes do,
                        // so "show me everything again" is one press and not a reload.
                        onClick={() => setMethod(on ? null : m)}
                        aria-pressed={on}
                        className={
                          "rounded-[var(--radius-control)] border px-3.5 py-1.5 text-sm font-semibold transition-colors " +
                          (on
                            ? "border-[var(--mk-ink)] bg-[var(--mk-ink)] text-[var(--mk-accent-ink)]"
                            : "border-[var(--mk-auth-edge)] text-[var(--mk-ink)]/70 hover:border-[var(--mk-ink)] hover:text-[var(--mk-ink)]")
                        }
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {product.colors.length > 0 && (
              <div className="mt-6">
                {/* THE NAME OF THE ONE YOU PICKED, not all 82 of them.
                    This listed every colourway as a text pill: the Gildan tee carries 82, so
                    the page became twenty-one rows of names between the price and the sizes,
                    and the one thing a pill is for — telling you what the colour looks like —
                    a word cannot do. Swatches say it in a glance and in a tenth of the space;
                    the selected NAME moves up here, where it is read once instead of hunted
                    for among its neighbours. */}
                <div className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--mk-ink)]/50">
                  <span>Colours <span className="text-[var(--mk-ink)]/35">· {product.colors.length}</span></span>
                  {chosen && (
                    <span className="truncate text-[13px] font-semibold normal-case tracking-normal text-[var(--mk-ink)]">
                      {chosen.name}
                    </span>
                  )}
                </div>
                {/* A GRID ON A FIXED TRACK, not a wrapping flex row.
                    82 swatches in `flex-wrap` gave every row a different number of chips and
                    a ragged right edge — the same defect a variable-width badge causes in a
                    table (CLAUDE.md: a variable element followed by anything else belongs in
                    a grid). `auto-fill` at the swatch's own 1.75rem keeps the columns square
                    and aligned at any column width, and the tracks do not stretch.
                    FOLDED AFTER THREE ROWS. Seven rows of colour is a wall between the price
                    and the sizes, and 24 is enough to see the range this garment comes in. */}
                <div className="mt-3 grid grid-cols-[repeat(auto-fill,1.75rem)] gap-2.5">
                  {(allColors ? product.colors : product.colors.slice(0, COLOR_FOLD)).map((c) => {
                    const i = product.colors.indexOf(c)
                    return (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => setColorIdx(i)}
                        aria-pressed={colorIdx === i}
                        aria-label={c.name}
                        title={c.name}
                        className={
                          "size-7 rounded-full border transition-shadow " +
                          (colorIdx === i
                            ? "border-[var(--mk-ink)]/25 ring-2 ring-[var(--mk-ink)] ring-offset-2 ring-offset-[var(--mk-accent-ink)]"
                            : "border-[var(--mk-ink)]/20 hover:ring-2 hover:ring-[var(--mk-ink)]/20 hover:ring-offset-2 hover:ring-offset-[var(--mk-accent-ink)]")
                        }
                        style={swatchChipStyle(c.name, c.image)}
                      />
                    )
                  })}
                </div>
                {product.colors.length > COLOR_FOLD && (
                  <button
                    type="button"
                    onClick={() => setAllColors((v) => !v)}
                    className="mt-3 text-sm font-semibold text-[var(--mk-ink)]/70 underline underline-offset-4 transition-colors hover:text-[var(--mk-ink)]"
                  >
                    {allColors ? "Show fewer" : `Show all ${product.colors.length}`}
                  </button>
                )}
              </div>
            )}
            {product.sizes.length > 0 && (
              <>
                {/* A PICKER, because there is now something to say back. This was a Spec —
                    deliberately inert, on the argument that a marketing page has nowhere to
                    submit a choice to. That held while every size cost the same; it stopped
                    holding the moment the price moved by size, because the answer to "what
                    does a 2XL cost" is a fact, not a submission. */}
                <div className="mt-6">
                  <div className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--mk-ink)]/50">
                    <span>Sizes <span className="text-[var(--mk-ink)]/35">· {product.sizes.length}</span></span>
                    {product.priceVaries && <span className="normal-case tracking-normal text-[var(--mk-ink)]/45">pick one for its price</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {product.sizes.map((s) => {
                      const on = size === s
                      return (
                        <button
                          key={s}
                          type="button"
                          // Pressing the chosen one again clears it, so a visitor can get
                          // back to the range without reloading the page.
                          onClick={() => setSize(on ? null : s)}
                          aria-pressed={on}
                          className={
                            "rounded-[var(--radius-control)] border px-3.5 py-1.5 text-sm font-semibold transition-colors " +
                            (on
                              ? "border-[var(--mk-ink)] bg-[var(--mk-ink)] text-[var(--mk-accent-ink)]"
                              : "border-[var(--mk-auth-edge)] text-[var(--mk-ink)]/70 hover:border-[var(--mk-ink)] hover:text-[var(--mk-ink)]")
                          }
                        >
                          {s}
                          {product.priceVaries && (
                            <span className={"ml-2 text-xs font-medium tabular-nums " + (on ? "text-[var(--mk-accent-ink)]/70" : "text-[var(--mk-ink)]/45")}>
                              {usd(priceOfSize(s))}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {/**
                  * THE SIZE CHART, WHERE SIZES ARE.
                  *
                  * It was a full section under the fold, and on most of the catalogue it held
                  * one line — only some manufacturers publish a measurement feed, so the
                  * common state was a heading, a sentence, and nothing. A heading that size
                  * over an apology is a section announcing its own emptiness.
                  *
                  * As a link next to the sizes it is where the question is asked, and it
                  * costs one line whether or not there is a table behind it.
                  */}
                <p className="mt-3 text-sm">
                  {specNames.length > 0
                    ? <a href="#size-chart" className="font-semibold text-[var(--mk-ink)]/70 underline underline-offset-4">Size chart &amp; measurements</a>
                    : <a href="mailto:orders@egful.store" className="font-semibold text-[var(--mk-ink)]/70 underline underline-offset-4">Ask us for measurements</a>}
                </p>
              </>
            )}

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Pill href="/signup" tone="primary">Start free</Pill>
              <Pill href="/pricing" tone="ghost">See pricing</Pill>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[var(--mk-ink)]/55">
              Connect Etsy, Shopify or TikTok Shop and this product is orderable from your queue.
              Nothing to pay until you submit an order.
            </p>
          </Rise>
        </div>

        {/* ── Size chart + artwork spec, full width under the fold ─────────────
            Below the buying decision rather than beside it: someone measuring a garment or
            checking a file spec has already decided they're interested, and squeezing a
            multi-column table into the right rail would make both harder to read. */}
        {(
          /* ONE column, because there is one thing left in it. Most products have no
             supplier size chart — S&S is the only feed that provides one — and the artwork
             guidelines that used to sit beside it are now their own full-width band below.
             A two-column grid holding a single item is just a half-width page, which is
             what made this section look broken rather than short. */
          <div className="mt-16 max-w-3xl space-y-12">
            {/* ONLY WHEN THERE IS A CHART. It used to render either way, so most products got
                a 24px heading over one line of apology — a section whose whole content was
                the news that it had none. The link beside the sizes covers that case now, and
                this is the anchor it points at. */}
            {specNames.length > 0 && (
            <Rise preset="cut">
                <h2 id="size-chart" className="scroll-mt-24 font-display text-2xl font-semibold tracking-tight">Size chart</h2>
                <p className="mt-1.5 text-sm text-[var(--mk-ink)]/55">
                  Garment measurements from the manufacturer, in inches.
                </p>
                {(<>
                {/* PIVOTED, not read off named fields: the supplier returns one row per
                    (size, measurement) and the measurements differ per garment — a polo has
                    a chest width, a cap has a bill length. Assuming columns is how a chart
                    that exists gets reported as missing. */}
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[22rem] border-collapse text-sm">
                    <thead>
                      <tr className={INK_ON_ACID}>
                        <th className="rounded-l-lg px-3 py-2 text-left font-bold">Size</th>
                        {specNames.map((n, i) => (
                          <th key={n} className={"px-3 py-2 text-left font-bold" + (i === specNames.length - 1 ? " rounded-r-lg" : "")}>{n}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sizeNames.map((z, ri) => (
                        <tr key={z} className={ri % 2 ? "bg-[var(--mk-ink)]/[0.03]" : ""}>
                          <td className="px-3 py-2 font-bold">{z}</td>
                          {specNames.map((n) => (
                            <td key={n} className="px-3 py-2 tabular-nums text-[var(--mk-ink)]/70">{specAt(z, n)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>)}
            </Rise>
            )}

            {methods.length > 0 && (
              <Rise preset="cut" index={1}>
                <h2 className="font-display text-2xl font-semibold tracking-tight">Where we can print</h2>
                <p className="mt-1.5 text-sm text-[var(--mk-ink)]/55">
                  Placements available on this garment.
                </p>
                {/* OURS, not the supplier's. A manufacturer's feed describes the blank; where
                    a decoration can go is a fact about OUR machines and jigs, so it is stated
                    per method here rather than pulled from anywhere. */}
                <div className="mt-5 space-y-5">
                  {inPlay.map((m) => {
                    const key = Object.keys(PLACEMENTS).find((k) => m.toUpperCase().includes(k))
                    const spots = key ? PLACEMENTS[key] : PLACEMENTS.DEFAULT
                    return (
                      <div key={m}>
                        <div className="text-sm font-bold">{m}</div>
                        {/**
                          * PILLS, not a row of ticks.
                          *
                          * Six ✓ items on one line gave the section six small marks, six
                          * gaps and no edges — a thin ragged strip that read as clutter
                          * rather than as a set. Every OTHER list of facts on this page is
                          * already a pill (see Spec: sizes, methods), so this was also the
                          * one place inventing its own.
                          *
                          * The tick goes with them: a list titled "where we can print" is
                          * affirmative by definition, so a ✓ on every item marks nothing.
                          */}
                        <ul className="mt-2.5 flex flex-wrap gap-1.5">
                          {spots.map((sp) => (
                            <li key={sp} className="rounded-[var(--radius-control)] border border-[var(--mk-auth-edge)] px-3 py-1 text-sm text-[var(--mk-ink)]/70">
                              {sp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </Rise>
            )}

          </div>
        )}

        {/**
          * THE ONE COLOURED MOMENT ON THE PAGE.
          *
          * This was a grey spec list on cream, and every attempt to lay it out better was
          * still a grey spec list on cream. It is the last thing before someone decides to
          * send us a file, so it earns the plate: "the banner is the colour; the page is
          * paper" (CLAUDE.md §4), and this is the page's banner.
          *
          * FULL BLEED, with the content still on the page's own 6xl measure — the colour runs
          * edge to edge, the words line up with everything above them. w-screen + the
          * 50vw/50% translate is the standard way out of a centred container without knowing
          * its width.
          *
          * CONTRAST IS MEASURED, NOT EYEBALLED. On this accent (#6633FF):
          *   cream #FAF8F3            5.68:1  — body, comfortably over 4.5
          *   cream at 80%             4.02:1  — used for the answers, over 3.0 at this size
          *   ink #0B0B0C              3.26:1  — NOT used; it fails as body on this plate
          * So the plate carries cream, which is what ACCENT_INK already is.
          *
          * NUMBERED, and flowing in columns rather than a fixed grid: five guidelines in four
          * tracks left one orphan above three empty cells, which is what made the last
          * attempt worse than the thing it replaced.
          */}
        {/* ON EVERY PRODUCT, not only the ones with a print method declared.
            This was gated on `product.methods.length > 0`, so three published products —
            the ones whose method field is empty — ended on cream with no plate at all,
            while their neighbours ended on the accent. The band read as decoration that
            came and went rather than as the page's last section.
            Nothing has to be invented to fill it: FILE_GUIDES entries carrying no methods
            are the UNIVERSAL ones (size, resolution, background), and they are true of any
            job whether or not the technique is on the product yet. */}
        {(
          /* -mb-20 cancels the page container's own pb-20. The band is the LAST thing on the
             page, so that padding was 80px of cream hanging under the colour with nothing in
             it — the plate should end where the page ends. */
          <div className="relative left-1/2 mt-20 -mb-20 w-screen -translate-x-1/2" style={{ background: ACCENT }}>
            <div className="mx-auto max-w-[88rem] px-6 py-16 sm:px-10">
              <Rise preset="cut">
                {/* ACID, not dimmed cream. The kit measures it at 5.07:1 on this plate and
                    calls it "type rather than a glow" — this is the one ground it works on
                    (1.12:1 on paper, where it disappears), so the plate is where the brand's
                    second colour finally gets to appear. */}
                <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: ACID }}>
                  {/* The methods, when the product names any. Without them the line still has
                      to say what the section IS, rather than trailing off after a middot. */}
                  What to send us{inPlay.length > 0 ? ` · ${inPlay.join(" / ")}` : ""}
                </div>
                <h2 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl" style={{ color: ACCENT_INK }}>
                  Artwork guidelines
                </h2>
                {/* -mb-8 cancels the last card's own margin, so the plate's bottom padding is
                    the 64px it says it is rather than 96px of colour under the last line. */}
                <dl className={`mt-10 -mb-8 gap-x-12 ${guideCols}`}>
                  {guides.map((g, i) => (
                    <div key={g.label} className="mb-8 break-inside-avoid">
                      <dt className="flex items-baseline gap-2.5">
                        <span className="tabular-nums text-xs font-bold tabular-nums" style={{ color: ACID }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-base font-semibold tracking-tight" style={{ color: ACCENT_INK }}>{g.label}</span>
                      </dt>
                      <dd className="mt-1.5 pl-[2.4rem] text-sm leading-relaxed" style={{ color: ACCENT_INK, opacity: 0.8 }}>
                        {g.body}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Rise>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

/* `Spec` — the read-only pill row — is gone. Both of its call sites (sizes, then print
   method) became pickers once there was something on the page for a choice to change, and a
   primitive with no call sites is the thing the next session re-derives instead of reading. */
