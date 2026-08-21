"use client"

import { useMemo } from "react"
import { Timer, Truck, Clock, SealCheck, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { fulfillmentSpeed, type SpeedStat } from "@/lib/analytics"
import type { OrderRow } from "@/lib/api"
import { useT, useLabelT } from "@/lib/i18n"

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
 const t = useT()
 const tl = useLabelT()
 const s = useMemo(() => fulfillmentSpeed(orders), [orders])

  // The day figures themselves ("3.2d", "18h") are unit-suffixed numbers, not prose, and
  // stay as they are in every locale — same reasoning as the money on the tiles above.
  // ONE LINE PER ROW. Each row carried a caption spelling out its own span
  // ("placed → shipped") under a label that already said it, so a four-row card was
  // eight lines of type and the figures — the only thing anyone reads here — had to
  // compete with a grey gloss on every one of them. The label carries the meaning;
  // On-time absorbs its yardstick into its name rather than losing it.
 const rows: { icon: typeof Timer; label: string; stat: SpeedStat; accent: string }[] = [
    { icon: Timer, label: tl("speed", "Production"), stat: s.production, accent: "text-violet-600 dark:text-violet-400" },
    { icon: Truck, label: tl("speed", "Transit"), stat: s.transit, accent: "text-sky-600 dark:text-sky-400" },
    { icon: Clock, label: tl("speed", "Total lead time"), stat: s.total, accent: "text-foreground" },
  ]

 return (
    <SectionCard
 title={t("dash.fulfillmentSpeed")}
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
                {/* NO PLATE. A beige rounded square behind every icon meant four identical tiles
 down the left of a four-row list — the plates lined up and the icons did
 not read at all, because the eye met the boxes first. The icon alone, at
 the weight the rest of the app uses. */}
                <Icon size={17} weight="regular" className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 truncate text-sm font-medium leading-tight">{r.label}</div>
                <div className="ml-auto text-right">
                  <div className={"text-xl font-bold tabular-nums leading-none " + (r.stat.days === null ? "text-muted-foreground" : r.accent)}>{fmtDays(r.stat.days)}</div>
                  <div className="mt-1 text-2xs text-muted-foreground">{r.stat.n ? (r.stat.n === 1 ? t("dash.oneOrder") : t("dash.nOrders", { n: r.stat.n })) : t("dash.noDataYet")}</div>
                </div>
              </div>
            )
          })}
          {/* On-time is the one that needs data to build up: est_delivery is only captured
 once a parcel starts moving, so it is honestly empty until orders ship. */}
          <div className="flex items-center gap-3 px-5 py-3">
            <SealCheck size={17} weight="regular" className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 truncate text-sm font-medium leading-tight">{tl("speed", "On-time vs ETA")}</div>
            <div className="ml-auto text-right">
              <div className={"text-xl font-bold tabular-nums leading-none " + (s.onTime.pct === null ? "text-muted-foreground" : s.onTime.pct >= 90 ? "text-success dark:text-emerald-400" : s.onTime.pct >= 75 ? "text-hold" : "text-red-600")}>{s.onTime.pct === null ? "—" : `${s.onTime.pct}%`}</div>
              <div className="mt-1 text-2xs text-muted-foreground">{s.onTime.n ? t("dash.ofDelivered", { n: s.onTime.n }) : t("dash.collecting")}</div>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  )
}
