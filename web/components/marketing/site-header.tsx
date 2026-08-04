"use client"

import Link from "next/link"
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
const PLATE_ROUTES = new Set(["/preview"])

export function SiteHeader() {
  const onPlate = PLATE_ROUTES.has(usePathname())
  return (
    <header
      className={
        "sticky top-0 z-30 " +
        (onPlate
          // Transparent so the hero's colour is the header's background. Not sticky-blurred
          // either: a blur over a flat colour just muddies it as you scroll.
          ? "bg-transparent"
          : "border-b border-border bg-background/80 backdrop-blur")
      }
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className={"font-display text-2xl font-semibold tracking-tight " + (onPlate ? "text-[#0B0B0C]" : "")}>
          egfulfill
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className={
                "rounded-md px-2 py-1 text-sm font-medium transition-colors " +
                (onPlate
                  ? "text-[#0B0B0C]/70 hover:bg-[#0B0B0C]/[0.06] hover:text-[#0B0B0C]"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {onPlate ? (
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
