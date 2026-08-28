"use client"

import Link from "next/link"


import { ACID, INK } from "@/components/marketing/bold-kit"

const nav = [
  { label: "Products", href: "/catalog" },
  { label: "Features", href: "/features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "API", href: "/docs" },
  // A published contact route has to be reachable from the top of every page, not only from
  // the footer — it is the one thing a visitor (or a marketplace reviewer) looks for by name.
  { label: "Contact", href: "/contact" },
]

/**
 * ONE header, ONE appearance, on every page and at every scroll position.
 *
 * It used to go transparent at the top of a colour plate and swap to a bar once you scrolled.
 * That was solving a problem the palette has since removed: the page is SURFACE now, so the
 * header simply wears the page's own colour and there is nothing to transition between. The
 * swap was the jarring part — links, buttons and background all changed at 24px of scroll,
 * which reads as a glitch rather than an effect.
 *
 * It stays opaque, so it can never float unreadably over content — the bug that made the
 * transparent version wrong in the first place — and the buttons keep one look throughout.
 */
import { Wordmark } from "@/components/marketing/wordmark"

export function SiteHeader() {
  /**
   * ONE appearance, on every marketing route: PAPER, opaque, with ink lettering.
   *
   * It used to be the deep violet plate, which was correct while the hero was a full-bleed
   * plate — the bar and the hero had to be one value or the seam showed. The hero is paper
   * now, so the bar follows it, and there is still exactly one value between them.
   *
   * There is no route fork here and there must not be one. A hardcoded list of "pages with a
   * plate" is a second source of truth about what the pages render, and it went stale the
   * last time a hero changed — pricing, features, how-it-works and catalog each drew a
   * lighter bar with dark ink above a deep plate. One appearance everywhere cannot drift.
   */
  const ink = "text-[var(--mk-ink)]"
  const muted = "text-[var(--mk-ink)]/65 hover:bg-[var(--mk-ink)]/[0.05] hover:text-[var(--mk-ink)]"
  /* TRANSPARENT AND IN FLOW, so a full-bleed hero can run to the top of the viewport with
        the nav standing on it. The bar was `sticky` with a SURFACE fill, which is why every
        photographic hero began 64px down the page behind a grey strip — the thing that stopped
        it being full bleed at all.

        NO ROUTE FORK, and the note above still holds: this works everywhere because every hero
        ground is light. PlateHero is paper and already pulls itself up under the bar with
        -mt-16 pt-16; MediaHero now does the same, and its `tone="ink"` pages are pinned to a
        pale periwinkle ground. Ink nav reads on all of them, so there is nothing to fork on.

        IT SCROLLS AWAY RATHER THAN STICKING. A transparent bar that stays put sits over
        whatever scrolls under it, and over the slate bands that is ink on near-black. The
        alternative — growing a background at 24px of scroll — is the two-appearance header §4
        removed once already. Scrolling away is the only option that keeps one appearance.
   */
  return (
    <header className="relative z-30">
      {/* THE HEADER SHARES THE PAGE'S CONTAINER — 88rem with a 40px gutter, the same one every
          band uses. It was max-w-6xl (72rem), so on a 1440 screen the wordmark sat 136px in
          while the headline under it started at 48px: the first two things the eye meets on
          the site were on two different left edges. §4 — a page has one left margin, and it is
          set once. Read off a screenshot; it is invisible at the widths a container query
          collapses to. */}
      <div className="mx-auto flex h-16 max-w-[88rem] items-center gap-8 px-6 sm:px-10">
        {/* The mark inherits `ink`, which is what makes one file work on every header state.
            Height-sized so it cannot distort, and it keeps the container's left edge — the
            note above about the wordmark and the headline sharing one left margin still
            applies, and artwork obeys it the same way the type did. */}
        <Link href="/" aria-label="EGFUL home" className={"flex items-center " + ink}>
          <Wordmark className="h-[30px] w-auto" />
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className={
                "rounded-md px-2 py-1 text-sm font-medium transition-colors " + muted
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>
        {/* TWO DOORS, AND THEY GO TO DIFFERENT PLACES. "Start free" pointed at /login, so
            the loudest control on the marketing site asked a first-time visitor for a
            password they had never set. Log in is for people who have an account; Start
            free is for people who don't, and it opens the form that makes one. */}
        <div className="ml-auto flex items-center gap-2">
                      <>
              <Link href="/login" className={"rounded-lg px-4 py-2 text-sm font-semibold transition-colors " + muted}>
                Log in
              </Link>
              <Link
                href="/signup"
                /* INK FILL, PARCHMENT LABEL — settled 2026-08-26.
                 *
                 * This went ink → lime → ink inside a day, and the round trip is worth
                 * recording because the reason changed each time. Ink-with-a-lime-label was
                 * wrong (the accent was doing lettering). Lime fill was right for LIME, which
                 * is a light colour and can only ever be a ground carrying ink. Then the
                 * accent became pink, which is governed by the opposite rule — brand marks
                 * only, never an interactive state — so the button returns to ink and the
                 * accent leaves the controls for good.
                 *
                 * Parchment on ink is 16.84:1. The old note below is kept because its
                 * measurement was correct and only its conclusion expired. */
                /* was: LIME FILL, INK LABEL — inverted 2026-08-26.
                 *
                 * It was ink fill with a lime label, and the note under it argued acid could
                 * not be the fill because "on paper it is 1.05:1 and the button would have no
                 * shape at all". That was measured against the old white page, and it was
                 * right then. Two things changed: the page is parchment, and the button now
                 * carries a 1px ink border, so its shape comes from the border rather than
                 * from the fill needing to out-contrast the page.
                 *
                 * This is the direction's rule, not a preference: lime is a GROUND CARRYING
                 * INK and never lettering. Ink on lime measures 15.49:1 — louder as a button
                 * and more readable as a label than the pair it replaces. */
                className="rounded-full border border-[var(--mk-ink)] px-5 py-2 text-sm font-semibold transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mk-ink)] focus-visible:ring-offset-2"
                style={{ background: ACID, color: INK }}
              >
                Start free
              </Link>
            </>

        </div>
      </div>
    </header>
  )
}
