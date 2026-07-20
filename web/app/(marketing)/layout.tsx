"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { buttonVariants } from "@/components/ui/button"

const nav = [
  { label: "Products", href: "/catalog" },
  { label: "Features", href: "/features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
]

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // The home hero is a black brand surface. A light nav bar sitting on top of it
  // draws a hard white line across the design, so on "/" ONLY the header goes
  // transparent and light-on-dark and lets the hero run underneath it. Every other
  // marketing page is a light surface and keeps the normal header.
  const onDarkHero = usePathname() === "/"
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header
        className={
          "sticky top-0 z-30 " +
          (onDarkHero
            ? "border-b border-white/10 bg-[#0b0b0c]/60 text-white backdrop-blur"
            : "border-b border-border bg-background/80 backdrop-blur")
        }
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
            egfulfill
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {nav.map((n) => (
              <Link
                key={n.label}
                href={n.href}
                className={
                  "text-sm font-medium transition-colors " +
                  (onDarkHero ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground")
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + (onDarkHero ? " text-white hover:bg-white/10 hover:text-white" : "")}
            >
              Log in
            </Link>
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-display text-xl font-semibold tracking-tight">egfulfill</div>
            <div className="mt-1 text-sm text-muted-foreground">Hands-off print-on-demand fulfillment.</div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/catalog" className="hover:text-foreground">Products</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/how-it-works" className="hover:text-foreground">How it works</Link>
            <Link href="/features" className="hover:text-foreground">Features</Link>
            <Link href="/login" className="hover:text-foreground">Log in</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </nav>
        </div>
        <div className="flex flex-col items-center justify-between gap-2 border-t border-border py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>© 2026 EGFULFILL. All rights reserved.</span>
          <span className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
