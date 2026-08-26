"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/app/section-card"
import { ActivityFeed } from "@/components/app/activity-feed"
import { getOrderHistory, type AuditRow, type OrderItem } from "@/lib/api"
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
export function OrderHistory({ orderId, items = [], startOpen = false }: {
  orderId: string
  items?: OrderItem[]
  /**
   * OPEN ON ARRIVAL, for a caller where getting here was already the decision.
   *
   * The panel collapses because it used to sit at the foot of the money column, where it
   * was passed by everyone and wanted by few. Behind a tab named History that reasoning
   * inverts: pressing the word IS the request, and a second click to see what you just
   * asked for is the click this whole change exists to remove.
   *
   * The §2.8 guarantee survives intact. The load still hangs off an EVENT, not an effect —
   * the caller simply does not mount this until the tab is pressed, so a page view that
   * never opens History still costs no audit query.
   */
  startOpen?: boolean
}) {
  const tl = useLabelT()
  // "FFL-mssfifwo0l05v" means nothing to a reader. The order knows which line that is, so
  // the log borrows the SAME number the item rows and the drop zone use.
  const resolveLine = (key: string) => {
    const i = items.findIndex((it) => (it.line_id || it.sku) === key)
    if (i < 0) return null
    const it = items[i]
    return `Item ${i + 1}${it.name ? ` · ${it.name}` : ""}`
  }
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

  /**
   * COLLAPSED, AND IT DOES NOT FETCH UNTIL IT IS OPENED.
   *
   * This is the RECORD — worth having, rarely worth reading. Expanded by default it pushed
   * the factory note and the activity thread, which are the two things anyone actually works
   * from, below the fold of a long page.
   *
   * The fetch moved onto the toggle rather than into an effect keyed on `open`. §2.8: an
   * effect must never fetch on a condition its own fetch can satisfy, and the safe way to
   * say "load this now" is an EVENT — a click cannot recur on its own. It also takes one
   * audit query off every order page load, since most of them never open this.
   */
  const [open, setOpen] = useState(startOpen)
  /**
   * Mounted already open means the click that would have loaded it never happens, so the
   * arrival has to ask.
   *
   * SAFE UNDER §2.8, and worth saying why, because "an effect that fetches" is the shape
   * that rule is about. The condition here is `startOpen` and `load`'s identity — neither
   * of which this fetch can alter: `load` closes over orderId and allowed, and writes only
   * `rows`, which is in nobody's dependency list. It runs at most twice, once refused while
   * the role check is still pending and once for real when `allowed` flips, and there is no
   * state it writes that can bring it back round.
   */
  useEffect(() => {
    if (startOpen) load()
  }, [startOpen, load])
  const toggle = () => {
    setOpen((v) => {
      if (!v && rows === null) load()
      return !v
    })
  }

  // A seller gets 403 → empty. Rendering an empty card would imply nothing happened,
  // which is a different claim from "you can't see this", so it renders nothing at all.
  // Only factory staff get this far, so an empty list genuinely means "nothing recorded
  // yet" rather than "you can't see it" — and saying so beats rendering nothing, which is
  // indistinguishable from the feature being missing. Most existing orders predate
  // auditing, so empty is the common first impression.
  if (!allowed) return null

  return (
    <SectionCard
      title={tl("orderHistory", "Order history")}
      actions={
        /* A control, not a caption: it SAYS which way it will go, and the caret turns so
           the state is readable without reading the word. Ghost because opening a record
           is a minor action next to anything else on this page (§4: the variants are a
           hierarchy). */
        <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open}>
          {open ? tl("orderHistory", "Hide") : tl("orderHistory", "Show")}
          <CaretDown size={13} weight="bold" className={"transition-transform " + (open ? "rotate-180" : "")} />
        </Button>
      }
    >
      {!open ? null : (
      <div className="max-h-72 overflow-y-auto p-3">
        {/* BARE, because this is already inside a SectionCard. `variant="card"` gave the
            feed its own rounded border, so the panel drew a box, and the list drew another
            box just inside it — two frames around one list, which is what makes a page of
            cards read as clutter. The prop exists for exactly this. */}
        <ActivityFeed
          rows={rows}
          resolveLine={resolveLine}
          variant="bare"
          empty="Nothing recorded for this order yet — changes from here on will appear."
        />
      </div>
      )}
    </SectionCard>
  )
}
