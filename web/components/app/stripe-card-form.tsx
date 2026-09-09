"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getStripeConfig, createStripeIntent, verifyStripeIntent, chargeSavedCard, quoteStripe } from "@/lib/api"
import { getUser } from "@/lib/auth"

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

// Inner form — inside <Elements>, so it can use useStripe/useElements.
function PayForm({ intentId, clientSecret, email, onPaid, onError }: { intentId: string; clientSecret: string; email?: string; onPaid: () => void; onError: (m: string) => void }) {
  const tl = useLabelT()
 const stripe = useStripe()
 const elements = useElements()
 const [busy, setBusy] = useState(false)

 const pay = async () => {
 if (!stripe || !elements) return
 setBusy(true)
 onError("")
    /**
     * confirmCardPayment, NOT confirmPayment — the Card Element's own confirm.
     *
     * confirmPayment({ elements }) is the Payment Element's call and it throws outright
     * against a card element, so the two have to move together: the element and the confirm
     * are one integration, not two choices.
     *
     * 3-D Secure is unaffected. This still opens the bank's challenge and resolves to
     * requires_action → succeeded exactly as before; the verify below is what credits.
     */
 const card = elements.getElement(CardElement)
 if (!card) { onError("The card form didn't load. Reload and try again."); setBusy(false); return }
 const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
 payment_method: { card, billing_details: email ? { email } : undefined },
    })
 if (error) {
      /**
       * SAID ONCE, where the element says it. The card element prints card and validation
       * errors under the row itself, in Stripe's own wording, so passing those up printed
       * "Your card has insufficient funds" twice — once inside the element and once under
       * the button — which reads as two problems rather than one.
       *
       * Only those two types. An api_error or a network failure has NO inline home, and
       * swallowing one would leave the button falling silent with nothing said anywhere.
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
      {/**
        * JUST THE CARD FIELDS, AND LINK OFF (owner, 2026-09-09: "can we hide the link? why
        * don't you just show the card fields?").
        *
        * Link identifies a returning customer by "email address, phone number, or BROWSER
        * COOKIE" and autofills their saved card "regardless of whether they initially saved
        * their information in Link with another business" — Stripe's words. The cookie
        * belongs to the browser, not to our session, which is why a brand-new EGFULFILL
        * account was shown somebody's Mastercard: on a shared machine the next person sees
        * the previous one's email plus card brand and last four.
        *
        * THE PAYMENT ELEMENT CANNOT TURN IT OFF. Stripe is explicit: "To manage Link in the
        * Payment Element, go to your payment method settings" — Dashboard only, account-wide,
        * and it costs accelerated checkout for real returning customers.
        *
        * The CARD ELEMENT can, per element, in code: `disableLink: true`. That is the whole
        * reason for the switch. We only ever accept cards — the intent is created with
        * `payment_method_types[]: 'card'` — so nothing is given up by leaving the Payment
        * Element behind, and the fields are the ones a person expects to see anyway.
        *
        * `hidePostalCode` is FALSE on purpose: the postal code is an AVS check the issuer
        * runs, and dropping it raises the decline rate on exactly the cards worth having.
        */}
      <div className="rounded-lg border border-input bg-background px-3 py-3">
        <CardElement
          options={{
            disableLink: true,
            hidePostalCode: false,
            /* Inherits the app's own type rather than Stripe's default sans, so the row does
               not read as an embedded third-party widget sitting in our form. */
            style: { base: { fontSize: "15px", fontFamily: "inherit", color: "#18181b", "::placeholder": { color: "#a1a1aa" } } },
          }}
        />
      </div>
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
    /* NO clientSecret ON <Elements>. That option exists so the Payment Element can ask the
       intent which methods to offer; a Card Element offers one thing and never asks. Passing
       it here while confirming with confirmCardPayment(clientSecret, …) below would be the
       same secret handed to two integrations, and it is the Payment Element's shape Stripe
       then expects to find mounted. `appearance` goes with it — that is the Payment
       Element's theming API; the Card Element is styled by its own `style` option. */
    <Elements stripe={stripePromise}>
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
      <PayForm intentId={intentId} clientSecret={clientSecret} email={getUser()?.email as string | undefined} onPaid={onPaid} onError={onError} />
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
