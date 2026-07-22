import { Printer, PenNib, Storefront, CurrencyDollar, Binoculars, Tag, SquaresFour, ShoppingBag, ChartBar, Wallet, Code, Package, Barcode, Megaphone, Truck, Receipt, type Icon } from "@phosphor-icons/react"

export type StaffNavItem = { label: string; href: string; icon: Icon; roles: string[] }

// Staff boards, gated by role. Admin sees everything.
const STAFF_ITEMS: StaffNavItem[] = [
  { label: "Dashboard", href: "/overview", icon: SquaresFour, roles: ["operator", "warehouse", "admin"] },
  { label: "Orders", href: "/operator", icon: Printer, roles: ["operator", "warehouse", "admin"] },
  { label: "Board", href: "/designer", icon: PenNib, roles: ["operator", "warehouse", "designer", "admin"] },
  // Earnings = a designer's own payout view. Admin sees designer credits in Wallet instead.
  { label: "Earnings", href: "/earnings", icon: CurrencyDollar, roles: ["designer"] },
  // Dispatch = orders leaving the building (batch, print, scan out). Distinct from Scan,
  // which is the stock-in/out station for inventory.
  { label: "Dispatch", href: "/dispatch", icon: Truck, roles: ["operator", "warehouse", "admin"] },
  // Shipments sits BESIDE Dispatch, not inside it. Dispatch is a work queue — what's left
  // to scan today, read by the floor, empty by evening. This is the archive: every parcel
  // that ever got a tracking number, searched by whoever is on the phone to a buyer. A
  // growing list nobody works through does not belong underneath a short list they do.
  { label: "Shipments", href: "/shipments", icon: Package, roles: ["operator", "warehouse", "admin"] },
  // Operator sees Scan READ-ONLY: stock movements are the warehouse's claim about
  // physical custody, but an operator needs to look up what's on hand.
  { label: "Scan", href: "/scan", icon: Barcode, roles: ["operator", "warehouse", "admin"] },
  { label: "Inventory", href: "/inventory", icon: Package, roles: ["operator", "warehouse", "admin"] },
  { label: "Purchase", href: "/purchase", icon: ShoppingBag, roles: ["operator", "warehouse", "admin"] },
  { label: "Suppliers", href: "/suppliers", icon: Storefront, roles: ["operator", "warehouse", "admin"] },
  // Partner billing — what byeastside / Pink Design / carriers / suppliers are owed.
  // Money, so warehouse and admin only, matching every other spend boundary.
  { label: "Billing", href: "/billing", icon: Receipt, roles: ["warehouse", "admin"] },
  // Campaigns is HIDDEN until Meta/Google connections exist — there are no settings to
  // connect an ad account yet, so the page can only show an empty shell. The route and
  // component are intact; restore the roles here to bring it back.
  { label: "Campaigns", href: "/campaigns", icon: Megaphone, roles: [] },
  // Console retired — Users + Activity live in Settings, Top-ups in Wallet, Products at /products.
]

export const STAFF_ROLES = ["operator", "warehouse", "designer", "admin"]

// Where a user should land after login / where staff get bounced if they hit a seller page.
export function landingFor(role?: string | null): string {
  switch (role) {
    case "admin": return "/overview"
    case "operator": return "/overview"
    case "warehouse": return "/overview" // staff dashboard is home for the team
    case "designer": return "/designer"
    default: return "/dashboard" // sellers
  }
}
export function isStaffRole(role?: string | null): boolean {
  return !!role && STAFF_ROLES.includes(role)
}

// Seller-side tool pages (in the (app) group) that specific staff roles may also use.
// Admin gets everything; others get a curated set. Designers get none (design-only).
const STAFF_TOOLS: StaffNavItem[] = [
  { label: "SpyDeck", href: "/spydeck", icon: Binoculars, roles: ["warehouse", "admin"] },
  { label: "Products", href: "/products", icon: Tag, roles: ["operator", "warehouse", "admin"] },
  // The shop window we publish OUTWARD — curated selection, trade prices, CSV export.
  // Warehouse/admin only: it sets the prices outside buyers are shown, which is a
  // commercial decision rather than a floor one.
  // NOT /catalog — that path is the PUBLIC marketing catalogue in (marketing), and two
  // pages resolving to one URL is a build error, not a runtime surprise. This is the
  // staff-side curation of what that window shows.
  { label: "Catalogue", href: "/published-catalog", icon: Storefront, roles: ["warehouse", "admin"] },
  { label: "Design Lab", href: "/design", icon: PenNib, roles: ["operator", "warehouse", "admin"] },
  // Admin-only seller pages (full superuser access). (Seller "Orders"/Dashboard are
  // redundant with the factory Orders hub, so they're intentionally not here.)
  { label: "Stores", href: "/stores", icon: Storefront, roles: ["admin"] },
  { label: "Reports", href: "/reports", icon: ChartBar, roles: ["admin"] },
  { label: "Wallet", href: "/wallet", icon: Wallet, roles: ["admin", "warehouse"] },
  // API keys are a SELLER integration concern — an operator minting live keys is
  // not something the role needs. Warehouse keeps it for connection testing.
  { label: "Developers", href: "/developers", icon: Code, roles: ["warehouse", "admin"] },
]
export function staffTools(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_TOOLS.filter((i) => i.roles.includes(role))
}

// Pages every staff member may use inside the seller (app) group.
// Seller-shell pages any staff role may sit on. /orders is here because the boards link
// INTO it — "Open order" and manual order creation both land on seller-shell routes, and
// without this a non-admin was silently bounced to their dashboard, which reads as the
// page being broken rather than forbidden.
//
// NB this allows the SUB-routes (/orders/new, /orders/:id). The seller order LIST at
// exactly /orders is redirected away for staff — see ordersHomeFor. Two different
// "Orders" pages in the same shell reads as the app switching between a seller and a
// factory design, which is exactly what it looks like.
const STAFF_SHARED_PATHS = ["/chat", "/settings", "/help", "/notifications"]
// Order routes are for roles that actually handle orders. A designer works the artwork
// board and nothing else, so opening an order — let alone creating one — isn't theirs.
const ORDER_ROLES = ["operator", "warehouse", "admin"]

/** Where "orders" means for this role: staff get their production board, sellers the list. */
export function ordersHomeFor(role?: string | null): string {
  return isStaffRole(role) ? "/operator" : "/orders"
}
// May this staff role sit on this (app) page? (admin = all; others = shared + their tools)
export function staffCanUseAppPath(role: string | null | undefined, pathname: string): boolean {
  if (role === "admin") return true
  const allowed = [
    ...STAFF_SHARED_PATHS,
    ...(ORDER_ROLES.includes(String(role)) ? ["/orders"] : []),
    ...staffTools(role).map((i) => i.href),
  ]
  return allowed.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

export function staffNav(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_ITEMS.filter((i) => i.roles.includes(role))
}

// Title for the top bar. Covers EVERY staff-reachable page — the board items, the tools
// (Products/SpyDeck/Design Lab/Stores/Wallet/…) AND the shared pages — not just
// STAFF_ITEMS, so a detail route like /products/16468 shows "Products" instead of falling
// through to the bare "EGFULFILL" brand. Longest-prefix wins so /products/x beats /.
const SHARED_TITLES: Record<string, string> = { "/chat": "Chat", "/settings": "Settings", "/help": "Help", "/orders": "Orders", "/notifications": "Notifications" }
export function staffNavTitle(pathname: string): string {
  const all = [...STAFF_ITEMS, ...STAFF_TOOLS, ...Object.entries(SHARED_TITLES).map(([href, label]) => ({ href, label }))]
  let best = ""; let bestLen = -1
  for (const i of all) {
    if ((pathname === i.href || pathname.startsWith(i.href + "/")) && i.href.length > bestLen) { best = i.label; bestLen = i.href.length }
  }
  return best || "EGFULFILL"
}
