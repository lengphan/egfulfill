import { PloyPricing } from "@/components/marketing/ploy/pricing"
import { getSiteContent } from "@/lib/site-content"

export const metadata = { title: "Pricing — EGFUL" }

/**
 * The heading and lead come from stored site content (Settings › Site content › Pricing).
 * The FIGURES deliberately do not: they read lib/plans.ts, the same constants the signed-in
 * billing page and the order charge use, so a price on this page cannot drift from the price
 * a seller is actually billed. See the note in ploy/pricing.tsx.
 */
export default async function PricingPage() {
  const content = await getSiteContent()
  const head = content.pricingPage
  return (
    <PloyPricing
      headline={head.title || "Simple,"}
      accent={head.accent || "pay-as-you-go."}
      lead={head.sub || "No monthly fee. No minimums. You pay the per-order fulfilment cost when an order actually ships — funded from your wallet."}
      faq={content.faq}
    />
  )
}
