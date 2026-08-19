"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { getDesignFees, setDesignTier, type DesignTier, type OrderItem } from "@/lib/api"
import { TIER_LABEL, TIER_WHY, feeFor, type DesignFees } from "@/lib/design-fee"

const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)
const TIERS: DesignTier[] = ["standard", "complex", "supplied"]

/**
 * THE DESIGN CHARGE, BESIDE THE TOTAL — set here, read here.
 *
 * It used to live inside the design window, which put the one number a seller is billed on
 * a screen about placing pictures, and buried it behind opening a line. Money belongs with
 * money: this sits in the order's Summary, under what the order costs, so the charge and
 * the total it lands in are read in one glance and changed in one place.
 *
 * STAFF ONLY, and the server agrees — the person being charged must not be the one setting
 * the charge. It renders per LINE because that is what a tier is: two lines of one order
 * can legitimately be one supplied file and one we cut from scratch.
 *
 * NOTHING IS PRE-SELECTED. There was a suggestion once, worked out from a rule of thumb and
 * shown as a tinted chip with a fee beside it; nothing was ever debited by it, and it still
 * sat where a real charge goes. Picking a tier is a decision, not a confirmation of ours.
 */
export function DesignCharge({ orderId, items, onChanged }: {
  orderId: string
  items: OrderItem[]
  onChanged?: () => void
}) {
  const [fees, setFees] = useState<DesignFees | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** The tier as this panel currently believes it, keyed by line — so a chip reflects the
   *  press immediately rather than waiting for the order to be re-read. */
  const [local, setLocal] = useState<Record<string, DesignTier>>({})

  useEffect(() => {
    // Deferred: a straight setState in an effect body cascades a render, which this
    // codebase's lint rule rejects.
    const t = setTimeout(() => { getDesignFees().then(setFees).catch(() => setFees(null)) }, 0)
    return () => clearTimeout(t)
  }, [])

  const keyOf = useCallback((it: OrderItem) => String(it.line_id || it.sku || ""), [])

  const apply = async (it: OrderItem, id: DesignTier) => {
    const k = keyOf(it)
    setBusy(k + id); setErr(null); setNote(null)
    try {
      const r = await setDesignTier(orderId, { tier: id, line_id: it.line_id, sku: it.line_id ? undefined : it.sku })
      if (r?.error) throw new Error(r.error)
      setLocal((m) => ({ ...m, [k]: id }))
      // The SERVER's own account of what happened — quoted, charged, already charged, our
      // own shop, or no fee configured. Each is a different fact and only it knows which.
      setNote(r.quoted
        ? "Quoted to the seller. Nothing is charged until they accept, and they may decline."
        : r.charged?.charged
          ? `Charged ${usd(Number(r.charged.charged))} to the seller.`
          : r.charged?.reason === "already-charged"
            ? "Re-filed. This line was already charged, so nothing moved."
            : r.charged?.reason === "factory-order"
              ? "Filed. This is our own shop's order, so nothing is charged."
              : r.charged?.reason === "no-fee-set"
                ? "Filed. No fee is set for this tier, so nothing was charged."
                : "Filed.")
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't set that charge.")
    } finally { setBusy(null) }
  }

  if (!items.length) return null

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Design charge</div>
      <div className="space-y-2.5">
        {items.map((it) => {
          const k = keyOf(it)
          const tier = local[k] ?? ((it.design_tier as DesignTier | null) ?? null)
          const quote = it.design_quote_status ?? null
          return (
            <div key={k || it.sku || it.name}>
              {/* The LINE, only when there is more than one — on a single-line order naming
                  it repeats the item card directly above. */}
              {items.length > 1 && (
                <div className="mb-1 truncate text-2xs text-muted-foreground">{it.name || it.sku || "Line"}</div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {TIERS.map((id) => {
                  const fee = feeFor(id, fees)
                  const set = tier === id
                  return (
                    <button
                      key={id}
                      type="button"
                      title={TIER_WHY[id]}
                      /* Accepted is LOCKED: the seller has paid against that tier, and
                         changing it afterwards would move a settled record. */
                      disabled={!!busy || quote === "accepted"}
                      onClick={() => void apply(it, id)}
                      className={"rounded-lg border px-2 py-1.5 text-2xs font-medium transition-colors disabled:opacity-50 " +
                        (set ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}
                    >
                      {busy === k + id ? <CircleNotch size={12} className="mx-auto animate-spin" /> : (
                        <>
                          <span className="block">{TIER_LABEL[id]}</span>
                          {/* The number, not just the word — Complex is several times
                              Standard, and a charge set by someone who cannot see the amount
                              is a charge made blind. Only once the fees have loaded. */}
                          {fee !== null && <span className="block text-2xs font-normal tabular-nums opacity-70">{usd(fee)}</span>}
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
              {/* The quote's own state, in words. A "complex" chip alone cannot tell
                  waiting-on-the-seller from already-paid from refused. */}
              {quote === "pending" && <p className="mt-1 text-2xs text-amber-700">Waiting on the seller to accept — don&apos;t start work yet.</p>}
              {quote === "declined" && <p className="mt-1 text-2xs text-rose-700">The seller declined. Cancel the line, or agree something else with them.</p>}
              {quote === "accepted" && <p className="mt-1 text-2xs text-emerald-700">Accepted and paid — the tier is locked.</p>}
              {!tier && <p className="mt-1 text-2xs text-muted-foreground">Not set — nothing charged.</p>}
            </div>
          )
        })}
      </div>
      {note && <p className="mt-2 text-2xs text-muted-foreground">{note}</p>}
      {err && <p className="mt-2 text-2xs text-destructive">{err}</p>}
    </div>
  )
}
