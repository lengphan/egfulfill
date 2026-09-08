"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, useReducedMotion, type PanInfo } from "motion/react"
import { CaretRight, Check, Minus } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { getUser } from "@/lib/auth"
import {
  getDesignLibrary, getEtsyConnections, getOrders, getShopifyConnections, getTeam,
  getTiktokConnections, getWallet,
} from "@/lib/api"
import { sellerStatus } from "@/lib/order-status"

/**
 * THE SETUP GUIDE — a checklist over the board, that gets out of the way.
 *
 * It replaces the get-started strip that used to sit on the dashboard alone. Same three
 * ideas, kept exactly:
 *
 *   CHECKS, NOT CLICKS. A step is done because the product says so — a connection exists,
 *   the wallet holds money, an order left Draft — never because someone tapped "done".
 *   Nobody is asked to connect a store they already connected.
 *
 *   UNKNOWN IS NOT ZERO (CLAUDE.md §4). If a lookup fails, the guide says nothing at all
 *   rather than nag for something that may already be done. A failed check and a genuinely
 *   empty account must not look the same.
 *
 *   IT RETIRES ITSELF. When every required step is done it renders nothing, permanently,
 *   and the lookups stop running. No dismiss, no state to explain.
 *
 * What is new is that it follows the person: it mounts once in the seller shell, so it is
 * on every page rather than one. Open, it is a panel docked to a corner. Minimised, it is a
 * pill carrying the count, which can be dragged to any corner — the corner is remembered.
 * It opens by itself exactly once, on the first visit; after that it is the person's call.
 *
 * THE EFFECT CANNOT LOOP (§2.8). It fires on mount, and depends on nothing it writes:
 * `done` is read before it runs and the fetch's result lands in state it does not read.
 */

const DONE_KEY = "eg_setup_done"
const OPEN_KEY = "eg_setup_open"
const CORNER_KEY = "eg_setup_corner"

type Corner = "tl" | "tr" | "bl" | "br"
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"]

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/* Bottom-LEFT by default: the chat launcher owns bottom-right on every page. */
const DEFAULT_CORNER: Corner = "bl"

/**
 * WHERE EACH CORNER PUTS THE THING — one complete class string per corner, never a base
 * string plus an override.
 *
 * Two things bit here and both are invisible in the markup. Tailwind resolves conflicting
 * utilities by their order in the STYLESHEET, not in the class attribute, so a base
 * `sm:bottom-auto` and a corner's `sm:bottom-5` is a coin toss — the panel rendered anchored
 * to a corner it was not assigned and ran off the bottom of the viewport. And `fixed` is
 * relative to the viewport, not to the shell's padded column, so a left-hand corner at
 * `left-5` sits ON the sidebar rail. Left corners clear the expanded rail from md up.
 */
const PILL_POS: Record<Corner, string> = {
  tl: "left-5 top-20 md:left-64",
  tr: "right-5 top-20",
  bl: "left-5 bottom-5 md:left-64",
  // The chat launcher is bottom-right on every page: sit above it, not on it.
  br: "right-5 bottom-20",
}
const PANEL_POS: Record<Corner, string> = {
  tl: "sm:left-5 sm:top-20 sm:bottom-auto md:left-64",
  tr: "sm:right-5 sm:top-20 sm:bottom-auto",
  bl: "sm:left-5 sm:bottom-5 sm:top-auto md:left-64",
  br: "sm:right-5 sm:bottom-20 sm:top-auto",
}

type Check = boolean | "unknown" | null

export function SetupGuide() {
  const tl = useLabelT()
  const pathname = usePathname()
  const reduced = useReducedMotion()

  // Read once, synchronously, so a finished account never even schedules the lookups.
  const [done, setDone] = useState<boolean>(() => read(DONE_KEY) === "1")
  const [open, setOpen] = useState<boolean>(() => read(OPEN_KEY) !== "0")
  const [corner, setCorner] = useState<Corner>(() => {
    const c = read(CORNER_KEY)
    return CORNERS.includes(c as Corner) ? (c as Corner) : DEFAULT_CORNER
  })

  const [stores, setStores] = useState<Check>(null)
  const [funds, setFunds] = useState<Check>(null)
  const [design, setDesign] = useState<Check>(null)
  const [order, setOrder] = useState<Check>(null)
  const [team, setTeam] = useState<Check>(null)

  useEffect(() => {
    if (done) return
    let live = true
    Promise.allSettled([
      getEtsyConnections(), getShopifyConnections(), getTiktokConnections(),
      getWallet(), getOrders(), getDesignLibrary(), getTeam(),
    ]).then(([etsy, shopify, tiktok, wallet, orders, library, members]) => {
      if (!live) return
      // Every connection lookup must answer. One rejection means we cannot say whether a
      // shop is connected — allSettled would otherwise fold that into a confident zero.
      const conns = [etsy, shopify, tiktok]
      const answered = conns.every((r) => r.status === "fulfilled" && Array.isArray(r.value))
      setStores(answered
        ? conns.reduce((n, r) => n + (r as PromiseFulfilledResult<unknown[]>).value.length, 0) > 0
        : "unknown")
      setFunds(wallet.status === "fulfilled" ? (wallet.value.balance ?? 0) > 0 : "unknown")
      // "Sent" means it left Draft — the same word the queue uses for the seller.
      setOrder(orders.status === "fulfilled" && Array.isArray(orders.value)
        ? orders.value.some((o) => sellerStatus(o).group !== "draft")
        : "unknown")
      setDesign(library.status === "fulfilled" && Array.isArray(library.value)
        ? library.value.length > 0
        : "unknown")
      // A team member's own /api/team is a refusal, not an empty team — and the step is
      // optional anyway, so a refusal simply hides the row rather than the guide.
      setTeam(members.status === "fulfilled" && Array.isArray(members.value)
        ? members.value.length > 0
        : "unknown")
    })
    return () => { live = false }
  }, [done])

  const required = [stores, funds, design, order]
  const ready = required.every((c) => c !== null)
  const unverifiable = required.some((c) => c === "unknown")
  const allDone = ready && required.every((c) => c === true)

  // Latch the finished state so the lookups stop happening on every later visit.
  // Deferred a tick: react-hooks/set-state-in-effect forbids setting state straight from an
  // effect, and setTimeout(fn, 0) is the pattern the rest of the app pages already use.
  useEffect(() => {
    if (!allDone || done) return
    const id = setTimeout(() => { write(DONE_KEY, "1"); setDone(true) }, 0)
    return () => clearTimeout(id)
  }, [allDone, done])

  const minimise = useCallback(() => { write(OPEN_KEY, "0"); setOpen(false) }, [])
  const expand = useCallback(() => { write(OPEN_KEY, "1"); setOpen(true) }, [])

  /* The pill lands in whichever corner is nearest to where it was let go. The element is
     keyed by corner, so it remounts at the new position with no leftover transform. */
  const onDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const x = info.point.x, y = info.point.y
    const c: Corner = `${y < window.innerHeight / 2 ? "t" : "b"}${x < window.innerWidth / 2 ? "l" : "r"}` as Corner
    write(CORNER_KEY, c)
    setCorner(c)
  }, [])

  // Sellers only; staff have their own boards and, for now, no guide.
  const role = getUser()?.role
  if (role && role !== "seller") return null
  // Nothing to say while loading, nothing once finished, nothing we cannot stand behind.
  if (done || !ready || allDone || unverifiable) return null
  // The chat page owns the whole viewport on phones; the pill would sit on the composer.
  if (pathname === "/chat") return null

  const steps = [
    { id: "store", ok: stores === true, href: "/stores",
      label: tl("setup", "Connect a store"), sub: tl("setup", "Etsy, Shopify or TikTok Shop") },
    { id: "funds", ok: funds === true, href: "/wallet",
      label: tl("setup", "Fund the wallet"), sub: tl("setup", "Charged on submit, refunded on cancel") },
    { id: "design", ok: design === true, href: "/design",
      label: tl("setup", "Upload a design"), sub: tl("setup", "Map it to a product once") },
    { id: "order", ok: order === true, href: "/orders/new",
      label: tl("setup", "Send your first order"), sub: tl("setup", "Pick a blank, place the artwork") },
    // Optional, and hidden entirely when the team lookup was refused (a member, not an owner).
    ...(team === "unknown" ? [] : [{ id: "team", ok: team === true, href: "/settings",
      label: tl("setup", "Invite a teammate"), sub: tl("setup", "Optional · under your wallet"), optional: true }]),
  ]
  const total = steps.length
  const doneCount = steps.filter((s) => s.ok).length
  const count = `${doneCount}/${total}`

  const spring = reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 32 }

  if (!open) {
    return (
      <motion.button
        key={corner}
        type="button"
        onClick={expand}
        drag
        dragMomentum={false}
        dragElastic={0.2}
        onDragEnd={onDragEnd}
        whileTap={{ scale: 0.96 }}
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
        aria-label={tl("setup", "Open the setup guide")}
        title={`${tl("setup", "Set up your shop")} · ${count}`}
        className={"fixed z-40 flex size-12 cursor-grab touch-none select-none items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground ring-1 ring-foreground/10 active:cursor-grabbing " + PILL_POS[corner]}
      >
        {count}
      </motion.button>
    )
  }

  return (
    <>
    {/* CLICK ANYWHERE ELSE TO PUT IT AWAY. Invisible and full-bleed — it paints nothing, so
        the page is never dimmed for a panel that is not a modal (the same call made for the
        chat launcher; see the note there). It only has to beat the page, not the panel:
        z-30 sits under the panel's z-40, so a click INSIDE lands on the panel as before.
        Minimising rather than dismissing, so the pill stays and the checklist is one press
        away — clicking off is "not now", never "I am done with this". */}
    <div aria-hidden onClick={minimise} className="fixed inset-0 z-30" />
    <motion.section
      key={`panel-${corner}`}
      role="dialog"
      aria-label={tl("setup", "Set up your shop")}
      initial={reduced ? false : { y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={spring}
      className={"fixed inset-x-3 bottom-3 z-40 flex max-h-[min(36rem,calc(100svh-7rem))] w-auto flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/15 sm:inset-x-auto sm:w-[22.5rem] dark:ring-foreground/20 " + PANEL_POS[corner]}
    >
      {/* THE PLATE: the app's brand fill, so it takes the skin — never a colour of its own. */}
      <div className="bg-brand px-4 pb-3.5 pt-3.5 text-brand-foreground">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] opacity-75">
              {tl("setup", "Seller")} · {doneCount} {tl("setup", "of")} {total}
            </p>
            <h2 className="font-title mt-0.5 text-xl font-semibold tracking-tight">{tl("setup", "Set up your shop")}</h2>
          </div>
          <button
            type="button"
            onClick={minimise}
            aria-label={tl("setup", "Minimise")}
            className="eg-tap -mr-1 -mt-1 inline-flex size-8 items-center justify-center rounded-full opacity-80 hover:bg-brand-foreground/15 hover:opacity-100"
          >
            <Minus size={14} weight="bold" />
          </button>
        </div>
        {/* One segment per step — a length, not a numeral in a circle. */}
        <div className="mt-3 flex gap-1" aria-hidden>
          {steps.map((s) => (
            <span key={s.id} className={"h-1 flex-1 rounded-full " + (s.ok ? "bg-brand-foreground" : "bg-brand-foreground/25")} />
          ))}
        </div>
      </div>

      <ol className="grid gap-2 overflow-y-auto p-2.5">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              href={s.href}
              onClick={minimise}
              className="eg-tap grid grid-cols-[20px_1fr_14px] items-center gap-3 rounded-xl border border-border px-3 py-2.5 hover:bg-accent"
            >
              <span
                aria-hidden
                className={"flex size-[18px] items-center justify-center rounded-full border-2 " +
                  (s.ok ? "border-shipped bg-shipped text-white" : "border-border")}
              >
                {s.ok && <Check size={10} weight="bold" />}
              </span>
              <span className="min-w-0">
                <span className={"block text-sm font-semibold " + (s.ok ? "text-muted-foreground line-through decoration-muted-foreground/50" : "")}>{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.sub}</span>
              </span>
              <CaretRight size={12} weight="bold" className="text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ol>
    </motion.section>
    </>
  )
}
