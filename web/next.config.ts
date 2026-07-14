import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  // Standalone server output for a small Docker image (next start via server.js).
  output: "standalone",
  // Pin roots to web/ so Next doesn't infer them from the repo's outer package.json
  // (the static-site root has its own).
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
}

export default nextConfig
