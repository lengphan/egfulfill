import { Printer, Package, type Icon } from "@phosphor-icons/react"

export type StaffNavItem = { label: string; href: string; icon: Icon; roles: string[] }

// Staff boards, gated by role. Only routes that exist are listed (Admin gets added
// here as it's built). Admin sees everything.
const STAFF_ITEMS: StaffNavItem[] = [
  { label: "Operator", href: "/operator", icon: Printer, roles: ["operator", "admin"] },
  { label: "Warehouse", href: "/warehouse", icon: Package, roles: ["warehouse", "admin"] },
]

export const STAFF_ROLES = ["operator", "warehouse", "designer", "admin"]

export function staffNav(role?: string | null): StaffNavItem[] {
  if (!role) return []
  return STAFF_ITEMS.filter((i) => i.roles.includes(role))
}

export function staffNavTitle(pathname: string): string {
  for (const i of STAFF_ITEMS) if (pathname === i.href || pathname.startsWith(i.href + "/")) return i.label
  return "EGFULFILL"
}
