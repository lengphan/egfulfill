import type { NextConfig } from "next"

// The Fastify API lives on the VPS. The browser calls /api/* on the Vercel domain
// and Next proxies it to the VPS — same-origin to the browser, no CORS.
// Override with API_ORIGIN in Vercel env if the API domain changes.
const API_ORIGIN = process.env.API_ORIGIN ?? "https://egful.store"

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }]
  },
}

export default nextConfig
