"use client"

import { FACTORY_STAGES, orderStage, type FactoryTone } from "@/lib/factory-status"
import { type OrderRow } from "@/lib/api"

// The six linear stages, Received first — the same vocabulary the boards show as badges.
const LINE = [{ id: "", label: "Received", tone: "new" as FactoryTone }, ...FACTORY_STAGES]

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

  // Each column is scaled to the BUSIEST stage, not to the total — so a lopsided floor
  // (everything in one stage, nothing shipped yet) still reads as a clean chart instead of
  // one segment eating a shared track. A non-zero stage never drops below a visible stub.
  const CHART_H = 128
  const BAR_MAX = CHART_H - 22 // leaves room for the value label riding on top
  const max = Math.max(1, ...counts.map((s) => s.n))

  return (
    <div className="px-5 py-4">
      {/* columns — value label on top, bar grounded on a shared baseline */}
      <div className="flex items-end gap-2 border-b border-border" style={{ height: CHART_H }}>
        {counts.map((s) => {
          const hot = s.id === peak.id && peak.n > 0
          const h = s.n ? Math.max(6, Math.round((s.n / max) * BAR_MAX)) : 2
          return (
            <div key={s.id || "received"} className="flex flex-1 flex-col items-center justify-end gap-1.5">
              <div className={"text-sm font-bold leading-none tabular-nums " + (hot ? "text-primary" : s.n ? "text-foreground" : "text-muted-foreground")}>{s.n}</div>
              <div
                className={"w-full max-w-[52px] rounded-t-[5px] transition-[height] duration-500 " + (s.n ? BAR[s.tone] : "bg-muted")}
                style={{ height: h }}
                title={`${s.label}: ${s.n}`}
              />
            </div>
          )
        })}
      </div>
      {/* stage labels, aligned under each column */}
      <div className="mt-2 flex gap-2">
        {counts.map((s) => {
          const hot = s.id === peak.id && peak.n > 0
          return (
            <div key={s.id || "received"} className={"flex-1 text-center text-[11px] font-medium leading-tight " + (hot ? "text-primary" : "text-muted-foreground")}>
              {s.label}
            </div>
          )
        })}
      </div>
    </div>
  )
}
