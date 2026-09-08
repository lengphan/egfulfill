"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { CircleNotch } from "@phosphor-icons/react"
import { StaffSidebar } from "@/components/app/staff-sidebar"
import { useRailCollapsed } from "@/lib/rail"
import { useAccent } from "@/components/app/accent-boot"
import { ConfirmProvider } from "@/components/app/confirm-dialog"
import { TopBar } from "@/components/app/topbar"
import { ChatLauncher } from "@/components/app/chat-launcher"
import { BoardTour } from "@/components/app/board-tour"
import { DashboardTicker } from "@/components/app/dashboard-ticker"
import { CommandPalette } from "@/components/app/command-palette"
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
        <CommandPalette staff={true} />
        {/* eg-content is THE page container — one width and one gutter for every page,
            no per-page opt-out. See app/globals.css. */}
        <main className="eg-content mx-auto px-4 py-5 md:px-10 md:py-8">
          {/* THE ANNOUNCEMENT REACHES EVERY BOARD, not just the dashboard.
              An admin writes one line for the floor; a person who spends their day on
              /production or /shipping and never opens /overview would never have seen it.

              It carries NO FIGURES here — those belong to the dashboard, which counts its own
              and passes them in. /overview renders its own strip WITH figures, so this one
              stands down there rather than drawing a second bar above it. */}
          {pathname !== "/overview" && <DashboardTicker items={[]} />}
          {children}
        </main>
      </div>
      {/* Boards are their own shell (see the note on StaffSidebar above), so the launcher
          has to be mounted here too — wiring it into app-shell alone left every board
          without it, which is where staff actually spend the day. */}
      <ChatLauncher />
      {/* The staff half of the setup guide. It mounts HERE and not in app-shell, which is the
          seller's: the two shells are separate (see the StaffSidebar note above) and the two
          panels are for different people, so neither role ever sees the other's. */}
      <BoardTour />
    </div>
    </ConfirmProvider>
  )
}
