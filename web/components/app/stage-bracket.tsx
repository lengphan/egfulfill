"use client"

import { cn } from "@/lib/utils"
import { ALL_STATUSES } from "@/lib/factory-status"
import { canSetStage, stageDenialReason, lineFor } from "@/shared/order-rules"

/**
 * THE LADDER, AS A SHAPE — and, for a role that only owns part of it, WHICH PART.
 *
 * The order ladder is a branching thing: Draft → Pending → Approved → Working → Shipped with
 * on_hold hanging off the side of it. Every dashboard rendered that as a row of stat tiles, or
 * — on the seller's — as a single number called "Open orders", which is one figure for four
 * different situations.
 *
 * IT READS THE RULES, IT DOES NOT MIRROR THEM. The stages come from `lineFor()`, the labels
 * from `ALL_STATUSES`, and whether a block is this role's to set comes from `canSetStage` with
 * the refusal text from `stageDenialReason` — the same functions the server's gate is mirrored
 * against and that tools/check-order-rules.mjs executes. A fifth hand-kept copy of the stage
 * vocabulary is exactly how "Backorder" and "Printed" survived in three places after being
 * retired in one.
 *
 * WHY THE OUT-OF-ZONE BLOCKS ARE DRAWN AT ALL. An operator cannot set Working — that is the
 * warehouse's call, and the handover is the whole reason Approved and Working are two stages
 * rather than one. But they still need to see the floor's state, so those blocks are drawn
 * dashed and quiet rather than dropped. `stageDenialReason` exists, in its own words, "so a UI
 * can grey an option and say why, instead of silently dropping it from the menu and leaving
 * the rule unlearnable". This is that UI.
 */

/** Counts keyed by canonical stage id — "" is Draft. Missing keys read as zero. */
export type StageCounts = Record<string, number>
/** Optional per-stage channel split, keyed stage → channel → n. Drawn as a hairline under
 *  the figure. Absent is fine and draws nothing; it is never invented. */
export type StageMix = Record<string, Record<string, number>>

const MIX_CLASS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"]

export function StageBracket({
  role,
  isFactory,
  counts,
  mix,
  onPick,
  className,
}: {
  /** The viewer's role. Drives the zone — and admin, having the whole ladder, sees no dashes. */
  role: string
  /** Factory roles drop `in_review` from the line; a seller keeps it. `lineFor` owns that. */
  isFactory?: boolean
  counts: StageCounts
  mix?: StageMix
  /** A block is a link into the queue at that stage. Out-of-zone blocks still navigate —
   *  looking is not setting. */
  onPick?: (stage: string) => void
  className?: string
}) {
  const line = lineFor(isFactory)
  const labelOf = (id: string) => ALL_STATUSES.find((s) => s.id === id)?.label ?? id

  /**
   * THE DASHES MARK A BOUNDARY, so a role with no boundary gets none.
   *
   * An admin owns the whole ladder and a seller owns none of it — neither is being shown
   * where their reach ends, because neither has one here. Dashing all five on the seller's
   * own dashboard reads as "none of this is yours", which is both discouraging and beside
   * the point: on that page the ladder is information about their orders, not a row of
   * controls they are being refused. The treatment is only meaningful for the two roles
   * that own PART of the line — operator up to Approved, warehouse from it.
   */
  const owned = line.filter((id, i) => canSetStage(role, line[i - 1] ?? "", id, isFactory)).length
  const showsZone = owned > 0 && owned < line.length

  const block = (id: string, i: number, exception?: boolean) => {
    // "Can this role put an order INTO this stage, coming from the one before it?" — which is
    // the question the ladder is actually asking. Draft has nothing before it, so it asks
    // about itself.
    const from = exception ? "working" : (line[i - 1] ?? "")
    const allowed = !showsZone || canSetStage(role, from, id, isFactory)
    const why = allowed ? null : stageDenialReason(role, from, id, isFactory)
    const n = counts[id] ?? 0
    const split = Object.entries(mix?.[id] ?? {}).filter(([, v]) => v > 0)

    return (
      <button
        key={id}
        type="button"
        onClick={() => onPick?.(id)}
        title={why ?? undefined}
        className={cn(
          "eg-tap min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
          exception
            ? "border-hold/40 bg-hold/10 text-hold hover:bg-hold hover:text-background"
            : allowed
              ? "border-border bg-card hover:bg-primary hover:text-primary-foreground"
              : "border-dashed border-border bg-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        <div className="eg-label truncate opacity-75">{labelOf(id)}</div>
        {/* The refusal reaches a screen reader too. `title` alone is a hover affordance, and
            the whole point of these strings is that the rule should be learnable. */}
        {why && <span className="sr-only">{why}</span>}
        <div className="mt-0.5 text-xl font-semibold tabular-nums leading-tight">{n}</div>
        {split.length > 0 && (
          <div className="mt-1.5 flex h-1 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {split.map(([name, v], j) => (
              <span key={name} className={MIX_CLASS[j % MIX_CLASS.length]} style={{ flexGrow: v }} />
            ))}
          </div>
        )}
      </button>
    )
  }

  return (
    <div className={cn("flex items-stretch gap-1.5", className)}>
      {line.map((id, i) => block(id, i))}
      {/* The branch, not a stage. It sits after a gap because work at on_hold has LEFT the
          ladder rather than advanced along it — and Backorder and Flagged fold onto it, so
          this one block is every stop the system still has. */}
      <div className="w-2 shrink-0" aria-hidden />
      {block("on_hold", line.length, true)}
    </div>
  )
}
