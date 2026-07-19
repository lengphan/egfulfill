"use client"

import { useState } from "react"
import Image from "next/image"
import { Package, ArrowsLeftRight, PencilSimple, MagnifyingGlassPlus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { bestMockup, resolveProduct } from "@/lib/variant-resolve"
import { designSrc } from "@/lib/order-image"
import type { CatalogProduct, DesignPos, OrderDesign, OrderItem } from "@/lib/api"

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
  className?: string
}

/** The blank the artwork sits on: the chosen colour's mockup, falling back to the listing photo. */
function blankOf(item: OrderItem, catalog?: CatalogProduct[]): string {
  const p = catalog?.length ? resolveProduct(item, catalog) : null
  return bestMockup(p, item.color, item.img || "")
}

export function ItemAvatar({ item, designs, catalog, size = 44, onEdit, className }: ItemAvatarProps) {
  const [preview, setPreview] = useState(false)
  const [showListing, setShowListing] = useState(false)

  const design = designs && item.sku ? designs[item.sku] : null
  const art = designSrc(design?.data) || designSrc(item.design_src)
  const blank = blankOf(item, catalog)
  const listing = item.img || ""
  // Only worth offering the swap when the two views actually differ.
  const canSwap = !!(art && listing && listing !== blank)

  const open = () => { if (onEdit) onEdit(); else setPreview(true) }

  return (
    <>
      <div className={"group/avatar relative shrink-0 " + (className ?? "")} style={{ width: size, height: size }}>
        <button
          type="button"
          onClick={open}
          title={onEdit ? "Edit the design" : "View larger"}
          className="eg-tap size-full overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-foreground/25"
        >
          <Composite blank={blank} art={art} pos={design?.pos} listing={listing} showListing={showListing} alt={item.name || item.sku || "Item"} />
          {/* Affordance only where there's something to do — and only on hover, so the
              row stays quiet until you're actually pointing at it. */}
          <span className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-md bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100 sm:flex">
            {onEdit ? <PencilSimple size={14} weight="bold" /> : <MagnifyingGlassPlus size={14} weight="bold" />}
          </span>
        </button>

        {canSwap && (
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
            <DialogTitle className="truncate">{item.name || item.sku || "Item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-1 pb-1">
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
              <Composite blank={blank} art={art} pos={design?.pos} listing={listing} showListing={showListing} alt={item.name || "Item"} />
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
function Composite({ blank, art, pos, listing, showListing, alt }: { blank: string; art: string; pos?: DesignPos | null; listing: string; showListing: boolean; alt: string }) {
  const base = showListing ? (listing || blank) : (blank || listing)
  if (!base && !art) {
    return <span className="grid size-full place-items-center text-muted-foreground"><Package size={16} /></span>
  }
  // Artwork with no blank to sit on: show the artwork itself rather than an empty box.
  if (!base) return <ImgFill src={art} alt={alt} />

  return (
    <span className="relative block size-full">
      <ImgFill src={base} alt={alt} />
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

function ImgFill({ src, alt }: { src: string; alt: string }) {
  // Designs arrive as data: URLs, which next/image can't optimise — so anything that
  // isn't a plain http(s) URL falls back to a bare <img>.
  if (!src.startsWith("http")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className="size-full object-cover" />
  }
  return <Image src={src} alt={alt} fill sizes="96px" className="object-cover" unoptimized />
}
