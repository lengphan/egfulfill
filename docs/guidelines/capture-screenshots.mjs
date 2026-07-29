// Auto-capture screenshots for the guidelines into docs/guidelines/images/.
//
// The guides reference images by a fixed key (e.g. images/orders-list.png). This script
// visits each page in a real browser, signed in AS YOU, and saves the screenshot under that
// key — so you get real screenshots without taking them one by one.
//
// ── Run it (on your Mac, NOT the server) ──────────────────────────────────────────
//   The server is headless and has no Chrome — run this locally, against the LIVE app.
//   1. Sign in to app.egful.store in your normal browser.
//   2. DevTools → Application → Local Storage → copy the value of `eg_token`.
//   3. In a terminal on your Mac, from the repo:
//        cd docs/guidelines
//        npm install                      # one-time: pulls puppeteer + a bundled Chrome
//        EG_TOKEN=<token> EG_ROLE=admin BASE_URL=https://app.egful.store npm run capture
//
//   Environment variables (all optional except EG_TOKEN):
//     EG_TOKEN   your real login token (REQUIRED — pages are empty without it)
//     EG_ROLE    seller | operator | warehouse | designer | admin   (default: admin)
//     BASE_URL   default http://localhost:3000  (use https://app.egful.store for live)
//     EG_NAME    display name for the fake user object (default "Guide")
//
//   Capture ALL pages by running it twice — once with a SELLER token+role, once with an
//   ADMIN token+role — because staff can't open seller-only pages and vice-versa.
//     EG_TOKEN=<seller-jwt> EG_ROLE=seller node docs/guidelines/capture-screenshots.mjs
//     EG_TOKEN=<admin-jwt>  EG_ROLE=admin  node docs/guidelines/capture-screenshots.mjs
//
// Needs puppeteer (already in the repo root node_modules).

import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Puppeteer is a one-off tool dependency, not part of the app. Load it dynamically so a missing
// install gives a plain instruction instead of a stack trace.
let puppeteer
try {
  puppeteer = (await import("puppeteer")).default
} catch {
  console.error(`\nPuppeteer isn't installed here.\n\nRun this on a machine with a normal desktop browser (your Mac — NOT the headless\nserver, which lacks the Chrome libraries):\n\n  cd docs/guidelines\n  npm install\n  EG_TOKEN=<your-token> EG_ROLE=admin BASE_URL=https://app.egful.store npm run capture\n`)
  process.exit(1)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const IMAGES = join(HERE, "images")
mkdirSync(IMAGES, { recursive: true })

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const TOKEN = process.env.EG_TOKEN || ""
const ROLE = process.env.EG_ROLE || "admin"
const NAME = process.env.EG_NAME || "Guide"
if (!TOKEN) { console.error("Set EG_TOKEN to your real login token (DevTools → Application → Local Storage → eg_token)."); process.exit(1) }

// Every screenshot the guides reference: key (file name) → { path, roles }.
// A page is captured when ROLE is in its roles list (or roles is empty = any).
const SHOTS = [
  // Seller shell
  { key: "seller-dashboard", path: "/dashboard", roles: ["seller"] },
  { key: "orders-list", path: "/orders", roles: ["seller"] },
  { key: "order-new", path: "/orders/new", roles: ["seller", "operator", "warehouse", "admin"] },
  { key: "products-list", path: "/products", roles: ["seller", "operator", "warehouse", "admin"] },
  { key: "stores", path: "/stores", roles: ["seller", "admin"] },
  { key: "spydeck", path: "/spydeck", roles: ["seller", "operator", "warehouse", "admin"] },
  { key: "reports", path: "/reports", roles: ["seller", "admin"] },
  { key: "wallet", path: "/wallet", roles: ["seller"] },
  { key: "design-lab", path: "/design", roles: ["seller", "operator", "warehouse", "admin"] },
  { key: "chat", path: "/chat", roles: ["seller", "operator", "warehouse", "designer", "admin"] },
  { key: "developers", path: "/developers", roles: ["seller", "warehouse", "admin"] },
  { key: "settings", path: "/settings", roles: ["seller", "operator", "warehouse", "designer", "admin"] },
  { key: "published-catalog", path: "/published-catalog", roles: ["operator", "warehouse", "admin"] },
  // Factory boards
  { key: "staff-overview", path: "/overview", roles: ["operator", "warehouse", "admin"] },
  { key: "production-hub", path: "/operator", roles: ["operator", "warehouse", "admin"] },
  { key: "designer-board", path: "/designer", roles: ["designer", "operator", "warehouse", "admin"] },
  { key: "earnings", path: "/earnings", roles: ["designer"] },
  { key: "shipping", path: "/shipping", roles: ["operator", "warehouse", "admin"] },
  { key: "inventory", path: "/inventory", roles: ["operator", "warehouse", "admin"] },
  { key: "purchasing", path: "/purchasing", roles: ["operator", "warehouse", "admin"] },
  { key: "finance", path: "/finance", roles: ["warehouse", "admin"] },
  { key: "digitizer", path: "/digitizer", roles: ["operator", "admin"] },
  { key: "broadcasts", path: "/broadcasts", roles: ["operator", "admin"] },
]

const wanted = SHOTS.filter((s) => !s.roles.length || s.roles.includes(ROLE))
if (!wanted.length) { console.log(`No shots for role "${ROLE}".`); process.exit(0) }

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } })
const page = await browser.newPage()
// Seed auth into localStorage BEFORE any app script runs, on every navigation.
await page.evaluateOnNewDocument((token, user) => {
  localStorage.setItem("eg_token", token)
  localStorage.setItem("eg_user", user)
}, TOKEN, JSON.stringify({ name: NAME, role: ROLE }))

let ok = 0
for (const s of wanted) {
  try {
    await page.goto(BASE_URL + s.path, { waitUntil: "networkidle2", timeout: 45000 })
    await new Promise((r) => setTimeout(r, 1500)) // let data settle
    // Try to open the Import dialog for the orders page's companion shot.
    await page.screenshot({ path: join(IMAGES, `${s.key}.png`), fullPage: true })
    console.log("✓", s.key, "←", s.path)
    ok++
  } catch (e) {
    console.warn("✗", s.key, "(" + s.path + "):", e.message)
  }
}
await browser.close()
console.log(`\nSaved ${ok}/${wanted.length} screenshots to docs/guidelines/images/ as role "${ROLE}".`)
console.log("Modal shots (Import dialog, Pick-a-blank, Top-up) aren't page routes — capture those by hand and save as:")
console.log("  images/import-dialog.png, images/variant-picker.png, images/wallet-topup.png")
