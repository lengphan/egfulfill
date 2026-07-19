"use client"

import { CheckCircle } from "@phosphor-icons/react"
import { orderReadiness } from "@/lib/order-format"
import type { OrderRow } from "@/lib/api"

/**
 * What's stopping this order shipping — named, all of it, without hovering.
 *
 * This replaced a five-dot pipeline. Dots looked tidy but failed the actual job: they
 * showed only the FIRST blocker in words, so you'd fix that, come back, and find another
 * one waiting. And an unlabelled dot needs a hover to say which check it is, which is the
 * opposite of at-a-glance.
 *
 * So: don't render the checklist, render the GAPS. A production board doesn't need a
 * progress bar — everything done is the normal case and deserves one quiet word, while
 * anything missing needs naming. Nothing hides behind a tooltip, and an order with three
 * problems says three things.
 */

export function ReadinessStrip({ order, missingArtwork, className }: {
  order: OrderRow
  /** Pass when known; omitted leaves artwork out rather than claiming it's missing. */
  missingArtwork?: boolean
  className?: string
}) {
  const gaps = orderReadiness(order, { missingArtwork }).filter((c) => c.met === false)

  if (!gaps.length) {
    return (
      <span className={"inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 " + (className ?? "")}>
        <CheckCircle size={12} weight="fill" /> Ready
      </span>
    )
  }

  return (
    <span className={"inline-flex flex-wrap items-center gap-1 " + (className ?? "")}>
      {gaps.map((g) => (
        <span
          key={g.id}
          title={g.detail}
          className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
        >
          {g.blocked ?? g.label}
        </span>
      ))}
    </span>
  )
}
