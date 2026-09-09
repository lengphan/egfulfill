import { SiteHeader } from "@/components/marketing/site-header"
import { MotionProvider } from "@/components/marketing/motion-provider"
import { SupportBubble } from "@/components/marketing/support-bubble"
import { getSiteContent } from "@/lib/site-content"
import { getPublicTheme } from "@/lib/public-theme"
import { EditModeProvider } from "@/components/marketing/edit-mode"
import { PloyFooter } from "@/components/marketing/ploy/footer"

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
  // The WHOLE blob, not just the presets: the inline editor seeds its draft from it, and the
  // layout is the one place every marketing route passes through. React dedupes this with the
  // page's own getSiteContent() inside a render, so it is still one fetch.
  const content = await getSiteContent()
  const { motion } = content
  /* The palette and the display face, as stored KEYS. Read here rather than in each page
     because this is the one component every public route passes through — and read on the
     SERVER so there is no first frame painted in the default. See lib/public-theme.ts. */
  const theme = await getPublicTheme()

  // The header moved to components/marketing/site-header.tsx so it can read the route and
  // sit ON a full-bleed hero plate where a page has one. Still ONE component with one set of
  // links — the hazard the old note here warned about was two headers that could disagree,
  // not a background that varies.
  return (
    <MotionProvider value={motion}>
    <EditModeProvider initial={content}>
    {/* THE GROUND IS THE SKIN'S, NOT THE APP'S. This was `bg-background` — the shadcn token,
        which is white and belongs to the signed-in product. It went unnoticed while the
        marketing skin was also white; on `signal` the page is a cool grey and the footer was
        the one white band left on it, which reads as a seam rather than as a footer. */}
    {/* THE THEME IS APPLIED HERE AND NOWHERE ELSE ON THE PUBLIC SITE.
        `data-skin` re-points the whole --mk-* palette for this subtree; `data-face` picks the
        display face via one selector in globals.css. Both are attributes rather than inline
        variables because the generated `font-display` utility resolves its token at BUILD
        time — see the note in globals.css, which cost a while to find.
        Scoped to this wrapper, so the ~100 `font-display` call sites in the signed-in app and
        its own palette are untouched by a marketing choice. */}
    <div
      data-skin={theme.skin}
      data-face={theme.face}
      className="flex min-h-svh flex-col"
      style={{ background: "var(--mk-surface)" }}
    >
      <SiteHeader />

      {/* THE HEADER IS FIXED NOW (see site-header.tsx), so it is out of flow and every page
          would otherwise start underneath it. The gutter is added HERE, once, rather than on
          each page — and the home page cancels it with `-mt-16`, because its hero is meant to
          run to the top of the viewport with the capsule floating on it. */}
      {/* THE CLEARANCE ABOVE THE FOOTER IS THE LAYOUT'S, not each page's.
          Measured across all twelve marketing routes it ranged from -28px (the catalogue
          overlapped the footer) through 0 (pricing sat flush against it) to 192px, because
          only the three converted components carried a bottom gap and the older pages —
          /features, /docs, /privacy, the product detail page — never had one at all. A page
          may still add its own space; this only guarantees the floor, on every route,
          including the ones nobody has redrawn yet.

          IT IS A FLOOR, SO IT IS SMALL. The pages that still carry their own trailing
          padding — /features, /contact, /privacy, /terms, the Amazon page — end up with both
          and run longer than the redrawn ones. That is the right way round: those pages are
          being replaced, and the alternative is editing five files that are about to go. The
          converted pages, which add none of their own, land where this says. */}
      {/* `pb-14 md:pb-20` is PAIRED with the CTA mound's `-bottom-14 md:-bottom-20` in
          ploy/drop.tsx, which reaches down through it so the pile lands on the footer's top
          edge instead of floating above it. Move one and move the other. */}
      <main className="flex-1 pb-14 pt-16 md:pb-20">{children}</main>

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

      {/* THE PLOY FOOTER, on every marketing route. It carries the same links the old one
          did — including /contact, which is the PUBLISHED contact page a marketplace
          reviewing us for API access can cite, and is therefore load-bearing rather than
          decoration — plus the privacy and terms pair in the legal line. */}
      <PloyFooter />

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
    </EditModeProvider>
    </MotionProvider>
  )
}
