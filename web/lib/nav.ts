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
  type Icon,
} from "@phosphor-icons/react"

export type NavItem = { label: string; href: string; icon: Icon }
export type NavSection = { heading?: string; items: NavItem[] }

/** Seller-side navigation, ported from the static site's sidebar. */
export const sellerNav: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: SquaresFour },
      { label: "Orders", href: "/orders", icon: ShoppingBag },
      { label: "Products", href: "/products", icon: Tag },
      { label: "Stores", href: "/stores", icon: Storefront },
      { label: "SpyDeck", href: "/spydeck", icon: Binoculars },
      { label: "Reports", href: "/reports", icon: ChartBar },
      { label: "Wallet", href: "/wallet", icon: Wallet },
      { label: "Design Lab", href: "/design", icon: PenNib },
      { label: "Chat", href: "/chat", icon: ChatCircleDots },
    ],
  },
  {
    heading: "Account",
    items: [{ label: "Settings", href: "/settings", icon: Gear }],
  },
]

/** Flat lookup of href → label, for page titles / breadcrumbs. */
export const navTitle = (pathname: string): string => {
  for (const section of sellerNav) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) return item.label
    }
  }
  return "EGFULFILL"
}
