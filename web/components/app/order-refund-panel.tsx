"use client"

import { useLabelT } from "@/lib/i18n"
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
  const tl = useLabelT()
 const [state, setState] = useState<OrderCharges | null>(null)
  // Distinguishes "couldn't read this" from "there's nothing here". Without it a dead
  // endpoint renders exactly like an order that was never charged, and the panel simply
  // appears not to exist — which is how a broken deploy looks like a missing feature.
 const [loadErr, setLoadErr] = useState<string | null>(null)
 const [picked, setPicked] = useState<Set<string>>(new Set())
 const [amounts, setAmounts] = useState<Record<string, string>>({})
 const [note, setNote] = useState("")
  /* The adjustment, as typed. A STRING, like the per-part amounts beside it: parsing on
 every keystroke turns "5." into 5 and fights the person typing "5.50". */
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
      <SectionCard title={tl("orderRefund", "Refund")}>
        <div className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-hold" />
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
      /* `refundedNow`, not `refunded` — the latter is everything this order has ever sent
 back, which is the same number only on the first refund. The fallback covers an API
 that has not been redeployed yet, where the old key is all there is. */
 const sent = r.refundedNow ?? r.refunded ?? 0
      /* ONE LEG NOW, so one sentence. The three-way message existed to report a refund and
         a charge landing independently; with the charge gone there is only the refund to
         report, and a branch for a leg that cannot happen is a branch that rots. */
 setMsg({ ok: true, text: `Refunded ${usd(sent)} to the seller's wallet.` })
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
 title={tl("orderRefund", "Refund")}
 actions={<span className="text-xs text-muted-foreground">{usd(state.refundable)} refundable</span>}
    >
      {/* A PART WITH NOTHING LEFT IS NOT A CHOICE. A fully refunded row sat here greyed, with
          a disabled box and a tick reading "fully refunded" — in a panel whose whole job is
          picking what to send back. It could not be acted on, and on an order where price
          adjustments have been charged and reversed it is the row that fills the list.
          Where a refund WENT is answered by the Summary and by Order history; this panel
          only has to say what can still go. */}
      <div className="divide-y divide-border">
        {parts.filter((p) => p.refundable > 0).map((p) => {
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
                  <CheckCircle size={12} weight="fill" /> {tl("orderRefund", "fully refunded")}
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
            (msg.ok ? "border-shipped/30 bg-shipped/12 text-shipped" : "border-destructive/30 bg-destructive/10 text-destructive")}>
            {msg.ok ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}
        {/* NOT hidden when there is nothing left to refund. A price adjustment is money in
 the other direction — an order that has been fully refunded can still turn out to
 have cost more, and hiding the whole footer once the refundable balance hits zero
 took the only control that could record that away with it. */}
        {nothingLeft && (
          <p className="text-sm text-muted-foreground">{tl("orderRefund", "Everything charged on this order has been refunded.")}</p>
        )}
        {(
          <>
            <Input
 value={note}
 onChange={(e) => setNote(e.target.value)}
 placeholder={tl("orderRefund", "Reason (shown on the ledger entry)")}
 disabled={busy}
 className="h-9"
            />

            {/* NO "Charge an adjustment" HERE (owner, 2026-09-10: "we already have charge
                adjustment down below").

                It let one press do both legs — refund X, keep Y back — and the argument for
                it was that keeping a fee out of a refund is one decision. But the two were
                never one MOVEMENT: the note under the field said so itself, "both are
                recorded separately", because they are always two ledger entries either way.
                So what it actually saved was a second press, at the cost of a second money
                field on a panel whose whole job is one number leaving.

                The Price adjustment card below does the charge, on every order and at every
                stage, which is more than this could — this one only appeared once a part was
                ticked. Two controls for one act, and the narrower one went. */}
            {/* ONE BUTTON, and it always states the amount it will send.
                Two buttons made the reader compare them to work out which was which, on a
 panel where the difference is money leaving. The amount follows the ticks:
 everything by default, less when a part is unticked.

                Whether that becomes a `full` or a per-part refund is decided from the
                SELECTION rather than from which button was pressed — refunding every part
 at its full amount IS the whole order, and letting the server take its own
                "everything" path avoids the two disagreeing over a rounding penny. */}
            {/* FULL WIDTH, not a small button adrift on the left. It is the only action on
 the panel, it sits under a full-width reason field, and it is the one that
 moves money — so it gets the width and the target size to match. */}
            <div className="flex">
              <Button
 className="w-full justify-center"
 onClick={() => void send(isEverything ? "full" : "selected")}
                /* A reason is OPTIONAL here. Money arriving explains itself; the case that
                   required one was the charge leg, and that has moved to the Price
                   adjustment card, which requires its own. */
 disabled={busy || !selected.length}
              >
                {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowUUpLeft size={13} weight="bold" />}
                {/* THE AMOUNT, ALWAYS. One movement now, so the label is the figure that lands —
                    there is no second leg to name. Every part ticked is still "Full refund":
                    that is the whole order going back, and saying so beats restating a number
                    the header already carries. */}
                {isEverything ? tl("orderRefund", "Full refund") : `Refund ${usd(planned)}`}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {tl("orderRefund", "Goes straight to the seller’s wallet balance. Tick a part to refund it in full, or type an amount to refund some of it.")}
            </p>
          </>
        )}
      </div>

      {/* "ALREADY REFUNDED" IS GONE (owner's call). It listed every refund a third time: the
          Summary above now strikes the adjustment each one cancelled and shows what is left,
          and Order history carries the same movements with who pressed it and when — which
          this list could not say. Three renderings of one set of facts, and the one with the
          least in it was sitting under the control that makes more of them. */}
    </SectionCard>
  )
}
