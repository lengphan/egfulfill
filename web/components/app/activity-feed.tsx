"use client"

import type { ReactNode } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { actionMeta, actorName } from "@/components/app/activity-meta"
import type { AuditRow } from "@/lib/api"

// The money an audited action moved, when it recorded one — a charge/refund/payout carries
// it in `after` (fields vary by action: amount, total, charged…). Surfaced as a small chip so
// "how much was charged" is answerable straight from the log. Null when the action isn't money.
const MONEY_FIELDS = ["amount", "amount_usd", "total", "charged", "refunded", "delta", "paid"]
function moneyOf(r: AuditRow): number | null {
  const a = r.after
  if (!a) return null
  for (const f of MONEY_FIELDS) {
    const v = a[f]
    const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null)
    if (n != null && n !== 0) return n
  }
  return null
}
const fmtMoney = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The one activity feed, used everywhere audit_log is shown — order page, dispatch board,
 * readiness popover, designer board. Each row reads as a quiet sentence:
 *
 *     [icon]  **Helen** moved  Card 13 · incoming → in progress            Jul 24
 *
 * A neutral (grey) icon carries the type, the actor is the bold subject, the verb is muted,
 * the subject/detail is plain. No colour, no pills. The look is defined once here and the
 * action→wording once in activity-meta, so no two feeds can drift again.
 *
 * `variant` handles the container (a bordered card on its own, or bare when it already sits
 * inside one — a band, a popover, a SectionCard). `compact` is the popover density. `subject`
 * renders the object of the verb (a card title, a lane move); order/dispatch actions are
 * self-contained and pass none. Rows render in the order given — the caller decides newest-
 * or oldest-first, because a dispatch timeline reads forward and a history reads backward.
 */
const fmtWhen = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""

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
  /** Append the audit note to the sentence when a row carries one (order/dispatch feeds). */
  note?: boolean
  /** The object of the verb — a card title, a "from → to". Order/dispatch actions pass none. */
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

  const wrap = variant === "card" ? "divide-y divide-border overflow-hidden rounded-xl border border-border " : ""

  return (
    <div className={wrap + (className ?? "")}>
      {rows.map((r, i) => {
        const m = actionMeta(r.action)
        const Icon = m.icon
        const subj = subject ? subject(r) : null
        const who = actorName(r)
        const when = fmtWhen(r.ts)

        if (compact) {
          return (
            <div key={String(r.id ?? i)} className="rounded px-2 py-1.5 leading-snug hover:bg-accent">
              <div className="flex items-start gap-2 text-xs">
                <Icon size={13} weight="regular" className="mt-[2px] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{who}</span>{" "}
                  <span className="text-muted-foreground">{m.verb}</span>
                  {subj != null && <> {subj}</>}
                  {note && r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
                  {(() => { const amt = moneyOf(r); return amt != null ? <span className="font-semibold text-foreground"> · {fmtMoney(amt)}</span> : null })()}
                  <span className="text-muted-foreground/70"> · {when}</span>
                </span>
              </div>
            </div>
          )
        }

        return (
          <div key={String(r.id ?? i)} className="flex items-start gap-2.5 px-3 py-2 text-sm">
            <Icon size={15} weight="regular" className="mt-[3px] shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 leading-snug">
              <span className="font-medium text-foreground">{who}</span>{" "}
              <span className="text-muted-foreground">{m.verb}</span>
              {subj != null && <> {subj}</>}
              {note && r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
            </div>
            {(() => { const amt = moneyOf(r); return amt != null ? <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{fmtMoney(amt)}</span> : null })()}
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{when}</span>
          </div>
        )
      })}
    </div>
  )
}
