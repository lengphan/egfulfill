import { Printer, PenNib, Storefront, CurrencyDollar, Binoculars, Tag, SquaresFour, ShoppingBag, ChartBar, Wallet, Code, Package, Barcode, Megaphone, type Icon } from "@phosphor-icons/react"

export type StaffNavItem = { label: string; href: string; icon: Icon; roles: string[] }

// Staff boards, gated by role. Admin sees everything.
const STAFF_ITEMS: StaffNavItem[] = [
  { label: "Dashboard", href: "/overview", icon: SquaresFour, roles: ["operator", "warehouse", "admin"] },
  { label: "Orders", href: "/operator", icon: Printer, roles: ["operator", "warehouse", "admin"] },
  { label: "Board", href: "/designer", icon: PenNib, roles: ["operator", "warehouse", "designer", "admin"] },
  { label: "Earnings", href: "/earnings", icon: CurrencyDollar, roles: ["designer", "admin"] },
  { label: "Scan", href: "/scan", icon: Barcode, roles: ["warehouse", "admin"] },
  { label: "Inventory", href: "/inventory", icon: Package, roles: ["operator", "warehouse", "admin"] },
  { label: "Purchase", href: "/purchase", icon: ShoppingBag, roles: ["operator", "warehouse", "admin"] },
  { label: "Suppliers", href: "/suppliers", icon: Storefront, roles: ["operator", "warehouse", "admin"] },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone, roles: ["warehouse", "admin"] },
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
  { label: "Design Lab", href: "/design", icon: PenNib, roles: ["operator", "warehouse", "admin"] },
  // Admin-only seller pages (full superuser access). (Seller "Orders"/Dashboard are
  // redundant with the factory Orders hub, so they're intentionally not here.)
  { label: "Stores", href: "/stores", icon: Storefront, roles: ["admin"] },
  { label: "Reports", href: "/reports", icon: ChartBar, roles: ["admin"] },
  { label: "Wallet", href: "/wallet", icon: Wallet, roles: ["admin"] },
  { label: "Developers", href: "/developers", icon: Code, roles: ["operator", "warehouse", "admin"] },
]
export function staffTools(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_TOOLS.filter((i) => i.roles.includes(role))
}

// Pages every staff member may use inside the seller (app) group.
const STAFF_SHARED_PATHS = ["/chat", "/settings", "/help"]
// May this staff role sit on this (app) page? (admin = all; others = shared + their tools)
export function staffCanUseAppPath(role: string | null | undefined, pathname: string): boolean {
  if (role === "admin") return true
  const allowed = [...STAFF_SHARED_PATHS, ...staffTools(role).map((i) => i.href)]
  return allowed.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

export function staffNav(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_ITEMS.filter((i) => i.roles.includes(role))
}

export function staffNavTitle(pathname: string): string {
  for (const i of STAFF_ITEMS) if (pathname === i.href || pathname.startsWith(i.href + "/")) return i.label
  return "EGFULFILL"
}
