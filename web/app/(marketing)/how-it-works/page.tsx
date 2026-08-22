import { getSiteContent } from "@/lib/site-content"
import { BoldHow } from "@/components/marketing/bold-how"

export const metadata = { title: "How it works — EGFUL" }

/**
 * Three steps, the annotated diagram, then the real order statuses. Copy and figure both come
 * from stored site content (Settings › Site content › How it works) — see the note in
 * bold-how.tsx on why the status TONES deliberately do not.
 */
export default async function HowItWorksPage() {
  const content = await getSiteContent()
  return <BoldHow content={content} />
}
