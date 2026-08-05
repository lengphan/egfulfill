"use client"

import Link from "next/link"


import { PLATE_DEEP, ACID } from "@/components/marketing/bold-kit"

const nav = [
  { label: "Products", href: "/catalog" },
  { label: "Features", href: "/features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "API", href: "/docs" },
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
export function SiteHeader() {
  /**
   * ONE appearance, on every marketing route: the deep plate, opaque, at every scroll
   * position, with light lettering.
   *
   * This used to fork on `pathname === "/"` — deep plate for home, the pastel ACCENT band
   * everywhere else. That check silently went wrong the moment PlateHero moved the interior
   * heroes onto the deep plate too: the four inner pages rendered a lighter blue bar with
   * DARK ink sitting directly above a deep plate carrying cream, which is both a visible
   * seam between two near-identical blues and a legibility drop on the links.
   *
   * The lesson is the reason there's no route list here now. A hardcoded set of "pages with
   * a plate" is a second source of truth about what the pages render, and it drifts the
   * first time someone changes a hero. One appearance everywhere can't drift.
   */
  const ink = "text-[#FAF8F3]"
  const muted = "text-[#FAF8F3]/75 hover:bg-[#FAF8F3]/10 hover:text-[#FAF8F3]"
  return (
    <header
      className="sticky top-0 z-30"
      style={{ background: PLATE_DEEP }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className={"font-display text-2xl font-semibold tracking-tight " + ink}>
          egfulfill
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
        <div className="ml-auto flex items-center gap-2">
                      <>
              <Link href="/login" className={"rounded-full px-4 py-2 text-sm font-semibold transition-colors " + muted}>
                Log in
              </Link>
              <Link
                href="/login"
                // Acid pill, ink label — 15.19:1, and the one loud thing in the bar.
                className="rounded-full px-5 py-2 text-sm font-semibold text-[#0B0B0C] transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FAF8F3] focus-visible:ring-offset-2"
                style={{ background: ACID }}
              >
                Start free
              </Link>
            </>

        </div>
      </div>
    </header>
  )
}
