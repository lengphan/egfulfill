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
  const box = size === "sm" ? "size-10" : "size-12"
  const glyph = size === "sm" ? 18 : 22
  return (
    <span className={cn(
      "grid place-items-center rounded-xl border border-border bg-background text-muted-foreground",
      box, className,
    )}>
      {busy ? <CircleNotch size={glyph} className="animate-spin" /> : <I size={glyph} />}
    </span>
  )
}

/** Part 2. */
export const REGION_LINE = "text-sm font-medium text-foreground"
/** Part 3. max-w-xs is the measure: past about 45 characters a centred sentence reads as a
 *  paragraph, and a paragraph in an empty state is an apology. */
export const REGION_NOTE = "max-w-xs text-xs text-muted-foreground"
/** The column every region shares, so the rhythm is one decision rather than fifty-three. */
export const REGION_STACK = "flex flex-col items-center justify-center gap-2.5 text-center"
/** Vertical air. ONE scale, two steps — a region inside a card, and a region that IS the card. */
export const REGION_PAD = { sm: "py-8", md: "py-16" } as const
