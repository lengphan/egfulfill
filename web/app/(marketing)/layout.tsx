import Link from "next/link"
import { SiteHeader } from "@/components/marketing/site-header"
import { SupportBubble } from "@/components/marketing/support-bubble"

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // The header moved to components/marketing/site-header.tsx so it can read the route and
  // sit ON a full-bleed hero plate where a page has one. Still ONE component with one set of
  // links — the hazard the old note here warned about was two headers that could disagree,
  // not a background that varies.
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-display text-xl font-semibold tracking-tight">egful</div>
            <div className="mt-1 text-sm text-muted-foreground">Hands-off print-on-demand fulfillment.</div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/catalog" className="hover:text-foreground">Products</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/how-it-works" className="hover:text-foreground">How it works</Link>
            <Link href="/features" className="hover:text-foreground">Features</Link>
            <Link href="/docs" className="hover:text-foreground">API</Link>
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

      {/* On every marketing page, because the question a visitor wants to ask arrives while
          they are reading pricing or a product — not after they have found a contact page. */}
      <SupportBubble />
    </div>
  )
}
