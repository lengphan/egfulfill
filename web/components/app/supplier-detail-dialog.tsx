"use client"

import { useEffect, useState } from "react"
import { CircleNotch, ShoppingCart, Plus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getSsStyle, getOttoStyle, getSanmarCatalogStyle } from "@/lib/api"
import { swatchHex } from "@/components/app/products-catalog"
import { descriptionLines } from "@/lib/description"
import { prettyColorName } from "@/lib/color-name"

/**
 * ONE BLANK, IN FULL — the catalogue tile's picture is a thumbnail of a decision.
 *
 * A grid tile answers "is this roughly the thing"; it cannot answer "will this do", which is
 * what you actually need before putting a style on a purchase order. The colour it happens
 * to be photographed in is not the colour you want, the sizes are a count rather than a
 * list, and the description — where the fabric weight and the fit live — is not on the card
 * at all. Until now the only way to see any of that was to open the supplier's own site,
 * which means leaving, searching again, and reading it in their layout.
 *
 * All three suppliers return the same shape once you ask for a style — name, brand, category,
 * description, colours, sizes, per-colour images — so this is one window, not three. Which
 * fetcher runs is the only thing that differs.
 */

type Supplier = "ss" | "otto" | "sanmar"

/** The common shape the three detail endpoints collapse to. */
type Detail = {
  name: string
  brand?: string | null
  category?: string | null
  description?: string | null
  image?: string | null
  colors: string[]
  sizes: string[]
  colorImages: Record<string, string>
  skus: number
  /** null = we never asked (Otto / SanMar). {} = asked and the style has none. */
  stockByColor?: Record<string, number> | null
  stockByVariant?: Record<string, Record<string, number>> | null
}

const SUPPLIER_NAME: Record<Supplier, string> = { ss: "S&S Activewear", otto: "Otto Cap", sanmar: "SanMar" }

/**
 * THE SPEC LINES COME FROM lib/description.ts — there is one splitter, not two.
 *
 * This file had its own, and its own was wrong. It stripped every tag to a space first,
 * destroying the <p>/<li> boundaries the supplier actually sent, then GUESSED them back from
 * capitalisation with `(?<=[a-z%)])\s+(?=[A-Z][a-z])` — which breaks before any capitalised
 * word. "95% Cotton" became "95%" / "Cotton"; "Soft Crown" became "Soft" / "Crown". Every
 * feature was cut into single words, one per row, which is exactly what the dialog showed.
 *
 * descriptionLines() already turns block tags into line breaks BEFORE stripping them, splits
 * inline bullet glyphs (SanMar sends "LIMITED EDITION • 5 oz./yd² • Regular fit" with no tags
 * at all), and handles the labelled clauses S&S glues on with no separator. The product
 * editor has been using it the whole time — which is why the same description read correctly
 * there and as a column of words here.
 *
 * CLAUDE.md §5: import shared logic, never re-derive it. This was the third private copy.
 */
const specLines = descriptionLines

export function SupplierDetailDialog({
  open, onOpenChange, supplier, styleId, seed, onOrder, onAddToCatalog, added, onAddToCart,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  supplier: Supplier | null
  styleId: string | null
  /** What the card already knows, shown immediately so the window has content before the
   *  fetch lands — opening onto a spinner for a style you can already see is a step
   *  backwards from the tile you clicked. */
  seed?: { name?: string | null; brand?: string | null; image?: string | null; price?: string | null }
  onOrder?: () => void
  onAddToCatalog?: () => void
  added?: boolean
  /** Put THIS variant in the purchasing cart. Given the choices made in this window, so
   *  nothing has to be re-picked on the way out. */
  onAddToCart?: (sel: { colour: string | null; size: string | null; qty: number }) => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [colour, setColour] = useState<string | null>(null)
  /**
   * THE VARIANT AND HOW MANY, decided here rather than back on the grid.
   *
   * This window is where you work out that it IS the right blank — the colour, the size run,
   * the fabric. Sending you back to a tile to press Order, and re-choosing the colour you
   * just chose here, is the pointless half of that journey.
   */
  const [size, setSize] = useState<string | null>(null)
  const [qty, setQty] = useState(1)

  useEffect(() => {
    if (!open || !supplier || !styleId) return
    let alive = true
    const t = setTimeout(() => {
      setD(null); setErr(null); setColour(null); setSize(null); setQty(1)
      const fetcher =
        supplier === "ss" ? getSsStyle(styleId)
          : supplier === "otto" ? getOttoStyle(styleId)
            : getSanmarCatalogStyle(styleId)
      fetcher
        .then((r) => {
          if (!alive) return
          const raw = r as Record<string, unknown>
          if (raw?.error) { setErr(String(raw.error)); return }
          setD({
            name: String(raw.name ?? raw.title ?? seed?.name ?? styleId),
            brand: (raw.brand as string) ?? seed?.brand ?? null,
            category: (raw.category as string) ?? null,
            description: (raw.description as string) ?? null,
            image: (raw.image as string) ?? seed?.image ?? null,
            colors: Array.isArray(raw.colors) ? (raw.colors as string[]) : [],
            sizes: Array.isArray(raw.sizes) ? (raw.sizes as string[]) : [],
            colorImages: (raw.colorImages as Record<string, string>) ?? {},
            skus: Array.isArray(raw.skus) ? (raw.skus as string[]).length : 0,
            // ABSENT MEANS UNKNOWN, NOT ZERO. Only S&S returns these — Otto and SanMar keep
            // no quantity in our data, and asking them costs a live call per sku / per style.
            // Defaulting the missing case to 0 would print "Out of stock" over two suppliers
            // we never asked, which is the one thing worse than not showing a number.
            stockByColor: (raw.stockByColor as Record<string, number>) ?? null,
            stockByVariant: (raw.stockByVariant as Record<string, Record<string, number>>) ?? null,
          })
        })
        .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Couldn't load this blank.") })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier, styleId])

  if (!open || !supplier || !styleId) return null

  // The colour you picked wins; otherwise the style's own photo. Falling back to the first
  // colour image would show a colour nobody chose, which is the mistake this window exists
  // to prevent on a purchase order.
  const shown = (colour && (d?.colorImages ?? {})[colour]) || d?.image || seed?.image || null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* WIDER, because the right-hand column is doing real work now — a size run, a palette
          of fourteen named swatches, and a per-variant stock table. At 3xl with a 22rem
          image beside it, the colours fell to three per row and every compound Otto name
          ("Navy/White", "Black/Dark Green") truncated to "Navy/W…", which is not a name. */}
      <DialogContent className="sm:max-w-5xl">
        {/**
          * THE PRODUCT IDENTIFIES ITSELF ONCE, AT THE TOP.
          *
          * Brand, then name, then the codes underneath — the order you'd read it on a spec
          * sheet, and the order that tells you what the thing IS before what it is called.
          * The box icon is gone: it was the same glyph on every product, so it identified
          * nothing and only pushed the name along.
          *
          * All of this used to be repeated in the right-hand column above the description,
          * which meant the name was on screen twice and the panel that should be about
          * CHOOSING opened with facts you had already read in the title bar.
          */}
        <DialogHeader>
          <DialogTitle className="min-w-0 space-y-0.5">
            {(d?.brand || seed?.brand) && (
              <span className="block truncate text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {d?.brand || seed?.brand}
              </span>
            )}
            <span className="block truncate text-base font-semibold leading-tight">
              {d?.name || seed?.name || styleId}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-xs font-normal text-muted-foreground">
              <span>{[SUPPLIER_NAME[supplier], styleId, d?.category].filter(Boolean).join(" · ")}</span>
              {seed?.price && <span className="font-semibold text-foreground">{seed.price}</span>}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:items-start">
          {/**
            * THE PHOTO STOPS CLAIMING A COLUMN IT DOESN'T FILL.
            *
            * It was a 22rem box at 4:5 with object-contain, so a cap — wide and short —
            * floated in the middle of a tall white rectangle, and the column beneath it stayed
            * empty for the whole height of the palette and the stock table. That is the blank
            * space: a fixed tall frame next to a variable tall panel.
            *
            * Square is closer to the shape of the things in it, 17rem gives the width back to
            * the column doing the work, and `sticky` keeps the picture beside whichever colour
            * you scroll to instead of leaving a long empty gutter under it.
            */}
          <div className="md:sticky md:top-0">
            <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-white">
              {shown ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown} alt="" className="absolute inset-0 size-full object-contain" />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground/60">No image</div>
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-3 text-sm">
            {err && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}

            {/* Brand, name, supplier and price all live in the header now — this column is
                the description and the variant choice, and nothing else. */}
            {!d && !err && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleNotch size={13} className="animate-spin" /> Loading the rest…
              </div>
            )}

            {d && (
              <>
                {specLines(d.description).length > 0 && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto pr-1 text-xs leading-relaxed text-muted-foreground">
                    {specLines(d.description).map((l, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                        <span className="min-w-0">{l}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Sizes as a LIST, not a count. "12 sizes" doesn't tell you whether it goes
                    to 4XL, which is the question actually being asked. */}
                {/* Sizes are PICKABLE, for the same reason the colours are: this is where
                    the choice is being made. Still a full list, so "does it reach 4XL" is
                    answered by looking rather than by counting. */}
                <Section label={`Sizes${d.sizes.length ? ` (${d.sizes.length})` : ""}`}>
                  {d.sizes.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {d.sizes.map((z) => (
                        <button
                          key={z}
                          type="button"
                          onClick={() => setSize(z === size ? null : z)}
                          // Sized to be HIT as well as read. These were 10px text in a 2px
                          // pad — a target you aim at, on the control you are here to use.
                          className={"min-w-9 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors "
                            + (z === size ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
                        >
                          {z}
                        </button>
                      ))}
                    </span>
                  ) : "—"}
                </Section>
                {/* Names ran together into an unreadable line — "016 - White · 017 - Dk.
                    Green · 021 - Green · 030 - Sky Blue…" is fourteen facts in one sentence.
                    They are chips now: the ones with a photo show it, the rest show their
                    colour, and every one of them changes the picture. The name is on hover
                    and on the selected chip, which is the only moment it matters. */}
                <Section label={`Colours${d.colors.length ? ` (${d.colors.length})` : ""}`}>
                  {d.colors.length ? (
                    <span className="flex flex-wrap gap-x-2 gap-y-2">
                      {d.colors.map((c) => (
                        <span key={c} className="flex w-[4.5rem] flex-col items-center gap-1">
                        <button
                          type="button"
                          title={d.stockByColor ? `${c} — ${d.stockByColor[c] ?? 0} in stock at the supplier` : c}
                          onClick={() => setColour(c === colour ? null : c)}
                          // NOT dimmed by stock. Fading the unavailable ones washed out the
                          // whole palette — seventeen pale blobs that read as "this widget is
                          // broken" rather than "these colours are short", and it hid the very
                          // thing a swatch exists to show: the colour. Stock is a number, and
                          // it belongs on the line below, in words.
                          /**
                           * BIGGER, AND ZOOMED INTO THE GARMENT.
                           *
                           * These were 24px showing the WHOLE product photo — which on a
                           * studio shot is mostly white backdrop, so seventeen swatches read
                           * as seventeen white circles with a speck in the middle. A swatch
                           * exists to show the COLOUR, so the picture is scaled up and pulled
                           * to the body of the garment. Same treatment the product card
                           * already uses (260% at center 42%).
                           */
                          className={"relative size-9 shrink-0 overflow-hidden rounded-full border-2 bg-muted transition-transform hover:scale-110 "
                            + (c === colour ? "border-primary ring-2 ring-primary/40" : "border-black/15")}
                          style={d.colorImages[c]
                            ? { backgroundImage: `url("${d.colorImages[c]}")`, backgroundSize: "260%", backgroundPosition: "center 42%" }
                            : { background: swatchHex(c) }}
                        />
                        {/* THE NAME UNDER THE SWATCH. It was on hover and on the selected chip
                            only, so reading the palette meant pointing at each circle in turn
                            — and a zoomed crop of a garment is not always enough to tell
                            Charcoal from Black. Supplier codes are prettified ("031753A -
                            Blk/Dk.Grn" → the readable half) and truncated; the full string
                            stays on the button's title. */}
                        {/* TWO LINES, NOT AN ELLIPSIS. Otto names are compound — "Navy/White",
                            "Black/Dark Green", "Khaki/Navy" — and a single truncated line
                            turned three different colourways into "Navy/W…", "Navy/Da…" and
                            "Navy/Kh…", which distinguishes nothing. Wrapping keeps the part
                            that actually differs visible. */}
                        <span
                          className={"line-clamp-2 w-full break-words text-center text-2xs leading-tight " + (c === colour ? "font-medium text-foreground" : "text-muted-foreground")}
                          title={c}
                        >
                          {prettyColorName(c)}
                        </span>
                        </span>
                      ))}
                    </span>
                  ) : "—"}
                </Section>
                {/* "Orderable skus 24" is colours × sizes — a number already implied by the
                    two rows above it, and not one anybody acts on. Removed rather than kept
                    for completeness. */}
                {/**
                  * SUPPLIER STOCK, from the rows this dialog already fetched.
                  *
                  * Costs no extra request: `qty` rides along in the same S&S product feed the
                  * colours and sizes come from, so this is a sum, not a lookup.
                  *
                  * Shown ONLY when we actually asked. Otto and SanMar keep no quantity in our
                  * data, so the field is absent for them and this row does not render at all —
                  * far better than a confident "0" over a supplier nobody queried.
                  *
                  * Picking a colour narrows it to that colourway's sizes, because "480 in
                  * stock" across a style is not an answer to "can you make six 2XL".
                  */}
                {/**
                  * PER VARIANT — a colourway and a size, which is the thing actually ordered.
                  *
                  * "6,949 at the supplier, across 3 colours" is true and useless: nobody buys
                  * a style, they buy Black / XS, and a grand total hides the one size that is
                  * empty. One row per colour, its sizes along it, so the gap is visible where
                  * it matters rather than averaged away.
                  *
                  * Picking a colour narrows to that row; picking a size dims the others so the
                  * column you care about stands out without the rest disappearing — what a
                  * neighbouring size holds is exactly what you check before changing the pick.
                  */}
                {d.stockByColor && (
                  <Section label="Stock">
                    {(() => {
                      const rows = Object.entries(d.stockByVariant ?? {}).filter(([c]) => !colour || c === colour)
                      if (!rows.length) return <span className="text-muted-foreground">No per-variant figures for this style.</span>
                      /**
                       * SAY EACH THING ONCE.
                       *
                       * The colour name is under its swatch now, and the size list is its own
                       * row above — so repeating both here turned "521" into "Grey · One Size
                       * 521", three labels around one number.
                       *
                       * Each label earns its place only when it distinguishes something: the
                       * colour when more than one row is shown, the size when the style has
                       * more than one. A single-size style in a chosen colour is just the
                       * number, sitting next to the word Stock, which is all it ever was.
                       */
                      const manyColours = rows.length > 1
                      const manySizes = d.sizes.length > 1
                      return (
                        <span className="flex flex-col gap-1">
                          {rows.map(([c, bySize]) => (
                            <span key={c} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              {manyColours && <span className="w-20 shrink-0 truncate text-muted-foreground">{prettyColorName(c)}</span>}
                              {Object.entries(bySize).map(([z, n]) => (
                                <span
                                  key={z}
                                  className={"tabular-nums " + (size && z !== size ? "text-muted-foreground/45" : n > 0 ? "font-medium text-foreground" : "text-muted-foreground line-through")}
                                  title={`${c} / ${z}`}
                                >
                                  {manySizes && <span className="font-normal text-muted-foreground">{z} </span>}
                                  {n.toLocaleString()}
                                </span>
                              ))}
                            </span>
                          ))}
                        </span>
                      )
                    })()}
                  </Section>
                )}
              </>
            )}

            {/**
              * THE ACTION BAR — grouped by what each control belongs TO, and one height.
              *
              * Everything was a flat wrap of four items at three different heights: a 32px
              * number box, then buttons that broke to a second line whenever the column was
              * narrow, so "Add to Products" ended up stranded underneath looking like a
              * different section. That is the awkwardness — no grouping and no baseline.
              *
              * Quantity belongs to Add to cart, so those two sit together as one unit. Order
              * and Add to Products do something else with the same blank, so they go to the
              * far end. Everything is h-9, which is the app's input height, so the number box
              * and the buttons finally line up.
              *
              * WEIGHTS STILL DIFFER, deliberately: buying stock and listing a product for sale
              * are not the same decision, and two identical purple buttons invite the wrong
              * one. Add to cart is filled; the others are outlined.
              */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {onAddToCart && (
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} value={qty}
                    onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    aria-label="Quantity"
                    className="h-9 w-16 rounded-lg border border-border bg-card px-2.5 text-sm tabular-nums"
                  />
                  <Button size="sm" className="h-9" onClick={() => onAddToCart({ colour, size, qty })}>
                    <ShoppingCart size={14} weight="bold" /> Add to cart
                  </Button>
                </div>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
              {onOrder && (
                <Button size="sm" variant="outline" className="h-9" onClick={onOrder}>
                  <ShoppingCart size={14} weight="bold" /> Order
                </Button>
              )}
              {onAddToCatalog && (
                <Button size="sm" variant="outline" className="h-9" onClick={onAddToCatalog} disabled={added}>
                  <Plus size={14} weight="bold" /> {added ? "In Products" : "Add to Products"}
                </Button>
              )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One block of the variant panel — caption above, content beneath it, full width.
 *
 * These were label-and-value ROWS: a fixed 112px column of grey text on the left, the control
 * squeezed into whatever was left on the right. That layout suits short values, and none of
 * these are short — a size run, a palette of swatches with names under them, a per-variant
 * stock table. Everything fought for the same half-width gutter while the label column sat
 * mostly empty beside it.
 *
 * Reading down beats reading across here: the caption is small and quiet, the content gets
 * the whole width, and the three blocks stack instead of interleaving. It also removes the
 * rules that were drawing double lines against the action row.
 */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}
