import { getSiteContent } from "@/lib/site-content"
import { BoldHome } from "@/components/marketing/bold-home"

/**
 * The home page.
 *
 * Adopted from what was /preview: full-bleed accent plate, oversized type, one highlight,
 * the scroll-parallaxed product panel. See CLAUDE.md §4 for the rules, and bold-home.tsx for
 * the implementation.
 *
 * Copy still comes from stored site content (Settings › Site content) — the redesign changed
 * how the words are presented, never where they come from, so an admin edit lands here
 * exactly as before. Every section the old page rendered is still rendered: hero, stats,
 * features, steps, testimonials, FAQ, CTA.
 */
export default async function MarketingHome() {
  const content = await getSiteContent()
  return <BoldHome content={content} />
}
