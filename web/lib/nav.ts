import {
  SquaresFour,
  ShoppingBag,
  Tag,
  Binoculars,
  ChartBar,
  Wallet,
  PenNib,
  ChatCircleDots,
  Storefront,
  Gear,
  Code,
  Question,
  type Icon,
} from "@phosphor-icons/react"

export type NavItem = { label: string; href: string; icon: Icon; gate?: "spydeck" }
export type NavSection = { heading?: string; items: NavItem[] }

/** Seller-side navigation, ported from the static site's sidebar. */
export const sellerNav: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: SquaresFour },
      { label: "Orders", href: "/orders", icon: ShoppingBag },
      { label: "Products", href: "/products", icon: Tag },
      { label: "Stores", href: "/stores", icon: Storefront },
      { label: "SpyDeck", href: "/spydeck", icon: Binoculars, gate: "spydeck" },
      { label: "Reports", href: "/reports", icon: ChartBar },
      { label: "Wallet", href: "/wallet", icon: Wallet },
      { label: "Design Lab", href: "/design", icon: PenNib },
      { label: "Chat", href: "/chat", icon: ChatCircleDots },
    ],
  },
  {
    heading: "Account",
    items: [
      { label: "Developers", href: "/developers", icon: Code },
      { label: "Help", href: "/help", icon: Question },
      { label: "Settings", href: "/settings", icon: Gear },
    ],
  },
]

// href → the team-permission surface id a leader toggles in Settings › Team. Pages absent
// from this map are always available (Help, Settings — Settings deliberately, since it's
// where permissions are granted). Keep in step with SHAREABLE in settings-view.tsx.
const SURFACE_BY_HREF: Record<string, string> = {
  "/dashboard": "dashboard", "/orders": "orders", "/products": "products",
  "/stores": "stores", "/spydeck": "spydeck", "/reports": "reports",
  "/wallet": "wallet", "/design": "design", "/chat": "chat", "/developers": "developers",
}

/** Surface id gating this path, or null when the page is always available. */
export function surfaceOf(href: string): string | null {
  return SURFACE_BY_HREF[href] ?? null
}

/**
 * Is this nav item visible to me? An OWNER (not a team member) sees everything —
 * `permissions` is null. A member sees only the surfaces their leader turned on.
 */
export function allowedByPerms(href: string, permissions: string[] | null): boolean {
  if (!permissions) return true
  const surface = surfaceOf(href)
  return surface === null || permissions.includes(surface)
}

/** Flat lookup of href → label, for page titles / breadcrumbs. */
export const navTitle = (pathname: string): string => {
  for (const section of sellerNav) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) return item.label
    }
  }
  return "EGFULFILL"
}
