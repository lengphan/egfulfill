"use client"

import { useCallback, useEffect, useState } from "react"
import { ClockCounterClockwise, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { getOrderHistory, type AuditRow } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { sayAction } from "@/components/app/tag-history"

/** "Helen · Warehouse" — a team asks "who did this" by name, and the role is what makes
 *  the name meaningful when two people share one. Falls back through name → email →
 *  role so an entry is never anonymous. */
function actorOf(r: AuditRow): string {
  const who = r.actor_name || r.actor_email || r.actor || ""
  const role = r.actor_role ? r.actor_role.charAt(0).toUpperCase() + r.actor_role.slice(1) : ""
  if (who && role) return `${who} · ${role}`
  return who || role || "System"
}

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
  if (!allowed) return null
  if (rows !== null && rows.length === 0) return null

  return (
    <SectionCard
      title="Order history"
      description="Internal — who changed what, and when. Never shown to the seller."
    >
      {rows === null ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground"><CircleNotch size={18} className="animate-spin" /></div>
      ) : (
        <div className="max-h-72 divide-y divide-border overflow-y-auto">
          {rows.map((r) => (
            <div key={String(r.id)} className="flex items-start gap-3 px-5 py-2.5">
              <ClockCounterClockwise size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{sayAction(r.action)}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{actorOf(r)}</span>
                  {" · "}
                  {new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {r.note ? ` · ${r.note}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
