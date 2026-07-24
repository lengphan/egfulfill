import type { NextConfig } from "next"

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
    ]
  },
}

export default nextConfig
