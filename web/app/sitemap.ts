import type { MetadataRoute } from "next"
import { getPublicProducts } from "@/lib/api"
import { SITE_URL } from "@/lib/site-url"

// Same window as /catalog and /catalog/[slug]: publishing a product should reach the sitemap
// without a redeploy, and the three surfaces must not disagree about what is published.
export const revalidate = 300

/**
 * The public marketing routes, by hand.
 *
 * Generated from `app/(marketing)/` would drift into publishing whatever lands there next —
 * the same allow-list-not-redaction reasoning the public catalogue API uses (CLAUDE.md §2.9).
 * A page appearing in search is a decision, so it is a line in this array.
 */
const STATIC = [
  "/",
  "/catalog",
  "/pricing",
  "/features",
  "/how-it-works",
  "/docs",
  "/integrations/amazon",
  "/contact",
  "/terms",
  "/privacy",
]

/**
 * No `lastModified`, `changeFrequency` or `priority` on any entry.
 *
 * Google ignores changefreq and priority outright, and `lastModified` would have to be
 * `new Date()` — a fresh timestamp on every build, which claims every page changed whenever
 * anything did. That is worse than omitting it: a lastmod nobody can trust gets discounted
 * for the whole site. The public product shape carries no updated-at field to use instead.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC.map((path) => ({ url: `${SITE_URL}${path}` }))

  // A catalogue read failure must not fail the deploy — same call and same reasoning as
  // `generateStaticParams` in catalog/[slug]. The sitemap then ships the marketing routes
  // alone, which is strictly better than no sitemap, and the next revalidation picks the
  // products up.
  try {
    const { products } = await getPublicProducts()
    for (const p of products ?? []) {
      if (p.slug) entries.push({ url: `${SITE_URL}/catalog/${encodeURIComponent(p.slug)}` })
    }
  } catch {
    // Intentionally silent: logged nowhere useful at build time, and non-fatal by design.
  }

  return entries
}
