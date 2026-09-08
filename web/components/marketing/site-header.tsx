"use client"

import Link from "next/link"



const nav = [
  { label: "Products", href: "/catalog" },
  { label: "Features", href: "/features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Integrations", href: "/integrations" },
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
  const muted = "text-[var(--mk-ink)]/80 hover:text-[var(--mk-ink)]"
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
    /* FIXED, NOT IN FLOW — the capsule has to travel over the coloured blocks for the trick
       below to mean anything, and the home page's hero starts at the top of the viewport. */
    <header className="fixed inset-x-0 top-0 z-50 px-6 py-4 md:px-8">
      <div className="flex items-center justify-between gap-4">
        {/* THE CAPSULE, and it is the whole header idea.
            The bar itself is transparent and never changes at any scroll position. The menu
            sits in a fully-round capsule painted the SAME colour as the page ground, so it is
            invisible over the ground and becomes a floating pill the moment a coloured block
            passes beneath it. No scroll listener, no state, no backdrop blur, and — the point
            — ONE appearance, which is what §4 requires. The header that swapped background,
            links and buttons at 24px of scroll was the thing that read as a glitch; this
            changes nothing and still reads on acid, periwinkle and paper alike. */}
        <div className="ploy-capsule flex items-center gap-7 py-2.5 pl-5 pr-5 lg:pr-7">
          <Link href="/" aria-label="EGFUL home" className={"flex items-center " + ink}>
            <Wordmark className="h-[21px] w-auto" />
          </Link>
          {/* PAGES, NEVER ANCHORS. Every item is a route of its own — a menu that scrolls the
              page you are already on teaches people the menu is decoration, and it cannot work
              at all from any other page. */}
          <nav className="hidden items-center gap-6 lg:flex">
            {nav.map((n) => (
              <Link key={n.label} href={n.href} className={"text-[15px] transition-colors " + muted}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* TWO DOORS, AND THEY GO TO DIFFERENT PLACES. "Start free" once pointed at /login,
            so the loudest control on the site asked a first-time visitor for a password they
            had never set. Log in is for people who have an account; Start free opens the form
            that makes one. Both are their own capsule, so they read on any band. */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="whitespace-nowrap rounded-full bg-ploy-paper px-4 py-2.5 text-[14px] font-medium text-ploy-ink transition-transform hover:scale-[1.03] sm:px-6 sm:text-[15px]"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="whitespace-nowrap rounded-full bg-ploy-ink px-4 py-2.5 text-[14px] font-medium text-ploy-ground transition-transform hover:scale-[1.03] sm:px-6 sm:text-[15px]"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  )
}
