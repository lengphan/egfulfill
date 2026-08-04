"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { buttonVariants } from "@/components/ui/button"

const nav = [
  { label: "Products", href: "/catalog" },
  { label: "Features", href: "/features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "API", href: "/docs" },
]

/**
 * ONE header component for the whole marketing site — the thing that varies is a background,
 * not a second implementation. That distinction is what the layout's old note was protecting:
 * the failure mode it warned about was two headers that could disagree, or one that
 * half-inverted mid theme-switch, not a page whose plate runs behind it.
 *
 * On a page whose hero IS a full-bleed colour plate, the header sits ON the plate: no bar, no
 * border, no blur — the colour runs from the top of the window. Everywhere else it's the
 * ordinary sticky bar over a themed surface. Both use the same links and the same markup, so
 * they can't drift.
 */
const PLATE_ROUTES = new Set(["/", "/pricing"])

export function SiteHeader() {
  const onPlate = PLATE_ROUTES.has(usePathname())

  /**
   * Transparent ONLY while the plate is behind it.
   *
   * A permanently transparent sticky header is a bug, not a style: scroll down and the nav
   * links sit directly on body copy and headings, unreadable, with no surface between them.
   * So it's transparent at the top — where the hero's colour IS its background — and becomes
   * the ordinary bar the moment the page moves.
   *
   * 24px rather than the hero's full height: the swap should happen as soon as the page has
   * clearly moved, not at some invisible landmark further down.
   */
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    window.addEventListener("scroll", onScroll, { passive: true })
    // Deferred, not called in the effect body: a synchronous setState during mount is what
    // react-hooks/set-state-in-effect rejects, and it also matters for a restored scroll
    // position, where the page can already be scrolled before this ever runs.
    const t = setTimeout(onScroll, 0)
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(t) }
  }, [])

  // Plate styling applies only at rest on a plate route; everything else is the normal bar.
  const bare = onPlate && !scrolled
  return (
    <header
      className={
        "sticky top-0 z-30 transition-colors duration-200 " +
        (bare
          // No blur either: blurring a flat colour just muddies it.
          ? "bg-transparent"
          : "border-b border-border bg-background/80 backdrop-blur")
      }
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className={"font-display text-2xl font-semibold tracking-tight " + (bare ? "text-[#0B0B0C]" : "")}>
          egfulfill
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className={
                "rounded-md px-2 py-1 text-sm font-medium transition-colors " +
                (bare
                  ? "text-[#0B0B0C]/70 hover:bg-[#0B0B0C]/[0.06] hover:text-[#0B0B0C]"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {bare ? (
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
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Log in</Link>
              <Link href="/login" className={buttonVariants({ size: "sm" })}>Start free</Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
