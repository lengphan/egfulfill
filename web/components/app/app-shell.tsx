"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "@/components/app/sidebar"
import { StaffSidebar } from "@/components/app/staff-sidebar"
import { TopBar } from "@/components/app/topbar"
import { PageTransition } from "@/components/motion/page-transition"
import { getUser } from "@/lib/auth"
import { isStaffRole, landingFor } from "@/lib/staff-nav"

// Pages staff are allowed to use inside the seller (app) group (shared surfaces).
// Everything else in (app) is seller-only — staff hitting those get sent to their board.
const STAFF_SHARED = ["/chat", "/settings", "/help"]

// The (app) shell is role-aware: sellers see the seller Sidebar; staff who land on a
// shared page (chat/settings/help) see the StaffSidebar instead; staff on a seller-only
// page are bounced to their own board so they only ever see what their role should.
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [mode, setMode] = useState<"loading" | "seller" | "staff">("loading")

  useEffect(() => {
    const id = setTimeout(() => {
      const role = getUser()?.role
      if (isStaffRole(role)) {
        const allowed = STAFF_SHARED.some((p) => pathname === p || pathname.startsWith(p + "/"))
        if (!allowed) { router.replace(landingFor(role)); return }
        setMode("staff")
      } else {
        setMode("seller")
      }
    }, 0)
    return () => clearTimeout(id)
  }, [router, pathname])

  if (mode === "loading") return null

  if (mode === "staff") {
    return (
      <div className="min-h-svh bg-background">
        <StaffSidebar />
        <div className="md:pl-60">
          <main className="mx-auto max-w-[1600px] px-6 py-6 md:px-8">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-background">
      <Sidebar />
      <div className="md:pl-60">
        <TopBar />
        <main className="mx-auto max-w-[1600px] px-6 py-6 md:px-8">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  )
}
