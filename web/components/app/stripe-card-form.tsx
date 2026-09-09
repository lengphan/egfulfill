"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getStripeConfig, createStripeIntent, verifyStripeIntent, chargeSavedCard, quoteStripe } from "@/lib/api"

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

// Inner form — inside <Elements>, so it can use useStripe/useElements.
function PayForm({ intentId, onPaid, onError }: { intentId: string; onPaid: () => void; onError: (m: string) => void }) {
  const tl = useLabelT()
 const stripe = useStripe()
 const elements = useElements()
 const [busy, setBusy] = useState(false)

 const pay = async () => {
 if (!stripe || !elements) return
 setBusy(true)
 onError("")
 const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" })
 if (error) {
      /**
       * SAID ONCE. The Payment Element prints card and validation errors under the card row
       * itself — that is its job and it does it in Stripe's own wording — so passing those
       * up printed "Your card has insufficient funds" twice, once inside the element and
       * once under the button, which reads as two problems rather than one.
       *
       * Only those two types. An api_error or a network failure has NO inline home in the
       * element, and swallowing one would leave the button falling silent with nothing said
       * anywhere — the exact defect the note further down guards against.
       */
 const shown = error.type === "card_error" || error.type === "validation_error"
 onError(shown ? "" : error.message || "Payment failed.")
 setBusy(false)
 return
    }
 if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
 try {
 const v = await verifyStripeIntent(intentId)
 if (v.ok) onPaid()
 else onError(v.error || `Payment ${v.status || "not confirmed"} — nothing was charged. Try again.`)
      } catch {
 onError("Payment verification failed.")
      }
    } else if (paymentIntent) {
      // requires_action / requires_payment_method / canceled — never left silent, or the
      // button reads "Processing…" forever with no reason shown.
 onError(`Payment ${String(paymentIntent.status).replace(/_/g, " ")} — please check the card details and try again.`)
    } else {
 onError("Payment didn't complete. Please try again.")
    }
 setBusy(false)
  }

 return (
    <div className="space-y-4">
      <PaymentElement />
      <Button className="w-full" onClick={pay} disabled={busy || !stripe}>
        {busy ? tl("stripeCardForm", "Processing…") : tl("stripeCardForm", "Pay now")}
      </Button>
    </div>
  )
}

export function StripeCardForm({ amount, save, onPaid, onError }: { amount: number; save?: boolean; onPaid: () => void; onError: (m: string) => void }) {
  const tl = useLabelT()
 const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
 const [clientSecret, setClientSecret] = useState("")
 const [intentId, setIntentId] = useState("")
  /** What the card will actually be billed, and the processor's cut inside it — both from
   *  the SERVER, which is the only side that decides them. */
 const [cost, setCost] = useState<{ credit: number; charge: number; fee: number; pct: number; fixed: number } | null>(null)
 const [loading, setLoading] = useState(true)
 const [err, setErr] = useState<string | null>(null)

 useEffect(() => {
 let alive = true
    ;(async () => {
 try {
 const cfg = await getStripeConfig()
 if (!cfg.enabled || !cfg.publishableKey) throw new Error("Card payments aren't enabled on the server.")
 if (!alive) return
 setStripePromise(loadStripe(cfg.publishableKey))
 const intent = await createStripeIntent(amount)
 if (!intent.clientSecret || !intent.id) throw new Error(intent.error || "Couldn't start the card payment.")
 if (!alive) return
 setClientSecret(intent.clientSecret)
 setIntentId(intent.id)
 if (intent.charge != null && intent.credit != null) {
 setCost({
 credit: intent.credit, charge: intent.charge, fee: intent.fee ?? Number((intent.charge - intent.credit).toFixed(2)),
 pct: intent.feeCfg?.pct ?? cfg.fee?.pct ?? 0, fixed: intent.feeCfg?.fixed ?? cfg.fee?.fixed ?? 0,
          })
        }
      } catch (e) {
 if (alive) setErr(e instanceof Error ? e.message : "Card unavailable.")
      } finally {
 if (alive) setLoading(false)
      }
    })()
 return () => {
 alive = false
    }
  }, [amount, save])

 if (loading) {
 return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin" /> {tl("stripeCardForm", "Preparing secure card form…")}
      </div>
    )
  }
 if (err) return <div className="py-6 text-center text-sm text-hold">{err}</div>
 if (!stripePromise || !clientSecret) return null

 return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      {/**
        * WHAT THE CARD IS BILLED, BEFORE IT IS BILLED.
        *
        * The processor keeps a cut of every charge, and it is added on top rather than taken
        * out of the top-up — so the wallet gets the round number and the card pays a few
        * dollars more. A surprise on a statement is how a fee becomes a dispute, so the three
        * figures are on screen before the button: what you get, what the fee is, what you pay.
        *
        * Read from the server's own numbers. The client must never compute a charge it is
        * about to make somebody agree to.
        */}
      {cost && (
        <dl className="mb-4 space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tl("stripeCardForm", "Wallet credit")}</dt>
            <dd className="tabular-nums">{usd(cost.credit)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {tl("stripeCardForm", "Card fee")}
              <span className="opacity-70"> · {cost.pct}% + {usd(cost.fixed)}</span>
            </dt>
            <dd className="tabular-nums">{usd(cost.fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
            <dt>{tl("stripeCardForm", "You pay")}</dt>
            <dd className="tabular-nums">{usd(cost.charge)}</dd>
          </div>
        </dl>
      )}
      <PayForm intentId={intentId} onPaid={onPaid} onError={onError} />
    </Elements>
  )
}

/**
 * PAYING WITH A CARD ALREADY ON FILE — no Payment Element, no typing.
 *
 * The server confirms the charge itself, so the happy path never touches Stripe.js at all.
 * What this component exists for is the OTHER path: a card whose bank wants 3-D Secure comes
 * back `requires_action` with a client secret, and that challenge can only be run in the
 * browser. Skipping it would make saved-card payments fail silently for exactly the cards
 * that are most protected — and the failure would look like a decline rather than an
 * unfinished step.
 *
 * Crediting stays where it already was: the server credits on a straight success, and
 * verify-intent credits after a challenge. The wallet is never moved from here.
 */
export function SavedCardPay({ amount, cardId, onPaid, onError }: {
  amount: number
  cardId: string
  onPaid: () => void
  onError: (m: string) => void
}) {
  const tl = useLabelT()
  const [busy, setBusy] = useState(false)
  /* The same three figures the Payment Element path shows, from the SERVER. One press is not
     a reason to collect a fee somebody has not seen, and the client must never work out a
     charge it is about to make. */
  const [cost, setCost] = useState<{ credit: number; charge: number; fee: number; pct: number; fixed: number } | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      quoteStripe(amount)
        .then((q) => {
          if (!live || q.error || q.charge == null || q.credit == null) return
          setCost({ credit: q.credit, charge: q.charge, fee: q.fee ?? Number((q.charge - q.credit).toFixed(2)), pct: q.feeCfg?.pct ?? 0, fixed: q.feeCfg?.fixed ?? 0 })
        })
        .catch(() => {})
    }, 0)
    return () => { live = false; clearTimeout(t) }
  }, [amount])

  const pay = async () => {
    setBusy(true)
    onError("")
    try {
      const r = await chargeSavedCard(amount, cardId)
      if (r.ok) { onPaid(); return }
      if (r.error) throw new Error(r.error)
      if (!r.clientSecret || !r.id) throw new Error(`Payment ${r.status || "not confirmed"} — nothing was charged.`)

      const cfg = await getStripeConfig()
      const stripe = cfg.publishableKey ? await loadStripe(cfg.publishableKey) : null
      if (!stripe) throw new Error("Couldn't reach Stripe to finish the check.")
      const { error } = await stripe.handleNextAction({ clientSecret: r.clientSecret })
      if (error) throw new Error(error.message || "That check wasn't completed.")

      const v = await verifyStripeIntent(r.id)
      if (v.ok) onPaid()
      else throw new Error(v.error || `Payment ${v.status || "not confirmed"} — nothing was charged.`)
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't take that payment.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {cost && (
        <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tl("stripeCardForm", "Wallet credit")}</dt>
            <dd className="tabular-nums">{usd(cost.credit)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {tl("stripeCardForm", "Card fee")}<span className="opacity-70"> · {cost.pct}% + {usd(cost.fixed)}</span>
            </dt>
            <dd className="tabular-nums">{usd(cost.fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
            <dt>{tl("stripeCardForm", "You pay")}</dt>
            <dd className="tabular-nums">{usd(cost.charge)}</dd>
          </div>
        </dl>
      )}
      <Button className="w-full" onClick={pay} disabled={busy || !cost}>
        {busy ? <CircleNotch size={16} className="animate-spin" /> : `${tl("stripeCardForm", "Pay")} ${usd(cost?.charge ?? amount)}`}
      </Button>
    </div>
  )
}
