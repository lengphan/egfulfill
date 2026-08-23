"use client"

import type { Icon } from "@phosphor-icons/react"
import { RegionMark, REGION_LINE, REGION_NOTE, REGION_STACK, REGION_PAD } from "@/components/app/region"
import { cn } from "@/lib/utils"

/**
 * A REGION WITH NOTHING IN IT, that you cannot drop onto.
 *
 * Same four parts as Dropzone — see components/app/region.tsx for why they are those four.
 * The difference is only that this one has no target: nothing here accepts a file.
 *
 * SAY WHICH. CLAUDE.md's honesty rule lands hardest here: an empty state must never look
 * identical to a broken feature. "No orders yet" and "we couldn't load your orders" are
 * different sentences, and if the code cannot tell them apart it must say so rather than
 * pick the friendlier one.
 */
export function EmptyState({
  icon, title, note, action, size = "md", className,
}: {
  icon: Icon
  /** What is missing. One line, no full stop. */
  title: string
  /** Why, or what to do about it. One sentence. Optional. */
  note?: string
  /** At most one. */
  action?: React.ReactNode
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <div className={cn(REGION_STACK, REGION_PAD[size], className)}>
      <RegionMark icon={icon} size={size} />
      <div className={REGION_LINE[size]}>{title}</div>
      {note && <div className={REGION_NOTE[size]}>{note}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
