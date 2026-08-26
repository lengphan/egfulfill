"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SignOut, ChatCircleDots, Gear, CaretLineLeft } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { staffNav, staffTools, type StaffNavItem } from "@/lib/staff-nav"
import { loadNavVisibility, isSurfaceHidden } from "@/lib/nav-visibility"
import { useLabelT } from "@/lib/i18n"
import { getUser, clearSession } from "@/lib/auth"
import { MobileNav, type MobileNavSection } from "@/components/app/mobile-nav"

export function StaffSidebar({ collapsed = false, onToggle }: {
  /** Set by the shell, which owns the fact — see lib/rail.ts. */
  collapsed?: boolean
  onToggle?: () => void
}) {
  const tl = useLabelT()
  const pathname = usePathname()
  const router = useRouter()
  const itemCls = cn(
    "flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
    collapsed ? "justify-center px-0" : "gap-3 px-3",
  )
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
    ...(tools.length ? [{ heading: tl("staffSidebar", "Tools"), items: tools.map((i) => ({ label: i.label, href: i.href, icon: i.icon })) }] : []),
    { heading: tl("staffSidebar", "Account"), items: [{ label: tl("staffSidebar", "Chat"), href: "/chat", icon: ChatCircleDots }, { label: tl("staffSidebar", "Settings"), href: "/settings", icon: Gear }] },
  ]

  return (
    <>
    <MobileNav sections={mobileSections} onLogout={logout} role={role} />
    <aside className={cn(
      "fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
      collapsed ? "w-16" : "w-60",
    )}>
      <div className={cn("flex h-16 shrink-0 items-center gap-2", collapsed ? "justify-center px-0" : "px-5")}>
        {/* Brand, so it keeps the marketing face — see sidebar.tsx. */}
        <span className="font-display text-2xl font-semibold tracking-tight" title="egful">{collapsed ? "e" : "egful"}</span>
        {/* WHICH ROLE YOU ARE IN, not a badge for it. This was a filled pill beside the
            wordmark on every single screen — the loudest thing in the sidebar header, saying
            something nobody needs shouted. Small caps carry it just as clearly and stop it
            competing with the nav item that is actually selected. */}
        {role && !collapsed && <span className="ml-auto text-2xs font-semibold uppercase tracking-widest text-sidebar-foreground/50">{role}</span>}
      </div>

      {/* One string, three renderings. They were three copies of the same twelve classes,
          which is how a collapse rule ends up applied to two of them. */}
      <nav className="eg-scroll-slim flex-1 overflow-y-auto p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? nl("nav", item.label) : undefined}
              className={cn(
                itemCls,
                active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/75")} />
              {!collapsed && nl("nav", item.label)}
            </Link>
          )
        })}

        {/* Seller-side tools this role may use (admin: all; operator/warehouse: a curated set). */}
        {tools.length > 0 && (
          <>
            <div className={cn("pb-2 pt-5 eg-label text-sidebar-foreground/70", collapsed ? "px-0 text-center" : "px-3")}>{nl("nav", "Tools")}</div>
            {tools.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/")
              const Icon = item.icon
              return (
                <Link key={item.href} href={item.href} title={collapsed ? nl("nav", item.label) : undefined} className={cn(itemCls, active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
                  <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/75")} />
                  {!collapsed && nl("nav", item.label)}
                </Link>
              )
            })}
          </>
        )}

        {/* Common to every staff member — profile + factory chat. */}
        <div className={cn("pb-2 pt-5 eg-label text-sidebar-foreground/70", collapsed ? "px-0 text-center" : "px-3")}>{nl("nav", "Account")}</div>
        {[{ label: tl("staffSidebar", "Chat"), href: "/chat", icon: ChatCircleDots }, { label: tl("staffSidebar", "Settings"), href: "/settings", icon: Gear }].map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} title={collapsed ? nl("nav", item.label) : undefined} className={cn(itemCls, active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
              <Icon size={19} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/75")} />
              {!collapsed && nl("nav", item.label)}
            </Link>
          )
        })}
      </nav>

      {/* THE TOGGLE — a deliberate, remembered choice, never hover. It sits at the foot with
          log out because both are about the rail rather than about a page. */}
      <div className="shrink-0 p-3 pb-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand the menu" : "Collapse the menu"}
          className={cn(itemCls, "w-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}
        >
          <CaretLineLeft size={19} className={cn("shrink-0 transition-transform", collapsed && "rotate-180")} />
          {!collapsed && <span className="flex-1 text-left">Collapse</span>}
        </button>
      </div>
      <div className="shrink-0 p-3">
        <button
          onClick={logout}
          title={collapsed ? nl("nav", "Log out") : undefined}
          className={cn(itemCls, "w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}
        >
          <SignOut size={19} className="text-sidebar-foreground/75" />
          {!collapsed && nl("nav", "Log out")}
        </button>
      </div>
    </aside>
    </>
  )
}
