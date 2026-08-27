"use client"

import { CircleNotch, type Icon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/**
 * THE ANATOMY OF A REGION WITH NOTHING IN IT.
 *
 * A dropzone, an empty list, a search that matched nothing, a first-run panel — these are one
 * object wearing four hats, and the app built them 53 separate times. Measured across those
 * 53: NINE different vertical paddings (py-6 · 8 · 10 · 12 · 14 · 16 · 20 · 24), five gaps,
 * and the mark present in only 13 of them.
 *
 * FOUR PARTS, IN THIS ORDER:
 *
 *   1. THE MARK — a glyph in a tile. Not a loose outline. This is the single biggest
 *      difference between a region that reads as a place and one that reads as a gap: a
 *      20px stroke floating in whitespace is decoration the eye reads past, and the same
 *      glyph on a small filled square is an object it lands on.
 *   2. THE LINE — what is missing, or what to do. `text-sm font-medium`. One line.
 *   3. THE NOTE — why, or what is allowed. `text-xs text-muted-foreground`, capped at a
 *      readable measure. OPTIONAL, and one sentence: an empty region may carry a sentence
 *      because there is nothing else to read. A populated screen may not.
 *   4. THE WAY OUT — at most one action. A second PEER route (record instead of upload) goes
 *      under an "or", because two equal routes to one end need a word between them or the
 *      first button reads as the thing you were supposed to press.
 *
 * This file holds the parts. `EmptyState` is the version you cannot drop onto; `Dropzone` is
 * the version you can. Nothing else should re-derive either — that is the whole reason nine
 * paddings existed.
 */

/** Part 1. The tile. `sm` inside a card's own section, `md` for a region that owns a panel. */
export function RegionMark({
  icon, busy = false, size = "md", className,
}: { icon: Icon; busy?: boolean; size?: "sm" | "md"; className?: string }) {
  const I = icon
  const box = size === "sm" ? "size-12" : "size-14"
  const glyph = size === "sm" ? 20 : 24
  return (
    // THE GLYPH IS INK, NOT GREY. It was `text-muted-foreground`, which put the mark at the
    // same weight as the note under it — so the tile read as another piece of caption rather
    // than as the object the region is about. A tile is a white card lifted off the ground:
    // border, faint shadow, dark glyph. That contrast is the whole reason part 1 exists.
    <span className={cn(
      // rounded-LG, not xl. --radius-xl maps to --radius (26px), and 26px on a 44px box is a
      // circle — which is exactly the "loose outline" this component was written to replace.
      // The tile has to read as a SQUARE with softened corners or it stops being an object
      // the eye lands on. --radius-control (10px) is the right step for something this size.
      "grid place-items-center rounded-lg border border-border bg-background text-foreground ",
      box, className,
    )}>
      {busy ? <CircleNotch size={glyph} className="animate-spin text-muted-foreground" /> : <I size={glyph} />}
    </span>
  )
}

/**
 * Part 2, and part 3 under it — BOTH KEYED BY SIZE, the way the padding already was.
 *
 * They were two flat strings, `text-sm` over `text-xs`, and at 14px over 12px a region that
 * owns a whole panel whispered: the line asking you to do the thing was the size of a table
 * cell, and the note under it was the size of a footnote's footnote. The step from line to
 * note is COLOUR, not size — one is ink and one is grey. Dropping two steps of scale on top
 * of that is what made these regions read as small print in a large hole.
 *
 * `sm` is the old pair, for a region inside a card's own section, where 14px genuinely is the
 * body size around it. `md` is a step up for a region that IS the panel.
 */
export const REGION_LINE = {
  sm: "text-sm font-medium text-foreground",
  md: "text-base font-medium text-foreground",
} as const
/** Part 3. The measure: past about 45 characters a centred sentence reads as a paragraph,
 *  and a paragraph in an empty state is an apology. */
export const REGION_NOTE = {
  sm: "max-w-xs text-xs text-muted-foreground",
  md: "max-w-sm text-sm text-muted-foreground",
} as const
/** The column every region shares, so the rhythm is one decision rather than fifty-three. */
export const REGION_STACK = "flex flex-col items-center justify-center gap-2.5 text-center"
/** Vertical air. ONE scale, two steps — a region inside a card, and a region that IS the card. */
export const REGION_PAD = { sm: "py-8", md: "py-16" } as const
