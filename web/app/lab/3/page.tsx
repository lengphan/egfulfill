import { getSiteContent } from "@/lib/site-content"
import { HomeLumen } from "@/components/marketing/brand/home-lumen"
import { GROUNDS, DEFAULT_GROUND, type GroundKey } from "@/components/marketing/brand/lumen"
import { GroundSwitch } from "@/components/marketing/brand/style-switch"

export const metadata = { robots: { index: false, follow: false } }

export default async function StyleLumen({ searchParams }: { searchParams: Promise<{ ground?: string }> }) {
  const content = await getSiteContent()
  const { ground } = await searchParams
  const key: GroundKey = ground && ground in GROUNDS ? (ground as GroundKey) : DEFAULT_GROUND
  return (<><HomeLumen content={content} ground={key} /><GroundSwitch current={key} /></>)
}
