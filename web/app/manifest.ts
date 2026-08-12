import type { MetadataRoute } from "next"

// Makes the app installable on iPhone + Android ("Add to Home Screen"), replacing
// the old static floor.webmanifest. start_url points at the scan station because
// that's what the warehouse opens the installed app for — now the Scan tab of the
// merged Inventory section (the old /scan route also redirects here).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EGFUL — Staff",
    short_name: "Staff",
    description: "Warehouse floor app: barcode scan for stock in/out, inventory, and orders.",
    start_url: "/inventory?tab=scan",
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
