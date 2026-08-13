import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The Fastify API lives on the VPS. The browser calls /api/* on the Vercel domain
// and Next proxies it to the VPS — same-origin to the browser, no CORS.
// Override with API_ORIGIN in Vercel env if the API domain changes.
// NB: use `|| default`, NOT `?? default` — an EMPTY/whitespace API_ORIGIN must fall
// back too, or the rewrite destination has no host → Vercel 502 DNS_HOSTNAME_EMPTY.
const FALLBACK = "https://egful.store"
const RAW = (process.env.API_ORIGIN || "").trim().replace(/\/+$/, "")
// Always resolve to a real https origin — never an empty host (Vercel 502 DNS_HOSTNAME_EMPTY).
const API_ORIGIN = /^https?:\/\/[^/]+/.test(RAW) ? RAW : FALLBACK

const nextConfig: NextConfig = {
  /**
   * PIN THE WORKSPACE ROOT TO web/.
   *
   * The repo root carries its own package.json + package-lock.json (puppeteer, for the
   * screenshot tooling), so Turbopack saw two lockfiles, inferred the REPO root as the
   * workspace, and served the dev client bundle from the wrong place. The symptom was not
   * an error: `next dev` reported ready, pages server-rendered, and nothing hydrated — even
   * /login came up with zero working buttons. Silent, and it made every dev screenshot a
   * picture of static HTML.
   *
   * Pinning it here rather than deleting a lockfile: the root one is legitimately in use,
   * and an inferred root is a thing that changes whenever a file lands beside the repo.
   */
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }]
  },
  // Suppliers + Purchase merged into one "Purchasing" section. These run at the routing
  // layer, BEFORE the (boards) auth guard, so old links/bookmarks land on the right tab
  // instead of racing the guard to the landing board. Non-permanent (307) so the mapping
  // can change later without browsers caching it.
  async redirects() {
    return [
      { source: "/suppliers", destination: "/purchasing?tab=browse", permanent: false },
      { source: "/purchase", destination: "/purchasing?tab=purchase", permanent: false },
      // Dispatch + Shipments merged into Shipping; Scan folded into Inventory.
      { source: "/dispatch", destination: "/shipping?tab=dispatch", permanent: false },
      { source: "/shipments", destination: "/shipping?tab=shipments", permanent: false },
      { source: "/scan", destination: "/inventory?tab=scan", permanent: false },
      // /operator → /production. The production queue is shared by operator, warehouse AND
      // admin, so a path named after one role told an admin they were somewhere they
      // weren't. Redirected rather than moved outright: the old URL is in bookmarks and in
      // notification links already sent.
      { source: "/operator", destination: "/production", permanent: false },
    ]
  },
}

export default nextConfig
