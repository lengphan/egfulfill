"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUUpLeft, CircleNotch, CheckCircle, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getOrderCharges, refundOrder, chargeOrderFee, type OrderCharges } from "@/lib/api"

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
 const [fee, setFee] = useState("")
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
 const r = await refundOrder(orderId, { ...body, ...(feeAmt > 0 ? { fee: { amount: feeAmt } } : {}) })
 if (r.error) { setMsg({ ok: false, text: r.error }); return }
      /* `refundedNow`, not `refunded` — the latter is everything this order has ever sent
 back, which is the same number only on the first refund. The fallback covers an API
 that has not been redeployed yet, where the old key is all there is. */
 const sent = r.refundedNow ?? r.refunded ?? 0
      // BOTH LEGS ARE REPORTED, and a failed fee never gets rounded up into "done". The
      // refund stands either way, so the message has to say precisely which half landed.
 if (r.fee?.error) {
 setMsg({ ok: false, text: `Refunded ${usd(sent)}, but the ${usd(feeAmt)} adjustment was not charged — ${r.fee.error}` })
      } else if (r.fee?.charged) {
 setMsg({ ok: true, text: `Refunded ${usd(sent)} and charged ${usd(r.fee.charged)} back — the seller is ${usd(sent - r.fee.charged)} up.` })
      } else {
 setMsg({ ok: true, text: `Refunded ${usd(sent)} to the seller's wallet.` })
      }
 setPicked(new Set()); setAmounts({}); setNote(""); setFee("")
 setState(r)
    } catch {
 setMsg({ ok: false, text: "Couldn't process the refund — nothing was charged back." })
    } finally { sending.current = false; setBusy(false) }
  }

  /**
   * A price adjustment on its own — money the other way, no refund involved.
   *
   * Same guard as a refund (the ref, not `busy`) for the same reason: each press mints its
   * own idempotency key, so two presses that beat the re-render are two charges, not one
   * deduped retry.
   */
 const charge = async () => {
 if (sending.current) return
 sending.current = true
 setBusy(true); setMsg(null)
 try {
 const r = await chargeOrderFee(orderId, { amount: feeAmt, note: note.trim(), clientId: newClientId() })
 if (r.error) {
 setMsg({ ok: false, text: r.shortfall
          ? `${r.error} They need ${usd(r.shortfall)} more in the wallet.`
 : r.error })
 return
      }
 setMsg({ ok: true, text: `Charged ${usd(r.charged || feeAmt)} to the seller's wallet.` })
 setFee(""); setNote("")
 setState(r)
      /* Re-tick what is refundable now: the charge just made itself refundable, and the
 panel opens with everything ticked. Same re-seed the load path does. */
 setPicked(new Set(r.parts.filter((p) => p.refundable > 0).map((p) => p.key)))
    } catch {
 setMsg({ ok: false, text: "Couldn't charge the adjustment — nothing was taken." })
    } finally { sending.current = false; setBusy(false) }
  }

  /* "Everything" means every refundable part is ticked AND nobody typed a smaller amount
 into one. A typed-down part is a partial refund even when all the boxes are ticked. */
  /* Parsed once. Negative and non-numeric collapse to 0, which reads as "no adjustment"
 everywhere below — a fee is money leaving a seller's wallet and there is no sensible
 meaning for a negative one here; that direction is what the refund above is. */
 const feeAmt = Math.max(0, Number(fee) || 0)

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
 placeholder={feeAmt > 0 ? tl("orderRefund", "Why the adjustment — required, and the seller sees it") : tl("orderRefund", "Reason (shown on the ledger entry)")}
 disabled={busy}
 className="h-9"
            />

            {/**
              * THE ADJUSTMENT — the other direction of the same money.
              *
              * A quote can be wrong upward as well as downward: a heavier parcel than the
              * estimate, a colour added at the machine, one line re-printed. There was no way
              * to record that, so it was either never taken or taken as some unrelated ledger
              * entry with no order against it.
              *
              * It sits INSIDE the refund panel rather than in a panel of its own because it
              * is the same decision with the same authority, made at the same moment, by the
              * same person — and because keeping a fee back out of a refund is the two of
              * them together, which two separate panels could not express in one press.
              */}
            <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{tl("orderRefund", "Charge an adjustment")}</div>
                <div className="text-xs text-muted-foreground">
                  {selected.length
                    ? tl("orderRefund", "Kept back out of this refund — both are recorded separately")
 : tl("orderRefund", "Taken from the seller’s wallet against this order")}
                </div>
              </div>
              <Input
 value={fee}
 onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ""))}
 placeholder="0.00"
 inputMode="decimal"
 disabled={busy}
 aria-label={tl("orderRefund", "Adjustment to charge")}
 className="h-8 w-24 text-right tabular-nums"
              />
            </label>
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
 onClick={() => (selected.length ? send(isEverything ? "full" : "selected") : void charge())}
                /* A reason is OPTIONAL on a refund and REQUIRED on a charge: money arriving
 explains itself, money leaving does not. The server refuses it either way;
 this only stops the round trip. */
 disabled={busy || (!selected.length && feeAmt <= 0) || (feeAmt > 0 && !note.trim())}
              >
                {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowUUpLeft size={13} weight="bold" />}
                {/* ONE BUTTON, NAMING ALL OF WHAT IT DOES. With an adjustment typed it is two
 money movements in one press, and a label reading "Full refund" while $5
 goes the other way would be false — so the charge is named too. Every part
 ticked and nothing kept back is still "Full refund": that is the whole
 order going back, and saying so beats restating a figure the header
 already carries. */}
                {!selected.length
                  ? `Charge ${usd(feeAmt)}`
 : feeAmt > 0
                    ? `${isEverything ? tl("orderRefund", "Full refund") : `Refund ${usd(planned)}`}, keep ${usd(feeAmt)}`
 : isEverything ? tl("orderRefund", "Full refund") : `Refund ${usd(planned)}`}
              </Button>
            </div>
            {/* THE NET, stated, because two movements in one press is the one case where the
 figure on the button is not the figure that lands. */}
            {selected.length > 0 && feeAmt > 0 && (
              <p className="text-xs font-medium">
                Seller receives {usd(Math.max(0, planned - feeAmt))} — two entries on their statement, not one.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {selected.length
                ? tl("orderRefund", "Goes straight to the seller’s wallet balance. Tick a part to refund it in full, or type an amount to refund some of it.")
 : tl("orderRefund", "An adjustment is charged against this order and shows here as a refundable part, so it can be taken back the same way.")}
            </p>
          </>
        )}
      </div>

      {state.refunds.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tl("orderRefund", "Already refunded")}</div>
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
