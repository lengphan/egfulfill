import type { NextConfig } from "next"

// The Fastify API lives on the VPS. The browser calls /api/* on the Vercel domain
// and Next proxies it to the VPS — same-origin to the browser, no CORS.
// Override with API_ORIGIN in Vercel env if the API domain changes.
// NB: use `|| default`, NOT `?? default` — an EMPTY/whitespace API_ORIGIN must fall
// back too, or the rewrite destination has no host → Vercel 502 DNS_HOSTNAME_EMPTY.
const RAW = (process.env.API_ORIGIN || "").trim().replace(/\/+$/, "")
const API_ORIGIN = /^https?:\/\/[^/]+/.test(RAW) ? RAW : "https://egful.store"

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }]
  },
}

export default nextConfig
