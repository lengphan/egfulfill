"use client"

import { useEffect, useState } from "react"
import { CircleNotch, Package, Warning, CheckCircle, LinkSimple } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getShipmentCandidates, attachShipmentToOrder, type ShipmentCandidate } from "@/lib/api"

/**
 * WHICH ORDER IS THIS PARCEL FOR? — asked, never assumed.
 *
 * A label bought without an order usually means the address was pasted rather than picked,
 * and an order is sitting there waiting for it: seven such labels were bought in one
 * evening, so seven buyers had a parcel on the way and no tracking number.
 *
 * The matching is a GUESS and is presented as one. Two orders in that same batch shared a
 * buyer name, which is exactly why this cannot auto-attach: the server ranks, the person
 * decides, and nothing moves until a specific row is chosen and confirmed.
 *
 * So every candidate shows what is needed to tell two apart — the full ship-to address, the
 * date the order came in, and what matched — rather than a name and a score. A ranking you
 * cannot check is just an assertion with an ordering.
 */
export function MatchShipmentDialog({
  shipmentId, toName, onClose, onAttached,
}: {
  shipmentId: string | null
  toName?: string | null
  onClose: () => void
  onAttached?: (orderId: string) => void
}) {
  const [rows, setRows] = useState<ShipmentCandidate[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    // Deferred: a setState in an effect body cascades a render before paint, which this
    // repo lints against (react-hooks/set-state-in-effect).
    const t = setTimeout(() => {
      if (!alive || !shipmentId) return
      setRows(null); setErr(null); setPicked(null)
      getShipmentCandidates(shipmentId)
        .then((r) => { if (alive) setRows(r.candidates ?? []) })
        .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Couldn't look for matching orders.") })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [shipmentId])

  const attach = async () => {
    if (!shipmentId || !picked) return
    setSaving(true); setErr(null)
    try {
      const r = await attachShipmentToOrder(shipmentId, picked)
      if (r.error) throw new Error(r.error)
      onAttached?.(picked)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't attach this label to that order.")
    } finally { setSaving(false) }
  }

  const fmtDate = (v?: string | null) =>
    v ? new Date(v).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—"

  return (
    <Dialog open={!!shipmentId} onOpenChange={(o) => { if (!o) onClose() }}>
      {/* `sm:` — the base sets sm:max-w-md and a bare max-w-* is a different variant, so both
          survive tailwind-merge and the breakpoint one wins above 640px. A full address per
          row needs the width. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package size={16} weight="fill" className="text-muted-foreground" />
            Which order is this parcel for?
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          This label was bought without an order{toName ? <> — addressed to <span className="font-medium text-foreground">{toName}</span></> : null}.
          Attaching it puts the tracking on that order. It does <span className="font-medium text-foreground">not</span> tell
          the marketplace or charge anything again.
        </p>

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <Warning size={15} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-border">
          {rows === null ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <CircleNotch size={16} className="animate-spin" /> Looking for orders that fit…
            </div>
          ) : rows.length === 0 ? (
            // NOT the same as "we failed to look". An empty result here is a fact about the
            // orders, and it names the two reasons it can be true.
            <div className="p-8 text-center text-sm text-muted-foreground">
              No order matches this address or name — and orders that already have tracking
              aren&apos;t offered, since a second number on one order means a parcel is unaccounted for.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((c) => {
                const on = picked === c.id
                return (
                  <label
                    key={c.id}
                    className={"flex cursor-pointer items-start gap-3 p-3 transition-colors " + (on ? "bg-primary/5" : "hover:bg-accent/50")}
                  >
                    <input
                      type="radio"
                      name="candidate"
                      checked={on}
                      onChange={() => setPicked(c.id)}
                      className="mt-1 size-4 accent-[var(--primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{c.customer || "No name on the order"}</span>
                        <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[c.address.street, c.address.city, c.address.state, c.address.zip].filter(Boolean).join(", ") || "No address on the order"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs">
                        {/* The import date, because two orders for one buyer are told apart
                            by when they arrived and by nothing else on this row. */}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                          Imported {fmtDate(c.createdAt)}
                        </span>
                        {c.matchedZip && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                            Address matches
                          </span>
                        )}
                        {c.matchedName && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                            Name matches
                          </span>
                        )}
                        {!c.matchedZip && !c.matchedName && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                            Weak match
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void attach()} disabled={!picked || saving}>
            {saving ? <CircleNotch size={14} className="animate-spin" /> : <LinkSimple size={14} weight="bold" />}
            Attach to this order
          </Button>
        </div>

        {/* Said before the click, not after: this is reversible, and knowing that is what
            makes confirming a weak match reasonable rather than risky. */}
        <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <CheckCircle size={13} className="mt-px shrink-0" />
          Wrong one? The order&apos;s tracking can be removed again — the postage stays bought either way.
        </p>
      </DialogContent>
    </Dialog>
  )
}
