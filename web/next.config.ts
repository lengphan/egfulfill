import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  // Pin the workspace root to web/ so Next doesn't infer it from the repo's
  // outer package.json (the static-site root has its own package.json).
  turbopack: {
    root: path.join(__dirname),
  },
}

export default nextConfig
