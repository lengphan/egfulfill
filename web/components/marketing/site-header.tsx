"use client"

import Link from "next/link"


import { usePathname } from "next/navigation"
import { ACCENT, PLATE_DEEP, ACID } from "@/components/marketing/bold-kit"

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
   * The home hero sits on the DEEP plate; every other marketing page sits on the pastel
   * band. One header serves both, so it reads the route rather than being forked into two
   * components — and the ink/light swap has to move WITH the background, or the links land
   * dark-on-dark the moment the plate goes deep.
   */
  const onDeepPlate = usePathname() === "/"
  const ink = onDeepPlate ? "text-white" : "text-[#0B0B0C]"
  const muted = onDeepPlate
    ? "text-white/75 hover:bg-white/10 hover:text-white"
    : "text-[#0B0B0C]/70 hover:bg-[#0B0B0C]/[0.06] hover:text-[#0B0B0C]"
  return (
    <header
      className="sticky top-0 z-30"
      // The PLATE's colour, opaque, at every scroll position. One appearance throughout —
      // it just belongs to the hero rather than to the page below it.
      style={{ background: onDeepPlate ? PLATE_DEEP : ACCENT }}
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
              <Link href="/login" className={"rounded-full px-4 py-2 text-sm font-semibold transition-colors " + (onDeepPlate ? "text-white hover:bg-white/10" : "text-[#0B0B0C] hover:bg-[#0B0B0C]/[0.06]")}>
                Log in
              </Link>
              <Link
                href="/login"
                // Acid on the deep plate (ink label, 15.19:1); ink pill elsewhere.
                className={"rounded-full px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " + (onDeepPlate ? "text-[#0B0B0C] hover:brightness-95 focus-visible:ring-white" : "bg-[#0B0B0C] text-white hover:bg-[#26262a] focus-visible:ring-[#0B0B0C]")}
                style={onDeepPlate ? { background: ACID } : undefined}
              >
                Start free
              </Link>
            </>

        </div>
      </div>
    </header>
  )
}
