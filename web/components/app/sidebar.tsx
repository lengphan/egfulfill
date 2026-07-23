"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SignOut, LockSimple } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { sellerNav, allowedByPerms } from "@/lib/nav"
import { useLabelT } from "@/lib/i18n"
import { useEntitlements } from "@/lib/entitlements"
import { getMyAccess } from "@/lib/api"
import { clearSession, getToken } from "@/lib/auth"
import { MobileNav, type MobileNavSection } from "@/components/app/mobile-nav"

export function Sidebar() {
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
    .map((s) => ({ ...s, items: s.items.filter((it) => allowedByPerms(it.href, perms)) }))
    .filter((s) => s.items.length > 0)

  const mobileSections: MobileNavSection[] = sections.map((s) => ({
    heading: s.heading,
    items: s.items.map((it) => ({ label: it.label, href: it.href, icon: it.icon, locked: it.gate === "spydeck" && !spydeck })),
  }))

  return (
    <>
    <MobileNav sections={mobileSections} onLogout={logout} />
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
      {/* Wordmark — clean bold sans (retired the serif logo) */}
      <div className="flex h-16 shrink-0 items-center border-b border-border px-5">
        <Link href="/dashboard" className="font-display text-2xl font-semibold tracking-tight text-foreground">
          egfulfill
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {sections.map((section, i) => (
          <div key={i} className="mb-1">
            {section.heading && (
              <div className="px-3 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {nl("nav", section.heading)}
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
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/70 hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon
                    size={19}
                    weight={active ? "fill" : "regular"}
                    className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}
                  />
                  <span className="flex-1">{nl("nav", item.label)}</span>
                  {locked && <LockSimple size={13} weight="fill" className="shrink-0 text-muted-foreground/60" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <SignOut size={19} className="text-muted-foreground" />
          {nl("nav", "Log out")}
        </button>
      </div>
    </aside>
    </>
  )
}
