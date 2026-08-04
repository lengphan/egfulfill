"use client"

import Link from "next/link"


import { PAPER } from "@/components/marketing/bold-kit"

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
 * That was solving a problem the palette has since removed: the page is PAPER now, so the
 * header simply wears the page's own colour and there is nothing to transition between. The
 * swap was the jarring part — links, buttons and background all changed at 24px of scroll,
 * which reads as a glitch rather than an effect.
 *
 * It stays opaque, so it can never float unreadably over content — the bug that made the
 * transparent version wrong in the first place — and the buttons keep one look throughout.
 */
export function SiteHeader() {
  return (
    <header
      className="sticky top-0 z-30"
      // The page's own paper, opaque. No blur: blurring a flat colour only muddies it.
      style={{ background: PAPER }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className={"font-display text-2xl font-semibold tracking-tight " + "text-[#0B0B0C]"}>
          egfulfill
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className={
                "rounded-md px-2 py-1 text-sm font-medium transition-colors " +
                "text-[#0B0B0C]/70 hover:bg-[#0B0B0C]/[0.06] hover:text-[#0B0B0C]"
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
                      <>
              <Link href="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-[#0B0B0C] transition-colors hover:bg-[#0B0B0C]/[0.06]">
                Log in
              </Link>
              <Link
                href="/login"
                className="rounded-full bg-[#0B0B0C] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#26262a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B0B0C] focus-visible:ring-offset-2"
              >
                Start free
              </Link>
            </>

        </div>
      </div>
    </header>
  )
}
