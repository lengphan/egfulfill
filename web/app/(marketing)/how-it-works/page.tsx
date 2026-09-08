import { getSiteContent } from "@/lib/site-content"
import { PloyHow } from "@/components/marketing/ploy/how"

export const metadata = { title: "How it works — EGFUL" }

/**
 * The four steps told as a scroll, then the order's real stages.
 *
 * Copy comes from stored site content (Settings › Site content) — the SAME `steps` the home
 * page reads, deliberately: a visitor who reads both should not find two accounts of the same
 * four steps. The stage names at the bottom are not content and never should be; see the note
 * in ploy/how.tsx.
 */
export default async function HowItWorksPage() {
  const content = await getSiteContent()
  const head = content.howPage
  return (
    <PloyHow
      headline={head.title || "Three steps."}
      accent={head.accent || "Then it runs."}
      lead={head.sub || "Connect, upload, submit. Everything after that happens without you opening a shipping screen."}
      steps={content.steps.items}
    />
  )
}
