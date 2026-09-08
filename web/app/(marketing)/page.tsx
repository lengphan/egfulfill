import { getSiteContent } from "@/lib/site-content"
import { PloyHome } from "@/components/marketing/ploy/ploy-home"

/**
 * The home page.
 *
 * Redrawn 2026-09-08 from the ploy prototype: one enormous garment and one block of type per
 * band, the four steps on acid with a scroll-filled pipe, the seven print methods on a rail,
 * and the three plans. See components/marketing/ploy/ploy-home.tsx.
 *
 * Copy still comes from stored site content (Settings › Site content) — the redesign changed
 * how the words are presented, never where they come from. The previous implementation
 * (BoldHome) is left in place: the other marketing routes still render the pages it was built
 * alongside, and §2.7 is "port before deleting".
 */
export default async function MarketingHome() {
  const content = await getSiteContent()
  return <PloyHome content={content} />
}
