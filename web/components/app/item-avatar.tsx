"use client"

import { useState } from "react"
import Image from "next/image"
import { Package, ArrowsLeftRight, PencilSimple, MagnifyingGlassPlus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { bestMockup, resolveProduct } from "@/lib/variant-resolve"
import { designSrc } from "@/lib/order-image"
import type { CatalogProduct, DesignPos, OrderDesign, OrderItem } from "@/lib/api"
import { OrderedVariant } from "@/components/app/ordered-variant"

/**
 * The ONE item avatar, shared by the seller order list, the order detail, and all three
 * factory boards.
 *
 * It shows what will be MADE — the blank mockup with the artwork composited on top at its
 * stored position — not the marketplace listing photo. A production board that shows the
 * listing photo is showing the buyer's view of a product, which tells the floor nothing
 * about what to print.
 *
 * The composite is plain CSS layering (a positioned <img> over the mockup) rather than a
 * canvas, because this renders once per line on a 50-row board. Canvas compositing belongs
 * in the editor, where there's one of them.
 *
 * Two jobs, deliberately split:
 *  - VERIFY is the common case — every row, every role, constantly. It costs zero clicks:
 *    the avatar is already correct.
 *  - AUTHOR is rare and role-gated. `onEdit` is only passed where repositioning is the
 *    person's job (seller, operator, admin); everyone else gets a zoom preview.
 *
 * The swap button reveals on hover/focus (and is always visible on touch, which has no
 * hover) so a long board isn't littered with one control per row.
 */

export type ItemAvatarProps = {
  item: OrderItem
  /** The order's designs, keyed by sku — from `getOrderDesigns`. */
  designs?: Record<string, OrderDesign> | null
  catalog?: CatalogProduct[]
  size?: number
  /** Passed only where the viewer may reposition artwork. Absent → click opens the preview. */
  onEdit?: () => void
  /** Renders the composite alone — no click, no swap, no preview. For decorative stacks
   *  (a row's 3-up thumbnail cluster) where a control per thumb would be noise. */
  readOnly?: boolean
  /** Show the buyer's LISTING photo on the thumbnail, and put the artwork behind a click.
   *
   *  For the row-level photo strip. At 32px a composite is unreadable anyway — you get a
   *  smudge of artwork over a smudge of blank — whereas the listing photo is the shot that
   *  was styled to be legible small, so it's the better row-scanning image. The production
   *  view isn't lost, it moves one click away: the preview opens on the DESIGN when there
   *  is one, which is where you'd actually inspect placement.
   *
   *  Falls back to the composite when a line has no listing photo, so a manual order still
   *  shows something real rather than an empty tile. */
  listingFirst?: boolean
  /** Accept artwork dropped straight onto the thumb. Passed wherever a design can be
   *  attached — one handler here covers every surface that renders an item. */
  onDropImage?: (dataUrl: string, file: File) => void
  /** Drop the frame. A row's PRIMARY photo is the picture itself — a border around a
   *  small image reads as a chip, and a stack of them reads as a strip of chips rather
   *  than as the products. Kept as an opt-in so the 44px avatars inside an expanded line,
   *  where the tile IS a control, still look like one. */
  bare?: boolean
  className?: string
}

/**
 * The blank the artwork sits on — and whether it is REALLY the blank.
 *
 * `url` falls back to the listing photo, which keeps a manual order from rendering an empty
 * tile. But that fallback is a quiet lie on a production surface: a blank with no mockup put
 * the BUYER'S photo in the "what we'll print" position, on a component whose entire premise
 * is that it never shows the listing photo. The floor then sees a rack of aprons captioned as
 * the thing to make, with nothing anywhere saying the chosen blank has no picture.
 *
 * `missing` is that fact, kept separate so the caller can say it out loud instead — CLAUDE.md
 * §4: an empty state must never be indistinguishable from a broken one.
 */
function blankOf(item: OrderItem, catalog?: CatalogProduct[]): { url: string; missing: boolean } {
  const p = catalog?.length ? resolveProduct(item, catalog) : null
  // No fallback — this is the blank's OWN imagery or nothing.
  const own = bestMockup(p, item.color, "")
  return { url: own || item.img || "", missing: !!p && !own }
}

export function ItemAvatar({ item, designs, catalog, size = 44, onEdit, readOnly, listingFirst, onDropImage, bare, className }: ItemAvatarProps) {
  const [preview, setPreview] = useState(false)
  const [showListing, setShowListing] = useState(false)
  const [over, setOver] = useState(false)

  /** Drop artwork straight onto the thumb — the shortest path from a file to the item it
   *  belongs to. Ignores anything that isn't an image so dragging a row doesn't trigger it. */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false)
    if (!onDropImage) return
    const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"))
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onDropImage(String(reader.result || ""), file)
    reader.readAsDataURL(file)
  }
  const dropProps = onDropImage
    ? {
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(true) },
        onDragLeave: () => setOver(false),
        onDrop: handleDrop,
      }
    : {}

  const design = designs && item.sku ? designs[item.sku] : null
  const art = designSrc(design?.data) || designSrc(item.design_src)
  const { url: blank, missing: blankMissing } = blankOf(item, catalog)
  const listing = item.img || ""
  // Only worth offering the swap when the two views actually differ.
  const canSwap = !!(art && listing && listing !== blank)
  /**
   * BOTH PICTURES AT ONCE, rather than a swap between them.
   *
   * Swapping made you hold one in your head to compare it with the other, which is exactly
   * the comparison this thumb exists for: what the buyer bought, against what we are about
   * to print. So the listing sits as a small card offset off the corner — visible together,
   * legible apart.
   *
   * Only where there is room. Below ~56px the inset card would be a smudge, so those sizes
   * keep the corner swap they already had.
   */
  /**
   * SHOW BOTH WHENEVER THERE ARE TWO THINGS TO COMPARE — which is not the same as canSwap.
   *
   * canSwap requires attached ARTWORK, because a swap between "the blank" and "the blank"
   * is pointless. But the pair is answering a different question: the buyer's listing photo
   * against what we are going to make. That is worth seeing before any artwork exists — it
   * is exactly when someone is choosing the blank — and requiring `art` meant a line with no
   * design yet fell back to a single image, so the treatment looked arbitrary from row to
   * row on the same order.
   *
   * AND A CHOSEN-BUT-PICTURELESS BLANK IS STILL TWO THINGS. Without blankMissing the pair
   * collapsed to one tile the moment someone picked a blank we hold no photo for, which
   * reads as "this order is different" rather than "that product needs a photo".
   */
  const showBoth = !!(listing && (art || blankMissing || (blank && listing !== blank))) && !listingFirst && size >= 56
  /** Which card is in front. The print leads, because it is what the floor makes. */
  const [listingFront, setListingFront] = useState(false)
  /**
   * A PRIMARY AND A REFERENCE — not two equal cards.
   *
   * They were the same size, side by side, and that is why the pair read as odd: with equal
   * weight nothing says which one matters, so the eye bounces between them and neither gets
   * read. The print is the answer to "what do I make", so it is full size and in front; the
   * listing is the thing you glance at to check it, so it is smaller and tucked behind the
   * print's left edge, peeking out far enough to recognise and to click.
   *
   * PEEK is how much of the listing shows to the left of the print. It doubles as the whole
   * strip's extra width, so the pair costs size × (1 + PEEK) instead of the 1.62 two equal
   * cards needed.
   */
  const PEEK = 0.4
  const SECONDARY = 0.78

  const open = () => {
    if (onEdit) { onEdit(); return }
    // Opening from a listing-first thumb lands on the DESIGN when there is one — that's
    // the thing worth inspecting at size, and it's why you clicked. No artwork attached
    // yet → there is nothing to show but the listing, so stay on it.
    if (listingFirst) setShowListing(!art)
    setPreview(true)
  }

  // What the THUMBNAIL shows. `listingFirst` prefers the buyer's photo and falls back to
  // the composite when a line has none; otherwise the composite, as before.
  // With both on screen the big one is always WHAT WE WILL PRINT — the inset is the
  // listing, so letting the main image swap to the listing too would show it twice.
  const thumbShowsListing = showBoth ? false : (listingFirst ? !!listing : showListing)

  if (readOnly) {
    return (
      <span
        className={"relative block shrink-0 overflow-hidden rounded-md bg-muted " + (bare ? "" : "border border-border ") + (className ?? "")}
        style={{ width: size, height: size }}
      >
        <Composite blank={blank} art={art} pos={design?.pos} listing={listing} showListing={thumbShowsListing} alt={item.name || item.sku || "Item"} blankMissing={blankMissing} />
      </span>
    )
  }

  return (
    <>
      <div
        {...dropProps}
        className={"group/avatar relative shrink-0 " + (over ? "rounded-md ring-2 ring-primary ring-offset-1 " : "") + (className ?? "")}
        // Wide enough for the print plus the listing's peek. Only when both are shown, so
        // every other caller's layout is exactly as it was.
        style={{ width: showBoth ? Math.round(size * (1 + PEEK)) : size, height: size }}
      >
        {/* THE PRINT — full size, in front, offset right by exactly the listing's peek. */}
        <button
          type="button"
          onClick={showBoth && listingFront ? () => setListingFront(false) : open}
          title={showBoth && listingFront ? "Bring the design forward" : (onEdit ? "Edit the design" : "View larger")}
          className={"eg-tap overflow-hidden rounded-md bg-muted transition-[border-color,transform] " + (bare ? "" : "border border-border hover:border-foreground/25")
            + (showBoth ? (listingFront ? " absolute top-1/2 -translate-y-1/2 z-0" : " absolute top-1/2 -translate-y-1/2 z-20 border-2 border-background shadow-md") : " size-full")}
          style={showBoth ? { left: Math.round(size * PEEK), width: size, height: size } : undefined}
        >
          <Composite blank={blank} art={art} pos={design?.pos} listing={listing} showListing={thumbShowsListing} alt={item.name || item.sku || "Item"} blankMissing={blankMissing} />
          {/* Affordance only where there's something to do — and only on hover, so the
              row stays quiet until you're actually pointing at it. */}
          <span className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-md bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100 sm:flex">
            {onEdit ? <PencilSimple size={14} weight="bold" /> : <MagnifyingGlassPlus size={14} weight="bold" />}
          </span>
        </button>

        {/**
          * THE LISTING, TUCKED BEHIND THE PRINT'S LEFT EDGE.
          *
          * Smaller and behind, because it is the reference and the print is the answer. The
          * interaction rule is unchanged and still one sentence: the card BEHIND is a swap
          * (click it and it comes forward), the card in FRONT is the real action (the print
          * opens the design step, the listing opens at full size). Neither card can steal the
          * other's click, which was the whole problem with a swap toggle and then with a
          * click-through inset.
          *
          * It grows to full size when brought forward, so "in front" is never something you
          * have to infer from a z-index you cannot see.
          */}
        {showBoth && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (listingFront) { setShowListing(true); setPreview(true) }
              else setListingFront(true)
            }}
            title={listingFront ? "View the buyer's listing photo" : "Bring the listing photo forward"}
            className={
              "eg-tap absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-md border-2 border-background bg-muted shadow-md transition-all hover:brightness-105 " +
              (listingFront ? "z-20" : "z-0")
            }
            // NO `transform` here. Tailwind v4 compiles -translate-y-1/2 to the `translate`
            // property, not `transform` — they are separate properties and both apply, so an
            // inline translateY(-50%) centred the card TWICE and lifted it clean out of the
            // row. Sizing only; the class does the centring.
            style={
              listingFront
                ? { left: 0, width: size, height: size }
                : { left: 0, width: Math.round(size * SECONDARY), height: Math.round(size * SECONDARY) }
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={listing} alt="Buyer's listing photo" className="size-full object-cover" />
          </button>
        )}

        {/* No corner swap on a listing-first thumb: the row shows the listing, and the
            design lives one click away in the detail view rather than behind a 16px
            control on a 32px image. */}
        {canSwap && !listingFirst && !showBoth && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowListing((v) => !v) }}
            title={showListing ? "Show what we'll print" : "Show the buyer's listing photo"}
            aria-pressed={showListing}
            className={
              "eg-tap absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-opacity " +
              // No hover on touch, so the control has to stay put there.
              (showListing ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover/avatar:opacity-100 sm:focus-visible:opacity-100")
            }
          >
            <ArrowsLeftRight size={9} weight="bold" />
          </button>
        )}
      </div>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-6 text-sm leading-snug">{item.name || item.sku || "Item"}</DialogTitle>
            {/* Shared by every board that renders a line, so the buyer's choice follows the
                item wherever it is opened rather than only on the queue. */}
            <OrderedVariant item={item} className="pr-6" />
          </DialogHeader>
          <div className="space-y-3 px-1 pb-1">
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
              <Composite blank={blank} art={art} pos={design?.pos} listing={listing} showListing={showListing} alt={item.name || "Item"} blankMissing={blankMissing} fit="contain" />
            </div>
            {canSwap && (
              <button
                type="button"
                onClick={() => setShowListing((v) => !v)}
                className="eg-tap inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-accent"
              >
                <ArrowsLeftRight size={12} weight="bold" />
                {showListing ? "Show what we'll print" : "Show the listing photo"}
              </button>
            )}
            <p className="text-xs text-muted-foreground">
              {showListing
                ? "The buyer's listing photo — for reference only."
                : art
                  ? "The blank with its artwork placed — this is what gets made."
                  : "No artwork on this line yet."}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Blank + artwork, layered. The artwork's stored position is in percentages of the mockup,
 * so the same numbers hold at 44px in a row and at full size in the preview — one model,
 * no per-surface maths.
 */
function Composite({ blank, art, pos, listing, showListing, alt, fit, blankMissing }: { blank: string; art: string; pos?: DesignPos | null; listing: string; showListing: boolean; alt: string; fit?: "cover" | "contain"; blankMissing?: boolean }) {
  /**
   * SAY IT, rather than borrow the listing photo.
   *
   * When the chosen blank has no imagery, `blank` falls back to the buyer's listing photo —
   * and this component's whole premise is that it shows what gets MADE, never the listing.
   * A rack of aprons sitting in the print position, captioned as the thing to produce, is
   * worse than an empty tile: it is confidently wrong. So when a blank IS chosen and simply
   * has no picture, the card says so and the pair keeps both halves.
   */
  if (blankMissing && !art && !showListing) {
    return (
      <span className="grid size-full place-items-center gap-1 bg-muted/60 p-1 text-center text-muted-foreground">
        <Package size={15} />
        <span className="text-[9px] font-medium leading-tight">No blank photo</span>
      </span>
    )
  }
  const base = showListing ? (listing || blank) : (blank || listing)
  if (!base && !art) {
    return <span className="grid size-full place-items-center text-muted-foreground"><Package size={16} /></span>
  }
  // Artwork with no blank to sit on: show the artwork itself rather than an empty box.
  if (!base) return <ImgFill src={art} alt={alt} fit={fit} />

  return (
    <span className="relative block size-full">
      <ImgFill src={base} alt={alt} fit={fit} />
      {!showListing && art && <ArtLayer art={art} pos={pos} />}
    </span>
  )
}

/** The artwork layer, positioned from the design's stored %-coords. */
function ArtLayer({ art, pos }: { art: string; pos?: DesignPos | null }) {
  // A design saved before positioning existed carries no pos — fall back to a sensible
  // chest placement rather than dropping the layer, so the row still shows there IS
  // artwork on the line.
  const x = pos?.x ?? 50, y = pos?.y ?? 45, w = pos?.w ?? 42, r = pos?.r ?? 0
  return (
    <span
      className="pointer-events-none absolute"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        transform: `translate(-50%, -50%) rotate(${r}deg)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art} alt="" className="block w-full object-contain" />
    </span>
  )
}

function ImgFill({ src, alt, fit = "cover" }: { src: string; alt: string; fit?: "cover" | "contain" }) {
  // Designs arrive as data: URLs, which next/image can't optimise — so anything that
  // isn't a plain http(s) URL falls back to a bare <img>.
  if (!src.startsWith("http")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={"size-full " + (fit === "contain" ? "object-contain" : "object-cover")} />
  }
  return <Image src={src} alt={alt} fill sizes="96px" className={fit === "contain" ? "object-contain" : "object-cover"} unoptimized />
}
