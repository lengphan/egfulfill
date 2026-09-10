"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { HOVER, reveal } from "./motion"
import { GUTTER, SECTION, TOP } from "./rhythm"
import { getPublicProduct, type PublicProduct } from "@/lib/api"
/* THE CANONICAL SPLITTER, not a second one. `normalizeMethods` already splits a combined
   value ("DTG printing / Embroidery") and de-dupes by normalised key. */
import { normalizeMethods, normTech } from "@/lib/print-method"
import { bySize, sizeRangeLabel } from "@/lib/size-order"
/* The canonical swatch resolver — the same one the app's product page reads, so one colour
   name cannot render three ways across the product (§5). */
import { swatchChipStyle } from "@/lib/color-swatch"
/* ONE VOCABULARY FOR A FACE. `left` is "Left sleeve" everywhere in the product — on the
   import sheet, on the boards and here — and a second spelling on a public page is how two
   words for one placement start (§5). */
import { SIDE_LABEL } from "@/lib/order-import"
import { framingStyle } from "@/lib/product-framing"
import { ShippingFees } from "@/components/shipping-fees"

/**
 * THE CATALOGUE, AS ONE PAGE.
 *
 * It used to be a grid of 23 identical squares beside a 190px filter sidebar, and a click
 * left for /catalog/<slug> — a page built in a DIFFERENT design language (the old bold-kit,
 * with its violet artwork plate), so choosing a product visibly changed which site you were
 * on. That is most of what read as "not exciting": not the amount of information, the
 * uniformity of it.
 *
 * Three things changed, and they are one idea.
 *
 *   EDITORIAL, NOT INVENTORY.  The catalogue is grouped by its own categories, each opened
 *   by a display word, and the tiles inside a group are packed at TWO scales rather than
 *   one. A page of equal squares has no focus by construction; a page that varies scale has
 *   to decide what matters, which is what makes it read as a catalogue rather than a stock
 *   list.
 *
 *   NOWHERE TO GO.  Selecting a product opens a full-width band directly beneath ITS OWN
 *   ROW — the grid parts, the detail pushes in, and your place in the page is never lost.
 *   Nothing is fetched to do it: /api/public/products already returns every field the
 *   detail needs (colours, sizes, sizePrices, methodPrices, sides, sideFee, ship). The one
 *   exception is the supplier size chart, which is deliberately detail-route-only because
 *   it costs a supplier call per product — so that, and only that, is read on open.
 *
 *   THE PICKS MOVE THE PRICE.  Colour, size, technique and placement are the four things
 *   that change what a seller pays, and the figure recomputes as they are pressed. This
 *   mirrors server/src/pricing.js exactly: size sets the base, the method adds its own
 *   surcharge, and only faces 2..n are charged because the blank's price already buys one.
 *
 * WHAT IS STILL DELIBERATELY ABSENT, because we do not have it: ratings, delivery dates,
 * stock. §4 — an invented figure must not look like a measured one. And no `sku`, no
 * `blank`, no supplier domain in any src: §2.9 covers URLs, not just fields.
 */

/** How many colourways a CARD shows before it prints a count instead. */
const CARD_SWATCHES = 6
/** How many the open panel shows before it folds. Three rows at the panel's width. */
const PANEL_SWATCHES = 24

/**
 * WHAT WE NEED FROM A CUSTOMER, by technique. Ours, not the supplier's — a manufacturer's
 * feed describes the garment, not what a print shop needs to receive. `methods: []` means it
 * applies to every one. Kept to a line each: this is the answer to "what do I send you", not
 * a prepress manual, and it used to be a full-bleed plate of eight paragraphs under the fold.
 */
const FILE_GUIDES: { label: string; body: string; methods: string[] }[] = [
  { label: "File type", methods: [], body: "PNG with transparency, or a vector PDF/SVG/AI." },
  { label: "Resolution", methods: [], body: "300 DPI at the size it will be printed." },
  { label: "Colour", methods: ["DTG", "DTF", "SUB"], body: "sRGB — we convert for the printer." },
  { label: "Stitch files", methods: ["EMB"], body: "Send .DST, .PES or .EMB and we run it as-is." },
  { label: "Small text", methods: ["EMB"], body: "Under 5mm tall tends to close up in stitches." },
  { label: "Placement", methods: [], body: "Tell us where it goes and how wide." },
]

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Every technique this garment is offered in, one per entry. `methods` arrives as ONE
 *  STRING PER ROW ("DTG printing / Embroidery"), so nothing means anything until it is split. */
const techniquesOf = (methods: string[]) =>
  [...new Set(methods.flatMap((m) => m.split("/").map((x) => x.trim()).filter(Boolean)))]

/**
 * PACK THE TILES INTO ROWS THAT ALWAYS SUM TO 12.
 *
 * The editorial rhythm is a cycle — a wide tile with a narrow one, then three equal ones,
 * then the mirror — but a cycle applied blindly is exactly how a grid ends with one orphan
 * above four empty cells, which is the defect the owner reads as "the layout seems undone".
 * So the LAST row of every group is re-spanned to fill the width whatever is left over:
 * one tile takes 12, two take 6 each, three take 4.
 *
 * Rows are explicit rather than implied by wrapping because the open panel has to know which
 * row it belongs under — a `flex-wrap` grid has no row to ask about.
 */
/**
 * ONE TILE SIZE, AND ROWS OF FOUR.
 *
 * This went through three shapes and the last two were the same mistake twice, so the
 * reasoning is worth keeping.
 *
 * It began as a spread — two tiles across the full width, then three — which reads as a
 * LOOKBOOK. A lookbook and a catalogue are different objects: a catalogue's job is
 * comparison, and comparison needs several products in the eye at once.
 *
 * Then it was an opening row of four with a run of six, to give each category a beginning.
 * That looked right until the TAIL. A category rarely divides by four and six: Headwear has
 * six products, so it opened four and had two left, and those two were re-spanned to close
 * the row. Capping the span left 8 of 12 columns used — a hole. Not capping it made each
 * tile half the page — two 690px caps, which is the "crazy large" this kept coming back as.
 * There is no cap that is both, because the premise was wrong: a row cannot be made to
 * always fill AND always stay small when the item count is whatever the catalogue happens
 * to hold.
 *
 * So every tile is the same, four across, and the last row of a category is simply short —
 * the way every product grid on the web ends. A short final row is not the orphan defect;
 * the orphan defect was ONE item stretched to fill a width it did not need. The editorial
 * rhythm lives where it should have from the start: in the display word that opens each
 * category, and in the air around it.
 *
 * Rows are still explicit rather than left to wrapping, because the open panel has to know
 * which row to sit under — a wrapped grid has no row to ask about.
 */
const PER_ROW = 4

type Cell<T> = { item: T }

function packRows<T>(items: T[]): Cell<T>[][] {
  const rows: Cell<T>[][] = []
  for (let i = 0; i < items.length; i += PER_ROW) {
    rows.push(items.slice(i, i + PER_ROW).map((item) => ({ item })))
  }
  return rows
}

/** Two up on a phone, three on a tablet, four on a desktop — and the same at every count,
 *  so a tile never changes size because of how many happen to be beside it. */
const TILE = "col-span-6 sm:col-span-4 lg:col-span-3"

/**
 * SCALE VARIES, THE CROP DOES NOT — and that is the whole correction.
 *
 * The first cut of this gave the feature tile a LANDSCAPE frame, on the reasoning that a
 * catalogue needs two shapes. It does, but not this way: every photograph in the catalogue
 * is a portrait or square product shot, so a 16/11 `object-cover` frame took a band out of
 * the middle of each one. A cap came out as an abstract close-up of its crown — the tile
 * meant to be the most important thing on the row was the only one you could not identify.
 *
 * So there is ONE ratio and the rhythm comes from SIZE: a row of two, then a row of four.
 * That reads as editorial for the reason a magazine spread does — the eye is given somewhere
 * to land — while every garment stays whole, which is the thing a catalogue is FOR.
 *
 * Two breakpoints, because a quarter-width tile on a 768px screen is a thumbnail: below lg a
 * feature runs full width and the rest go two-up. Tailwind needs finished class names, so
 * these are a lookup rather than a template.
 */
const RATIO = "aspect-[5/6]"

/* ────────────────────────────────────────────────────────────────────────────
   THE CARD
   ──────────────────────────────────────────────────────────────────────────── */

function Card({
  p,
  open,
  onOpen,
}: {
  p: PublicProduct
  open: boolean
  onOpen: () => void
}) {
  /** The colourway under the cursor. Hovering a swatch swaps the PHOTO, which is the one
   *  thing a row of dots cannot say on its own — and it is why the swatches are here at all
   *  rather than a count. Null is the product's default shot. */
  const [peek, setPeek] = useState<number | null>(null)
  const shot = (peek != null && p.colors[peek]?.image) || p.image

  return (
    <motion.div {...reveal(0)} className={TILE}>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="block w-full text-left"
      >
        <motion.div
          whileHover={{ y: -4 }}
          transition={HOVER}
          className={
            "relative overflow-hidden rounded-[26px] bg-ploy-paper ring-2 transition-[box-shadow] " +
            RATIO +
            (open ? " ring-ploy-ink" : " ring-transparent")
          }
        >
          {shot ? (
            <Image
              src={shot}
              alt={p.name}
              fill
              sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
              className="object-cover"
              /* The crop set in the product editor — the public surfaces were the last ones
                 still ignoring it, so a product framed for the app arrived here uncropped. */
              style={framingStyle(p)}
            />
          ) : (
            /* An honest blank tile, never a placeholder mockup: §4, and the marketing-home
               note about never reintroducing a fake render. */
            <div className="grid h-full w-full place-items-center">
              <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/35">
                Photo coming
              </span>
            </div>
          )}
        </motion.div>
      </button>

      {/* STACKED, not name-left / price-right. A run tile is a sixth of the page, and a
          two-column meta row inside it puts the price hard against a truncated name — which
          is the crooked-column defect §4 describes, one tile at a time. The price keeps its
          own line and its tabular figures, so the column of them still reads down the row. */}
      <div className="mt-3">
        <p className="truncate text-[15px] font-semibold">{p.name}</p>
        <p className="mt-0.5 text-[13px] text-ploy-ink/55">
          <span className="tabular-nums text-ploy-ink">
            {p.priceVaries ? "from " : ""}
            {usd(p.priceFrom ?? p.price)}
          </span>
          <span className="text-ploy-ink/35"> · </span>
          {sizeRangeLabel(p.sizes)}
        </p>
      </div>

      {p.colors.length > 0 && (
        /* NOT a picker — the card is one button and these are inside it only visually. They
           set the hovered photo and nothing else, so they are `aria-hidden` and unfocusable;
           the real choice lives in the panel, where there is something for it to change. */
        <div className="mt-2.5 flex items-center gap-1.5" onMouseLeave={() => setPeek(null)}>
          {p.colors.slice(0, CARD_SWATCHES).map((c, i) => (
            <span
              key={c.name}
              title={c.name}
              aria-hidden
              onMouseEnter={() => setPeek(i)}
              className="size-3.5 shrink-0 cursor-pointer rounded-full border border-ploy-ink/15"
              style={swatchChipStyle(c.name, c.image)}
            />
          ))}
          {p.colors.length > CARD_SWATCHES && (
            <span className="text-[12px] font-medium tabular-nums text-ploy-ink/45">
              +{p.colors.length - CARD_SWATCHES}
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}

/**
 * ONE PICK, four call sites — colour aside, every choice in the panel is this button.
 *
 * Defined at module scope, not inside Panel: a component declared in a render body is a NEW
 * TYPE on every render, so React unmounts and remounts the whole row each keystroke — which
 * is what `react-hooks/static-components` exists to catch (§5).
 *
 * SHAPE SAYS KIND (§4). These are choices between options, so they carry a control's radius
 * and a control's border, and the live one FILLS rather than growing a second shape.
 */
function Pick({ on, ...rest }: { on: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={on}
      {...rest}
      className={
        "rounded-[var(--radius-control)] border px-3.5 py-1.5 text-[14px] font-medium transition-colors " +
        (on
          ? "border-ploy-ink bg-ploy-ink text-ploy-ground"
          : "border-ploy-ink/25 text-ploy-ink/70 hover:border-ploy-ink hover:text-ploy-ink")
      }
    />
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   THE PANEL — the configurator, in place
   ──────────────────────────────────────────────────────────────────────────── */

function Panel({
  p,
  shipping,
  specs,
  onClose,
}: {
  p: PublicProduct
  shipping: { extra: number } | null
  /** undefined = not read yet · [] = read, none published · rows = the chart. */
  specs: { size: string; spec: string; value: string }[] | undefined
  onClose: () => void
}) {
  const [colorIdx, setColorIdx] = useState<number | null>(null)
  const [size, setSize] = useState<string | null>(null)
  const [method, setMethod] = useState<string | null>(null)
  /** MULTI-SELECT, and the only one here: colour, size and technique are choices BETWEEN
   *  options; placement is not — a garment can carry a front and a back, which is exactly
   *  why it has a price. Empty means one print, which the base price already buys. */
  const [sides, setSides] = useState<string[]>([])
  const [allColors, setAllColors] = useState(false)

  const methods = techniquesOf(p.methods)
  const placements = p.sides ?? []
  const sideFee = Number(p.sideFee ?? 0) || 0

  /** A size with no tier of its own is charged the base — the same rule the server prices by. */
  const priceOfSize = (s: string | null) =>
    (s ? p.sizePrices?.find((t) => t.size === s)?.price : undefined) ?? p.price
  /** ZERO WHEN UNKNOWN, never a guess: a method the table has no entry for adds nothing,
   *  which is what methodAddOn() does too. */
  const addOn = (m: string | null) => {
    if (!m) return 0
    const key = normTech(m)?.key
    return (key && p.methodPrices?.[key]) || 0
  }
  const sidesAdd = sideFee > 0 ? sideFee * Math.max(0, sides.length - 1) : 0
  const base = size ? priceOfSize(size) : p.priceFrom ?? p.price
  const shown = base + addOn(method) + sidesAdd

  const chosen = colorIdx == null ? null : p.colors[colorIdx] ?? null
  const hero = chosen?.image ?? p.image

  /** The colourways that actually carry a photo — what the arrows step through. Stepping
   *  onto one without an image would blank the hero mid-browse. */
  const shots = p.colors.map((c, i) => (c.image ? i : -1)).filter((i) => i >= 0)
  const at = colorIdx == null ? -1 : shots.indexOf(colorIdx)
  const step = (d: number) => {
    if (!shots.length) return
    setColorIdx(shots[at < 0 ? (d > 0 ? 0 : shots.length - 1) : (at + d + shots.length) % shots.length])
  }

  /** The techniques in play: the picked one, or all of them while nobody has picked. */
  const inPlay = method && methods.includes(method) ? [method] : methods
  const guides = FILE_GUIDES.filter(
    (g) => g.methods.length === 0 || inPlay.some((m) => g.methods.some((k) => m.toUpperCase().includes(k))),
  )

  const specNames = [...new Set((specs ?? []).map((x) => x.spec))]
  const sizeNames = [...new Set((specs ?? []).map((x) => x.size))]
  const specAt = (z: string, n: string) => (specs ?? []).find((x) => x.size === z && x.spec === n)?.value ?? ""

  return (
    <div className="col-span-12 mt-2 overflow-hidden rounded-[26px] bg-ploy-paper">
      {/**
       * THREE COLUMNS, because two left half the band empty.
       *
       * The first cut gave the photograph `1fr` beside a 26rem column of picks. On a
       * full-bleed band that made the picture ~700px wide and ~875 tall, and the picks ran
       * out level with its middle — so the bottom-right quarter of an open product was blank
       * page, which is the exact complaint this rewrite exists to answer. A photo taking
       * every pixel it is offered is not the same as a photo that needed them.
       *
       * So the picture is capped, the picks keep their reading measure, and the prose that
       * used to sit UNDER the photo — the description, the file guidance, the size chart —
       * takes the third column instead of pushing the panel further down the page. Below lg
       * the three stack in that order, which is also the order they are wanted in.
       */}
      <div className="relative grid gap-8 p-6 md:gap-10 md:p-10 lg:grid-cols-[minmax(0,19rem)_minmax(0,24rem)_minmax(0,1fr)]">
        {/* The close belongs to the PANEL, not to a column — it was inside the picks header,
            which put it in the middle of the band once there were three of them. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full border border-ploy-ink/20 bg-ploy-paper text-ploy-ink/60 transition-colors hover:border-ploy-ink hover:text-ploy-ink"
        >
          ✕
        </button>
        {/* ── The picture ─────────────────────────────────────────────── */}
        <div className="min-w-0">
          {/* THE SAME FRAME AS THE CARDS, and for the same reason.
              This was 4/3 with `object-contain`, which letterboxed every portrait cut-out —
              a white garment on its own white background, with two grey rails down the sides
              where the page ground showed through. It reads as a broken image rather than a
              wide one. Cover at the card's own ratio crops almost nothing (the photography is
              already about this shape) and never produces a bar. */}
          <div className="relative aspect-[4/5] overflow-hidden rounded-[20px] bg-ploy-ground">
            {hero ? (
              <Image
                src={hero}
                alt={chosen ? `${p.name} — ${chosen.name}` : p.name}
                fill
                unoptimized
                sizes="(max-width:768px) 100vw, 45vw"
                className="object-cover"
                style={framingStyle(p)}
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-[13px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/35">
                Photo coming
              </div>
            )}
            {/* Only when there is somewhere to go: an arrow pair over one photo is a control
                that lies about having a next. */}
            {shots.length > 1 &&
              ([-1, 1] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => step(d)}
                  aria-label={d < 0 ? "Previous colour" : "Next colour"}
                  className={
                    "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-ploy-ground text-ploy-ink transition-transform hover:scale-105 " +
                    (d < 0 ? "left-3" : "right-3")
                  }
                >
                  {d < 0 ? "‹" : "›"}
                </button>
              ))}
          </div>

        </div>

        {/* ── The picks ───────────────────────────────────────────────── */}
        <div className="min-w-0">
          {(p.brand || p.category) && (
            <p className="pr-12 text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">
              {[p.brand, p.category].filter(Boolean).join(" · ")}
            </p>
          )}
          <h3 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{p.name}</h3>

          <div className="mt-5 border-y border-ploy-ink/12 py-5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              {/* "from" ONLY while no size is chosen. Once one is, this is not a range any
                  more — it is that size's price, and still hedging it would be a lie. */}
              {p.priceVaries && !size && (
                <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ploy-ink/45">from</span>
              )}
              <span className="text-[34px] font-semibold tabular-nums leading-none tracking-tight">
                {usd(shown)}
              </span>
              {size && <span className="text-[13px] font-semibold text-ploy-ink/55">for {size}</span>}
            </div>
            {shipping && <ShippingFees first={p.ship} extra={shipping.extra} tone="marketing" className="mt-3" />}
          </div>

          {p.colors.length > 0 && (
            <div className="mt-5">
              <div className="flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">
                <span>Colour · {p.colors.length}</span>
                {chosen && (
                  <span className="truncate text-[13px] normal-case tracking-normal text-ploy-ink">{chosen.name}</span>
                )}
              </div>
              {/* A GRID ON A FIXED TRACK, not a wrapping flex row: 82 swatches in flex-wrap
                  give every row a different count and a ragged right edge. */}
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,1.75rem)] gap-2.5">
                {(allColors ? p.colors : p.colors.slice(0, PANEL_SWATCHES)).map((c, i) => (
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
                        ? "border-ploy-ink/25 ring-2 ring-ploy-ink ring-offset-2 ring-offset-ploy-paper"
                        : "border-ploy-ink/20 hover:ring-2 hover:ring-ploy-ink/20 hover:ring-offset-2 hover:ring-offset-ploy-paper")
                    }
                    style={swatchChipStyle(c.name, c.image)}
                  />
                ))}
              </div>
              {p.colors.length > PANEL_SWATCHES && (
                <button
                  type="button"
                  onClick={() => setAllColors((v) => !v)}
                  className="mt-3 text-[13px] font-semibold underline underline-offset-4 text-ploy-ink/65 hover:text-ploy-ink"
                >
                  {allColors ? "Show fewer" : `Show all ${p.colors.length}`}
                </button>
              )}
            </div>
          )}

          {p.sizes.length > 0 && (
            <div className="mt-5">
              <div className="flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">
                <span>Size · {p.sizes.length}</span>
              </div>
              {/* THE SHARED LADDER, not the stored order. A live row reads
                  "S, M, XL, 3XL, 4XL, 2XL" — the order sizes happened to be entered — and
                  printing that raw puts 2XL after 4XL in a row of buttons somebody is
                  scanning for their own size. `bySize` is the same comparator the range
                  label above already uses, so the two cannot disagree (§5). */}
              <div className="mt-3 flex flex-wrap gap-2">
                {[...p.sizes].sort(bySize).map((s) => (
                  <Pick key={s} on={size === s} onClick={() => setSize(size === s ? null : s)}>
                    {s}
                    {p.priceVaries && (
                      <span className={"ml-2 text-[12px] tabular-nums " + (size === s ? "opacity-70" : "opacity-55")}>
                        {usd(priceOfSize(s))}
                      </span>
                    )}
                  </Pick>
                ))}
              </div>
            </div>
          )}

          {methods.length > 0 && (
            <div className="mt-5">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">
                Technique · {methods.length}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {methods.map((m) => (
                  <Pick key={m} on={method === m} onClick={() => setMethod(method === m ? null : m)}>
                    {m}
                    {addOn(m) > 0 && (
                      <span className={"ml-2 text-[12px] tabular-nums " + (method === m ? "opacity-70" : "opacity-55")}>
                        +{usd(addOn(m))}
                      </span>
                    )}
                  </Pick>
                ))}
              </div>
            </div>
          )}

          {placements.length > 1 && (
            <div className="mt-5">
              <div className="flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">
                <span>Placement · {placements.length}</span>
                {/* The first face is free, and that belongs on the heading rather than in a
                    sentence underneath it — §4 forbids prose under a control. */}
                {sideFee > 0 && (
                  <span className="normal-case tracking-normal text-ploy-ink/45">
                    {usd(sideFee)} per extra
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {placements.map((sd) => (
                  <Pick
                    key={sd}
                    on={sides.includes(sd)}
                    onClick={() => setSides(sides.includes(sd) ? sides.filter((x) => x !== sd) : [...sides, sd])}
                  >
                    {SIDE_LABEL[sd] ?? sd}
                  </Pick>
                ))}
              </div>
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-block rounded-full bg-ploy-ink px-6 py-2.5 text-[15px] font-medium text-ploy-ground"
            >
              Start free
            </Link>
            <Link
              href="/pricing"
              className="inline-block rounded-full border border-ploy-ink/30 px-6 py-2.5 text-[15px] font-medium"
            >
              See pricing
            </Link>
          </div>

        </div>

        {/* ── The notes: what to send, what it is, how big ─────────────── */}
        <div className="min-w-0">
          {guides.length > 0 && (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ploy-ink/45">
                What to send us{inPlay.length === 1 ? ` · ${inPlay[0]}` : ""}
              </p>
              <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {guides.map((g) => (
                  <div key={g.label}>
                    <dt className="text-[13px] font-semibold">{g.label}</dt>
                    <dd className="text-[13px] leading-relaxed text-ploy-ink/55">{g.body}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {p.description && (
            <p className="mt-6 max-w-prose border-t border-ploy-ink/12 pt-5 text-[13px] leading-relaxed text-ploy-ink/55">
              {p.description}
            </p>
          )}

          {/* THE SIZE CHART, where the sizes are — not a full section under a fold that most
              products cannot fill. Only S&S publishes a measurement feed, so the common case
              is no chart at all, and a heading over an apology is a section announcing its
              own emptiness. */}
          {specNames.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[22rem] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-ploy-ink/15 text-left">
                    <th className="py-2 pr-3 font-semibold">Size</th>
                    {specNames.map((n) => (
                      <th key={n} className="py-2 pr-3 font-semibold">{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sizeNames.map((z) => (
                    <tr key={z} className="border-b border-ploy-ink/8">
                      <td className="py-2 pr-3 font-semibold">{z}</td>
                      {specNames.map((n) => (
                        <td key={n} className="py-2 pr-3 tabular-nums text-ploy-ink/65">{specAt(z, n)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   THE PAGE
   ──────────────────────────────────────────────────────────────────────────── */

export function PloyProducts({
  products,
  shipping,
  initialSlug = null,
  headline,
  accent,
  lead,
}: {
  /** null means the read FAILED. [] means the catalogue is genuinely empty. §4 — those are
   *  different facts and the page says which. */
  products: PublicProduct[] | null
  /** The extra-item fee, from the same read as the products. The garment price without the
   *  postage beside it is the half of the answer that flatters us. */
  shipping: { extra: number } | null
  /**
   * A PRODUCT TO OPEN ON ARRIVAL — how /catalog/<slug> is served.
   *
   * That route used to render a whole second page in the old bold-kit, so a link shared
   * from this grid landed somebody on a different-looking site. It renders THIS page now,
   * with the product already open, which means one design and one set of behaviour however
   * you got here. The panel is in the first render rather than opened by an effect, so a
   * crawler and a cold visitor both receive the product in the HTML.
   */
  initialSlug?: string | null
  headline: string
  accent: string
  lead: string
}) {
  const [q, setQ] = useState("")
  const [method, setMethod] = useState("All")
  const [openSlug, setOpenSlug] = useState<string | null>(initialSlug)
  /** Size charts already read, by slug. A key present with `[]` means "asked, none
   *  published" — which is what stops a product without a chart being re-requested. */
  const [specs, setSpecs] = useState<Record<string, { size: string; spec: string; value: string }[]>>({})

  const all = useMemo(() => products ?? [], [products])

  const methodTabs = useMemo(
    () => ["All", ...normalizeMethods(all.flatMap((p) => p.methods ?? [])).map((m) => m.label)],
    [all],
  )

  /**
   * SEARCH ACROSS EVERYTHING A VISITOR MIGHT TYPE — the name, the brand, the category, the
   * techniques and the COLOUR NAMES. "navy" is a real thing to search a blanks catalogue
   * for, and a search that only matches the title makes the visitor learn our vocabulary.
   *
   * Never the sku or the blank: §2.9 withholds those from every unauthenticated surface,
   * and a field you can SEARCH is a field you have published.
   */
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter((p) => {
      if (method !== "All" && !normalizeMethods(p.methods ?? []).some((m) => m.label === method)) return false
      if (!term) return true
      const hay = [p.name, p.brand, p.category, ...(p.methods ?? []), ...p.colors.map((c) => c.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return hay.includes(term)
    })
  }, [all, q, method])

  /** Grouped by the catalogue's OWN categories, in the order they first appear, each opened
   *  by a display word. A group with nothing in it does not draw. */
  const groups = useMemo(() => {
    const by = new Map<string, PublicProduct[]>()
    for (const p of visible) {
      const k = p.category || "Other"
      const list = by.get(k)
      if (list) list.push(p)
      else by.set(k, [p])
    }
    return [...by.entries()]
  }, [visible])

  /**
   * OPENING IS AN EVENT — a click — and never an effect watching a list (§2.8). Nothing here
   * loads on scroll, on length, or on a page number, so there is no shape for a runaway
   * loader to take.
   *
   * The URL moves with `pushState` so a deep link still resolves and BACK closes the panel
   * rather than leaving the page — the static /catalog/<slug> route stays exactly as it is
   * and keeps serving crawlers and anyone who arrives on the link cold.
   */
  const open = useCallback((slug: string) => {
    setOpenSlug(slug)
    /**
     * PUSH ONCE, THEN REPLACE.
     *
     * Opening a second product while one is already open used to push again, so browsing
     * six blanks buried /catalog six entries deep and BACK walked you back through them one
     * at a time. Only the FIRST open is a navigation — after that the panel is a thing on
     * the page being retargeted, so the entry is replaced and Back always means "close".
     */
    const nested = !!window.history.state?.egCatalog
    const next = { ...(window.history.state ?? {}), egCatalog: slug }
    if (nested) window.history.replaceState(next, "", `/catalog/${slug}`)
    else window.history.pushState(next, "", `/catalog/${slug}`)
  }, [])
  /** Closing UNDOES the entry rather than adding another, so the history stays the length
   *  the visitor's own navigation made it. `popstate` is what actually clears the state —
   *  which is also what makes BACK and this button do exactly the same thing. */
  const close = useCallback(() => {
    if (window.history.state?.egCatalog) { window.history.back(); return }
    /* Arrived ON the product — /catalog/<slug> straight from a link or a search result —
       so there is no entry of ours to pop, and Back belongs to wherever they came from.
       The address has to come back to /catalog by itself or it would keep naming a product
       that is no longer open, which is the bug Escape used to have. */
    setOpenSlug(null)
    window.history.replaceState({}, "", "/catalog")
  }, [])

  /**
   * A COLD ARRIVAL LANDS ON THE MASTHEAD, not on the product it asked for.
   *
   * The panel is in the markup from the first render, but it can be several rows down, so
   * without this /catalog/<slug> opens at the top of the catalogue and the visitor has to
   * find the thing they clicked. Once, on mount, and never in response to a state change —
   * this reads the DOM and scrolls, it does not fetch, so there is nothing here that could
   * re-trigger itself (§2.8).
   */
  useEffect(() => {
    if (!initialSlug) return
    const t = setTimeout(() => {
      document.getElementById(`p-${initialSlug}`)?.scrollIntoView({ block: "start" })
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onPop = () => setOpenSlug(null)
    /* ESCAPE GOES THROUGH close(), not straight to state. It used to call setOpenSlug(null)
       itself, which shut the panel and left the address bar on a product that was no longer
       open — and the next Back then appeared to do nothing at all. */
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    window.addEventListener("popstate", onPop)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("popstate", onPop)
      window.removeEventListener("keydown", onKey)
    }
  }, [close])

  /**
   * THE ONE THING THAT IS FETCHED, and why it cannot loop.
   *
   * Everything the panel draws is already in the list payload. The supplier size chart is
   * not, deliberately — it costs a supplier call per product, so /api/public/products omits
   * it and the detail route adds it. It is read once per slug, on open.
   *
   * The condition is `a slug is open AND we have not asked for it yet`, and the fetch's own
   * result makes that FALSE — including on failure, which writes `[]` so a product with no
   * chart is never asked for twice. That is the direction §2.8 requires: a fetch must not be
   * able to re-satisfy the condition that started it.
   */
  useEffect(() => {
    if (!openSlug || specs[openSlug]) return
    let live = true
    getPublicProduct(openSlug)
      .then((r) => { if (live) setSpecs((s) => ({ ...s, [openSlug]: r.product.specs ?? [] })) })
      .catch(() => { if (live) setSpecs((s) => ({ ...s, [openSlug]: [] })) })
    return () => { live = false }
  }, [openSlug, specs])

  const openProduct = openSlug ? all.find((p) => p.slug === openSlug) ?? null : null

  return (
    <div className="bg-ploy-ground text-ploy-ink">
      {/* ── THE MASTHEAD ─────────────────────────────────────────────── */}
      <section className={`${GUTTER} ${TOP}`}>
        <h1 className="ploy-display text-[clamp(2.4rem,6vw,5rem)]">
          <motion.span {...reveal(0)} className="block">{headline}</motion.span>
          <motion.span {...reveal(0.1)} className="block">{accent}</motion.span>
        </h1>
        <motion.p {...reveal(0.2)} className="mt-6 max-w-xl text-[17px] leading-relaxed text-ploy-ink/70">
          {lead}
        </motion.p>
      </section>

      {/* ── THE BAR: a rule under the live word, never a tray of capsules ──
          §4 — tabs and filter rows are a rule under the live word, and the search sits on
          the same line because it filters the same list. The 190px sidebar this replaces
          cost more page than it saved on a catalogue of two dozen. */}
      <section className={`${GUTTER} ${SECTION}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-b border-ploy-ink/15 pb-3">
          <label className="flex min-w-[15rem] flex-1 items-center gap-2">
            <span aria-hidden className="text-[15px] text-ploy-ink/40">⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a garment, brand or colour"
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-ploy-ink/35"
            />
          </label>
          <div className="flex flex-wrap items-center gap-5">
            {methodTabs.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={
                  "relative pb-3 -mb-3 text-[14px] transition-colors " +
                  (method === m
                    ? "font-semibold text-ploy-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-ploy-ink"
                    : "text-ploy-ink/50 hover:text-ploy-ink")
                }
              >
                {m}
              </button>
            ))}
          </div>
          <span className="ml-auto shrink-0 text-[13px] tabular-nums text-ploy-ink/45">
            {products === null ? "—" : `${visible.length} of ${all.length}`}
          </span>
        </div>
      </section>

      {/* ── THE CATALOGUE ────────────────────────────────────────────── */}
      <section className={`${GUTTER} ${SECTION} pb-4`}>
        {products === null ? (
          <p className="max-w-md text-[16px] leading-relaxed text-ploy-ink/70">
            The catalogue could not be loaded just now. This is our end, not yours — the
            products are still there.{" "}
            <Link href="/contact" className="underline underline-offset-4">Tell us</Link> if it stays this way.
          </p>
        ) : all.length === 0 ? (
          <p className="max-w-md text-[16px] leading-relaxed text-ploy-ink/70">
            Nothing is published to the public catalogue yet.{" "}
            <Link href="/signup" className="underline underline-offset-4">Start free</Link> and you can
            order any blank the factory keeps.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-[16px] leading-relaxed text-ploy-ink/70">
            Nothing matches that.{" "}
            <button
              type="button"
              onClick={() => { setQ(""); setMethod("All") }}
              className="underline underline-offset-4"
            >
              Clear it
            </button>
            .
          </p>
        ) : (
          groups.map(([cat, list], gi) => (
            <div key={cat} className={gi === 0 ? "" : "mt-16"}>
              <div className="mb-6 flex items-baseline gap-3">
                <h2 className="ploy-display text-[clamp(1.6rem,3.2vw,2.8rem)]">{cat}</h2>
                <span className="text-[13px] tabular-nums text-ploy-ink/45">{list.length}</span>
              </div>

              {packRows(list).map((row, ri) => {
                const openHere = row.some((c) => c.item.slug === openSlug)
                return (
                  <div
                    key={ri}
                    id={row.map(({ item }) => item.slug).includes(openSlug ?? "") ? `p-${openSlug}` : undefined}
                    className="mb-4 grid scroll-mt-24 grid-cols-12 gap-4 md:mb-6 md:gap-6"
                  >
                    {row.map(({ item }) => (
                      <Card
                        key={item.slug}
                        p={item}
                        open={item.slug === openSlug}
                        onOpen={() => (item.slug === openSlug ? close() : open(item.slug))}
                      />
                    ))}
                    <AnimatePresence initial={false}>
                      {openHere && openProduct && (
                        <motion.div
                          key={openProduct.slug}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.42, ease: [0.22, 0.68, 0, 1] }}
                          className="col-span-12 overflow-hidden"
                        >
                          <Panel
                            p={openProduct}
                            shipping={shipping}
                            specs={specs[openProduct.slug]}
                            onClose={close}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
