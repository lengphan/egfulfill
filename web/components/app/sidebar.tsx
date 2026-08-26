"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SignOut, LockSimple , CaretLineLeft } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { sellerNav, allowedByPerms } from "@/lib/nav"
import { useNavVisibility, isSurfaceHidden } from "@/lib/nav-visibility"
import { useLabelT } from "@/lib/i18n"
import { useEntitlements } from "@/lib/entitlements"
import { getMyAccess } from "@/lib/api"
import { clearSession, getToken } from "@/lib/auth"
import { MobileNav, type MobileNavSection } from "@/components/app/mobile-nav"

export function Sidebar({ collapsed = false, onToggle }: {
  /** Set by the shell, which owns the fact — see lib/rail.ts. */
  collapsed?: boolean
  onToggle?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const nl = useLabelT()
  const logout = () => {
    clearSession()
    router.push("/login")
  }
  // Plan-gated items (SpyDeck). Resolved SERVER-side via useEntitlements, not from the
  // cached session: a team member's own row is always 'starter', so the cached answer
  // drew a padlock next to a feature their leader had already paid for.
  const spydeck = useEntitlements().spydeck
  useNavVisibility() // re-render once the admin hide-map loads

  // Team permissions: if I'm someone's member, show only the surfaces they shared. An
  // owner gets null → everything. Until it resolves we render the full nav (an owner is
  // the common case, and hiding then re-showing would flash).
  const [perms, setPerms] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    const sync = () => {
      if (!getToken()) return
      getMyAccess()
        .then((a) => { if (live) setPerms(a.member ? (a.permissions ?? []) : null) })
        .catch(() => {})
    }
    const id = setTimeout(sync, 0)
    // A leader toggling a surface fires this so an open member session updates.
    window.addEventListener("eg-perms-changed", sync)
    return () => { live = false; clearTimeout(id); window.removeEventListener("eg-perms-changed", sync) }
  }, [])

  // One filtered copy of the nav, used by both the desktop rail and the mobile sheet.
  const sections = sellerNav
    .map((s) => ({ ...s, items: s.items.filter((it) => allowedByPerms(it.href, perms) && !isSurfaceHidden("seller", it.href)) }))
    .filter((s) => s.items.length > 0)

  const mobileSections: MobileNavSection[] = sections.map((s) => ({
    heading: s.heading,
    items: s.items.map((it) => ({ label: it.label, href: it.href, icon: it.icon, locked: it.gate === "spydeck" && !spydeck })),
  }))

  return (
    <>
    <MobileNav sections={mobileSections} onLogout={logout} />
    <aside className={cn(
      "fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
      collapsed ? "w-16" : "w-60",
    )}>
      {/* THE WORDMARK IS BRAND, NOT CHROME — so it takes `font-display` (Playfair), the
          marketing face, even though every other heading in the app takes `font-title`.
          A logo that changes typeface between the marketing site and the product is two
          companies; the rest of the app staying sans is a UI decision, not a brand one. */}
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-0" : "px-5")}>
        <Link
          href="/dashboard"
          className="font-display text-2xl font-semibold tracking-tight text-sidebar-foreground"
          title="egful"
        >
          {collapsed ? "e" : "egful"}
        </Link>
      </div>

      <nav className="eg-scroll-slim flex-1 overflow-y-auto p-3">
        {sections.map((section, i) => (
          <div key={i} className="mb-1">
            {section.heading && (
              <div className={cn("eg-label pb-2 pt-5 text-sidebar-foreground/70", collapsed ? "px-0 text-center text-[8px]" : "px-3")}>
                {collapsed ? "" : nl("nav", section.heading)}
              </div>
            )}
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/")
              const Icon = item.icon
              const locked = item.gate === "spydeck" && !spydeck
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? nl("nav", item.label) : undefined}
                  className={cn(
                    "flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "gap-3 px-3",
                    // The selected item is the ONLY coloured thing in the nav — a solid
                    // inverted block, not a 10% tint of the accent. A tint that faint reads
                    // as "slightly warmer row" rather than "you are here", which is why the
                    // active page was hard to spot at a glance.
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon
                    size={19}
                    weight={active ? "fill" : "regular"}
                    className={cn("shrink-0", !active && "text-sidebar-foreground/60")}
                  />
                  {!collapsed && <span className="flex-1">{nl("nav", item.label)}</span>}
                  {locked && <LockSimple size={13} weight="fill" className="shrink-0 text-muted-foreground/60" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* THE TOGGLE. A deliberate, remembered choice — never hover. It sits at the foot with
          log out because both are about the rail rather than about a page. */}
      <div className="shrink-0 p-3 pb-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand the menu" : "Collapse the menu"}
          className={cn(
            "flex w-full items-center rounded-lg py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed ? "justify-center px-0" : "gap-3 px-3",
          )}
        >
          <CaretLineLeft size={19} className={cn("shrink-0 transition-transform", collapsed && "rotate-180")} />
          {!collapsed && <span className="flex-1 text-left">Collapse</span>}
        </button>
      </div>
      <div className="shrink-0 p-3">
        <button
          onClick={logout}
          title={collapsed ? nl("nav", "Log out") : undefined}
          className={cn(
            "flex w-full items-center rounded-lg py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed ? "justify-center px-0" : "gap-3 px-3",
          )}
        >
          <SignOut size={19} className="text-sidebar-foreground/75" />
          {!collapsed && nl("nav", "Log out")}
        </button>
      </div>
    </aside>
    </>
  )
}
