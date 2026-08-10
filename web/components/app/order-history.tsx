"use client"

import { useCallback, useEffect, useState } from "react"
import { SectionCard } from "@/components/app/section-card"
import { ActivityFeed } from "@/components/app/activity-feed"
import { getOrderHistory, type AuditRow } from "@/lib/api"
import { getUser } from "@/lib/auth"

/**
 * Everything that has happened to one order, newest first.
 *
 * Distinct from the messages panel, which is a conversation. This is the record: who
 * changed what and when, drawn from audit_log rather than reconstructed from current
 * state — so it still answers "who moved this to shipped" after the fact.
 *
 * Staff-only by API (GET /api/audit/entity requires staff), so this renders empty for a
 * seller rather than leaking who on the floor touched their order.
 */
export function OrderHistory({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  // Don't even ASK as a seller. The endpoint is staff-gated, but relying on a 403 means
  // the request still goes out and the panel can flash before it fails — and this is
  // internal-only, so it shouldn't be one server slip away from being visible.
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      const r = getUser()?.role ?? ""
      setAllowed(["operator", "warehouse", "admin", "designer"].includes(r))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const load = useCallback(() => {
    if (!orderId || !allowed) return
    getOrderHistory(orderId).then((r) => setRows(r ?? [])).catch(() => setRows([]))
  }, [orderId, allowed])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  // A seller gets 403 → empty. Rendering an empty card would imply nothing happened,
  // which is a different claim from "you can't see this", so it renders nothing at all.
  // Only factory staff get this far, so an empty list genuinely means "nothing recorded
  // yet" rather than "you can't see it" — and saying so beats rendering nothing, which is
  // indistinguishable from the feature being missing. Most existing orders predate
  // auditing, so empty is the common first impression.
  if (!allowed) return null

  return (
    <SectionCard
      title="Order history"
    >
      <div className="max-h-72 overflow-y-auto p-3">
        <ActivityFeed
          rows={rows}
          variant="card"
          empty="Nothing recorded for this order yet — changes from here on will appear."
        />
      </div>
    </SectionCard>
  )
}
