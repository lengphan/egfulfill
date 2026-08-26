"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CaretDown, CaretRight, Check } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { getEtsyConnections, getShopifyConnections, getTiktokConnections } from "@/lib/api"

/**
 * THE GET-STARTED BANNER — over the board, not instead of it.
 *
 * A new seller's dashboard is four dashes and an empty list, which reads as broken rather
 * than as new. The answer is not a separate first-run SCREEN that later vanishes: it is a
 * strip on top of the real board, so the same page serves someone on day one and on day two
 * hundred, and nothing has to be swapped out underneath them.
 *
 * IT RETIRES ITSELF. When every step is done it renders nothing, permanently — there is no
 * "dismiss" to hunt for and no state to explain. Collapse is separate and remembered: it is
 * for someone who knows what is left and does not want to read it every visit.
 *
 * WHY IT COSTS NOTHING ONCE YOU ARE SET UP. The three connection lookups are the only new
 * requests on this page, and they do not run at all when the banner is already finished —
 * `done` is read synchronously from localStorage before the effect decides. So a seller who
 * completed onboarding pays for this exactly once, on the load that completed it.
 *
 * THE EFFECT CANNOT LOOP (CLAUDE.md §2.8). It fires on mount and depends on nothing it
 * writes: `done` is a value the fetch cannot change, and the fetch's own result lands in
 * state the effect does not read. That is the shape the rule asks for — a condition its own
 * result cannot re-satisfy — rather than a guard bolted onto a condition that can.
 */

const DONE_KEY = "eg_getstarted_done"
const OPEN_KEY = "eg_getstarted_open"

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export function GetStarted({ orders, balance, clip }: {
  /** A short screen-recording for the open step, if one has been uploaded. Absent is a real
   *  answer — the copy simply takes the width. A grey rectangle where a film should be is
   *  the placeholder this codebase already deleted once from the marketing hero. */
  clip?: string
  /** Null while the dashboard is still loading — the banner waits rather than guessing. */
  orders: number | null
  balance: number | null
}) {
  const tl = useLabelT()
  // Read once, synchronously, so a finished account never even schedules the lookups.
  const [done, setDone] = useState<boolean>(() => read(DONE_KEY) === "1")
  const [open, setOpen] = useState<boolean>(() => read(OPEN_KEY) !== "0")
  /** Number of connected shops, or "unknown" when a lookup did not answer. A failed check
   *  and a genuinely empty account must NOT look the same (CLAUDE.md §4) — the first is our
   *  problem, the second is the seller's, and nagging someone to connect a store they
   *  already have because a request 403'd is the worst version of this banner. */
  const [stores, setStores] = useState<number | "unknown" | null>(null)

  useEffect(() => {
    if (done) return
    let live = true
    Promise.allSettled([getEtsyConnections(), getShopifyConnections(), getTiktokConnections()])
      .then((rs) => {
        if (!live) return
        // Every lookup must answer. One rejection means we cannot say whether a shop is
        // connected — allSettled would otherwise fold that into a confident zero.
        const answered = rs.every((r) => r.status === "fulfilled" && Array.isArray(r.value))
        if (!answered) { setStores("unknown"); return }
        setStores(rs.reduce((sum, r) => sum + (r as PromiseFulfilledResult<unknown[]>).value.length, 0))
      })
    return () => { live = false }
  }, [done])

  const known = typeof stores === "number"
  const hasStore = known && stores > 0
  const hasFunds = (balance ?? 0) > 0
  const hasOrder = (orders ?? 0) > 0
  const ready = stores !== null && orders !== null && balance !== null
  // Could not check the shops: say nothing rather than ask for something already done.
  const unverifiable = stores === "unknown"
  const allDone = ready && hasStore && hasFunds && hasOrder

  // Latch the finished state so the lookups stop happening on every later visit.
  // Deferred a tick: react-hooks/set-state-in-effect forbids setting state straight from an
  // effect, and setTimeout(fn, 0) is the pattern the rest of the app pages already use.
  useEffect(() => {
    if (!allDone || done) return
    const id = setTimeout(() => { write(DONE_KEY, "1"); setDone(true) }, 0)
    return () => clearTimeout(id)
  }, [allDone, done])

  const toggle = useCallback(() => {
    setOpen((o) => { write(OPEN_KEY, o ? "0" : "1"); return !o })
  }, [])

  // Nothing to say while the page is still loading, and nothing to say once it is finished.
  if (done || !ready || allDone || unverifiable) return null

  const steps = [
    { id: "store", ok: hasStore, href: "/stores",
      label: tl("getStarted", "Connect a store"),
      headline: tl("getStarted", "Bring your first store in."),
      body: tl("getStarted", "Sign in to Etsy, Shopify or TikTok Shop. Existing orders import straight away."),
      cta: tl("getStarted", "Connect a store") },
    { id: "funds", ok: hasFunds, href: "/wallet",
      label: tl("getStarted", "Fund the wallet"),
      headline: tl("getStarted", "Put something in the wallet."),
      body: tl("getStarted", "An order is charged when you submit it, and refunded in full if you cancel before production."),
      cta: tl("getStarted", "Top up") },
    { id: "order", ok: hasOrder, href: "/orders/new",
      label: tl("getStarted", "Send your first order"),
      headline: tl("getStarted", "Send us your first order."),
      body: tl("getStarted", "Pick a blank, place your artwork, and submit it to the floor."),
      cta: tl("getStarted", "New order") },
  ]
  const doneCount = steps.filter((s) => s.ok).length
  const next = steps.find((s) => !s.ok)

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/40 bg-brand/10">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-sm font-semibold">{tl("getStarted", "Get started")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {steps.map((s, n) => (
            <span
              key={s.id}
              className={
                "inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs " +
                (s === next ? "border border-border bg-card font-semibold text-foreground" : "text-muted-foreground")
              }
            >
              <span
                className={
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums " +
                  (s.ok ? "bg-success/15 text-success"
                    : s === next ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground")
                }
              >
                {s.ok ? <Check size={9} weight="bold" /> : n + 1}
              </span>
              {s.label}
            </span>
          ))}
        </div>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {doneCount} {tl("getStarted", "of")} {steps.length}
        </span>
        <button
          type="button"
          onClick={toggle}
          className="eg-tap inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={open}
        >
          {open ? tl("getStarted", "Collapse") : tl("getStarted", "Expand")}
          <CaretDown size={11} weight="bold" className={"transition-transform " + (open ? "" : "-rotate-90")} />
        </button>
      </div>

      {open && next && (
        <div className="flex flex-wrap items-center gap-6 border-t border-brand/30 px-4 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">{next.headline}</h2>
            <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{next.body}</p>
            <Link
              href={next.href}
              className="eg-tap mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              {next.cta} <CaretRight size={12} weight="bold" />
            </Link>
          </div>
          {clip && (
            /* eslint-disable-next-line @next/next/no-img-element -- an admin-supplied URL. */
            <img src={clip} alt="" className="hidden h-[168px] w-[300px] shrink-0 rounded-xl object-cover sm:block" />
          )}
        </div>
      )}
    </section>
  )
}
