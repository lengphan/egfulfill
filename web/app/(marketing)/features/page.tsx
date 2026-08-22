import { getSiteContent } from "@/lib/site-content"
import { BoldFeatures } from "@/components/marketing/bold-features"

export const metadata = { title: "Features — EGFUL" }

/**
 * The six capabilities, and every word of them now comes from stored site content
 * (Settings › Site content › Features page) rather than an array inside the component —
 * same fetch, same 60-second revalidate and same fall-back-to-defaults as the home page.
 */
export default async function FeaturesPage() {
  const content = await getSiteContent()
  return <BoldFeatures content={content} />
}
