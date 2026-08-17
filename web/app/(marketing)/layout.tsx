import Link from "next/link"
import { SiteHeader } from "@/components/marketing/site-header"
import { MotionProvider } from "@/components/marketing/motion-provider"
import { SupportBubble } from "@/components/marketing/support-bubble"
import { getSiteContent } from "@/lib/site-content"

/**
 * Async so the motion presets can be read HERE rather than per page.
 *
 * The layout is the only place that sees every marketing route, and the presets apply to all
 * of them — putting the fetch on each page would mean five fetches and five chances for one
 * page to be left out. The homepage also calls getSiteContent() for its copy; React dedupes
 * the two within a render, so this costs nothing, and its 60-second ISR window is shared.
 *
 * A failure inside getSiteContent returns the baked-in defaults, so the pages animate with the
 * house values rather than not animating.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { motion } = await getSiteContent()

  // The header moved to components/marketing/site-header.tsx so it can read the route and
  // sit ON a full-bleed hero plate where a page has one. Still ONE component with one set of
  // links — the hazard the old note here warned about was two headers that could disagree,
  // not a background that varies.
  return (
    <MotionProvider value={motion}>
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">{children}</main>

      {/* MOST ASKED MOVED INTO THE BUBBLE.
          It was a strip above the footer — the right three questions in the wrong place. The
          argument for taking them out of the bubble was that the bubble floated over the page
          it was meant to help sell; the argument against a footer strip is that a visitor's
          question arrives while they are reading a price, and by the time they have scrolled
          past everything to the bottom they have either found the answer or gone.
          They are chips inside the panel now, answered THERE (no model call, no email asked
          for), with "talk to a person" one press away — which is the point at which a name
          and an address are worth asking for, and the only point they are needed.
          The same three routes remain in the footer nav below, which is where you look when
          you already know what you want. */}

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          {/* The identity block. It names the company, the app and a reachable human in one
              place because a marketplace reviewing us for API access looks for exactly that,
              and a support widget is not a published contact method. */}
          <div>
            <div className="font-display text-xl font-semibold tracking-tight">egful</div>
            <div className="mt-1 text-sm text-muted-foreground">
              EGFUL — hands-off print-on-demand fulfillment.
            </div>
            <a
              href="mailto:linh@embroiderygoods.com"
              className="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              linh@embroiderygoods.com
            </a>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/catalog" className="hover:text-foreground">Products</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/how-it-works" className="hover:text-foreground">How it works</Link>
            <Link href="/features" className="hover:text-foreground">Features</Link>
            <Link href="/integrations/amazon" className="hover:text-foreground">Amazon</Link>
            <Link href="/docs" className="hover:text-foreground">API</Link>
            <Link href="/contact" className="hover:text-foreground">Contact</Link>
            <Link href="/login" className="hover:text-foreground">Log in</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </nav>
        </div>
        <div className="flex flex-col items-center justify-between gap-2 border-t border-border py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>© 2026 EGFUL. All rights reserved.</span>
          <span className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
          </span>
        </div>
      </footer>


      {/* THE PUBLIC AI BUBBLE IS OFF.
          It sat on every marketing page and answered visitors with a paid model call on an
          unauthenticated endpoint — the widest possible surface for the narrowest possible
          benefit, and it covered the corner of the product pages it was meant to help sell.
          The component and its route are left in place, so turning it back on is deleting
          this comment and un-commenting one line, not rebuilding a feature. /contact is
          still the way to reach a person, and the seller support chat inside the app —
          which is authenticated, per-seller and rate-limited — is untouched. */}
      <SupportBubble />
    </div>
    </MotionProvider>
  )
}
