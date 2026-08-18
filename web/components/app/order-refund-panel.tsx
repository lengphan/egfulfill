"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUUpLeft, CircleNotch, CheckCircle, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrderCharges, refundOrder, type OrderCharges } from "@/lib/api"

const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)

// Module scope, not the component body: these are impure, and the purity lint rightly
// refuses them during render. One id per refund press, so the server can dedupe a retry.
const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Refund panel — admin and warehouse only.
 *
 * Shows what an order actually charged, split into parts, and lets whoever's handling it
 * send back some or all of it. The parts exist because a refund is rarely the whole
 * order: shipping goes back when a parcel is late, the garment goes back when it's
 * misprinted, and the expedite fee usually does NOT go back because we already paid the
 * partner for it.
 *
 * Deliberately shows what's already been refunded per part. The dangerous mistake here
 * isn't refunding too little, it's refunding the same thing twice because the first one
 * isn't visible — the server caps it either way, but a refusal after the fact reads as a
 * bug, where a struck-through balance reads as information.
 */
export function OrderRefundPanel({ orderId }: { orderId: string }) {
  const [state, setState] = useState<OrderCharges | null>(null)
  // Distinguishes "couldn't read this" from "there's nothing here". Without it a dead
  // endpoint renders exactly like an order that was never charged, and the panel simply
  // appears not to exist — which is how a broken deploy looks like a missing feature.
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // A REF, not the `busy` state, guards re-entry. State updates are async, so a fast
  // double-click can land a second press before `busy` has re-rendered the button into
  // its disabled form — and each press mints its own idempotency key, so two presses
  // would be two genuinely different refunds rather than one deduped retry. Declared
  // with the other hooks, above the early returns, so the hook order never varies.
  const sending = useRef(false)

  const load = useCallback(() => {
    setLoadErr(null)
    getOrderCharges(orderId)
      .then((r) => {
        setState(r); setLoadErr(null)
        /* EVERY REFUNDABLE PART STARTS TICKED. There is one button now, and its amount is
           whatever is selected — so the panel has to open already saying the full figure,
           or "Refund" would read as $0.00 until someone ticked something. Untick to send
           back less. Re-seeded after each refund, so what remains is ticked. */
        setPicked(new Set(r.parts.filter((p) => p.refundable > 0).map((p) => p.key)))
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn't load this order's charges."))
  }, [orderId])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  // A read that FAILED is reported, never hidden. The commonest cause is an API that
  // hasn't been redeployed yet, and silently showing nothing sends someone hunting for a
  // missing button instead of a missing deploy.
  if (loadErr) {
    return (
      <SectionCard title="Refund">
        <div className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
          <span>Couldn&apos;t load this order&apos;s charges, so refunds can&apos;t be shown. {loadErr}</span>
        </div>
      </SectionCard>
    )
  }
  if (!state) return null                       // still loading
  // Staff who can't refund don't get the panel. The server enforces this; hiding it just
  // avoids offering an action that would only ever 403.
  if (!state.canRefund) return null
  // Nothing was ever charged (an unsubmitted order) — there's no money story to tell yet.
  if (state.charged <= 0) return null

  const parts = state.parts
  const toggle = (k: string) => setPicked((p) => {
    const n = new Set(p); if (!n.delete(k)) n.add(k); return n
  })

  // What the current selection would pay out. A typed amount overrides a ticked part, so
  // the figure shown is always the figure that will move.
  const selected = parts.filter((p) => picked.has(p.key) && p.refundable > 0)
  const planned = selected.reduce((s, p) => {
    const typed = Number(amounts[p.key])
    return s + (isFinite(typed) && typed > 0 ? Math.min(typed, p.refundable) : p.refundable)
  }, 0)

  const send = async (mode: "full" | "selected") => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setMsg(null)
    const clientId = newClientId()
    try {
      const body = mode === "full"
        ? { full: true, note: note.trim() || undefined, clientId }
        : {
            amount: Object.fromEntries(selected.map((p) => {
              const typed = Number(amounts[p.key])
              return [p.key, isFinite(typed) && typed > 0 ? Math.min(typed, p.refundable) : p.refundable]
            })),
            note: note.trim() || undefined, clientId,
          }
      const r = await refundOrder(orderId, body)
      if (r.error) { setMsg({ ok: false, text: r.error }); return }
      setMsg({ ok: true, text: `Refunded ${usd(r.refunded || 0)} to the seller's wallet.` })
      setPicked(new Set()); setAmounts({}); setNote("")
      setState(r)
    } catch {
      setMsg({ ok: false, text: "Couldn't process the refund — nothing was charged back." })
    } finally { sending.current = false; setBusy(false) }
  }

  /* "Everything" means every refundable part is ticked AND nobody typed a smaller amount
     into one. A typed-down part is a partial refund even when all the boxes are ticked. */
  const isEverything =
    parts.filter((p) => p.refundable > 0).every((p) => picked.has(p.key)) &&
    selected.every((p) => {
      const typed = Number(amounts[p.key])
      return !(isFinite(typed) && typed > 0 && typed < p.refundable)
    })
  const nothingLeft = state.refundable <= 0

  return (
    <SectionCard
      title="Refund"
      actions={<span className="text-xs text-muted-foreground">{usd(state.refundable)} refundable</span>}
    >
      <div className="divide-y divide-border">
        {parts.map((p) => {
          const spent = p.refundable <= 0
          return (
            <label
              key={p.key}
              className={"flex items-center gap-3 px-5 py-2.5 text-sm " + (spent ? "opacity-60" : "cursor-pointer")}
            >
              <input
                type="checkbox"
                disabled={spent || busy}
                checked={picked.has(p.key)}
                onChange={() => toggle(p.key)}
                className="size-4 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.label}</div>
                {/* State what's gone rather than only what's left — a part that's already
                    been refunded should say so, not just look unavailable. */}
                <div className="text-xs text-muted-foreground">
                  {usd(p.charged)} charged
                  {p.refunded > 0 && <> · <span className="text-success">{usd(p.refunded)} refunded</span></>}
                </div>
              </div>
              {spent ? (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <CheckCircle size={12} weight="fill" /> fully refunded
                </span>
              ) : (
                <Input
                  value={amounts[p.key] ?? ""}
                  placeholder={p.refundable.toFixed(2)}
                  disabled={busy || !picked.has(p.key)}
                  onChange={(e) => setAmounts((a) => ({ ...a, [p.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                  inputMode="decimal"
                  className="h-8 w-24 text-right tabular-nums"
                />
              )}
            </label>
          )
        })}
      </div>

      <div className="space-y-3 border-t border-border px-5 py-4">
        {msg && (
          <div className={"flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
            (msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/30 bg-destructive/10 text-destructive")}>
            {msg.ok ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}
        {nothingLeft ? (
          <p className="text-sm text-muted-foreground">Everything charged on this order has been refunded.</p>
        ) : (
          <>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason (shown on the ledger entry)"
              disabled={busy}
              className="h-9"
            />
            {/* ONE BUTTON, and it always states the amount it will send.
                Two buttons made the reader compare them to work out which was which, on a
                panel where the difference is money leaving. The amount follows the ticks:
                everything by default, less when a part is unticked.

                Whether that becomes a `full` or a per-part refund is decided from the
                SELECTION rather than from which button was pressed — refunding every part
                at its full amount IS the whole order, and letting the server take its own
                "everything" path avoids the two disagreeing over a rounding penny. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => send(isEverything ? "full" : "selected")}
                disabled={busy || !selected.length}
              >
                {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowUUpLeft size={13} weight="bold" />}
                Refund {usd(isEverything ? state.refundable : planned)}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Goes straight to the seller&apos;s wallet balance. Tick a part to refund it in full, or type an
              amount to refund some of it.
            </p>
          </>
        )}
      </div>

      {state.refunds.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Already refunded</div>
          <div className="space-y-1">
            {state.refunds.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums text-success">{usd(r.amount)}</span>
                {r.part && <span>· {parts.find((p) => p.key === r.part)?.label ?? r.part}</span>}
                {r.note && <span className="truncate">· {r.note}</span>}
                <span className="ml-auto shrink-0">{new Date(r.at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
