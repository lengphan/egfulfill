"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { CircleNotch } from "@phosphor-icons/react"
import { StaffSidebar } from "@/components/app/staff-sidebar"
import { getUser, getToken } from "@/lib/auth"
import { STAFF_ROLES, staffNav, landingFor } from "@/lib/staff-nav"

// Staff-only shell. Sellers (or signed-out) are bounced to the seller dashboard, and a
// staffer who hits a board their role can't access is sent to their own landing board.
export default function BoardsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
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
    <div className="min-h-svh bg-background">
      <StaffSidebar />
      <div className="md:pl-60">
        <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-6">{children}</main>
      </div>
    </div>
  )
}
