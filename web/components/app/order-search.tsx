"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { MagnifyingGlass, Package } from "@phosphor-icons/react"
import { getOrders, type OrderRow } from "@/lib/api"
import { getToken } from "@/lib/auth"

// The friendly number a person searches by: the seller's #seq, else the marketplace
// name in meta, else the id. Mirrors how orders render their number elsewhere.
function orderNum(o: OrderRow): string {
  if (o.seq != null) return `#${o.seq}`
  const m = (o.meta || {}) as Record<string, unknown>
  const shop = m.shopify_name
  if (typeof shop === "string" && shop) return shop
  return o.id
}

// The topbar search: a ⌘K overlay that finds an order by number, customer, id, or any
// line SKU, then jumps to its detail page. Orders are fetched once on open (the same
// list every orders view already loads) and filtered client-side, so typing is instant.
export function OrderSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [qy, setQy] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load once per open, so a freshly-created order shows up without a stale cache.
  //
  // Deferred, like every other session-dependent read in this app: setting state
  // synchronously in an effect body cascades a second render before paint, which
  // react-hooks/set-state-in-effect rejects outright. The focus call stays inside the
  // timeout too — the input is only in the DOM once this has committed.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!open) { setQy(""); setActive(0); return }
      inputRef.current?.focus()
      if (!getToken()) { setOrders([]); return }
      getOrders().then((r) => setOrders(r ?? [])).catch(() => setOrders([]))
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  const results = useMemo(() => {
    const term = qy.trim().toLowerCase()
    if (!term || !orders) return []
    return orders
      .filter((o) => {
        const hay = [
          orderNum(o), o.id, o.customer?.name, o.customer?.email, o.store, o.source,
          ...(o.items ?? []).flatMap((it) => [it.sku, it.name]),
        ].filter(Boolean).join(" ").toLowerCase()
        return hay.includes(term)
      })
      .slice(0, 8)
  }, [qy, orders])

  // Retyping puts the highlight back on the first result — holding row 5 of the OLD list
  // over a new one highlights something the person never chose. Deferred for the same
  // reason as above.
  useEffect(() => {
    const t = setTimeout(() => setActive(0), 0)
    return () => clearTimeout(t)
  }, [qy])

  if (!open) return null

  const go = (o: OrderRow) => { onClose(); router.push(`/orders/${encodeURIComponent(o.id)}`) }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 pt-[15vh] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <MagnifyingGlass size={18} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={qy}
            onChange={(e) => setQy(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search orders — number, customer, or SKU"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground sm:block">esc</kbd>
        </div>
        {qy.trim() && (
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            {orders === null ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No orders match “{qy.trim()}”.</div>
            ) : (
              results.map((o, i) => (
                <button
                  key={o.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(o)}
                  className={"flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left " + (i === active ? "bg-accent" : "")}
                >
                  <Package size={16} weight="duotone" className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{orderNum(o)}</span>
                      <span className="truncate text-sm">{o.customer?.name || "—"}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {(o.items?.length ?? 0)} item{(o.items?.length ?? 0) === 1 ? "" : "s"}
                      {o.store ? ` · ${o.store}` : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
