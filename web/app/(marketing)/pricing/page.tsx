import { BoldPricing } from "@/components/marketing/bold-pricing"
import { getSiteContent } from "@/lib/site-content"

export const metadata = { title: "Pricing — EGFUL" }

export default async function PricingPage() {
  const content = await getSiteContent()
  return <BoldPricing head={content.pricingPage} />
}
