"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Warning } from "@phosphor-icons/react"
import { getWallet } from "@/lib/api"
import { getToken } from "@/lib/auth"

const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2)

/**
 * LAZY, and that is what makes opening it from here affordable.
 *
 * This banner mounts in the app SHELL, so it is on every page. The top-up dialog carries
 * Stripe, PayPal and the QR flow behind it; importing it normally would put all of that in
 * the first load of the orders queue, the designer board and everywhere else — for a dialog
 * most sessions never open. `next/dynamic` fetches it on the press instead.
 *
 * `ssr: false` because it is only ever reached by a click, and rendering a closed dialog on
 * the server buys nothing.
 */
const TopUpDialog = dynamic(
  () => import("@/components/app/topup-dialog").then((m) => m.TopUpDialog),
  { ssr: false },
)

/**
 * Warns a seller their wallet is running out, before it stops them.
 *
 * Submitting an order charges it, and a short wallet refuses the submit — so without a
 * warning the first sign of trouble is work that won't go to production. This arrives
 * while there's still time to top up.
 *
 * Three states, deliberately distinct: EMPTY and BELOW ZERO are already blocking, LOW is not
 * yet. One message for all three would either over-alarm at $40 or under-alarm at -$5.
 *
 * ZERO IS NOT LOW. It was tested with `balance < 0`, so an account sitting at exactly $0.00
 * read "top up before it runs out" — advice about a future that had already happened, in the
 * amber that means "not yet". The submit gate is `balance < due` and an order that prices at
 * $0 is refused outright, so at zero EVERY order is blocked, which is the same fact a
 * negative balance carries and it must not be dressed as a warning.
 *
 * The threshold comes from the server with the balance, so this never decides for itself
 * what "low" means. House accounts get nothing — they're allowed to run negative, which
 * is how a loss stays visible instead of blocking the floor.
 *
 * AND IT STOPS ASKING ONCE YOU HAVE PAID (owner, 2026-09-09). A $5 top-up against a $200
 * floor leaves the balance genuinely low, so the warning was still true and still on screen
 * the moment it was answered — which reads as not having worked. A notice that survives the
 * action it asked for is not a warning any more, it is nagging, and the next one gets
 * ignored too.
 *
 * The signal is the BALANCE GOING UP, not a top-up event, because money arrives by several
 * routes — this banner's own dialog, the wallet page's, an admin confirming a transfer, a
 * refund — and each would otherwise need to remember to say so. A rise means somebody put
 * money in; that is the whole condition.
 *
 * Snoozed for the TAB (sessionStorage), not for ever: a new session is a new sitting and the
 * balance is worth mentioning again. And never when BLOCKING — at or below zero nothing can
 * be submitted at all, which is not advice to be taken once but a description of the account
 * right now, so it ignores the snooze entirely.
 */
const SNOOZE_KEY = "eg-lowbal-snoozed"
const SEEN_KEY = "eg-lowbal-seen"
/** sessionStorage throws outright in some embedded contexts, so every touch is guarded and
 *  the fall-back is to behave as though nothing was stored — i.e. to show the banner. */
function readNum(k: string): number | null {
  try { const v = sessionStorage.getItem(k); return v == null ? null : Number(v) } catch { return null }
}
function write(k: string, v: string) { try { sessionStorage.setItem(k, v) } catch { /* private mode */ } }
export function LowBalanceBanner() {
  const tl = useLabelT()
 const [w, setW] = useState<{ balance: number; low?: boolean; lowBelow?: number | null } | null>(null)
  /* TOP UP OPENS THE DIALOG, IT DOES NOT GO TO A PAGE (owner, 2026-09-09).
     This was a link to /wallet, so the answer to "your balance is low" was a page change: the
     queue they were reading disappears, the wallet dashboard loads, and the thing they came
     for is still one more press away behind Add Funds. Two navigations and a full screen of
     unrelated figures between a warning and the action that answers it is where people go and
     do something else. The dialog is self-contained and already controlled from outside, so
     it opens here over whatever they were doing and closes back onto it. */
 const [topUpOpen, setTopUpOpen] = useState(false)

  /* Read LAZILY rather than in an effect: sessionStorage is available on the first client
     render and setting state from an effect is what the lint rule is for. The initialiser
     runs once, and it is guarded, so a context that refuses storage simply starts unsnoozed. */
 const [snoozed, setSnoozed] = useState(() => readNum(SNOOZE_KEY) === 1)

 const load = useCallback(() => {
 if (!getToken()) return
 getWallet().then((r) => {
 setW({ balance: r.balance, low: r.low, lowBelow: r.lowBelow })
      // A RISE MEANS THEY PAID. Compared against the last balance this banner saw in this
      // tab, so the very first read never counts as a rise and never snoozes on arrival.
 const seen = readNum(SEEN_KEY)
 if (seen != null && Number(r.balance) > seen) { write(SNOOZE_KEY, "1"); setSnoozed(true) }
 write(SEEN_KEY, String(Number(r.balance)))
    }).catch(() => setW(null))
  }, [])
 useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])
  // Re-read the moment the wallet changes (a top-up funded/approved) so a now-healthy balance
  // drops this banner immediately instead of lingering until a reload. Same event the topbar
  // and Add Funds already dispatch.
 useEffect(() => {
 const h = () => load()
 window.addEventListener("eg-wallet-changed", h)
 return () => window.removeEventListener("eg-wallet-changed", h)
  }, [load])

 if (!w || !w.low) return null
  /** Nothing can be submitted at or below zero — see the docblock. */
 const blocking = w.balance <= 0
 /* Blocking outranks the snooze: "orders cannot be submitted" is not advice somebody can be
    said to have already taken. */
 if (snoozed && !blocking) return null
 const negative = w.balance < 0

 /**
   * THE MARK CARRIES THE COLOUR, NOT THE GROUND.
   *
   * This was a filled amber panel, and it sits on the dashboard's grey — two washed tints
   * against each other, which is the one place a tinted block has nothing to hold onto. The
   * app already reached this conclusion twice (the DPI reading, the "outside the print area"
   * chip): colour the thing that means something and leave the surface alone.
   *
   * So: the ordinary card the rest of the page is made of, with the warning in the icon and
   * in the figure — the two things being warned ABOUT. Blocking keeps a red hairline as
   * well, because "cannot submit" is a different claim from "getting low" and one of them
   * has to be louder.
   */
 return (
    <div className={"flex flex-wrap items-center gap-2.5 rounded-lg border bg-card px-4 py-2.5 text-sm text-foreground " + (
 blocking ? "border-destructive/40" : "border-border")}>
      <Warning size={16} weight="fill" className={"shrink-0 " + (blocking ? "text-destructive" : "text-hold")} />
      <span className="min-w-0 flex-1">
        {negative ? (
          <>{tl("lowBalanceBanner", "Your balance is")} <strong className={blocking ? "text-destructive" : "text-hold"}>{usd(w.balance)}</strong>{tl("lowBalanceBanner", ". Orders can’t be submitted to production until it’s positive.")}</>
        ) : blocking ? (
          <>{tl("lowBalanceBanner", "Your balance is")} <strong className={blocking ? "text-destructive" : "text-hold"}>{usd(w.balance)}</strong>{tl("lowBalanceBanner", ". Orders can’t be submitted to production until you top up.")}</>
        ) : (
          <>{tl("lowBalanceBanner", "Your balance is")} <strong className={blocking ? "text-destructive" : "text-hold"}>{usd(w.balance)}</strong>{tl("lowBalanceBanner", ". Submitting an order charges it — top up before it runs out.")}</>
        )}
      </span>
      <button
        type="button"
        onClick={() => setTopUpOpen(true)}
        className="shrink-0 font-medium underline underline-offset-2"
      >
        {tl("lowBalanceBanner", "Top up")}
      </button>
      {/* Mounted only once opened, so the chunk is fetched on the press rather than with the
          shell — and unmounted after, which resets the dialog's own state without a `key`. */}
      {topUpOpen && (
        <TopUpDialog
          open={topUpOpen}
          onOpenChange={setTopUpOpen}
          onFunded={() => {
            // The same event the wallet page fires: the topbar and this banner both read the
            // balance once and would otherwise hold the pre-top-up figure until a reload.
            load()
            window.dispatchEvent(new CustomEvent("eg-wallet-changed"))
          }}
        />
      )}
    </div>
  )
}
