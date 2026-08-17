"use client"

import { useEffect, useState } from "react"
import { VolumeTiersPanel } from "@/components/app/volume-tiers-panel"
import { getUser } from "@/lib/auth"

/**
 * PLANS AND THE VOLUME LADDER, on one page of their own.
 *
 * Both were folded into Settings › Platform, beside the base markup, the shipping bands and
 * every design fee — a screen you open to change one number and then scroll. They are not the
 * same kind of setting as a postage band: a band is a cost we pass on, while these two decide
 * what a seller PAYS US, and they are the two levers most likely to be adjusted in a hurry
 * (a peak season, a partner deal, a rung that turned out too generous).
 *
 * ONE PAGE, because they interact. A seller's rate comes from the ladder; their plan decides
 * what they can reach. Editing one while the other is two tabs away is how a rung gets set
 * against a plan nobody re-read.
 *
 * ADMIN ONLY, and said rather than hidden: warehouse and operator can open Settings ›
 * Platform (the cone list lives there for the floor), so a blank page here would read as
 * broken rather than as refused.
 */
export function PlansAndVolumeView() {
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setRole(getUser()?.role || ""), 0)
    return () => clearTimeout(t)
  }, [])

  // null = not read yet. Rendering the refusal before the role is known would flash "admins
  // only" at an admin on every load.
  if (role === null) return null

  if (role !== "admin") {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <div className="text-sm font-medium">Plans &amp; volume are admin-only</div>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          These decide what sellers pay us. The thread palette and the rest of the floor
          settings are on Settings › Platform.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Plans &amp; volume</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What a seller pays us: the subscription they are on, and the rate they earn by
          shipping. A saved rung applies from the next charge — never to an order already paid
          for.
        </p>
      </div>
      <VolumeTiersPanel />
    </div>
  )
}
