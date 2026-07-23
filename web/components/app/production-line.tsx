"use client"

import { CaretRight } from "@phosphor-icons/react"
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

  return (
    <div className="space-y-3 px-5 py-4">
      {/* proportional flow bar — segment width ∝ count, a sliver kept for empty stages */}
      <div className="flex h-2 gap-1 overflow-hidden">
        {counts.map((s) => (
          <div
            key={s.id || "received"}
            className={"h-full rounded-full transition-[flex-grow] duration-500 " + (s.n ? BAR[s.tone] : "bg-muted")}
            style={{ flexGrow: s.n || 0.12, flexBasis: 0 }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      {/* stage nodes with flow carets between */}
      <div className="flex items-center">
        {counts.map((s, i) => {
          const hot = s.id === peak.id && peak.n > 0
          return (
            <div key={s.id || "received"} className="flex flex-1 items-center">
              <div className="flex-1 text-center">
                <div className={"text-xl font-bold leading-none tabular-nums " + (hot ? "text-primary" : "")}>{s.n}</div>
                <div className={"mt-1 text-[11px] font-medium " + (hot ? "text-primary" : "text-muted-foreground")}>{s.label}</div>
              </div>
              {i < counts.length - 1 && <CaretRight size={12} weight="bold" className="shrink-0 text-muted-foreground/40" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
