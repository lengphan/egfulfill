import { Printer, Package, ShieldCheck, PenNib, Storefront, type Icon } from "@phosphor-icons/react"

export type StaffNavItem = { label: string; href: string; icon: Icon; roles: string[] }

// Staff boards, gated by role. Admin sees everything.
const STAFF_ITEMS: StaffNavItem[] = [
  { label: "Operator", href: "/operator", icon: Printer, roles: ["operator", "admin"] },
  { label: "Designer", href: "/designer", icon: PenNib, roles: ["operator", "warehouse", "designer", "admin"] },
  { label: "Warehouse", href: "/warehouse", icon: Package, roles: ["warehouse", "admin"] },
  { label: "Suppliers", href: "/suppliers", icon: Storefront, roles: ["operator", "warehouse", "admin"] },
  { label: "Admin", href: "/admin", icon: ShieldCheck, roles: ["admin"] },
]

export const STAFF_ROLES = ["operator", "warehouse", "designer", "admin"]

// Where a user should land after login / where staff get bounced if they hit a seller page.
export function landingFor(role?: string | null): string {
  switch (role) {
    case "admin": return "/admin"
    case "operator": return "/operator"
    case "warehouse": return "/warehouse"
    case "designer": return "/designer"
    default: return "/dashboard" // sellers
  }
}
export function isStaffRole(role?: string | null): boolean {
  return !!role && STAFF_ROLES.includes(role)
}

export function staffNav(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_ITEMS.filter((i) => i.roles.includes(role))
}

export function staffNavTitle(pathname: string): string {
  for (const i of STAFF_ITEMS) if (pathname === i.href || pathname.startsWith(i.href + "/")) return i.label
  return "EGFULFILL"
}
