"use client"

import { ItemAvatar } from "@/components/app/item-avatar"
import type { OrderItem, OrderDesign, CatalogProduct } from "@/lib/api"

/**
 * Overlapping thumbnails of an order's items — the photos a flat table row is missing.
 *
 * Lifted out of orders-list.tsx so the seller table and the factory boards render the
 * same strip instead of each grow­ing its own copy (this repo has had the same helper
 * re-implemented in three separate files before; see CLAUDE.md §5).
 *
 * Thumbs lead with the buyer's LISTING photo — at 32px a composite is a smudge of
 * artwork over a smudge of blank, while the listing shot was styled to read small. The
 * production view isn't lost: clicking a thumb opens the detail window on the DESIGN when
 * one is attached, which is where placement is actually worth looking at. Lines with no
 * listing photo fall back to the composite so nothing renders empty.
 *
 * Pass `readOnly` for a purely decorative strip (no click, no preview).
 *
 * `overlap` defaults to true (the dense stack a flat table row wants). Pass false where
 * the thumbs are the point rather than a hint: overlapping hides ~a third of every image
 * behind the next one, which no amount of extra size buys back.
 */
export function PhotoStack({
  items,
  designs,
  catalog,
  max = 3,
  /**
   * The row's PRIMARY image, and it should not be the smallest one on screen.
   *
   * It was 32px, then 48 — still under the 88px avatar an expanded line shows, so the
   * picture you SCAN was consistently less legible than the picture you had already chosen
   * to open. That is backwards, and it is worse in a stack: three overlapping 48px thumbs of
   * similar artwork are three smudges.
   *
   * 72 is close to the per-item avatar without making every row of a 700-row queue that
   * tall. One number, shared by every board, so they cannot drift apart again.
   */
  size = 72,
  readOnly,
  overlap = true,
  showExtra = true,
}: {
  items: OrderItem[]
  designs?: Record<string, OrderDesign> | null
  catalog?: CatalogProduct[]
  /** How many thumbs before collapsing into a +N chip. */
  max?: number
  size?: number
  readOnly?: boolean
  /** Tuck each thumb under the previous one. False lays them out edge to edge. */
  overlap?: boolean
  /** The "+2" chip for the lines that did not fit. False where the row already SAYS how
   *  many there are — `itemsLabel` prints "Tote +2" and the line under it counts the units,
   *  so the chip is the third place one row states the same number. */
  showExtra?: boolean
}) {
  const shown = items.slice(0, max)
  const extra = items.length - shown.length
  return (
    <div className={"flex shrink-0 items-center" + (overlap ? "" : " gap-1.5")}>
      {shown.map((it, i) => (
        <span
          // line_id first: two lines of the same SKU are different jobs, and keying on
          // sku alone gave duplicate React keys on identical-SKU siblings — which lets
          // React reuse the wrong node when the list reorders.
          key={it.line_id ?? it.sku ?? i}
          /**
           * A LIFT, SO OVERLAPPING PHOTOS READ AS SEPARATE CARDS.
           *
           * Stacked with a negative margin and nothing else, three thumbnails of similar
           * artwork merged into one wide smudge — you could not see where one ended and the
           * next began, which is the only thing a stack has to communicate.
           *
           * A ring rather than a border, because a border would change each tile's box and
           * shift the overlap; the ring paints outside it. Shadow and ring together give the
           * edge in both directions — the ring separates a pale photo from a pale neighbour,
           * the shadow separates a dark one from the page.
           */
          className={"relative rounded-md shadow-sm ring-1 ring-black/10 " + (i && overlap ? "-ml-2.5" : "")}
          style={{ zIndex: shown.length - i }}
        >
          <ItemAvatar
            item={it}
            designs={designs}
            catalog={catalog}
            size={size}
            readOnly={readOnly}
            listingFirst
            bare
            className="border-background"
          />
        </span>
      ))}
      {extra > 0 && showExtra && (
        <span
          className={(overlap ? "-ml-2.5 " : "") + "flex items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground shadow-sm ring-1 ring-black/10"}
          style={{ width: size, height: size }}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}
