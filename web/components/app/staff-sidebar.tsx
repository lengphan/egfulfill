"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SignOut, ChatCircleDots, Gear } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { staffNav, staffTools, type StaffNavItem } from "@/lib/staff-nav"
import { useLabelT } from "@/lib/i18n"
import { getUser, clearSession } from "@/lib/auth"
import { MobileNav, type MobileNavSection } from "@/components/app/mobile-nav"

export function StaffSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const nl = useLabelT()
  const [items, setItems] = useState<StaffNavItem[]>([])
  const [tools, setTools] = useState<StaffNavItem[]>([])
  const [role, setRole] = useState("")
  useEffect(() => {
    const id = setTimeout(() => {
      const u = getUser()
      setRole(u?.role ?? "")
      setItems(staffNav(u?.role))
      setTools(staffTools(u?.role))
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const logout = () => { clearSession(); router.push("/login") }

  const mobileSections: MobileNavSection[] = [
    { items: items.map((i) => ({ label: i.label, href: i.href, icon: i.icon })) },
    ...(tools.length ? [{ heading: "Tools", items: tools.map((i) => ({ label: i.label, href: i.href, icon: i.icon })) }] : []),
    { heading: "Account", items: [{ label: "Chat", href: "/chat", icon: ChatCircleDots }, { label: "Settings", href: "/settings", icon: Gear }] },
  ]

  return (
    <>
    <MobileNav sections={mobileSections} onLogout={logout} role={role} />
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-5">
        <span className="font-display text-2xl font-semibold tracking-tight">egfulfill</span>
        {role && <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium capitalize tracking-normal text-primary">{role}</span>}
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              {nl("nav", item.label)}
            </Link>
          )
        })}

        {/* Seller-side tools this role may use (admin: all; operator/warehouse: a curated set). */}
        {tools.length > 0 && (
          <>
            <div className="px-3 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{nl("nav", "Tools")}</div>
            {tools.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/")
              const Icon = item.icon
              return (
                <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-accent hover:text-foreground")}>
                  <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                  {nl("nav", item.label)}
                </Link>
              )
            })}
          </>
        )}

        {/* Common to every staff member — profile + factory chat. */}
        <div className="px-3 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{nl("nav", "Account")}</div>
        {[{ label: "Chat", href: "/chat", icon: ChatCircleDots }, { label: "Settings", href: "/settings", icon: Gear }].map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-accent hover:text-foreground")}>
              <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              {nl("nav", item.label)}
            </Link>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
          <SignOut size={19} className="text-muted-foreground" />
          {nl("nav", "Log out")}
        </button>
      </div>
    </aside>
    </>
  )
}
