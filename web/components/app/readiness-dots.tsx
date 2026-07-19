"use client"

import { orderReadiness, type Check } from "@/lib/order-format"
import type { OrderRow } from "@/lib/api"

/**
 * The order's readiness as a five-dot pipeline: Address → Artwork → Label → Printed →
 * Scanned, in the sequence they actually happen.
 *
 * The whole point is answering "is this ready, and if not what's missing?" at a glance,
 * across a board of fifty rows, without opening anything. So it reads left-to-right like
 * the work does, and the FIRST unmet dot is where the order is stuck — which is the one
 * question anyone actually has.
 *
 * Each dot is a fact (see orderReadiness), not a pipeline stage. Colour is used sparingly
 * to stay within the palette: filled = done, hollow = not yet, and only the blocking dot
 * is tinted, so a board of ready orders stays quiet and a stuck one draws the eye.
 */

export function ReadinessDots({ order, missingArtwork, className }: {
  order: OrderRow
  /** Pass when known; omitted leaves the artwork dot as not-applicable rather than failed. */
  missingArtwork?: boolean
  className?: string
}) {
  const checks = orderReadiness(order, { missingArtwork })
  const applicable = checks.filter((c) => c.met !== null)
  const firstUnmet = applicable.find((c) => !c.met)

  return (
    <span
      className={"inline-flex items-center gap-1.5 " + (className ?? "")}
      title={checks.map((c) => `${c.label}: ${c.met === null ? "n/a" : c.met ? "done" : (c.detail || "not yet")}`).join("\n")}
    >
      <span className="inline-flex items-center">
        {checks.map((c, i) => (
          <span key={c.id} className="inline-flex items-center">
            {i > 0 && <span className={"h-px w-2 " + (c.met ? "bg-foreground/25" : "bg-border")} />}
            <Dot check={c} blocking={c.id === firstUnmet?.id} />
          </span>
        ))}
      </span>
      <span className={"text-[11px] font-medium " + (firstUnmet ? "text-amber-700" : "text-muted-foreground")}>
        {firstUnmet ? (firstUnmet.blocked ?? `needs ${firstUnmet.label.toLowerCase()}`) : "ready to ship"}
      </span>
    </span>
  )
}

function Dot({ check, blocking }: { check: Check; blocking: boolean }) {
  // Not applicable reads as a faint tick mark rather than a gap — an undecorated blank
  // isn't "missing artwork", and showing it as unmet would send someone looking for a
  // problem that doesn't exist.
  if (check.met === null) {
    return <span className="size-2 rounded-full border border-dashed border-border" aria-label={`${check.label}: not applicable`} />
  }
  if (check.met) {
    return <span className="size-2 rounded-full bg-foreground/70" aria-label={`${check.label}: done`} />
  }
  return (
    <span
      className={"size-2 rounded-full border " + (blocking ? "border-amber-500 bg-amber-400/40" : "border-border")}
      aria-label={`${check.label}: ${check.detail || "not yet"}`}
    />
  )
}
