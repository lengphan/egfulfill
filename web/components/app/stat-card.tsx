"use client"

import { Children, type ElementType, type ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { RailPortal, useInRail, useRailNode } from "@/components/app/console-shell"

export type Tone = "pos" | "neg" | "mut"

/**
 * Universal KPI tile — one metric per card. Reused across every dashboard page.
 * `icon` is optional and off by default, so every existing caller is unchanged.
 *
 * A tile is a LABEL and a NUMBER. It carried a caption under the figure as well, and with
 * four tiles to a row that was four sentences restating four headings the reader already
 * knew. `sub`/`tone` are still accepted so the ~200 call sites don't need touching, and
 * they simply aren't drawn.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  onClick,
  active,
  tone,
}: {
  label: string
  value: string
  /** NOT RENDERED. The caption under the number ("waiting to be placed", "sent to
   *  suppliers") explained a label the reader already knows, on every tile of every board —
   *  four of them per row, restating four headings. Removed at the owner's request.
   *
   *  The prop stays ACCEPTED rather than deleted from ~200 call sites: stripping it would
   *  be a diff across most of the app for no behaviour change, and it is one line to put
   *  back if a tile ever needs to say something the label genuinely can't. */
  sub?: string
  /** Coloured the sub-line, so it is dormant alongside it. */
  tone?: Tone
  icon?: ElementType
  /** Makes the whole card a button. A number you can't act on is a number you read once —
   *  where a stat names a slice of the list below it, clicking should go there. */
  onClick?: () => void
  /** That slice is the one currently on screen. */
  active?: boolean
}) {
  const inRail = useInRail()
  // Type carries the hierarchy; nothing else needs to. The label was 11.5px and the sub
  // 12.5px — below comfortable reading size for a figure someone checks in passing, which
  // is what made these tiles feel cramped rather than calm. Both go up, the value grows,
  // and the row it sits in gets room to breathe (p-6).
  const body = (
    <>
      <div className="flex items-center gap-1.5 eg-label text-muted-foreground">
        {/* Monochrome and inline, not a tinted plate floating in the corner. A coloured
            chip on every card meant a row of four met the eye as four identical stickers
            before a single word was read — the same reasoning that already de-tinted the
            shortcut tiles. The accent is for things that need you, not for decoration. */}
        {Icon && <Icon size={14} className="shrink-0 opacity-70" />}
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {/* ON THE SCALE. This was 28px stepping to 34px — two sizes that exist nowhere else,
          and 34 sat two pixels from the dashboard's own 36px figure, which is a difference
          the eye reads as a mistake rather than a level. 24 → 36 are both steps. */}
      <div className="mt-2.5 text-2xl font-black leading-none tracking-tight tabular-nums sm:text-4xl">{value}</div>
      {/* THE ONE LIME MARK. A 2px bar under the figure, on the tile the caller flagged
          positive — nothing else on the screen carries it, which is the entire reason it
          registers. Lime can never letter anything (1.05:1 on white: invisible), so it is
          used the only way it works — as a solid shape. */}
      {tone === "pos" && <span className="mt-2.5 block h-[3px] w-9 rounded-full bg-[var(--brand-foreground)]" />}
    </>
  )

  /* INSIDE A CONSOLE RAIL the same tile is drawn as type: the label above, the figure
     under it, no border and no ground. Nothing about the caller changes — a page opts in by
     being wrapped in ConsoleShell, and every StatGrid outside one is untouched. The lead
     bar goes ABSOLUTE here because in flow it makes the flagged figure taller than its
     neighbours, and `items-end` then drops the labels onto different lines; a rail whose
     figures do not share a baseline is not comparable, which is the only reason to put them
     in a row. */
  if (inRail) {
    const fig = (
      <>
        <span className="block eg-label whitespace-nowrap text-muted-foreground">{label}</span>
        <span className="mt-1 block text-2xl font-semibold leading-none tracking-tight tabular-nums">{value}</span>
        {tone === "pos" && <span className="absolute bottom-0 left-0 h-[3px] w-8 rounded-full bg-[var(--brand-foreground)]" />}
      </>
    )
    if (!onClick) return <div className="relative shrink-0 pb-[7px]">{fig}</div>
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="eg-tap relative shrink-0 cursor-pointer rounded-md pb-[7px] text-left transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {fig}
      </button>
    )
  }

  if (!onClick) {
    return <Card className="relative gap-0 overflow-hidden p-4 sm:p-6">{body}</Card>
  }
  // A real <button>, not a div with onClick — keyboard and screen readers get it for free,
  // and Base UI has no asChild to lean on here.
  return (
    <Card className={"relative gap-0 overflow-hidden p-0 transition-shadow " + (active ? "ring-2 ring-primary/40" : "")}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="eg-tap w-full cursor-pointer p-4 text-left sm:p-6 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        {body}
      </button>
    </Card>
  )
}

/**
 * Responsive 4-up grid for StatCards.
 *
 * TWO across on a phone, not one. At `sm:grid-cols-2` the base case was a single column, so
 * four tiles became four full-width blocks — roughly a thousand pixels to scroll past
 * before reaching the table underneath, on every board in the app. A label and a number fit
 * comfortably in half a phone; giving them the whole width bought nothing and cost the page.
 */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Inside a ConsoleShell these go to the page header instead, as figures. Outside one
          RailPortal renders nothing, so the grid below is the only output and every existing
          board is byte-identical. */}
      <RailPortal>{children}</RailPortal>
      <StatGridInPlace>{children}</StatGridInPlace>
    </>
  )
}

/**
 * THE GRID FOLLOWS THE COUNT. It used to be `xl:grid-cols-4` whatever it was given, so a
 * board with fewer than four figures left the rest of the row empty — and it is not a rare
 * case. Measured across the app: wallet has ONE card in a four-column row (a 75% hole),
 * dispatch has two, billing and designer earnings have three, purchasing has five and wraps
 * to 4+1. Six boards, and on each of them the row reads as unfinished rather than as short.
 *
 * "The layout seems undone" is a COUNT problem, not a spacing one — count the cells before
 * reaching for padding.
 *
 * The map is literal on purpose: Tailwind's scanner only sees complete class strings, so a
 * computed `xl:grid-cols-${n}` would compile to nothing and silently leave the default.
 */
const XL_COLS: Record<number, string> = {
  1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3",
  4: "xl:grid-cols-4", 5: "xl:grid-cols-5",
}
/** Six or more wraps to whichever row length divides evenly, so no row is a short one. */
function xlCols(n: number): string {
  if (n <= 5) return XL_COLS[Math.max(1, n)] ?? "xl:grid-cols-4"
  if (n % 4 === 0) return "xl:grid-cols-4"
  if (n % 3 === 0) return "xl:grid-cols-3"
  return "xl:grid-cols-4"
}

/** Hidden when a rail has taken the figures. */
function StatGridInPlace({ children }: { children: ReactNode }) {
  const rail = useRailNode()
  /* toArray drops the nulls a conditional card leaves behind, so a board rendering
     `{isAdmin && <StatCard/>}` is counted by what actually shows, not by what was written. */
  const n = Children.toArray(children).length
  if (rail) return null
  return (
    <div className={`grid gap-3 sm:gap-4 ${n === 1 ? "grid-cols-1" : "grid-cols-2"} ${xlCols(n)}`}>
      {children}
    </div>
  )
}
