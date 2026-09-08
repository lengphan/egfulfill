"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, useReducedMotion, type PanInfo } from "motion/react"
import { CaretRight, Minus } from "@phosphor-icons/react"
import { useLabelT } from "@/lib/i18n"
import { getUser } from "@/lib/auth"

/**
 * THE BOARD TOUR — three cards naming the board, the one thing you do on it, and where the
 * rest lives. Read once, then closed for good.
 *
 * IT IS DELIBERATELY NOT A CHECKLIST, and that is the whole design. The first pass gave every
 * staff role the seller's shape — claim an order, scan it through a stage, buy a label, each
 * ticking when the person had done it once. Two things are wrong with that:
 *
 *   IT MEASURES THE JOB, NOT THE SETUP. An operator who has claimed an order has not
 *   "finished onboarding" — they have done a Tuesday. Ticking it congratulates them for
 *   working, and then congratulates them again tomorrow.
 *
 *   IT WOULD NEED A SERVER ROUTE. "Has this person done X once" only lives in the audit log,
 *   so answering it means a new endpoint — for a checkbox that means nothing.
 *
 * The seller's checklist earns its keep because each step UNBLOCKS THE NEXT: no store means
 * no orders, no wallet means nothing can be submitted. Staff have no such chain. They arrive
 * at a board that already works and need to know what they are looking at. So this measures
 * nothing, fetches nothing, and adds no endpoint — see the note in setup-guide.tsx for the
 * half of this pair that DOES check, and why it is allowed to.
 *
 * Same panel, same pill, same corner behaviour as the seller's, so staff who have also seen
 * that one are not learning a second object.
 */

const CORNER_KEY = "eg_tour_corner"
/** Per ROLE, not per person: someone promoted from operator to admin gets the admin tour. */
const doneKey = (role: string) => `eg_tour_done_${role}`

type Corner = "tl" | "tr" | "bl" | "br"
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"]

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/* Bottom-LEFT by default: the chat launcher owns bottom-right on every board. */
const DEFAULT_CORNER: Corner = "bl"

/* One complete class string per corner — never a base plus an override. Tailwind resolves
   conflicting utilities by stylesheet order, not class order, so a base `sm:bottom-auto`
   against a corner's `sm:bottom-5` is a coin toss. See the longer note in setup-guide.tsx. */
const PILL_POS: Record<Corner, string> = {
  tl: "left-5 top-20 md:left-64",
  tr: "right-5 top-20",
  bl: "left-5 bottom-5 md:left-64",
  br: "right-5 bottom-20",
}
const PANEL_POS: Record<Corner, string> = {
  tl: "sm:left-5 sm:top-20 sm:bottom-auto md:left-64",
  tr: "sm:right-5 sm:top-20 sm:bottom-auto",
  bl: "sm:left-5 sm:bottom-5 sm:top-auto md:left-64",
  br: "sm:right-5 sm:bottom-20 sm:top-auto",
}

type Card = { title: string; body: string; where: string; href: string }

/**
 * EVERY LINE NAMES A PLACE THAT EXISTS TODAY, and `href` is where the person is sent.
 *
 * These are not feature blurbs. Each card is one thing the board will not tell you by
 * looking at it: which queue is actually yours, what has to happen before yours can, and
 * where your zone stops. The third card in each set is the boundary, because that is the
 * one that costs something when nobody says it out loud.
 */
const TOUR: Record<string, Card[]> = {
  operator: [
    { title: "Your queue is Orders", body: "Everything the floor is making, by stage.", where: "/production", href: "/production" },
    { title: "Artwork gets approved first", body: "A card has to clear the design board before anything prints.", where: "/designer", href: "/designer" },
    { title: "Your zone ends at scan", body: "Stage changes are yours. Anything that moves money is not.", where: "/inventory › Scan", href: "/inventory" },
  ],
  warehouse: [
    { title: "Stock lives in Inventory", body: "Levels on hand, and the in/out station beside them.", where: "/inventory", href: "/inventory" },
    { title: "Today's parcels are Dispatch", body: "A short queue you empty; the archive is the tab next to it.", where: "/shipping", href: "/shipping" },
    { title: "Labels are rate-shopped for you", body: "Cheapest across four carriers, bought at cost. You never pick one.", where: "/shipping › Dispatch", href: "/shipping" },
  ],
  designer: [
    { title: "Claim a card to start", body: "An unclaimed card is anyone's; a claimed one is yours.", where: "/designer", href: "/designer" },
    { title: "The file goes on the card", body: "Not on the order. The card carries it through review.", where: "card details", href: "/designer" },
    { title: "You are credited on approval", body: "Not on submission — approval is what pays.", where: "/earnings", href: "/earnings" },
  ],
  admin: [
    { title: "Put every key in the UI", body: "Keys saved here survived the August rebuild. Keys in .env did not.", where: "Settings › Integrations", href: "/settings" },
    { title: "Roles decide what people see", body: "Invite, then set the nav each role gets.", where: "Settings › Users · Permissions", href: "/settings" },
    { title: "Check a backup exists", body: "The nightly dump is what a rebuild restores from.", where: "Settings › Backups", href: "/settings" },
  ],
}

export function BoardTour() {
  const tl = useLabelT()
  const pathname = usePathname()
  const reduced = useReducedMotion()

  const role = getUser()?.role ?? ""
  const cards = TOUR[role]

  // Read synchronously, so someone who has seen it never renders the panel for a frame.
  const [done, setDone] = useState<boolean>(() => (role ? read(doneKey(role)) === "1" : true))
  const [open, setOpen] = useState(true)
  const [corner, setCorner] = useState<Corner>(() => {
    const c = read(CORNER_KEY)
    return CORNERS.includes(c as Corner) ? (c as Corner) : DEFAULT_CORNER
  })

  const minimise = useCallback(() => setOpen(false), [])
  const expand = useCallback(() => setOpen(true), [])
  const finish = useCallback(() => {
    if (role) write(doneKey(role), "1")
    setDone(true)
  }, [role])

  const onDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const x = info.point.x, y = info.point.y
    const c: Corner = `${y < window.innerHeight / 2 ? "t" : "b"}${x < window.innerWidth / 2 ? "l" : "r"}` as Corner
    write(CORNER_KEY, c)
    setCorner(c)
  }, [])

  // A role with no tour (or a seller who somehow reached a board) gets nothing at all.
  if (!cards || done) return null
  // The chat page owns the whole viewport on phones; the pill would sit on the composer.
  if (pathname === "/chat") return null

  const count = String(cards.length)
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
        aria-label={tl("tour", "Open the board guide")}
        title={tl("tour", "Getting around")}
        className={"fixed z-40 flex size-12 cursor-grab touch-none select-none items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground ring-1 ring-foreground/10 active:cursor-grabbing " + PILL_POS[corner]}
      >
        {count}
      </motion.button>
    )
  }

  return (
    <>
    {/* Click anywhere else to put it away — invisible, so the board is never dimmed for a
        panel that is not a modal. Minimises rather than finishes: clicking off is "not now",
        and only the button on the last card is "I have read this". */}
    <div aria-hidden onClick={minimise} className="fixed inset-0 z-30" />
    <motion.section
      key={`tour-${corner}`}
      role="dialog"
      aria-label={tl("tour", "Getting around")}
      initial={reduced ? false : { y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={spring}
      className={"fixed inset-x-3 bottom-3 z-40 flex w-auto flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-[0_28px_70px_-14px_rgb(0_0_0/0.45)] ring-1 ring-black/12 sm:inset-x-auto sm:w-[22.5rem] dark:ring-white/20 " + PANEL_POS[corner]}
    >
      {/* THE PLATE: the app's brand fill, so it takes the skin — never a colour of its own. */}
      <div className="bg-brand px-4 pb-3.5 pt-3.5 text-brand-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-2xs font-semibold uppercase tracking-[0.16em] opacity-70">
              {tl("role", role)} · {count}
            </div>
            <div className="mt-0.5 text-base font-semibold">{tl("tour", "Getting around")}</div>
          </div>
          <button
            type="button"
            onClick={minimise}
            aria-label={tl("tour", "Minimise")}
            className="-mr-1 -mt-1 rounded-lg p-1.5 opacity-70 transition-opacity hover:opacity-100"
          >
            <Minus size={14} weight="bold" />
          </button>
        </div>
      </div>

      {/* THE SELLER'S SHAPE, because a staffer may well have seen that one and should not be
          learning a second object. Every card is on screen at once — it was a one-at-a-time
          stepper with Back/Next, which makes three short facts feel like a form and hides two
          thirds of what there is to know behind a button.

          NO TICKS. The seller's rows carry a check because each is a real state the product
          can verify; nothing here is checkable — it is a tour, not a checklist (see the note
          at the top). A numeral is the mark instead, so the rows read as an ordered list of
          places rather than as tasks left undone. */}
      {/* THE SELLER GUIDE'S ROW, EXACTLY — same grid, same border, same 18px circle, same
          caret. The two panels sit in the same corner of the same product and a staffer may
          well have seen both; two different row shapes makes them read as two features that
          happen to look alike, which is worse than either.

          The one deliberate difference is the MARK: the seller's circle carries a tick because
          each of their steps is a state the product can verify. Nothing in a tour is
          checkable, so it carries the step's number instead — a tick here would claim a
          progress that does not exist.

          `where` rides on the end of the sub rather than taking a line of its own, so the row
          stays two lines like the seller's. */}
      <ol className="grid gap-2 overflow-y-auto p-2.5">
        {cards.map((c, n) => (
          <li key={c.title}>
            <Link
              href={c.href}
              onClick={minimise}
              className="eg-tap grid grid-cols-[20px_1fr_14px] items-center gap-3 rounded-xl border border-border px-3 py-2.5 hover:bg-accent"
            >
              <span
                aria-hidden
                className="flex size-[18px] items-center justify-center rounded-full border-2 border-border text-2xs font-semibold tabular-nums text-muted-foreground"
              >
                {n + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{tl("tour", c.title)}</span>
                <span className="block text-xs text-muted-foreground">
                  {tl("tour", c.body)} <span className="text-foreground">{c.where}</span>
                </span>
              </span>
              <CaretRight size={12} weight="bold" className="text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-end border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={finish}
          className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground"
        >
          {tl("tour", "Got it")}
        </button>
      </div>
    </motion.section>
    </>
  )
}
