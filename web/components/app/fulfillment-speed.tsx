"use client"

import { useMemo } from "react"
import { Timer, Truck, Clock, SealCheck, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { fulfillmentSpeed, type SpeedStat } from "@/lib/analytics"
import type { OrderRow } from "@/lib/api"

// A day count reads better than raw days for the sub-day and multi-day cases alike.
const fmtDays = (d: number | null) => {
  if (d === null) return "—"
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`
  return `${d % 1 === 0 ? d : d.toFixed(1)}d`
}

/**
 * Fulfilment speed beside the production line: median production / transit / total lead
 * times and the on-time rate, every figure off real carrier + factory timestamps. A row
 * with no qualifying orders says so plainly rather than showing a hollow 0 — an empty
 * metric and a fast one must never look the same.
 */
export function FulfillmentSpeed({ orders, loading }: { orders: OrderRow[]; loading?: boolean }) {
  const s = useMemo(() => fulfillmentSpeed(orders), [orders])

  const rows: { icon: typeof Timer; label: string; hint: string; stat: SpeedStat; accent: string }[] = [
    { icon: Timer, label: "Production", hint: "placed → shipped", stat: s.production, accent: "text-violet-600 dark:text-violet-400" },
    { icon: Truck, label: "Transit", hint: "shipped → delivered", stat: s.transit, accent: "text-sky-600 dark:text-sky-400" },
    { icon: Clock, label: "Total lead time", hint: "placed → delivered", stat: s.total, accent: "text-foreground" },
  ]

  return (
    <SectionCard
      title="Fulfillment speed"
      className="h-full"
      bodyClassName="flex h-full flex-col divide-y divide-border"
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
      ) : (
        <>
          {rows.map((r) => {
            const Icon = r.icon
            return (
              <div key={r.label} className="flex items-center gap-3 px-5 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon size={16} weight="duotone" /></span>
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-tight">{r.label}</div>
                  <div className="text-xs text-muted-foreground leading-tight">{r.hint}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className={"text-xl font-bold tabular-nums leading-none " + (r.stat.days === null ? "text-muted-foreground" : r.accent)}>{fmtDays(r.stat.days)}</div>
                  <div className="mt-1 text-2xs text-muted-foreground">{r.stat.n ? `${r.stat.n} order${r.stat.n === 1 ? "" : "s"}` : "no data yet"}</div>
                </div>
              </div>
            )
          })}
          {/* On-time is the one that needs data to build up: est_delivery is only captured
              once a parcel starts moving, so it is honestly empty until orders ship. */}
          <div className="flex items-center gap-3 px-5 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><SealCheck size={16} weight="duotone" /></span>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-tight">On-time</div>
              <div className="text-xs text-muted-foreground leading-tight">delivered by USPS ETA</div>
            </div>
            <div className="ml-auto text-right">
              <div className={"text-xl font-bold tabular-nums leading-none " + (s.onTime.pct === null ? "text-muted-foreground" : s.onTime.pct >= 90 ? "text-success dark:text-emerald-400" : s.onTime.pct >= 75 ? "text-amber-600" : "text-red-600")}>{s.onTime.pct === null ? "—" : `${s.onTime.pct}%`}</div>
              <div className="mt-1 text-2xs text-muted-foreground">{s.onTime.n ? `of ${s.onTime.n} delivered` : "collecting"}</div>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  )
}
