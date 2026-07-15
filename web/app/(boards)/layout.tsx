"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CircleNotch } from "@phosphor-icons/react"
import { StaffSidebar } from "@/components/app/staff-sidebar"
import { getUser, getToken } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/staff-nav"

// Staff-only shell. Sellers (or signed-out) are bounced to the seller dashboard.
export default function BoardsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    const id = setTimeout(() => {
      const role = getUser()?.role
      if (!getToken() || !role || !STAFF_ROLES.includes(role)) {
        setOk(false)
        router.replace(getToken() ? "/dashboard" : "/login")
      } else {
        setOk(true)
      }
    }, 0)
    return () => clearTimeout(id)
  }, [router])

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
        <main className="mx-auto max-w-[1600px] px-6 py-6 md:px-8">{children}</main>
      </div>
    </div>
  )
}
