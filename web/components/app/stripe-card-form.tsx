"use client"

import { useEffect, useState } from "react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getStripeConfig, createStripeIntent, verifyStripeIntent } from "@/lib/api"

// Inner form — inside <Elements>, so it can use useStripe/useElements.
function PayForm({ intentId, onPaid, onError }: { intentId: string; onPaid: () => void; onError: (m: string) => void }) {
 const stripe = useStripe()
 const elements = useElements()
 const [busy, setBusy] = useState(false)

 const pay = async () => {
 if (!stripe || !elements) return
 setBusy(true)
 onError("")
 const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" })
 if (error) {
 onError(error.message || "Payment failed.")
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
        {busy ? "Processing…" : "Pay now"}
      </Button>
    </div>
  )
}

export function StripeCardForm({ amount, onPaid, onError }: { amount: number; onPaid: () => void; onError: (m: string) => void }) {
 const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
 const [clientSecret, setClientSecret] = useState("")
 const [intentId, setIntentId] = useState("")
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
      } catch (e) {
 if (alive) setErr(e instanceof Error ? e.message : "Card unavailable.")
      } finally {
 if (alive) setLoading(false)
      }
    })()
 return () => {
 alive = false
    }
  }, [amount])

 if (loading) {
 return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin" /> Preparing secure card form…
      </div>
    )
  }
 if (err) return <div className="py-6 text-center text-sm text-hold">{err}</div>
 if (!stripePromise || !clientSecret) return null

 return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <PayForm intentId={intentId} onPaid={onPaid} onError={onError} />
    </Elements>
  )
}
