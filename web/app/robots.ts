import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site-url"

/**
 * THE SIGNED-IN APP IS NOT A SEARCH RESULT.
 *
 * Every path under (app) and (boards) sits behind the auth guard, so a crawler following a
 * link into one receives the login redirect rather than content. Nothing leaks — but the
 * crawl budget is spent on pages that can never rank, and `/login` collects a pile of
 * duplicate entry points in the index.
 *
 * The segments are listed EXPLICITLY, and the default is "public". The tempting inverse —
 * disallow `/` and allow the marketing routes — silently de-indexes every marketing page
 * somebody adds later, which is a failure you only notice months afterwards in Search
 * Console. This way a new private section is the thing that needs remembering, and it is
 * one line next to a directory listing.
 *
 * Keep in step with the directories in `app/(app)/` and `app/(boards)/`.
 */
const PRIVATE = [
  // app/(app) — the seller shell
  "/chat",
  "/dashboard",
  "/design",
  "/developers",
  "/help",
  "/notifications",
  "/orders",
  "/products",
  "/publish",
  "/published-catalog",
  "/reports",
  "/settings",
  "/sourcing",
  "/spydeck",
  "/stores",
  "/wallet",
  // app/(boards) — staff only
  "/billing",
  "/broadcasts",
  "/campaigns",
  "/designer",
  "/digitizer",
  "/earnings",
  "/finance",
  "/inventory",
  "/overview",
  "/production",
  "/purchasing",
  "/shipping",
  "/warehouse",
  // Credential and OAuth surfaces. Indexing a login form gains nothing and competes with
  // the marketing pages for the brand query.
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/oauth-callback",
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
