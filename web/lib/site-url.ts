/**
 * WHERE THE PUBLIC SITE LIVES.
 *
 * `app.egful.store`, not the apex. The apex serves the legacy static HTML from the VPS
 * (see CLAUDE.md §3), so a canonical URL, a sitemap entry or an OG image pointing at
 * `egful.store` names a page this app does not serve.
 *
 * NOT the same value as the API origin in `next.config.ts` — that one is deliberately the
 * apex, because `/api/*` proxies to the VPS. Pointing this at the apex, or that at this,
 * breaks a different thing each way round.
 *
 * Override with SITE_URL in Vercel env if the app ever moves hosts. Trailing slash stripped
 * so callers can always concatenate a leading-slash path.
 */
const FALLBACK = "https://app.egful.store"
const RAW = (process.env.SITE_URL || "").trim().replace(/\/+$/, "")

export const SITE_URL = /^https?:\/\/[^/]+/.test(RAW) ? RAW : FALLBACK
