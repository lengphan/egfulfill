"use client"

import type { ReactNode } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { actionMeta, actorOf } from "@/components/app/activity-meta"
import type { AuditRow } from "@/lib/api"

/**
 * The one activity feed, used everywhere audit_log is shown — order page, dispatch board,
 * readiness popover, designer board. A row is: a colour-coded action pill, an optional
 * subject, then who and when. The look is defined once here and the action→badge mapping
 * once in activity-meta, so no two feeds can drift again.
 *
 * `variant` handles the container (a bordered card on its own, or bare when it already sits
 * inside one — a band, a popover, a SectionCard). `compact` is the popover density. `subject`
 * renders per-context detail (a card title, a lane move); with none, the pill + meta is the
 * whole row. Rows are rendered in the order given — the caller decides newest- or
 * oldest-first, because a dispatch timeline reads forward and a history reads backward.
 */
const fmtWhen = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""

function Pill({ action, compact }: { action: string; compact?: boolean }) {
  const m = actionMeta(action)
  const Icon = m.icon
  return (
    <span className={"inline-flex shrink-0 items-center gap-1 rounded-full font-semibold " + m.tone + (compact ? " px-1.5 py-0.5 text-[10px]" : " px-2 py-0.5 text-[11px]")}>
      <Icon size={compact ? 10 : 11} weight="bold" /> {m.label}
    </span>
  )
}

export function ActivityFeed({
  rows,
  variant = "card",
  compact = false,
  note = true,
  subject,
  loadingText,
  empty,
  className,
}: {
  rows: AuditRow[] | null
  variant?: "card" | "bare"
  compact?: boolean
  /** Append the audit note to the meta line when a row carries one (order/dispatch feeds). */
  note?: boolean
  /** Per-row middle content — a card title, a "from → to". Falls back to the note. */
  subject?: (r: AuditRow) => ReactNode
  loadingText?: ReactNode
  empty?: ReactNode
  className?: string
}) {
  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin" /> {loadingText ?? "Loading…"}
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className={"px-3 py-6 text-center text-sm text-muted-foreground " + (className ?? "")}>{empty ?? "Nothing recorded yet."}</div>
  }

  const wrap = variant === "card" ? "overflow-hidden rounded-xl border border-border " : ""

  return (
    <div className={wrap + (className ?? "")}>
      {rows.map((r, i) => {
        const m = actionMeta(r.action)
        const mid = subject ? subject(r) : (note && r.note ? <span className="text-muted-foreground">{r.note}</span> : null)
        const who = actorOf(r)
        const when = fmtWhen(r.ts)

        if (compact) {
          return (
            <div key={String(r.id ?? i)} className="rounded px-2 py-1.5 hover:bg-accent">
              <div className="flex items-center gap-2">
                <Pill action={r.action} compact />
                {mid && <span className="min-w-0 flex-1 truncate text-xs">{mid}</span>}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{who} · {when}</div>
            </div>
          )
        }

        return (
          <div
            key={String(r.id ?? i)}
            className={"flex items-center gap-3 px-3 py-2.5 text-sm " + (i ? "border-t border-border " : "") + (m.rowClass ?? "")}
          >
            <Pill action={r.action} />
            <span className="min-w-0 flex-1 truncate">{mid}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{who}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{when}</span>
          </div>
        )
      })}
    </div>
  )
}
