"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "@/components/app/sidebar"
import { StaffSidebar } from "@/components/app/staff-sidebar"
import { TopBar } from "@/components/app/topbar"
import { PageTransition } from "@/components/motion/page-transition"
import { getUser } from "@/lib/auth"
import { isStaffRole, landingFor, staffCanUseAppPath, ordersHomeFor } from "@/lib/staff-nav"

// The (app) shell is role-aware: sellers see the seller Sidebar; staff who may use a page
// (per their role — admin all, operator/warehouse a curated set, designer none) see the
// StaffSidebar instead; staff on a page their role can't use are bounced to their board.
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [mode, setMode] = useState<"loading" | "seller" | "staff">("loading")

  useEffect(() => {
    const id = setTimeout(() => {
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

  if (mode === "loading") return null

  if (mode === "staff") {
    return (
      <div className="min-h-svh bg-background">
        <StaffSidebar />
        <div className="md:pl-60">
          <TopBar />
          <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-6">
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
        <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  )
}
