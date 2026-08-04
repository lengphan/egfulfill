import { getSiteContent } from "@/lib/site-content"
import { BoldHome } from "@/components/marketing/bold-home"

/**
 * A PREVIEW of the home page in the bright/bold direction — deliberately its own route so
 * the live home page is untouched while the two can be compared side by side.
 *
 * It reads the SAME stored site content as the real page, so what's on screen is the real
 * copy an admin edits in Settings › Site content, not sample text. That's the point of
 * previewing it this way: if the design can't hold the actual words, it hasn't been proven.
 *
 * If it's adopted, this becomes the home page and the route goes away.
 */
export const metadata = { title: "Home preview — EGFULFILL", robots: { index: false, follow: false } }

export default async function HomePreview() {
  const content = await getSiteContent()
  return <BoldHome content={content} />
}
