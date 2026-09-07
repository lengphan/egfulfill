import { getSiteContent } from "@/lib/site-content"
import { HomeAtelier } from "@/components/marketing/brand/home-atelier"
import { StyleSwitch } from "@/components/marketing/brand/style-switch"

export const metadata = { robots: { index: false, follow: false } }

export default async function StyleAtelier() {
  const content = await getSiteContent()
  return (<><HomeAtelier content={content} /><StyleSwitch /></>)
}
