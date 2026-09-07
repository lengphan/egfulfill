import { getSiteContent } from "@/lib/site-content"
import { HomePress } from "@/components/marketing/brand/home-press"
import { HEROES, DEFAULT_HERO, type HeroKey } from "@/components/marketing/brand/heroes"
import { StyleSwitch, HeroSwitch } from "@/components/marketing/brand/style-switch"

/** A draft direction. noindex — a version of the site nobody approved must not reach search. */
export const metadata = { robots: { index: false, follow: false } }

export default async function StylePress({ searchParams }: { searchParams: Promise<{ hero?: string }> }) {
  const content = await getSiteContent()
  const { hero } = await searchParams
  const key: HeroKey = hero && hero in HEROES ? (hero as HeroKey) : DEFAULT_HERO
  return (
    <>
      <HomePress content={content} hero={key} />
      <HeroSwitch current={key} />
      <StyleSwitch />
    </>
  )
}
