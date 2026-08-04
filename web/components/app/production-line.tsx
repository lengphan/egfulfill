"use client"

import { Fragment } from "react"
import { FACTORY_STAGES, EXCEPTION_STAGES, orderStage } from "@/lib/factory-status"
import { platformOf } from "@/lib/order-format"
import { type OrderRow } from "@/lib/api"

// The linear stages, Draft first — the same vocabulary the boards show as badges. Exception
// states hang off the pipeline rather than sitting in it, so they're appended and only shown
// when they hold something: an always-visible "Cancelled 0" is a row that never earns its space.
const LINE = [{ id: "", label: "Draft" }, ...FACTORY_STAGES.map((s) => ({ id: s.id, label: s.label }))]
const OFF_LINE = EXCEPTION_STAGES.map((s) => ({ id: s.id, label: s.label }))

/**
 * WHICH CHANNEL, not which stage, carries the colour here.
 *
 * The stage is already named at the head of its own row, so hues spent telling stages apart
 * are decoration. Spent on the channel instead they answer a question the card couldn't
 * answer at all: *whose* orders are piling up — which matters, because a backlog that's all
 * one marketplace is a different problem from one spread evenly.
 *
 * Fixed slots, assigned by name and never cycled, so a channel keeps its colour when another
 * disappears from the data — colour follows the entity, never its rank.
 *
 * THE THEME'S chart tokens, not fixed hexes. --chart-1…5 are defined for light AND dark in
 * globals.css, so these track a re-theme (and dark mode) on their own; the hard-coded hexes
 * they replace could not, and were the one thing on this card that stayed put when the
 * palette moved. It is also the house rule: never hard-code a colour a token expresses.
 *
 * Colour is never the only signal — the light steps sit under 3:1 on some slots — so every
 * row carries a count and the legend spells the channel out.
 */
const CHANNELS: { name: string; cls: string }[] = [
  { name: "Etsy", cls: "bg-chart-1" },
  { name: "TikTok", cls: "bg-chart-2" },
  { name: "Shopify", cls: "bg-chart-3" },
  { name: "Manual", cls: "bg-chart-4" },
]
const OTHER = { name: "Other", cls: "bg-muted-foreground/50" }
const slotFor = (p: string) => CHANNELS.find((c) => c.name === p) ?? OTHER

const dayjs = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : NaN)
/** How long the oldest thing in a stage has been sitting. A stage holding old work is a
 *  different problem from a busy one, and the count alone can't say which. */
const ageLabel = (d: number) => (!Number.isFinite(d) ? "" : d < 1 ? "today" : `${Math.floor(d)}d`)

/**
 * The production floor as a single glance: how many orders sit at each stage, which channels
 * they came from, and how long the oldest has waited. Every number is a live count off the
 * order feed — nothing is modelled.
 */
// (Age bands were here — Draft split into "under 7 days" / "7 – 30 days" / "over 30 days"
// as sub-rows. Removed at the user's request: they re-stated the Draft count above them in
// different words, and the card's job is one glance, not a breakdown. If "how much of this
// is stale" is ever wanted again, it belongs as a column or a filter on the queue, not as
// three extra rows here.)

export function ProductionLine({ orders }: { orders: OrderRow[] }) {
  const rows = [...LINE, ...OFF_LINE].map((s) => {
    const inStage = orders.filter((o) => orderStage(o.items ?? []) === s.id)
    // Grouped in the fixed slot order, so a stack's bands sit in the same order on every row
    // and can be compared straight down the card.
    const byChannel = [...CHANNELS, OTHER]
      .map((c) => ({
        ...c,
        n: inStage.filter((o) => slotFor(platformOf(o)).name === c.name).length,
      }))
      .filter((c) => c.n > 0)
    // Seeded at 0, NOT NaN: Math.max(NaN, x) is NaN, so a NaN seed silently blanked the age
    // on every row. An empty stage is handled by the `r.n` check at render instead.
    const oldest = inStage.reduce((a, o) => {
      const d = dayjs(o.created_at)
      return Number.isFinite(d) && d > a ? d : a
    }, 0)
    return { ...s, n: inStage.length, byChannel, oldest, off: OFF_LINE.some((x) => x.id === s.id) }
  })

  // Exception rows only when they hold something; pipeline rows always, so the shape of the
  // line is stable even on a quiet day.
  const shown = rows.filter((r) => !r.off || r.n > 0)
  const max = Math.max(1, ...shown.map((r) => r.n))
  const total = shown.reduce((a, r) => a + r.n, 0)
  const channelsPresent = CHANNELS.concat(OTHER).filter((c) => shown.some((r) => r.byChannel.some((b) => b.name === c.name)))

  return (
    <div className="flex flex-1 flex-col px-5 py-3">
      {/* Legend — mandatory above one series, and the relief the light palette's contrast
          WARN requires: identity is never carried by colour alone. */}
      {channelsPresent.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {channelsPresent.map((c) => (
            <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className={"size-2 rounded-[2px] " + c.cls} />
              {c.name}
            </span>
          ))}
        </div>
      )}

      {shown.map((r) => {
        // Proportional to the busiest stage, with a floor so a non-zero stage is never
        // invisible — at 5/207 an honest proportion would round away to nothing, and a stage
        // holding five orders is not the same as one holding none.
        const pct = r.n ? Math.max(2, (r.n / max) * 100) : 0
        // Too little width for inter-segment gaps to be anything but noise — see below.
        const narrow = pct < 12
        return (
          <Fragment key={r.id || "draft"}>
          <div
            className="group flex min-h-[32px] flex-1 items-center gap-3 rounded-md px-1 transition-colors hover:bg-accent/40"
            title={
              `${r.label}: ${r.n} order${r.n === 1 ? "" : "s"}` +
              (total ? ` · ${Math.round((r.n / total) * 100)}% of the floor` : "") +
              (r.byChannel.length ? `\n${r.byChannel.map((c) => `${c.name} ${c.n}`).join(" · ")}` : "") +
              (Number.isFinite(r.oldest) ? `\nOldest waiting ${ageLabel(r.oldest)}` : "")
            }
          >
            <div className={"w-24 shrink-0 truncate text-xs font-medium " + (r.off ? "text-muted-foreground/70 italic" : "text-muted-foreground")}>
              {r.label}
            </div>

            {/* One shared track, so every stack is measured against the same width and the
                eye can compare them down the card's edge. */}
            <div className="relative h-2.5 flex-1 rounded-sm bg-muted/60">
              {r.n > 0 && (
                <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-sm" style={{ width: `${pct}%` }}>
                  {r.byChannel.map((c, i) => (
                    <div
                      key={c.name}
                      // 2px surface gap between touching segments (never a stroke), and the
                      // rounded data-end only on the last one — the stack ends there.
                      //
                      // The gap is DROPPED on a narrow stack. At 8 orders against a 207 peak
                      // the bar is ~2% wide, and three 2px gaps then cost more of it than the
                      // data does — it renders as confetti rather than a bar. Below the
                      // threshold the segments butt together and read as one small bar with
                      // its mix hinted; the exact split is in the tooltip, which is where a
                      // breakdown that cannot fit belongs.
                      className={
                        c.cls +
                        (i && !narrow ? " ml-[2px]" : "") +
                        (i === r.byChannel.length - 1 ? " rounded-r-[4px]" : "")
                      }
                      style={{ flex: `${c.n} 0 0%` }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Oldest-waiting, muted: context for the count rather than a competing number.
                Fixed width so it never shoves the counts out of their column. */}
            <div className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70">
              {r.n ? ageLabel(r.oldest) : ""}
            </div>

            {/* Value at the end of the ROW, not the end of the bar: a 2%-wide stack has
                nowhere to put a label, and a number that moves with the bar is one you have
                to hunt for. Right-aligned and tabular so the digits read as a column. */}
            <div className={"w-10 shrink-0 text-right text-sm font-semibold tabular-nums " + (r.n ? "text-foreground" : "text-muted-foreground/60")}>
              {r.n}
            </div>
          </div>


          </Fragment>
        )
      })}
    </div>
  )
}
