import type { NextConfig } from "next"
import path from "node:path"

// The Fastify API lives on the VPS. On Vercel the browser calls /api/* on the
// Vercel domain and Next proxies it to the VPS — same-origin to the browser, no CORS.
// Override with API_ORIGIN in Vercel env if the API domain changes.
const API_ORIGIN = process.env.API_ORIGIN ?? "https://egful.store"

const nextConfig: NextConfig = {
  // Pin roots to web/ so Next doesn't infer them from the repo's outer package.json.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }]
  },
}

export default nextConfig
