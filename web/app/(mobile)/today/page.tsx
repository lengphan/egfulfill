"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CaretRight, CircleNotch, Warning, Lightning, Barcode, ArrowClockwise } from "@phosphor-icons/react"
import { getOrders, type OrderRow } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { isOverdue } from "@/lib/order-filter"
import { normalizeStage } from "@/lib/factory-status"
import { useMounted } from "@/lib/use-mounted"

/*
 * TODAY — what needs you, in the order it needs you.
 *
 * Deliberately NOT the dashboard's tile grid. A tile is a number you read; on a phone,
 * standing up, holding one thing, what you want is a short list of jobs you can start. So
 * every line here is a destination with a count on it, and the screen is over in five rows.
 *
 * The counts are real — the same orders list every board reads, and the same isOverdue and
 * normalizeStage the console uses, so a number here can never disagree with the number you
 * see when you tap it.
 */

type Job = {
 key: string
 label: string
 hint: string
 href: string
 count: number
  /** Reserved status colours — amber warns, red alerts, violet is working. */
 tone: "alert" | "warn" | "work" | "quiet"
  /** Counts toward "needs you now". Work in progress does not: it is already happening. */
 urgent?: boolean
 icon: typeof Warning
}

const TONE: Record<Job["tone"], { dot: string; count: string }> = {
 alert: { dot: "bg-destructive", count: "text-destructive" },
 warn: { dot: "bg-hold", count: "text-hold" },
 work: { dot: "bg-primary", count: "text-primary" },
 quiet: { dot: "bg-muted-foreground/40", count: "text-foreground" },
}

export default function TodayPage() {
 const [orders, setOrders] = useState<OrderRow[] | null>(null)
 const [err, setErr] = useState<string | null>(null)
 const [busy, setBusy] = useState(false)
  /*
   * BOTH OF THESE ARE CLIENT-ONLY FACTS, and rendering them during SSR is a hydration
   * mismatch: the name comes from localStorage (absent on the server) and the date is
   * formatted in the server's locale and timezone, not yours.
   *
   * useSyncExternalStore with a no-op subscribe is the honest way to say "false on the
   * server, true once mounted" — no effect, no setState, and nothing for the
   * set-state-in-effect rule to catch.
   */
 const mounted = useMounted()
 const name = mounted ? (getUser()?.name?.split(" ")[0] || "there") : ""
 const today = mounted
    ? new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
 : ""

 const load = useCallback(async () => {
 setBusy(true); setErr(null)
 try { setOrders(await getOrders()) }
 catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load orders.") }
 finally { setBusy(false) }
  }, [])

  // Fetch on mount only. Refresh is a BUTTON — an effect that refetched on the state its own
  // fetch writes is the shape that took a machine down here once.
 useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

 const jobs = useMemo<Job[]>(() => {
 const os = orders ?? []
 const open = os.filter((o) => !["shipped", "cancelled", "refunded"].includes(normalizeStage(o.factory_status)))
 return [
      { key: "overdue", label: "Overdue", hint: "past the ship-by date", href: "/orders?status=overdue",
 count: open.filter((o) => isOverdue(o)).length, tone: "alert", icon: Warning, urgent: true },
      { key: "rush", label: "Rush", hint: "flagged urgent", href: "/orders?status=rush",
 count: open.filter((o) => o.rush).length, tone: "warn", icon: Lightning, urgent: true },
      { key: "working", label: "Working", hint: "on the floor now", href: "/orders",
 count: open.filter((o) => normalizeStage(o.factory_status) === "working").length, tone: "work", icon: ArrowClockwise },
      { key: "scan", label: "Awaiting scan", hint: "printed, not yet scanned", href: "/inventory?tab=scan",
 count: open.filter((o) => !!o.label_printed_at && !o.label_scanned_at).length, tone: "quiet", icon: Barcode },
    ]
  }, [orders])

 const needsYou = jobs.filter((j) => j.urgent).reduce((n, j) => n + j.count, 0)

 return (
    <div className="mx-auto max-w-lg">
      {/* HEADER. A greeting and the date, because the first thing you check on a phone is
 whether you are looking at today. No logo bar: the tab bar already says where you are. */}
      <header className="px-5 pb-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        {/* min-h holds the line's height before it fills, so the heading doesn't jump. */}
        <p className="min-h-5 text-sm text-muted-foreground">{today}</p>
        <h1 className="mt-0.5 text-3xl font-black tracking-tight">{name ? `Morning, ${name}` : "Today"}</h1>
      </header>

      {/* THE ONE NUMBER, and it is a door. Everything under it explains it. */}
      <section className="px-5">
        <Link
 href="/orders"
 className="block rounded-2xl bg-primary p-5 text-primary-foreground transition-transform active:scale-[0.99]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.08em] opacity-80">Needs you now</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[3.25rem] font-black leading-none tabular-nums">
              {orders === null ? "—" : needsYou}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-sm font-medium">
              Open queue <CaretRight size={14} weight="bold" />
            </span>
          </div>
          <p className="mt-2 text-xs opacity-75">
            {orders === null ? "Loading…" : needsYou === 0 ? "Nothing overdue or rushed" : "overdue and rush, across the floor"}
          </p>
        </Link>
      </section>

      {/* THE JOBS. Rows, not tiles — each one is somewhere to go. */}
      <section className="mt-5 px-5">
        <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">What needs doing</h2>
        <ul className="overflow-hidden rounded-2xl border border-border">
          {jobs.map((j, i) => {
 const Ico = j.icon
 return (
              <li key={j.key} className={i ? "border-t border-border" : ""}>
                <Link href={j.href} className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-accent/60">
                  <span className={"size-1.5 shrink-0 rounded-full " + TONE[j.tone].dot} />
                  <Ico size={18} weight="duotone" className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{j.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{j.hint}</span>
                  </span>
                  <span className={"shrink-0 text-lg font-bold tabular-nums " + TONE[j.tone].count}>
                    {orders === null ? "—" : j.count}
                  </span>
                  <CaretRight size={14} weight="bold" className="shrink-0 text-muted-foreground/50" />
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Say WHICH state this is. A blank list and a failed fetch must never look alike. */}
      {err && (
        <p className="mx-5 mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</p>
      )}
      {!err && orders !== null && needsYou === 0 && (
        <p className="mx-5 mt-4 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          Nothing overdue or rushed. The queue is clear.
        </p>
      )}

      <div className="px-5 py-6">
        <button
 onClick={load}
 disabled={busy}
 className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors active:bg-accent disabled:opacity-60"
        >
          {busy ? <CircleNotch size={15} className="animate-spin" /> : <ArrowClockwise size={15} />}
          {busy ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </div>
  )
}
