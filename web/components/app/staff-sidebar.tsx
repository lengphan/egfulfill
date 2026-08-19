"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SignOut, ChatCircleDots, Gear } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { staffNav, staffTools, type StaffNavItem } from "@/lib/staff-nav"
import { loadNavVisibility, isSurfaceHidden } from "@/lib/nav-visibility"
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
    let alive = true
    const id = setTimeout(() => {
      const u = getUser()
      const r = u?.role ?? ""
      setRole(r)
      // Draw IMMEDIATELY (isSurfaceHidden falls back to defaults before the map loads — no
      // empty-nav flash), then refine once any admin overrides arrive. HIDE-only throughout.
      const apply = () => {
        if (!alive) return
        setItems(staffNav(r).filter((i) => !isSurfaceHidden(r, i.href)))
        setTools(staffTools(r).filter((i) => !isSurfaceHidden(r, i.href)))
      }
      apply()
      loadNavVisibility().then(apply)
    }, 0)
    return () => { alive = false; clearTimeout(id) }
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
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-5">
        {/* Brand, so it keeps the marketing face — see sidebar.tsx. */}
        <span className="font-display text-2xl font-semibold tracking-tight">egful</span>
        {/* WHICH ROLE YOU ARE IN, not a badge for it. This was a filled pill beside the
            wordmark on every single screen — the loudest thing in the sidebar header, saying
            something nobody needs shouted. Small caps carry it just as clearly and stop it
            competing with the nav item that is actually selected. */}
        {role && <span className="ml-auto text-2xs font-semibold uppercase tracking-widest text-sidebar-foreground/50">{role}</span>}
      </div>

      <nav className="eg-scroll-slim flex-1 overflow-y-auto p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/75")} />
              {nl("nav", item.label)}
            </Link>
          )
        })}

        {/* Seller-side tools this role may use (admin: all; operator/warehouse: a curated set). */}
        {tools.length > 0 && (
          <>
            <div className="px-3 pb-2 pt-5 eg-label text-sidebar-foreground/70">{nl("nav", "Tools")}</div>
            {tools.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/")
              const Icon = item.icon
              return (
                <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
                  <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/75")} />
                  {nl("nav", item.label)}
                </Link>
              )
            })}
          </>
        )}

        {/* Common to every staff member — profile + factory chat. */}
        <div className="px-3 pb-2 pt-5 eg-label text-sidebar-foreground/70">{nl("nav", "Account")}</div>
        {[{ label: "Chat", href: "/chat", icon: ChatCircleDots }, { label: "Settings", href: "/settings", icon: Gear }].map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
              <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/75")} />
              {nl("nav", item.label)}
            </Link>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <SignOut size={19} className="text-sidebar-foreground/75" />
          {nl("nav", "Log out")}
        </button>
      </div>
    </aside>
    </>
  )
}
