"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useRef, useState } from "react"
import { CircleNotch, CheckCircle, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrderCharges, chargeOrderFee, ApiError } from "@/lib/api"

const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)

/** The shape the fee route refuses with — same fields whether it is returned or thrown. */
type FeeRefusal = { error?: string; shortfall?: number; sellerTold?: boolean }

/** One wording for a refusal, so the returned and the thrown path cannot drift apart. */
function refusal(r: FeeRefusal): string {
  const base = r.error || "Couldn't charge the adjustment — nothing was taken."
  if (!r.shortfall) return base
  return `${base} They need ${usd(r.shortfall)} more in the wallet${
    r.sellerTold ? " — they've been asked in chat to top up; press Charge again once it lands" : ""
  }.`
}
const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * THE PRICE ADJUSTMENT, ON ITS OWN — an amount and a reason, nothing else.
 *
 * It used to live inside the refund panel, under the itemised charges, which meant two
 * things the owner objected to (2026-09-07): it repeated every charge the Summary above
 * already prints, and it only existed once an order had been charged — so on a DRAFT,
 * which is exactly when the floor finds the heavier parcel or the extra colour, there was
 * nowhere to write it down. This card shows on every seller order at every stage.
 *
 * It charges the seller's wallet now, against this order, with the reason on their
 * statement — the same ledger entry whether the order is a draft or shipped. Who may press
 * it is decided server-side (canAdjustPrice: admin and operator); the read reports that as
 * `canAdjust`, and the card renders nothing for anyone else rather than offering a 403.
 *
 * Keeping money back OUT of a refund stays in the refund panel, because that is a
 * different act — two movements in one press — and this card is only ever one.
 */
export function OrderAdjustPanel({ orderId, onCharged }: { orderId: string; onCharged?: () => void }) {
  const tl = useLabelT()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // A ref guards re-entry: each press mints its own idempotency key, so two presses that
  // beat the re-render would be two charges, not one deduped retry.
  const sending = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => {
      getOrderCharges(orderId).then((r) => setAllowed(!!r?.canAdjust)).catch(() => setAllowed(false))
    }, 0)
    return () => clearTimeout(t)
  }, [orderId])

  /**
   * A SUCCESS IS NEWS, AND NEWS GOES STALE.
   *
   * "Charged $2.00 to the seller's wallet" sat there until the panel was unmounted — through
   * the reversal of that very charge, still claiming it as the latest thing that happened.
   * A confirmation is about the press that caused it; once it outlives the state it describes
   * it is just a sentence on the screen, and a wrong one.
   *
   * Successes only. A refusal stays until something is done about it: it names a shortfall or
   * a reason, and timing that out would hide the one message the operator has to act on.
   */
  useEffect(() => {
    if (!msg?.ok) return
    const t = setTimeout(() => setMsg((m) => (m?.ok ? null : m)), 6000)
    return () => clearTimeout(t)
  }, [msg])

  if (!allowed) return null

  const amt = Math.max(0, Number(amount) || 0)
  const charge = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setMsg(null)
    try {
      const r = await chargeOrderFee(orderId, { amount: amt, note: note.trim(), clientId: newClientId() })
      if (r.error) { setMsg({ ok: false, text: refusal(r) }); return }
      /* `chargedNow`, never `charged` — the latter is the order's running total, and reading
         it here is what confirmed a $2 adjustment as "Charged $128.27". */
      setMsg({ ok: true, text: `Charged ${usd(r.chargedNow ?? amt)} to the seller's wallet.` })
      setAmount(""); setNote("")
      onCharged?.()
    } catch (e) {
      /**
       * THE REASON IS IN THE THROWN ERROR, not in a returned object.
       *
       * The branch above could never run. The server refuses with `reply.code(400)` and a
       * body carrying the reason — a wallet shortfall, a missing note, an order it will not
       * adjust — and `api()` turns any non-2xx into a thrown ApiError. So every refusal, every
       * one of them explained, arrived here and was replaced with "Couldn't charge the
       * adjustment — nothing was taken": true, useless, and identical for a $2 shortfall and
       * a server that is down.
       *
       * ApiError carries the parsed body for exactly this. The shortfall wording is worth
       * recovering on its own: the seller has ALREADY been asked to top up, in their support
       * chat and on the bell, so the operator needs to know to wait rather than to chase.
       */
      const body = e instanceof ApiError ? (e.body as FeeRefusal | undefined) : undefined
      setMsg({
        ok: false,
        text: body?.error
          ? refusal(body)
          : e instanceof Error && e.message
            ? e.message
            : "Couldn't charge the adjustment — nothing was taken.",
      })
    } finally { sending.current = false; setBusy(false) }
  }

  return (
    <SectionCard title={tl("orderRefund", "Price adjustment")}>
      <div className="space-y-3 px-5 py-4">
        {msg && (
          <div className={"flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
            (msg.ok ? "border-shipped/30 bg-shipped/12 text-shipped" : "border-destructive/30 bg-destructive/10 text-destructive")}>
            {msg.ok ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            inputMode="decimal"
            disabled={busy}
            aria-label={tl("orderRefund", "Adjustment to charge")}
            className="h-9 w-24 text-right tabular-nums"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tl("orderRefund", "Reason — the seller reads it")}
            disabled={busy}
            className="h-9 flex-1"
          />
        </div>
        <div className="flex">
          {/* A reason is REQUIRED: money leaving a wallet does not explain itself. The
              server refuses without one; this only saves the round trip. */}
          <Button className="w-full justify-center" onClick={() => void charge()} disabled={busy || amt <= 0 || !note.trim()}>
            {busy ? <CircleNotch size={13} className="animate-spin" /> : null}
            {amt > 0 ? `${tl("orderRefund", "Charge")} ${usd(amt)}` : tl("orderRefund", "Charge")}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}
