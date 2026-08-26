"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { CircleNotch } from "@phosphor-icons/react"
import { StaffSidebar } from "@/components/app/staff-sidebar"
import { useRailCollapsed } from "@/lib/rail"
import { useAccent } from "@/components/app/accent-boot"
import { ConfirmProvider } from "@/components/app/confirm-dialog"
import { TopBar } from "@/components/app/topbar"
import { getUser, getToken } from "@/lib/auth"
import { STAFF_ROLES, staffNav, landingFor } from "@/lib/staff-nav"

// Staff-only shell. Sellers (or signed-out) are bounced to the seller dashboard, and a
// staffer who hits a board their role can't access is sent to their own landing board.
export default function BoardsLayout({ children }: { children: React.ReactNode }) {
  // Before any branch: AppShell has three, and one of them silently missed this.
  useAccent()
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, toggleRail] = useRailCollapsed()
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    const id = setTimeout(() => {
      const role = getUser()?.role
      if (!getToken() || !role || !STAFF_ROLES.includes(role)) {
        setOk(false)
        router.replace(getToken() ? "/dashboard" : "/login")
        return
      }
      // Per-role board gating: only the boards this role's nav includes are reachable.
      const allowed = staffNav(role).some((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
      if (!allowed) {
        setOk(false)
        router.replace(landingFor(role))
        return
      }
      setOk(true)
    }, 0)
    return () => clearTimeout(id)
  }, [router, pathname])

  if (ok !== true) {
    return (
      <div className="grid min-h-svh place-items-center bg-background text-muted-foreground">
        <CircleNotch size={24} className="animate-spin" />
      </div>
    )
  }

  return (
    <ConfirmProvider>
    <div className="min-h-svh bg-background">
      {/* THE SECOND SHELL. Board routes do not go through app-shell.tsx — they have their
          own copy of this layout, which is why wiring the rail there alone left every board
          with a toggle that did nothing. Both shells read the same hook. */}
      <StaffSidebar collapsed={collapsed} onToggle={toggleRail} />
      <div className={collapsed ? "md:pl-16" : "md:pl-60"}>
        <TopBar />
        {/* eg-content is THE page container — one width and one gutter for every page,
            no per-page opt-out. See app/globals.css. */}
        <main className="eg-content mx-auto px-4 py-5 md:px-10 md:py-8">{children}</main>
      </div>
    </div>
    </ConfirmProvider>
  )
}
