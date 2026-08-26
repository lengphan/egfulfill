"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CaretDown, Check, Storefront, Wallet, Package } from "@phosphor-icons/react"
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

export function GetStarted({ orders, balance }: {
  /** Null while the dashboard is still loading — the banner waits rather than guessing. */
  orders: number | null
  balance: number | null
}) {
  const tl = useLabelT()
  // Read once, synchronously, so a finished account never even schedules the lookups.
  const [done, setDone] = useState<boolean>(() => read(DONE_KEY) === "1")
  const [open, setOpen] = useState<boolean>(() => read(OPEN_KEY) !== "0")
  const [stores, setStores] = useState<number | null>(null)

  useEffect(() => {
    if (done) return
    let live = true
    Promise.allSettled([getEtsyConnections(), getShopifyConnections(), getTiktokConnections()])
      .then((rs) => {
        if (!live) return
        const n = rs.reduce((sum, r) => sum + (r.status === "fulfilled" && Array.isArray(r.value) ? r.value.length : 0), 0)
        setStores(n)
      })
    return () => { live = false }
  }, [done])

  const hasStore = (stores ?? 0) > 0
  const hasFunds = (balance ?? 0) > 0
  const hasOrder = (orders ?? 0) > 0
  const ready = stores !== null && orders !== null && balance !== null
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
  if (done || !ready || allDone) return null

  const steps = [
    { id: "store", ok: hasStore, icon: Storefront, href: "/stores",
      label: tl("getStarted", "Connect a store"),
      body: tl("getStarted", "Sign in to Etsy, Shopify or TikTok Shop. Existing orders import straight away."),
      cta: tl("getStarted", "Connect a store") },
    { id: "funds", ok: hasFunds, icon: Wallet, href: "/wallet",
      label: tl("getStarted", "Fund the wallet"),
      body: tl("getStarted", "An order is charged when you submit it, and refunded in full if you cancel before production."),
      cta: tl("getStarted", "Top up") },
    { id: "order", ok: hasOrder, icon: Package, href: "/orders/new",
      label: tl("getStarted", "Send your first order"),
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
          {steps.map((s) => (
            <span
              key={s.id}
              className={
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs " +
                (s.ok ? "text-muted-foreground"
                  : s === next ? "border border-border bg-card font-semibold text-foreground"
                  : "text-muted-foreground")
              }
            >
              {s.ok
                ? <Check size={11} weight="bold" className="text-success" />
                : <s.icon size={11} weight="regular" />}
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
        <div className="flex flex-wrap items-center gap-4 border-t border-brand/30 px-4 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{next.label}</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{next.body}</p>
          </div>
          <Link
            href={next.href}
            className="eg-tap inline-flex h-9 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            {next.cta}
          </Link>
        </div>
      )}
    </section>
  )
}
