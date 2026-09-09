"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useRef, useState } from "react"
import { CircleNotch } from "@phosphor-icons/react"
import { getPaypalConfig, createPaypalOrder, capturePaypalOrder } from "@/lib/api"

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

/**
 * THE REAL PAYPAL LOGIN, replacing the manual receipt.
 *
 * PayPal used to be a row in the Transfer tab: send money to an address by hand, screenshot
 * the confirmation, attach it, and wait for an admin to agree it arrived. Nothing about that
 * was a PayPal integration — the Orders v2 flow underneath had been built and then never
 * wired to a button, so the automatic path existed and only the legacy static wallet page
 * ever used it. This is that path: the seller signs into their own PayPal, approves, and we
 * capture server-side. The wallet moves in the same second, with no human in the middle.
 *
 * CARD FUNDING IS OFF, ON PURPOSE. PayPal charges a different (lower) rate for a guest card
 * than for a PayPal balance, and the fee quoted above the button is the balance rate. Leaving
 * card enabled would mean quoting one number and collecting against another — over-charging
 * on exactly the path we told them the price of. Cards have their own tab, at Stripe's rate.
 */

type PaypalButtonsApi = {
  Buttons: (opts: {
    style?: Record<string, string | number>
    createOrder: () => Promise<string>
    onApprove: (data: { orderID: string }) => Promise<void>
    onCancel?: () => void
    onError?: (err: unknown) => void
  }) => { render: (el: HTMLElement) => Promise<void>; close: () => void }
}

/**
 * ONE SCRIPT TAG PER CLIENT-ID, cached at module scope.
 *
 * The SDK registers globals and cannot be loaded twice for the same id — under React strict
 * mode the effect runs twice on mount, which without this cache appends a second <script>
 * and races two SDKs onto one `window.paypal`. Keyed by id so switching between a sandbox
 * and a live key in Settings still reloads rather than serving the stale SDK.
 */
const sdkCache = new Map<string, Promise<PaypalButtonsApi>>()

function loadSdk(clientId: string): Promise<PaypalButtonsApi> {
  const cached = sdkCache.get(clientId)
  if (cached) return cached
  const p = new Promise<PaypalButtonsApi>((resolve, reject) => {
    const url =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      // Sandbox vs live is decided by the client-id itself — there is no second host.
      `&currency=USD&intent=capture&components=buttons` +
      // See the note at the top: the quoted fee is the PayPal-balance rate.
      `&disable-funding=card,credit,paylater`
    const el = document.createElement("script")
    el.src = url
    el.async = true
    el.onload = () => {
      const api = (window as unknown as { paypal?: Partial<PaypalButtonsApi> }).paypal
      if (typeof api?.Buttons === "function") resolve(api as PaypalButtonsApi)
      else reject(new Error("PayPal SDK loaded without Buttons."))
    }
    el.onerror = () => reject(new Error("Couldn't reach PayPal."))
    document.head.appendChild(el)
  })
  // A failed load must not be cached, or one flaky network request disables PayPal for the
  // rest of the session with no way to retry but a reload.
  p.catch(() => sdkCache.delete(clientId))
  sdkCache.set(clientId, p)
  return p
}

export function PaypalButton({
  amount,
  remember,
  onPaid,
  onError,
}: {
  amount: number
  /** Ask PayPal to vault the account during its approval window, so the NEXT top-up needs
   *  no window at all. Consent has to be given there; it cannot be given on our page. */
  remember?: boolean
  /** How the save went: the account's label once PayPal has vaulted it, "pending" while
   *  PayPal is still minting the token (it arrives on the webhook), or null for no save at
   *  all. Three states, because "saved" and "not saved" are both wrong answers to the middle
   *  one — see the note in paypal.js's capture. */
  onPaid: (saved: string | null, savePending: boolean) => void
  onError: (m: string) => void
}) {
  const tl = useLabelT()
  const host = useRef<HTMLDivElement | null>(null)
  /** What PayPal will actually be billed, and its cut inside it — both from the SERVER,
   *  which is the only side that decides them. */
  const [cost, setCost] = useState<{ credit: number; charge: number; fee: number; pct: number; fixed: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let buttons: ReturnType<PaypalButtonsApi["Buttons"]> | null = null
    ;(async () => {
      try {
        const cfg = await getPaypalConfig()
        if (!cfg.enabled || !cfg.clientId) throw new Error("PayPal isn't enabled on the server.")
        const sdk = await loadSdk(cfg.clientId)
        // The order is created UP FRONT, like the Stripe intent, so the three figures can be
        // on screen before anything is pressed. The SDK's createOrder then just hands the id
        // it already has back to PayPal.
        const order = await createPaypalOrder(amount, remember === true)
        if (!order.id) throw new Error(order.error || "Couldn't start the PayPal payment.")
        if (!alive) return
        if (order.charge != null && order.credit != null) {
          setCost({
            credit: order.credit,
            charge: order.charge,
            fee: order.fee ?? Number((order.charge - order.credit).toFixed(2)),
            pct: order.feeCfg?.pct ?? cfg.fee?.pct ?? 0,
            fixed: order.feeCfg?.fixed ?? cfg.fee?.fixed ?? 0,
          })
        }
        setLoading(false)
        if (!host.current) return
        buttons = sdk.Buttons({
          style: { layout: "vertical", color: "black", shape: "rect", label: "paypal", height: 44 },
          createOrder: async () => order.id!,
          onApprove: async (data) => {
            const r = await capturePaypalOrder(data.orderID)
            if (r.ok) onPaid(r.saved ?? null, r.savePending === true)
            else onError(r.error || "PayPal didn't confirm the payment — nothing was charged.")
          },
          onCancel: () => onError(""),
          onError: () => onError("PayPal couldn't complete the payment. Please try again."),
        })
        await buttons.render(host.current)
      } catch (e) {
        if (alive) {
          setErr(e instanceof Error ? e.message : "PayPal unavailable.")
          setLoading(false)
        }
      }
    })()
    return () => {
      alive = false
      try { buttons?.close() } catch { /* already torn down with the node */ }
    }
  }, [amount, remember, onPaid, onError])

  if (err) return <div className="py-6 text-center text-sm text-hold">{err}</div>

  return (
    <div className="space-y-4">
      {/**
        * WHAT PAYPAL IS BILLED, BEFORE IT IS BILLED — the same three lines as the card form,
        * because it is the same decision. The processor's cut is added on top rather than
        * taken out of the top-up, so the wallet gets the round number and PayPal charges a
        * few dollars more. A surprise on a statement is how a fee becomes a dispute.
        */}
      {cost && (
        <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tl("paypalButton", "Wallet credit")}</dt>
            <dd className="tabular-nums">{usd(cost.credit)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {tl("paypalButton", "PayPal fee")}
              <span className="opacity-70"> · {cost.pct}% + {usd(cost.fixed)}</span>
            </dt>
            <dd className="tabular-nums">{usd(cost.fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
            <dt>{tl("paypalButton", "You pay")}</dt>
            <dd className="tabular-nums">{usd(cost.charge)}</dd>
          </div>
        </dl>
      )}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <CircleNotch size={16} className="animate-spin" /> {tl("paypalButton", "Preparing PayPal…")}
        </div>
      )}
      <div ref={host} />
    </div>
  )
}
