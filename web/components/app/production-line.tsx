"use client"

import { FACTORY_STAGES, orderStage, type FactoryTone } from "@/lib/factory-status"
import { type OrderRow } from "@/lib/api"

// The linear stages, Draft first — the same vocabulary the boards show as badges.
const LINE = [{ id: "", label: "Draft", tone: "new" as FactoryTone }, ...FACTORY_STAGES]

// Fill colours for the flow bar: the SAME hues as the stage badges (TONE_CLASS), one step
// stronger so a thin bar still reads, and given a dark-mode step so it isn't a pale smear
// on near-black. This is the app's semantic stage palette (like TONE_CLASS), which the
// neutral tokens deliberately don't express — so it lives here rather than being faked
// from --primary, which would make every stage look the same.
const BAR: Record<FactoryTone, string> = {
  new: "bg-slate-300 dark:bg-slate-600",
  review: "bg-indigo-400 dark:bg-indigo-500",
  neutral: "bg-slate-400 dark:bg-slate-500",
  qc: "bg-amber-400 dark:bg-amber-500",
  prod: "bg-violet-500",
  packed: "bg-sky-400 dark:bg-sky-500",
  shipped: "bg-emerald-500",
  hold: "bg-amber-500",
  alert: "bg-red-500",
  backorder: "bg-orange-500",
  closed: "bg-muted",
}

// The stages that are actually WORK-IN-PROGRESS (not the intake edge, not the done edge).
// The busiest of these is where the floor is backing up — worth drawing the eye to.
const WIP = new Set(["in_review", "awaiting_scan", "printed", "working"])

/**
 * The production floor as a single glance: how many orders sit at each stage, and where
 * the pile is. A proportional bar shows the shape of the backlog; the nodes below read the
 * exact counts. Every number is a live count off the order feed — nothing is modelled.
 */
export function ProductionLine({ orders }: { orders: OrderRow[] }) {
  const counts = LINE.map((s) => ({ ...s, n: orders.filter((o) => orderStage(o.items ?? []) === s.id).length }))
  // The busiest work-in-progress stage — highlighted so a bottleneck stands out. -1 seed so
  // an all-zero floor picks nothing rather than lighting up Received.
  const peak = counts.filter((s) => WIP.has(s.id)).reduce((a, s) => (s.n > a.n ? s : a), { id: "", n: 0 })

  // HORIZONTAL rows, not columns. A real floor is extremely lopsided — 207 drafts against
  // 8 pending and 5 awaiting scan — and as columns that shape fails twice: every stage but
  // the biggest collapses to a 6px stub on the baseline, and the tall bar forces a chart
  // height that the other four columns leave as empty air. Rows fix both. Each stage owns a
  // band whether its count is 207 or 0, the card's height goes into bands instead of
  // headroom, and the count sits at the end of its own row, so a one-pixel bar is still
  // perfectly readable — the number never depended on the bar's length.
  //
  // It also reads as what it is: a pipeline, top to bottom, in pipeline order.
  const max = Math.max(1, ...counts.map((s) => s.n))
  const total = counts.reduce((a, s) => a + s.n, 0)

  return (
    // h-full + flex-1 rows: this card is stretched to match the fulfilment-speed card beside
    // it, so a content-height chart left a third of it empty — the "doesn't use the height it
    // has" complaint. The bands absorb the slack instead, which also gives each row a bigger
    // hover target. min-h keeps them from collapsing when the card is short.
    <div className="flex flex-1 flex-col justify-center px-5 py-3">
      {counts.map((s) => {
        const hot = s.id === peak.id && peak.n > 0
        // Proportional to the busiest stage, with a floor so a non-zero stage is never
        // invisible — a stage holding 5 orders is not the same as one holding none, and at
        // 5/207 an honest proportion would round to nothing.
        const pct = s.n ? Math.max(1.5, (s.n / max) * 100) : 0
        return (
          <div
            key={s.id || "received"}
            className="group flex min-h-[34px] flex-1 items-center gap-3 rounded-md px-1 transition-colors hover:bg-accent/40"
            title={`${s.label}: ${s.n} order${s.n === 1 ? "" : "s"}${total ? ` · ${Math.round((s.n / total) * 100)}% of the floor` : ""}`}
          >
            <div className={"w-28 shrink-0 truncate text-xs font-medium " + (hot ? "text-foreground" : "text-muted-foreground")}>
              {s.label}
            </div>
            {/* The track is the full width every stage gets, so the bars share one scale and
                the eye can compare them down the column edge. */}
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-sm bg-muted/60">
              {s.n > 0 && (
                <div
                  className={"absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500 " + BAR[s.tone]}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
            {/* Value at the tip of the row, not the tip of the bar: a 1.5% bar has nowhere to
                put a label, and a number that moves with the bar is a number you have to hunt
                for. Right-aligned and tabular so the digits line up as a readable column. */}
            <div className={"w-10 shrink-0 text-right text-sm font-semibold tabular-nums " + (s.n ? "text-foreground" : "text-muted-foreground/60")}>
              {s.n}
            </div>
          </div>
        )
      })}
    </div>
  )
}
