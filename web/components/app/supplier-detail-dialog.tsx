"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { CircleNotch, Plus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getSsStyle, getOttoStyle, getSanmarCatalogStyle } from "@/lib/api"
import { colorHex, prettyColorName } from "@/lib/color-name"
import { descriptionLines } from "@/lib/description"
import { bySize } from "@/lib/size-order"

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
  /** The style code a person uses — "5000", "PC61". NOT the key this window fetches by:
   *  S&S's is an internal row id, so the two differ for exactly one of the three suppliers. */
 styleNo?: string | null
 brand?: string | null
 category?: string | null
 description?: string | null
 image?: string | null
 colors: string[]
 sizes: string[]
 colorImages: Record<string, string>
  /** The OTHER angles of each colourway — back, side, on-model — keyed by colour. */
 colorExtras?: Record<string, string[]>
  /** Style-level gallery, for when no colour is chosen yet. */
 extraImages?: string[]
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
   * fetch lands — opening onto a spinner for a style you can already see is a step
   * backwards from the tile you clicked. */
 seed?: { name?: string | null; brand?: string | null; image?: string | null; price?: string | null; styleNo?: string | null }
 onOrder?: () => void
 onAddToCatalog?: () => void
 added?: boolean
  /** Put THIS variant in the purchasing cart. Given the choices made in this window, so
   * nothing has to be re-picked on the way out. */
 onAddToCart?: (sel: { colour: string | null; size: string | null; qty: number }) => void
}) {
  const tl = useLabelT()
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
  /** Which angle of the current colourway is on screen. Cleared with the colour. */
 const [frame, setFrame] = useState<string | null>(null)

 useEffect(() => {
 if (!open || !supplier || !styleId) return
 let alive = true
 const t = setTimeout(() => {
 setD(null); setErr(null); setColour(null); setSize(null); setQty(1); setFrame(null)
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
            // S&S answers with styleName/partNumber; Otto and SanMar are already keyed by
            // their real style code, so for them the fetch key IS the number.
 styleNo: (raw.styleName as string) || (raw.partNumber as string) || (supplier === "ss" ? null : styleId),
 brand: (raw.brand as string) ?? seed?.brand ?? null,
 category: (raw.category as string) ?? null,
 description: (raw.description as string) ?? null,
 image: (raw.image as string) ?? seed?.image ?? null,
 colors: Array.isArray(raw.colors) ? (raw.colors as string[]) : [],
 sizes: Array.isArray(raw.sizes) ? (raw.sizes as string[]) : [],
 colorImages: (raw.colorImages as Record<string, string>) ?? {},
 colorExtras: (raw.colorExtras as Record<string, string[]>) ?? undefined,
 extraImages: Array.isArray(raw.extraImages) ? (raw.extraImages as string[]) : undefined,
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

  // The card already knows the number for S&S, so the header doesn't have to wait on the
  // fetch to stop being wrong — and once the detail lands, its own value wins.
 const styleNo = d?.styleNo || seed?.styleNo || (supplier === "ss" ? null : styleId)

  /**
   * EVERY ANGLE OF WHAT YOU ARE LOOKING AT.
   *
   * A cap photographed head-on tells you almost nothing about the back, which on a trucker
   * or a snapback is half the product — and the supplier sends those shots per colourway, so
   * the only reason they weren't here is that we flattened them (see colorExtras in ss.js).
   *
   * Scoped to the CHOSEN colour: the angles of a colour you did not pick are noise, and
   * mixing them would put a black back-view under a red cap. Before a colour is chosen it
   * falls back to the style's own gallery.
   */
 const frames = (() => {
 const front = (colour && (d?.colorImages ?? {})[colour]) || d?.image || seed?.image || null
 const extras = colour ? (d?.colorExtras ?? {})[colour] ?? [] : (d?.extraImages ?? [])
 return Array.from(new Set([front, ...extras].filter((x): x is string => !!x)))
  })()
  // The frame you clicked, else the first — which is the colour's front, or the style photo.
  // `frame` is cleared whenever the colour changes, so it can never show the previous
  // colourway's back panel next to the new colour's name.
 const shown = (frame && frames.includes(frame) ? frame : frames[0]) ?? null

 return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/**
        * WIDTH SET BY WHAT IS IN IT, which is not much: a size run, a palette, one number.
        *
        * 3xl with a 22rem photo squeezed the colours to three per row and truncated every
        * compound name. 5xl fixed that and broke the other way — the panel ran out of content
        * halfway across and left the photo looking like a stamp in a field of white.
        *
        * 4xl with a 20rem photo is the middle: the picture is big enough to judge a blank by,
        * the swatches get six or seven to a row, and the content reaches the edge instead of
        * trailing off.
        */}
      <DialogContent className="sm:max-w-4xl">
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
              <span className="block truncate eg-label text-muted-foreground">
                {d?.brand || seed?.brand}
              </span>
            )}
            <span className="block truncate text-base font-semibold leading-tight">
              {d?.name || seed?.name || styleId}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-xs font-normal text-muted-foreground">
              {/**
                * THE NUMBER ON THE SPEC SHEET, not the one in their database.
                *
                * `styleId` is what every fetch in this window is keyed by, and for S&S that is
                * an INTERNAL row id — so a Gildan 5000 introduced itself as "16", a number
                * that appears on no label, no spec sheet and no purchase order. Otto and
                * SanMar key by the real style code, which is why only S&S read wrong.
                *
                * Falls back to the id rather than showing nothing: an unfamiliar number still
                * tells you two products apart, and a blank gap doesn't.
                */}
              <span>{[SUPPLIER_NAME[supplier], styleNo, d?.category].filter(Boolean).join(" · ")}</span>
              {seed?.price && <span className="font-semibold text-foreground">{seed.price}</span>}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-start">
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
          <div className="space-y-2 md:sticky md:top-0">
            <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-white">
              {shown ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown} alt="" className="absolute inset-0 size-full object-contain" />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground/60">{tl("supplierDetail", "No image")}</div>
              )}
            </div>
            {/* The other angles of THIS colourway. A cap head-on says nothing about the back,
 which on a trucker or a snapback is half the product. Only shown when there is
 more than one — a single thumbnail under a photo of the same thing is furniture. */}
            {frames.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {frames.map((u) => (
                  <button
 key={u}
 type="button"
 onClick={() => setFrame(u)}
 aria-label={tl("supplierDetail", "Show this angle")}
 aria-pressed={u === shown}
 className={"relative size-14 shrink-0 overflow-hidden rounded-md border bg-white transition-colors "
                      + (u === shown ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-foreground/25")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="absolute inset-0 size-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-3 text-sm">
            {err && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}

            {/* Brand, name, supplier and price all live in the header now — this column is
 the description and the variant choice, and nothing else. */}
            {!d && !err && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleNotch size={13} className="animate-spin" /> {tl("supplierDetail", "Loading the rest…")}
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
                      {/* Sorted — a supplier hands these back in feed order, and a row of
                          size buttons that is not a size run is read as a mistake before it
                          is read as a choice. */}
                      {[...d.sizes].sort(bySize).map((z) => (
                        <button
 key={z}
 type="button"
 onClick={() => setSize(z === size ? null : z)}
                          // Sized to be HIT as well as read. These were 10px text in a 2px
                          // pad — a target you aim at, on the control you are here to use.
 className={"min-w-9 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors "
                            + (z === size ? "border-selected eg-selected" : "border-border hover:bg-muted")}
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
 onClick={() => { setColour(c === colour ? null : c); setFrame(null) }}
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
 : { background: colorHex(c) }}
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
                  * THE VARIANT YOU CLICKED, AND ONLY THAT.
                  *
                  * This listed every colourway with its sizes — fourteen rows of numbers under
                  * a style with fourteen colours. Every figure was true and the block was
                  * useless: a wall of quantities for thirteen variants nobody had asked about,
                  * pushing the actual controls off the bottom of the panel.
                  *
                  * Stock is a question you ask about a specific thing. So it answers when you
                  * have named one — pick a colour and it shows that colourway's sizes, pick a
                  * size too and it is a single number. Before that it says nothing, because
                  * there is nothing yet to be asked about.
                  *
                  * The per-colour total still lives on each swatch's tooltip, which is where
                  * you look while choosing rather than after.
                  */}
                {d.stockByColor && colour && (
                  <Section label={tl("supplierDetail", "Stock")}>
                    {(() => {
 const bySize = d.stockByVariant?.[colour] ?? {}
 const entries = Object.entries(bySize)
 if (!entries.length) return <span className="text-muted-foreground">{tl("supplierDetail", "No figures for this colourway.")}</span>
                      // A size chosen as well: one number, no labels. Nothing else is in
                      // question, and the colour and size are both lit up above.
 if (size) {
 const n = bySize[size]
                        // NO STRIKETHROUGH ON A ZERO. A struck-out number reads as "this
                        // figure is void", when the figure is the answer: there are none.
                        // Colour carries it instead — the number stays legible.
 return n == null
                          ? <span className="text-muted-foreground">Not offered in {size}.</span>
 : <span className={"text-lg font-semibold tabular-nums " + (n > 0 ? "" : "text-hold")}>{n.toLocaleString()}</span>
                      }
 return (
                        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          {entries.map(([z, n]) => (
                            <span key={z} className="tabular-nums">
                              <span className="text-muted-foreground">{z} </span>
                              <span className={"font-medium " + (n > 0 ? "" : "text-hold")}>{n.toLocaleString()}</span>
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
 aria-label={tl("supplierDetail", "Quantity")}
 className="h-9 w-16 rounded-lg border border-border bg-card px-2.5 text-sm tabular-nums"
                  />
                  <Button size="sm" className="h-9" onClick={() => onAddToCart({ colour, size, qty })}>
                    {tl("supplierDetail", "Add to cart")}
                  </Button>
                </div>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
              {onOrder && (
                <Button size="sm" variant="outline" className="h-9" onClick={onOrder}>
                  {tl("supplierDetail", "Order")}
                </Button>
              )}
              {onAddToCatalog && (
                <Button size="sm" variant="outline" className="h-9" onClick={onAddToCatalog} disabled={added}>
                  <Plus size={14} weight="bold" /> {added ? tl("supplierDetail", "In Products") : tl("supplierDetail", "Add to Products")}
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
      <div className="eg-label text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}
