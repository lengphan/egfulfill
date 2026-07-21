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
 */
export function PhotoStack({
  items,
  designs,
  catalog,
  max = 3,
  size = 32,
  readOnly,
}: {
  items: OrderItem[]
  designs?: Record<string, OrderDesign> | null
  catalog?: CatalogProduct[]
  /** How many thumbs before collapsing into a +N chip. */
  max?: number
  size?: number
  readOnly?: boolean
}) {
  const shown = items.slice(0, max)
  const extra = items.length - shown.length
  return (
    <div className="flex shrink-0 items-center">
      {shown.map((it, i) => (
        <span
          // line_id first: two lines of the same SKU are different jobs, and keying on
          // sku alone gave duplicate React keys on identical-SKU siblings — which lets
          // React reuse the wrong node when the list reorders.
          key={it.line_id ?? it.sku ?? i}
          className={"relative " + (i ? "-ml-2.5" : "")}
          style={{ zIndex: shown.length - i }}
        >
          <ItemAvatar
            item={it}
            designs={designs}
            catalog={catalog}
            size={size}
            readOnly={readOnly}
            listingFirst
            className="border-background ring-1 ring-border"
          />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="-ml-2.5 flex items-center justify-center rounded-md border border-background bg-muted text-[10px] font-semibold text-muted-foreground ring-1 ring-border"
          style={{ width: size, height: size }}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}
