// site-content.ts — the editable copy of the public marketing home.
//
// The homepage used to hardcode every string. Now the strings live in the database
// (settings key `site_content`, admin-edited from Settings › Site content) and the page
// reads them here. The values below are the DEFAULTS: they are the exact copy that used to
// be inline, and they are the fallback whenever a field is unset or the API is unreachable.
// A blank field in the editor therefore can NEVER blank the homepage — it falls back to
// this. That property is the whole point, so keep the defaults complete.

import { DEFAULT_MOTION, mergeMotion, type MotionSettings } from "./motion"

export type Stat = { value: string; label: string }
export type FeatureCard = { title: string; body: string }
export type Step = { n: string; title: string; body: string }
export type Testimonial = { quote: string; name: string; role: string }
export type Faq = { q: string; a: string }

export type SiteContent = {
  hero: {
    /** The plain lead of the headline. */
    headline: string
    /** The italic, violet-accented tail of the headline — the brand's one flourish. */
    accent: string
    subhead: string
    ctaPrimary: string
    ctaSecondary: string
    worksWithLabel: string
    integrations: string[]
    /** Optional background banner (public URL). Empty = the default gradient wash. When set,
     *  it renders behind the hero under a scrim so the dark text stays legible. */
    image: string
  }
  stats: Stat[]
  features: { heading: string; subhead: string; cards: FeatureCard[] }
  steps: { heading: string; items: Step[] }
  testimonials: { heading: string; items: Testimonial[] }
  faq: { heading: string; items: Faq[] }
  cta: { heading: string; subhead: string; button: string }
  /**
   * HOW the marketing pages animate — see lib/motion.ts.
   *
   * It rides in the copy blob rather than getting a settings key of its own, and that is a
   * decision worth defending: it is the same audience (admin), the same surface (the public
   * site), the same route, the same 64KB guard, and the same one fetch the layout already
   * makes. A second key would have bought a second endpoint, a second cache window and the
   * possibility of the two arriving out of step, in exchange for a tidier noun.
   */
  motion: MotionSettings
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  hero: {
    headline: "What if every order",
    accent: "printed itself?",
    subhead:
      "Etsy, Shopify & TikTok orders sync into one queue, print on a vetted network, and ship with tracking pushed back — completely hands off.",
    ctaPrimary: "Start for free",
    ctaSecondary: "See how it works",
    worksWithLabel: "Works with",
    integrations: ["Etsy", "Shopify", "TikTok Shop", "WooCommerce"],
    image: "",
  },
  stats: [
    { value: "2.4M+", label: "orders shipped" },
    { value: "3", label: "marketplaces synced" },
    { value: "99.2%", label: "on-time fulfillment" },
    { value: "48hrs", label: "avg to doorstep" },
  ],
  features: {
    heading: "Everything after the sale, handled.",
    subhead: "From the moment an order lands to the tracking number your buyer sees.",
    cards: [
      { title: "Every store, one queue", body: "Orders from Etsy, Shopify & TikTok Shop sync in automatically — no CSV exports, no copy-paste, no missed orders." },
      { title: "Vetted print network", body: "Quality-checked partners with QC at every stage — not a black box." },
      { title: "Tracking, automatic", body: "Cheapest label bought and tracking pushed back to the marketplace for you." },
      { title: "Transparent wallet", body: "A prepaid wallet with clear per-order charges and instant payouts. Always know exactly what you paid and why." },
    ],
  },
  steps: {
    heading: "Live in three steps.",
    items: [
      { n: "01", title: "Connect your stores", body: "OAuth into Etsy, Shopify or TikTok Shop in about two minutes." },
      { n: "02", title: "Upload your designs", body: "Map artwork to products once — we handle placement and print files." },
      { n: "03", title: "We fulfill, hands-off", body: "Print, pack, ship, and track. You just watch orders go out." },
    ],
  },
  testimonials: {
    heading: "Sellers who stopped touching orders.",
    items: [
      { quote: "I went from spending three hours a day on orders to basically zero. They just ship. I check tracking sometimes for fun.", name: "Maya R.", role: "Etsy · 4k orders/mo" },
      { quote: "The wallet made it click for me — I can see exactly what each order costs before it prints. No mystery invoices.", name: "Devon K.", role: "Shopify apparel" },
      { quote: "TikTok Shop blew up overnight and egfulfill just absorbed it. Same queue, same flow, tracking pushed back automatically.", name: "Priya S.", role: "TikTok Shop" },
    ],
  },
  faq: {
    heading: "Questions, answered.",
    items: [
      { q: "Which marketplaces do you sync with?", a: "Etsy, Shopify, TikTok Shop and WooCommerce today, with more on the way. Orders flow into one queue automatically and tracking is pushed back to each marketplace." },
      { q: "Is there a monthly fee?", a: "No. The platform is free — you only pay the per-order fulfillment cost when an order ships, funded from your prepaid wallet." },
      { q: "How does shipping pricing work?", a: "We rate-shop across carriers and buy the cheapest available label, billed at cost. You always see the exact charge on each order." },
      { q: "Can I use my own designs?", a: "Yes. Upload artwork to your library, map it to products once, and our mini designer handles placement and print-ready files." },
      { q: "What about quality control?", a: "Every order is quality-checked at each stage on a vetted print network — intake, print, and pack — before it ships." },
    ],
  },
  cta: {
    heading: "Ready to put fulfillment on autopilot?",
    subhead: "Connect a store and send your first hands-off order today. No monthly fee.",
    button: "Start for free",
  },
  motion: DEFAULT_MOTION,
}

/**
 * Overlay a stored (possibly partial) blob onto the defaults.
 *
 * Scalars: a non-empty stored value wins; blank or missing falls back to the default —
 * this is what stops a cleared field from blanking the page. Arrays (stats, cards, FAQ…)
 * are replaced WHOLESALE when present, not merged element-by-element: the editor owns the
 * whole list, so removing a testimonial has to actually remove it. An absent array key
 * keeps the default list.
 */
export function mergeSiteContent(stored: unknown): SiteContent {
  const d = DEFAULT_SITE_CONTENT
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() !== "" ? v : fallback
  const arr = <T,>(v: unknown, fallback: T[]) => (Array.isArray(v) && v.length ? (v as T[]) : fallback)
  const obj = (k: string) => (s[k] && typeof s[k] === "object" ? (s[k] as Record<string, unknown>) : {})

  const hero = obj("hero")
  const features = obj("features")
  const steps = obj("steps")
  const testimonials = obj("testimonials")
  const faq = obj("faq")
  const cta = obj("cta")

  return {
    hero: {
      headline: str(hero.headline, d.hero.headline),
      accent: str(hero.accent, d.hero.accent),
      subhead: str(hero.subhead, d.hero.subhead),
      ctaPrimary: str(hero.ctaPrimary, d.hero.ctaPrimary),
      ctaSecondary: str(hero.ctaSecondary, d.hero.ctaSecondary),
      worksWithLabel: str(hero.worksWithLabel, d.hero.worksWithLabel),
      integrations: arr<string>(hero.integrations, d.hero.integrations),
      // Empty is a valid, intentional value (no banner) — the default is also empty, so a
      // blank here stays blank rather than resurrecting a default image.
      image: typeof hero.image === "string" ? hero.image : d.hero.image,
    },
    stats: arr<Stat>(s.stats, d.stats),
    features: {
      heading: str(features.heading, d.features.heading),
      subhead: str(features.subhead, d.features.subhead),
      cards: arr<FeatureCard>(features.cards, d.features.cards),
    },
    steps: {
      heading: str(steps.heading, d.steps.heading),
      items: arr<Step>(steps.items, d.steps.items),
    },
    testimonials: {
      heading: str(testimonials.heading, d.testimonials.heading),
      items: arr<Testimonial>(testimonials.items, d.testimonials.items),
    },
    faq: {
      heading: str(faq.heading, d.faq.heading),
      items: arr<Faq>(faq.items, d.faq.items),
    },
    cta: {
      heading: str(cta.heading, d.cta.heading),
      subhead: str(cta.subhead, d.cta.subhead),
      button: str(cta.button, d.cta.button),
    },
    // Its own merge, because the rule for a number is not the rule for a string: 0 is a
    // legitimate value for every motion field and `str`'s "blank falls back" test would throw
    // it away. mergeMotion also clamps, so a hand-typed 40-second duration cannot ship.
    motion: mergeMotion(s.motion),
  }
}

/**
 * Read the site content for the Server-Component homepage.
 *
 * Runs on the Vercel server, so it needs the ABSOLUTE API origin — a relative `/api` only
 * resolves in the browser (via the Next rewrite). Mirrors next.config's API_ORIGIN with the
 * same `https://egful.store` fallback.
 *
 * ISR, not no-store: the homepage is hit constantly and its copy changes rarely, so a
 * 60-second revalidate means an edit shows within a minute without a DB round-trip per view.
 * ANY failure — API down, bad JSON, timeout — falls back to the baked-in defaults, because a
 * marketing homepage that 500s over a copy service is a far worse outcome than slightly
 * stale copy.
 */
export async function getSiteContent(): Promise<SiteContent> {
  const origin = (process.env.API_ORIGIN || "https://egful.store").replace(/\/+$/, "")
  try {
    const res = await fetch(`${origin}/api/site-content`, { next: { revalidate: 60 } })
    if (!res.ok) return DEFAULT_SITE_CONTENT
    const body = (await res.json()) as { content?: unknown }
    return mergeSiteContent(body?.content)
  } catch {
    return DEFAULT_SITE_CONTENT
  }
}
