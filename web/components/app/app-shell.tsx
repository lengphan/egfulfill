"use client"

import { useRailCollapsed } from "@/lib/rail"
import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "@/components/app/sidebar"
import { StaffSidebar } from "@/components/app/staff-sidebar"
import { TopBar } from "@/components/app/topbar"
import { CommandPalette } from "@/components/app/command-palette"
import { PageTransition } from "@/components/motion/page-transition"
import { useAccent } from "@/components/app/accent-boot"
import { ConfirmProvider } from "@/components/app/confirm-dialog"
import { getUser, getToken } from "@/lib/auth"
import { isStaffRole, landingFor, staffCanUseAppPath, ordersHomeFor } from "@/lib/staff-nav"
import { sellerNav, allowedByPerms } from "@/lib/nav"
import { getMyAccess } from "@/lib/api"
import { LowBalanceBanner } from "@/components/app/low-balance-banner"

// The (app) shell is role-aware: sellers see the seller Sidebar; staff who may use a page
// (per their role — admin all, operator/warehouse a curated set, designer none) see the
// StaffSidebar instead; staff on a page their role can't use are bounced to their board.
export function AppShell({ children }: { children: React.ReactNode }) {
  // Before any branch: AppShell has three, and one of them silently missed this.
  useAccent()
  const router = useRouter()
  const pathname = usePathname()
  const [mode, setMode] = useState<"loading" | "seller" | "staff">("loading")
  const [collapsed, toggleRail] = useRailCollapsed()

  useEffect(() => {
    const id = setTimeout(() => {
      /* NO SESSION → /login, before anything else renders.
         This shell had no such check: getUser() returning undefined fell through to the
         seller branch, so a signed-out visitor got the whole app shell and every call
         inside it 401'd into an empty state. "Couldn't load your orders" is not an access
         decision — it reads as a broken product, and it showed a signed-out person the
         shape of the app rather than asking them to sign in.

         The current path rides along as `next`, so signing in returns you where you were
         aiming. /login already validates that value against open redirects (safeNext), so
         only a same-origin relative path is ever honoured. Mode stays "loading" so nothing
         paints behind the redirect. */
      if (!getToken()) {
        const here = window.location.pathname + window.location.search
        router.replace(`/login?next=${encodeURIComponent(here)}`)
        return
      }
      const role = getUser()?.role
      if (isStaffRole(role)) {
        // The seller order LIST is a different design from the production board. Staff
        // reaching it (via a stale link, or "back") get their own board instead of the
        // app appearing to switch between two layouts. Sub-routes still work.
        if (pathname === "/orders") { router.replace(ordersHomeFor(role)); return }
        if (!staffCanUseAppPath(role, pathname)) { router.replace(landingFor(role)); return }
        setMode("staff")
      } else {
        setMode("seller")
      }
    }, 0)
    return () => clearTimeout(id)
  }, [router, pathname])

  // Team members: hiding a nav item doesn't stop someone typing /wallet, so the shell
  // bounces them off a surface their leader didn't share — the same way it bounces staff
  // off a board their role can't use. Only acts once access is KNOWN (an owner resolves
  // to null perms → unrestricted), so it can't redirect during the initial load.
  useEffect(() => {
    if (mode !== "seller" || !getToken()) return
    let live = true
    getMyAccess()
      .then((a) => {
        if (!live || !a.member) return
        const perms = a.permissions ?? []
        if (allowedByPerms(pathname, perms)) return
        // Send them somewhere they actually have: their first shared page, else Settings
        // (always available, and where the team banner explains their access).
        const home = sellerNav.flatMap((s) => s.items).find((it) => allowedByPerms(it.href, perms))
        router.replace(home?.href ?? "/settings")
      })
      .catch(() => {})
    return () => { live = false }
  }, [mode, pathname, router])

  if (mode === "loading") return null

  /* The rail's width and the shell's left padding are ONE fact held in two places. They are
     siblings in the tree, so the shell owns the state and hands it down rather than each
     reading storage and drifting a frame apart on load. */
  const railPad = collapsed ? "md:pl-16" : "md:pl-60"

  if (mode === "staff") {
    return (
      <ConfirmProvider>
      <div className="min-h-svh bg-background">
        <StaffSidebar collapsed={collapsed} onToggle={toggleRail} />
        <div className={railPad}>
          <TopBar />
          <CommandPalette staff />
          {/* eg-content is THE page container — one width and one gutter for every page,
              no per-page opt-out. See app/globals.css. */}
          <main className="eg-content mx-auto px-4 py-5 md:px-10 md:py-8">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      </ConfirmProvider>
    )
  }

  return (
    <ConfirmProvider>
    <div className="min-h-svh bg-background">
      <Sidebar collapsed={collapsed} onToggle={toggleRail} />
      <div className={railPad}>
        <TopBar />
        <CommandPalette />
        <main className="eg-content mx-auto space-y-4 px-4 py-5 md:px-10 md:py-8">
          {/* Seller-only, and above the page rather than on one screen: a short wallet
              stops an order being submitted from ANYWHERE, so a warning that only appears
              on the wallet page arrives after the refusal it was meant to prevent.
              Renders nothing unless the server says the balance is actually low. */}
          <LowBalanceBanner />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
    </ConfirmProvider>
  )
}
