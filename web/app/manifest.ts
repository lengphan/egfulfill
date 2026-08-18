import type { MetadataRoute } from "next"

// Makes the app installable on iPhone + Android ("Add to Home Screen"), replacing
// the old static floor.webmanifest.
//
// start_url is /today now, not the scan station. It pointed at Scan because that was the
// only reason to install this — there was no app home to open. There is one now: Today
// carries the counts, and Scan is one tap away on the tab bar. Opening straight into a
// camera made every other job a journey backwards through a console built for a mouse.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EGFUL",
    short_name: "EGFUL",
    description: "Orders, stock and the scan station — the factory floor on a phone.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#efece7",
    theme_color: "#1a1a18",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
