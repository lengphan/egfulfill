"use client"

import { useLabelT } from "@/lib/i18n"
import { useState, type ReactNode } from "react"
import { CaretRight, CircleNotch } from "@phosphor-icons/react"
import { actionMeta, actionDetail, actorName } from "@/components/app/activity-meta"
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
// Seconds included: two edits a moment apart are otherwise the same timestamp, and this
// log's job is telling them apart.
const fmtWhen = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""

/* ── THE GROUPED FEED ──────────────────────────────────────────────────────────────
 *
 * Measured on the production audit_log (2,363 order entries over 346 orders, 21 Sep 2026)
 * before any of this was drawn, because the panel's problem turned out not to be its
 * layout:
 *
 *   · the median order carries ONE person and ONE day — and reprinted both on every row
 *   · 46% of rows repeat the row above them
 *   · the worst order is 104 rows, 36 of which are one unbroken run of design.saved
 *     written by one person in ninety seconds while an artwork autosaved
 *   · only 5.5% of rows carry a note; the rest of that second line was boilerplate
 *
 * So two changes, and they are independent of each other:
 *
 *   RUNS   consecutive entries with the same action by the same person, no more than two
 *          minutes apart, become ONE row carrying a count and the span of time. Press it
 *          to see the individual writes — nothing is dropped. 2,363 rows → ~1,270.
 *   BANDS  the actor moves off the row and onto a band that appears when the person (or
 *          the day) CHANGES as you walk down the list. The list stays in strict time
 *          order — a person who comes back later gets a second band, in its right place,
 *          which is what separates this from grouping BY actor. 511 bands, not 2,363
 *          repetitions, and the name can then be a name: 14px ink rather than 11px grey.
 *
 * Opt-in, because this component is the one feed for the order page, the dispatch board,
 * the readiness popover and the designer board. The order history asked; the others read
 * differently (a dispatch timeline is many actors, few rows) and are not being redesigned
 * by a default. */

/** Same person? Falls back through the three actor spellings — see actorName. */
const actorKey = (r: AuditRow) => r.actor_name || r.actor_email || r.actor || r.actor_role || "system"
const dayKey = (ts: string | null | undefined) => (ts ? new Date(ts).toDateString() : "")
const fmtTime = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""
const fmtDay = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""

/**
 * A row that carries something a COUNT cannot: a note somebody typed, or money that moved.
 * Those never join a run — "Charged ×3" would swallow three different amounts, and a note
 * is the one part of an audit row nobody else wrote.
 */
const holdsUnique = (r: AuditRow) => Boolean(r.note && r.note.trim()) || moneyOf(r) != null

const RUN_GAP_MS = 120_000

/** Walk the rows IN THE ORDER GIVEN and gather adjacent ones into runs. Never sorts: the
 *  caller decides whether a feed reads forward or backward, and re-ordering here would put
 *  a dispatch timeline and a history into the same shape. */
function buildRuns(rows: AuditRow[]): AuditRow[][] {
  const out: AuditRow[][] = []
  for (const r of rows) {
    const run = out[out.length - 1]
    const prev = run?.[run.length - 1]
    const joins =
      prev != null &&
      prev.action === r.action &&
      actorKey(prev) === actorKey(r) &&
      dayKey(prev.ts) === dayKey(r.ts) &&
      !holdsUnique(prev) &&
      !holdsUnique(r) &&
      Math.abs(new Date(prev.ts).getTime() - new Date(r.ts).getTime()) <= RUN_GAP_MS
    if (joins) run.push(r)
    else out.push([r])
  }
  return out
}

export function ActivityFeed({
  rows,
  variant = "card",
  compact = false,
  grouped = false,
  note = true,
  subject,
  resolveLine,
  loadingText,
  empty,
  className,
}: {
  rows: AuditRow[] | null
  variant?: "card" | "bare"
  compact?: boolean
  /** Collapse repeated runs and band the feed by actor — see THE GROUPED FEED above.
   *  Ignored under `compact`, which is a popover of a handful of rows and has neither
   *  problem. */
  grouped?: boolean
  /** Append the audit note to the sentence when a row carries one (order/dispatch feeds). */
  note?: boolean
  /** Turns a line id or sku into something a person reads — "Item 1 · dc21". Without it,
   *  ids are dropped from the entry rather than printed raw. */
  resolveLine?: (key: string) => string | null
  /** The object of the verb — a card title, a "from → to". Order/dispatch actions pass none. */
  subject?: (r: AuditRow) => ReactNode
  loadingText?: ReactNode
  empty?: ReactNode
  className?: string
}) {
  const tl = useLabelT()
  /* Which runs the reader has opened. Keyed by the run's first row id, so it survives a
     refetch that returns the same rows, and it is EMPTY by default: a collapsed run is the
     point, and remembering an open one across orders would defeat it. */
  const [openRuns, setOpenRuns] = useState<Record<string, boolean>>({})
  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin" /> {loadingText ?? tl("activityFeed", "Loading…")}
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className={"px-3 py-6 text-center text-sm text-muted-foreground " + (className ?? "")}>{empty ?? tl("activityFeed", "Nothing recorded yet.")}</div>
  }

  // A list still needs its rows separated when it is bare — bare means "no card of my own",
  // not "no structure". Compact rows are the exception: they are hover-highlighted chips in
  // a popover, and hairlines between them read as a table nobody asked for.
  const wrap = variant === "card"
    ? "divide-y divide-border overflow-hidden rounded-xl border border-border "
    : (compact ? "" : "divide-y divide-border ")

  /* ── GROUPED: runs collapsed, actor on a band, strict time order ──────────────────
     Built as a flat list rather than nested <section>s per band, because the bands are
     NOT containers — they are markers on one continuous list, and nesting them would make
     a band that scrolls away take its rows with it. */
  if (grouped && !compact) {
    const runs = buildRuns(rows)
    const out: ReactNode[] = []
    let lastActor = ""
    let lastDay = ""
    for (const run of runs) {
      const head = run[0]
      const tail = run[run.length - 1]
      const who = actorKey(head)
      const day = dayKey(head.ts)
      if (who !== lastActor || day !== lastDay) {
        out.push(
          /* THE NAME IS A VALUE, SO IT IS SIZED LIKE ONE (§4). It was 11px grey on every
             row; here it is 14px ink on a band that appears only when the person changes.
             The date rides along only when the DAY changed too — a one-day order, which is
             the median, names its date once at the top and never again. */
          <div key={`band-${String(head.id)}`} className="flex items-baseline justify-between gap-3 bg-muted/50 px-3 py-2">
            <span className="min-w-0 truncate text-sm font-semibold">{actorName(head)}</span>
            {day !== lastDay && <span className="shrink-0 text-xs text-muted-foreground">{fmtDay(head.ts)}</span>}
          </div>
        )
        lastActor = who
        lastDay = day
      }

      const m = actionMeta(head.action)
      const subj = subject ? subject(head) : null
      const detail = subj == null ? actionDetail(head, resolveLine) : ""
      const amt = moneyOf(head)
      const many = run.length > 1
      const key = String(head.id)
      const isOpen = !!openRuns[key]
      const body = (
        <>
          {/* 5.5rem and nowrap: "09:42:59 AM" is eleven characters and broke onto two lines
              at 4.6rem, which turned every row into a two-line row to hold a timestamp. The
              seconds stay — two writes a moment apart are otherwise the same time, and
              telling them apart is this log's whole job. */}
          <span className="w-[5.5rem] shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground/80">{fmtTime(head.ts)}</span>
          <span className="min-w-0 flex-1 leading-snug">
            <span className="font-medium text-foreground">{m.label}</span>
            {many && (
              /* A COUNT, not a pill — §4 keeps capsules for things that carry meaning like
                 a stage. This is a number, so it reads as one. */
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">{run.length}</span>
            )}
            {subj != null && <span className="text-muted-foreground"> {subj}</span>}
            {detail && <span className="text-muted-foreground"> · {detail}</span>}
            {many && <span className="text-muted-foreground/70"> · {tl("activityFeed", "from")} {fmtTime(tail.ts)}</span>}
            {note && head.note && !many ? <span className="text-muted-foreground"> · {head.note}</span> : null}
          </span>
          {amt != null && <span className="shrink-0 rounded-lg bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">{fmtMoney(amt)}</span>}
          {many && <CaretRight size={12} weight="bold" className={"mt-1 shrink-0 text-muted-foreground transition-transform " + (isOpen ? "rotate-90" : "")} />}
        </>
      )

      out.push(
        many ? (
          /* A COLLAPSED RUN IS A CONTROL — it hides rows, so it has to say so and open.
             A run of one is not: making every row a button would put a focus ring and a
             hover state on a list nobody can press usefully. */
          <button
            key={key}
            type="button"
            onClick={() => setOpenRuns((p) => ({ ...p, [key]: !p[key] }))}
            aria-expanded={isOpen}
            className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent/60"
          >
            {body}
          </button>
        ) : (
          <div key={key} className="flex items-start gap-2.5 px-3 py-2 text-sm">{body}</div>
        )
      )

      if (many && isOpen) {
        for (const r of run) {
          const d = subject ? subject(r) : actionDetail(r, resolveLine)
          out.push(
            /* THE WRITES THEMSELVES. Indented under the run and quieter than it, so the
               list still reads as one column of events rather than as a second table. */
            <div key={`c-${String(r.id)}`} className="flex items-start gap-2.5 bg-muted/20 px-3 py-1.5 text-xs">
              <span className="w-[5.5rem] shrink-0 whitespace-nowrap text-right text-muted-foreground/70">{fmtTime(r.ts)}</span>
              <span className="min-w-0 flex-1 text-muted-foreground">{d || actionMeta(r.action).label}</span>
            </div>
          )
        }
      }
    }
    return <div className={wrap + (className ?? "")}>{out}</div>
  }

  return (
    <div className={wrap + (className ?? "")}>
      {rows.map((r, i) => {
        const m = actionMeta(r.action)
        const Icon = m.icon
        // The caller's own object wins; otherwise build one from what the row recorded.
        const subj = subject ? subject(r) : null
        const detail = subj == null ? actionDetail(r, resolveLine) : ""
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
                  {detail && <span className="font-medium text-foreground"> {detail}</span>}
                  {note && r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
                  {(() => { const amt = moneyOf(r); return amt != null ? <span className="font-semibold text-foreground"> · {fmtMoney(amt)}</span> : null })()}
                  <span className="text-muted-foreground/70"> · {when}</span>
                </span>
              </div>
            </div>
          )
        }

        // WHAT HAPPENED ON TOP, WHO AND WHEN UNDERNEATH. One long grey sentence with the
        // name first, the verb in the middle and the time at the far right meant the thing
        // that actually happened was the least visible part of the row.
        return (
          <div key={String(r.id ?? i)} className="flex items-start gap-2.5 px-3 py-2 text-sm">
            <Icon size={15} weight="regular" className="mt-[3px] shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 leading-snug">
              <div className="truncate">
                <span className="font-medium text-foreground">{m.label}</span>
                {subj != null && <span className="text-muted-foreground"> {subj}</span>}
                {detail && <span className="text-muted-foreground"> · {detail}</span>}
              </div>
              <div className="truncate text-2xs text-muted-foreground/80">
                {who}
                {note && r.note ? ` · ${r.note}` : ""}
                {" · "}{when}
              </div>
            </div>
            {(() => { const amt = moneyOf(r); return amt != null ? <span className="shrink-0 rounded-lg bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">{fmtMoney(amt)}</span> : null })()}
          </div>
        )
      })}
    </div>
  )
}
