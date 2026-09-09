"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { CheckCircle, Warning, CircleNotch, Copy, Check, X, Sparkle, CaretDown } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StripeCardForm, SavedCardPay } from "@/components/app/stripe-card-form"
import { PaypalButton } from "@/components/app/paypal-button"
import { createVietqrPayment, vietqrStatus, abandonVietqr, createTopupRequest, getVietqrRate, getStripeCards, deleteStripeCard, type SavedCard, getSavedPaypal, getPaypalConfig, quotePaypal, chargeSavedPaypal, capturePaypalOrder, deleteSavedPaypal, VN_BANK_NAMES, type VietqrPayment, type TopupConfig, type SavedPaypal } from "@/lib/api"
import { Dropzone } from "@/components/app/dropzone"

const vnd = (n: number) => `${n.toLocaleString("en-US")}₫`
const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Whole-dollar form for the preset buttons — they're always round amounts, so the ".00"
// is just noise. Kept separate from usd() so real/typed amounts still show cents.
const usd0 = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`

/**
 * `sub` IS OPTIONAL, and most of the time there should not be one.
 *
 * Every success box carried a line that restated its own title — "Payment received" over
 * "Your card top-up has been credited", "Payment received" over "Your wallet balance has
 * been updated". A caption that paraphrases the heading above it is the prose-under-a-
 * control defect in its purest form: it adds a second sentence to read and no second fact.
 *
 * What survives is the sub that says something the title cannot: money that has NOT landed
 * yet and what will make it land, or a save that did not happen. Those are outcomes, not
 * captions.
 */
function Success({ title, sub, onDone }: { title: string; sub?: string; onDone: () => void }) {
  const tl = useLabelT()
 return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-shipped/12 text-success">
        <CheckCircle size={30} weight="fill" />
      </span>
      <div className="font-semibold">{title}</div>
      {sub ? <div className="text-sm text-muted-foreground">{sub}</div> : null}
      <Button className="w-full" onClick={onDone}>{tl("topup", "Done")}</Button>
    </div>
  )
}

// ───────────────────────────── VietQR ─────────────────────────────
// The wallet is in USD, so the seller picks a USD amount; the admin-set rate converts it to
// the VND the QR actually charges, and that exact USD is what credits on payment.
// Small quick amounts — a clean ladder up to the bulk tiers. Shared by every method and laid
// out in the SAME full-width grid as the bulk cards so both hit the same margins.
const SMALL_USD_PRESETS = [50, 100, 200, 500, 1000]
// Bulk top-up suggestion amounts — the "top up more" tiers. Shared so VietQR (with a rate)
// and Transfer (plain USD, no rate) suggest the same big amounts. $20k is the top.
const BULK_USD_PRESETS = [2000, 5000, 10000, 20000]

// Derive the amount options + minimum a tab should show from the shared config (falling back
// to the shipped defaults while it loads). Small presets below the minimum are dropped — a
// button you can't submit is only confusing.
function amountOptions(cfg: TopupConfig | null) {
 const minUsd = cfg?.minUsd ?? 200
 return {
 minUsd,
 small: (cfg?.smallPresets ?? SMALL_USD_PRESETS).filter((v) => v >= minUsd),
 bulk: (cfg?.bulkPresets ?? BULK_USD_PRESETS).filter((v) => v >= minUsd),
  }
}
// Seed the amount box to the minimum once the config lands — but only if the seller hasn't
// typed yet (deferred to avoid a synchronous setState in render).
function useSeedAmount(cfg: TopupConfig | null, amount: string, setAmount: (v: string) => void) {
 useEffect(() => {
 if (!cfg) return
 const id = setTimeout(() => { if (amount === "") setAmount(String(cfg.minUsd)) }, 0)
 return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg])
}

// The line under every amount field: a quiet hint until the seller types an amount below the
// admin-set minimum, then an amber warning. Everything is driven by `minUsd` — nothing here
// is hardcoded, so it tracks whatever the admin sets.
function MinHint({ amount, minUsd }: { amount: string; minUsd: number }) {
  const tl = useLabelT()
 const n = Number(amount)
 if (n > 0 && n < minUsd)
 return (
      <span className="inline-flex items-center gap-1 text-2xs font-medium text-hold">
        <Warning size={11} weight="fill" /> {usd0(n)} is below the {usd0(minUsd)} minimum — enter at least {usd0(minUsd)}.
      </span>
    )
 return <span className="text-2xs text-muted-foreground">Minimum top-up {usd0(minUsd)}.</span>
}

function VietqrTopUp({ onFunded, onClose, cfg }: { onFunded: () => void; onClose: () => void; cfg: TopupConfig | null }) {
  const tl = useLabelT()
 const [amount, setAmount] = useState("")   // USD
 const [showBulk, setShowBulk] = useState(false)
 const [phase, setPhase] = useState<"amount" | "qr" | "paid" | "error">("amount")
 const [payment, setPayment] = useState<VietqrPayment | null>(null)
 const [qrImg, setQrImg] = useState("")
 const [error, setError] = useState<string | null>(null)
 const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

 const rate = cfg?.rate ?? 0          // base VND per $1, admin-set
 const tiers = cfg?.tiers ?? []       // volume discounts (ascending by usd)
  // The QR tab's bulk cards come from the rate `tiers` (they carry a discounted rate), so it
  // only needs the small presets + the minimum here.
 const { minUsd, small: smallPresets } = amountOptions(cfg)
 useSeedAmount(cfg, amount, setAmount)

 const stopPoll = useCallback(() => {
 if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  /*
   * CLOSING WITHOUT PAYING TAKES THE REQUEST BACK.
   *
   * The row is written when the QR is DRAWN, so opening this dialog to look at a rate left
   * a "Pending top-up" for an admin to act on and an "Awaiting confirmation" line in the
   * seller's history — for money nobody ever sent. A queue full of things nobody must act
   * on is one people stop reading.
   *
   * Held in a ref so the unmount cleanup sees the CURRENT payment, and cleared the moment
   * one is paid so a real top-up is never withdrawn. The server only marks it, so a code
   * someone saved and paid an hour later still settles.
   */
 const openRef = useRef<string | null>(null)
 useEffect(() => () => {
 stopPoll()
 const ref = openRef.current
 if (ref) { openRef.current = null; abandonVietqr(ref).catch(() => {}) }
  }, [stopPoll])

 const usdAmt = Number(amount) || 0
  // The best (lowest VND/$1) tier this amount qualifies for — tiers are ascending, so the
  // last one at or below the amount wins. Below the first tier, the base rate applies.
 let applicableRate = rate
 for (const t of tiers) if (usdAmt >= t.usd && t.rate > 0) applicableRate = t.rate
 const vndAmt = applicableRate > 0 ? Math.round(usdAmt * applicableRate) : 0
 const discounted = applicableRate > 0 && applicableRate < rate
  // Show a $20k tier even if the admin only configured up to $10k — a $20k top-up already
  // gets the best (top-tier) rate, so surfacing it is honest, not a made-up discount.
 const bestRate = tiers.reduce((m, t) => (t.rate > 0 && t.rate < m ? t.rate : m), rate)
 const maxTierUsd = tiers.reduce((m, t) => Math.max(m, t.usd), 0)
 const displayTiers = maxTierUsd >= 20000 || tiers.length === 0 ? tiers : [...tiers, { usd: 20000, rate: bestRate }]

 const start = async () => {
 if (usdAmt <= 0) { setError("Enter a USD amount."); return }
 if (usdAmt < minUsd) { setError(`Minimum top-up is ${usd0(minUsd)}.`); return }
 if (!rate) { setError("Exchange rate isn't available right now — try again in a moment."); return }
 if (vndAmt < 1000) { setError("That's below the minimum top-up."); return }
 setError(null); setPhase("qr")
 try {
 const p = await createVietqrPayment(vndAmt, usdAmt)
 if (p.error) throw new Error(typeof p.error === "string" ? p.error : JSON.stringify(p.error))
 if (!(p.qrCode || p.qrLink)) throw new Error("VietQR returned no QR — nothing was charged or recorded. Check the server's VietQR keys.")
      // Required receiver fields must all be present before we show a QR to pay — a blank
      // here could send money to the wrong place. Told right in the window, not after.
 const gaps = [!p.name && "receiver", !p.bankCode && "bank", !(p.vaAccount || p.account) && "account"].filter(Boolean)
 if (gaps.length) throw new Error(`VietQR didn't return the ${gaps.join(", ")} — don't pay this. Ask an admin to check the VietQR setup.`)
 setPayment(p)
      // Prefer the EMVCo VA string — we render it locally so it ALWAYS shows.
      // Only fall back to a server image if it's a real http(s) URL (an `imgId`
      // alone isn't loadable and rendered as a broken image).
 if (p.qrCode) setQrImg(await QRCode.toDataURL(p.qrCode, { width: 240, margin: 1 }))
 else if (p.qrLink && /^https?:\/\//i.test(p.qrLink)) setQrImg(p.qrLink)
 else throw new Error("VietQR returned no scannable code — check the server's VietQR keys.")
 const ref = p.note || ""
 openRef.current = ref || null
 if (ref) {
 pollRef.current = setInterval(async () => {
 try { const s = await vietqrStatus(ref); if (s.paid) { stopPoll(); openRef.current = null; setPhase("paid"); onFunded() } } catch { /* keep polling */ }
        }, 4000)
      }
    } catch (e) {
 setError(e instanceof Error ? e.message : "Payment failed."); setPhase("error")
    }
  }

 if (phase === "paid") return <Success title={tl("topup", "Payment received")} onDone={onClose} />
 if (phase === "error")
 return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-hold/15 text-hold"><Warning size={28} weight="fill" /></span>
        <div className="font-semibold">{tl("topup", "Couldn’t start the payment")}</div>
        {/* NEVER an empty line under the heading — a refusal with no reason is the same as
            no refusal (§4). api.ts now always carries one; this is the belt. */}
        <div className="text-sm text-muted-foreground">{error || tl("topup", "The payment service didn’t answer. Try again, and tell us if it keeps failing.")}</div>
        <Button variant="outline" className="w-full" onClick={() => setPhase("amount")}>{tl("topup", "Try again")}</Button>
      </div>
    )
 if (phase === "qr")
 return (
      <div className="flex flex-col items-center gap-4 py-2">
        {qrImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrImg} alt={tl("topup", "BIDV payment code")} className="size-56 rounded-xl border border-border" />
        ) : (
          <div className="flex size-56 items-center justify-center rounded-xl border border-border"><CircleNotch size={28} className="animate-spin text-muted-foreground" /></div>
        )}
        {payment && (
          <div className="w-full space-y-3">
            <div className="text-center">
              <div className="text-lg font-semibold tabular-nums">{vnd(Number(payment.amount) || 0)}</div>
              {payment.amountUsd != null && (
                <div className="text-xs text-muted-foreground">Credits {usd(payment.amountUsd)} to your wallet</div>
              )}
            </div>

            {/* Who the money is going to, so the payer can check it against their banking
 app BEFORE sending. A QR alone asks people to trust an opaque image. */}
            <dl className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <Detail label={tl("topup", "Receiver")} value={payment.name} missing="Receiver name not returned" />
              <Detail
 label={tl("topup", "Bank")}
 value={payment.bankCode ? (VN_BANK_NAMES[payment.bankCode.toUpperCase()] ?? payment.bankCode) : ""}
 missing="Bank not returned"
              />
              <Detail label={tl("topup", "Account")} value={payment.vaAccount || payment.account} mono missing="Account not returned" />
              {/* The FULL description, not just our ref: VietQR wraps our EG-code in the
                  virtual account's own prefix, so the bank shows something longer than the
                  reference we minted.

                  NO SENTENCE UNDER IT. It used to carry "send the description exactly as
                  shown — our reference sits inside it", which is prose explaining a field
                  that is already on screen (§4) and, worse, made the seller responsible for
                  our reconciliation. They are not: the ACCOUNT above is a virtual one issued
                  for this request alone, the money can only arrive there, and the callback
                  now matches on it as well as on the reference. The QR carries both, so a
                  scan cannot get either wrong. */}
              {/**
                * THE REFERENCE, AND NOTHING ELSE.
                *
                * VietQR prepends a sixteen-character virtual-account code to the content it
                * generates. It is theirs, it is in the QR, and a person scanning never types
                * any of it — so the only reader of this row is somebody entering the transfer
                * by hand, and what they need is the shortest string that identifies the
                * payment. That is "TOPUP EG000001".
                *
                * IT IS SAFE TO DROP because the money is routed by the ACCOUNT above, which
                * is virtual and issued for this request alone, and the callback now matches
                * on it as well as on the reference. Neither half of that depends on VietQR's
                * own prefix surviving a retype.
                *
                * The full string stays on the row's title for support, and the QR is
                * untouched — a scan still sends exactly what VietQR generated.
                */}
              <div className="flex items-start justify-between gap-3 py-1.5" title={payment.content || undefined}>
                <dt className="shrink-0 pt-px text-xs text-muted-foreground">{tl("topup", "Description")}</dt>
                {/* Sized like the Detail rows above it — this is the reference a payer types
                    into the transfer, and in simple mode it is the ONLY thing tying their
                    money to their wallet. It is the last value on this screen that should be
                    set at caption size. */}
                <dd className="min-w-0 break-all text-right text-sm font-medium">
                  {/* EXACTLY WHAT TO TYPE, and the two shapes differ. On the simple QR the
                      description IS the identifier, so it is printed verbatim; on a virtual
                      account it is ours plus VietQR's routing code, and only ours is worth
                      reading (see the note above). */}
                  {payment.simple
                    ? (payment.content || payment.note)
                    : payment.note
                      ? `TOPUP ${payment.note}`
                      : <span className="text-hold">{tl("topup", "Description not returned")}</span>}
                </dd>
              </div>
            </dl>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><CircleNotch size={15} className="animate-spin" /> {tl("topup", "Waiting for payment…")}</div>
      </div>
    )
 return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {smallPresets.map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} /* SMALLER. These were p-3 at text-base — a row of buttons the size of the primary
             action, for a shortcut into a field that is right underneath them. A preset is a
             convenience, not the main way to enter an amount, and it was the loudest thing in
             the dialog. */
 className={"rounded-lg border px-2 py-2 text-center text-sm font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
        ))}
      </div>

      {/* Bulk top-ups — a better VND/$1 the more you add. Tucked behind a toggle so the
 common case stays simple; opens to a grid of amounts with their discounted rate
 and how much VND each one saves vs the base rate. Admin-configured. */}
      {tiers.length > 0 && (
 showBulk ? (
          <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkle size={13} weight="fill" /> {tl("topup", "Top up more, pay a better rate")}</span>
              <button onClick={() => setShowBulk(false)} className="text-2xs text-muted-foreground hover:text-foreground">{tl("topup", "Hide")}</button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {displayTiers.map((t) => {
 const active = usdAmt === t.usd
 const saveVnd = Math.max(0, Math.round(t.usd * (rate - t.rate)))
 const best = displayTiers.length > 1 && t === displayTiers[displayTiers.length - 1]
 return (
                  <button
 key={t.usd}
 onClick={() => setAmount(String(t.usd))}
 className={"relative flex flex-col gap-2 overflow-hidden rounded-xl border p-4 text-left transition-colors " + (active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}
                  >
                    {best && <span className="absolute right-0 top-0 rounded-bl-lg bg-primary px-2 py-0.5 eg-label text-primary-foreground">{tl("topup", "Best rate")}</span>}
                    <span className="text-lg font-semibold tabular-nums">{usd0(t.usd)}</span>
                    <span className="w-fit rounded-lg bg-muted px-2.5 py-1.5 text-xs tabular-nums text-muted-foreground">$1 = <span className="font-semibold text-foreground">{vnd(t.rate)}</span></span>
                    {saveVnd > 0 && <span className="w-fit rounded-lg bg-shipped/12 px-2 py-0.5 text-xs font-semibold text-shipped">save {vnd(saveVnd)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <button onClick={() => setShowBulk(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5">
            {tl("topup", "Top up more for a better rate")} <CaretDown size={13} weight="bold" />
          </button>
        )
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{tl("topup", "Amount (USD)")}</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={String(minUsd)} />
        <MinHint amount={amount} minUsd={minUsd} />
      </label>
      {/* Left: the rate ($1 = …). Right: the VND the QR will actually charge. */}
      <div className={"flex items-center justify-between rounded-lg border px-3 py-2 text-sm " + (discounted ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40")}>
        {rate > 0 ? (
          <>
            <span className="text-muted-foreground">
              $1 = <span className="font-medium tabular-nums text-foreground">{vnd(applicableRate)}</span>
              {discounted && <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-2xs font-semibold text-primary">{tl("topup", "bulk rate")}</span>}
            </span>
            <span className="tabular-nums"><span className="text-muted-foreground">{tl("topup", "You’ll pay")} </span><span className="font-semibold">{usdAmt > 0 ? vnd(vndAmt) : "—"}</span></span>
          </>
        ) : (
          <span className="text-muted-foreground">{tl("topup", "Loading exchange rate…")}</span>
        )}
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={start} disabled={!rate || usdAmt < minUsd}>{tl("topup", "Generate QR Code")}</Button>
    </div>
  )
}

/**
 * One receiver field. A MISSING value is called out rather than rendered blank —
 * these come from VIETQR_* env vars with hardcoded fallbacks on the server, so a
 * silent gap here could show someone the wrong account to pay.
 */
/**
 * THE LABEL AND THE VALUE ARE NOT THE SAME SIZE, and this row is why the rule exists.
 *
 * Both halves were `text-xs`. The right-hand one is an account number somebody types into
 * their banking app a digit at a time, and it was set at the size of the word "Account" —
 * so reading it meant reaching for the zoom control, which magnifies the whole page,
 * header included. One number is unreadable; the fix for it makes four other things wrong.
 *
 * The value goes to `text-sm` (14px) and the label stays at 12px. A label is read once and
 * then ignored; a value is read carefully, and on this row it is copied. See
 * tools/check-type-scale.mjs, which holds the line across the rest of the app.
 */
function Detail({ label, value, mono, missing }: { label: string; value?: string | null; mono?: boolean; missing: string }) {
 const ok = !!(value && String(value).trim())
 return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 pt-px text-xs text-muted-foreground">{label}</dt>
      <dd className={"min-w-0 break-all text-right text-sm font-medium " + (ok ? (mono ? "tabular-nums" : "") : "text-hold")}>
        {ok ? value : missing}
      </dd>
    </div>
  )
}

// ───────────────────────────── Card (Stripe) ─────────────────────────────
function CardTopUp({ onFunded, onClose, cfg }: { onFunded: () => void; onClose: () => void; cfg: TopupConfig | null }) {
  const tl = useLabelT()
 const [amount, setAmount] = useState("")
 const [phase, setPhase] = useState<"amount" | "pay" | "paid">("amount")
 const [error, setError] = useState<string | null>(null)
 const { minUsd, small: smallPresets } = amountOptions(cfg)
 useSeedAmount(cfg, amount, setAmount)
  /**
   * CARDS WE HOLD, not cards Stripe Link happens to know about.
   *
   * The list a seller used to see here was Link — Stripe's own consumer wallet, keyed to
   * their email — so it appeared on one browser and was empty on the next, and neither we
   * nor they could act on it. These are cards saved against OUR customer: same four facts a
   * Netflix or an Uber shows (brand, last four, expiry, name), never a card number, because
   * Stripe holds the number and hands us only enough to recognise one.
   *
   * `"new"` is a real selection rather than the absence of one — "use a different card" has
   * to be a thing you can pick, not a thing you get by unpicking everything.
   */
 const [cards, setCards] = useState<SavedCard[] | null>(null)
 const [pick, setPick] = useState<string>("new")
 const [remember, setRemember] = useState(true)
 useEffect(() => {
 const t = setTimeout(() => {
 getStripeCards()
        .then((r) => {
 const list = r.cards ?? []
 setCards(list)
          // Open on the first saved card when there is one: the common case is paying with
          // the card you paid with last time.
 if (list.length) setPick(list[0].id)
        })
        .catch(() => setCards([]))
    }, 0)
 return () => clearTimeout(t)
  }, [])
 const forget = async (id: string) => {
 await deleteStripeCard(id).catch(() => {})
 setCards((p) => {
 const left = (p ?? []).filter((c) => c.id !== id)
 setPick(left.length ? left[0].id : "new")
 return left
    })
  }
 const proceed = () => {
 if (Number(amount) < minUsd) { setError(`Minimum top-up is ${usd0(minUsd)}.`); return }
 setError(null); setPhase("pay")
  }

 if (phase === "paid") return <Success title={tl("topup", "Payment received")} onDone={onClose} />
 if (phase === "pay")
 return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{tl("topup", "Topping up")}</span>
          <span className="font-semibold tabular-nums">{usd(Number(amount) || 0)}</span>
        </div>

        {(cards ?? []).length > 0 && (
          <div className="space-y-1.5">
            {(cards ?? []).map((c) => (
              <label key={c.id} className={"flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors " + (pick === c.id ? "border-selected eg-selected" : "border-border hover:bg-accent/40")}>
                <input type="radio" name="eg-card" checked={pick === c.id} onChange={() => setPick(c.id)} className="size-3.5 accent-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium capitalize">{c.brand} •••• {c.last4}</span>
                  {(c.exp || c.name) && <span className="block text-xs text-muted-foreground">{[c.exp, c.name].filter(Boolean).join(" · ")}</span>}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); forget(c.id) }}
                  className="eg-tap text-xs text-muted-foreground hover:text-destructive"
                >{tl("topup", "Remove")}</button>
              </label>
            ))}
            <label className={"flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors " + (pick === "new" ? "border-selected eg-selected" : "border-border hover:bg-accent/40")}>
              <input type="radio" name="eg-card" checked={pick === "new"} onChange={() => setPick("new")} className="size-3.5 accent-primary" />
              <span className="font-medium">{tl("topup", "Use a new card")}</span>
            </label>
          </div>
        )}

        {pick === "new" ? (
          <>
            <StripeCardForm amount={Number(amount) || 0} save={remember} onPaid={() => { setPhase("paid"); onFunded() }} onError={(m) => setError(m || null)} />
            {/* A checkbox, because it toggles. Same opt-in the PayPal tab asks for, and the
                same reason: keeping somebody's card on file is a decision, not a side effect
                of paying once. */}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-3.5 accent-primary" />
              {tl("topup", "Save this card for next time")}
            </label>
          </>
        ) : (
          <SavedCardPay
            amount={Number(amount) || 0}
            cardId={pick}
            onPaid={() => { setPhase("paid"); onFunded() }}
            onError={(m) => setError(m || null)}
          />
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}
        <button onClick={() => setPhase("amount")} className="text-xs text-muted-foreground hover:text-foreground">{tl("topup", "← Change amount")}</button>
      </div>
    )
 return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {smallPresets.map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} /* SMALLER. These were p-3 at text-base — a row of buttons the size of the primary
             action, for a shortcut into a field that is right underneath them. A preset is a
             convenience, not the main way to enter an amount, and it was the loudest thing in
             the dialog. */
 className={"rounded-lg border px-2 py-2 text-center text-sm font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{tl("topup", "Amount (USD)")}</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={String(minUsd)} />
        <MinHint amount={amount} minUsd={minUsd} />
      </label>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={proceed} disabled={Number(amount) < minUsd}>{tl("topup", "Continue to card")}</Button>
    </div>
  )
}

// ───────────────────────────── PayPal ─────────────────────────────
// Amount first, then the real PayPal login. Deliberately the same three phases and the same
// amount step as the Card tab: they are one flow with two processors, and a seller who has
// used one should not be learning a second shape.
function PaypalTopUp({ onFunded, onClose, cfg }: { onFunded: () => void; onClose: () => void; cfg: TopupConfig | null }) {
  const tl = useLabelT()
 const [amount, setAmount] = useState("")
 const [phase, setPhase] = useState<"amount" | "pay" | "paid">("amount")
 const [error, setError] = useState<string | null>(null)
 const { minUsd, small: smallPresets } = amountOptions(cfg)
 useSeedAmount(cfg, amount, setAmount)
  /**
   * THE POPUP HAPPENS ONCE. PayPal will never let us take somebody's PayPal login on our
   * own page, and nothing here should ever look as though it does — so the first payment
   * goes through PayPal's window and, if they tick Remember, PayPal vaults the account.
   * After that this tab is a button on our page: the order is created and captured
   * server-side against the saved token, and no window opens at all.
   */
 const [saved, setSaved] = useState<SavedPaypal[] | null>(null)
  /**
   * SANDBOX HAS TO SAY SO. A test payment and a real one are the same screens, the same
   * amounts and the same success message — the ONLY difference is which client-id the server
   * holds, which nobody looking at this dialog can see. That is the wrong kind of identical:
   * an admin testing against sandbox believes they moved money and a seller on a
   * misconfigured server believes they did too, and both are wrong in the expensive
   * direction. Live is unmarked, because live is the normal state and a badge on every real
   * top-up is noise.
   */
 const [ppEnv, setPpEnv] = useState<string | null>(null)
 const [useSaved, setUseSaved] = useState(true)
 const [remember, setRemember] = useState(true)
 const [busy, setBusy] = useState(false)
  /* The saved path's three figures. From the SERVER — the same rule as the interactive
     path, which is that the client never computes a charge it is about to collect. */
 const [quote, setQuote] = useState<{ credit: number; charge: number; fee: number; pct: number; fixed: number } | null>(null)
 useEffect(() => {
 const t = setTimeout(() => {
 getSavedPaypal().then(setSaved).catch(() => setSaved([]))
 getPaypalConfig().then((c) => setPpEnv(c.env ?? null)).catch(() => {})
    }, 0)
 return () => clearTimeout(t)
  }, [])
 const account = (saved ?? [])[0] ?? null
 const proceed = () => {
 if (Number(amount) < minUsd) { setError(`Minimum top-up is ${usd0(minUsd)}.`); return }
 setError(null); setQuote(null); setPhase("pay")
  }
  /* Amber, not red: nothing is broken. It is the warning tone this app already uses for
     "read this before you act on the number next to it". */
 const sandboxNote = ppEnv && ppEnv !== "live" ? (
    <div className="flex items-center gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
      <Warning size={13} weight="fill" className="shrink-0" />
      {tl("topup", "PayPal is in sandbox — no real money moves, and your balance won't really change.")}
    </div>
  ) : null
  // Priced when the pay step opens, and only for the saved path — the interactive one gets
  // its figures back from create-order because it has to create one anyway.
 useEffect(() => {
 if (phase !== "pay" || !account || !useSaved) return
 let live = true
 const t = setTimeout(() => {
 quotePaypal(Number(amount) || 0)
        .then((q) => {
 if (!live || q.error || q.charge == null || q.credit == null) return
 setQuote({ credit: q.credit, charge: q.charge, fee: q.fee ?? Number((q.charge - q.credit).toFixed(2)), pct: q.feeCfg?.pct ?? 0, fixed: q.feeCfg?.fixed ?? 0 })
        })
        .catch(() => {})
    }, 0)
 return () => { live = false; clearTimeout(t) }
  }, [phase, account, useSaved, amount])
  /* No window: create against the saved token, then the SAME capture the button uses. */
  /* A declined instrument is the one failure the saved account cannot fix by itself — the
     card behind it is out of money and only the payer can pick another. */
 const [declined, setDeclined] = useState(false)
 const payWithSaved = async () => {
 if (!account) return
 setBusy(true); setError(null); setDeclined(false)
 try {
 const r = await chargeSavedPaypal(Number(amount) || 0, account.id)
 if (r.declined) { setDeclined(true); setError(r.error || null); return }
 if (r.error || !r.orderID) throw new Error(r.error || "PayPal wouldn't start that payment.")
 const c = await capturePaypalOrder(r.orderID)
 if (!c.ok) throw new Error(c.error || "PayPal didn't confirm the payment.")
 setSavedNow(null); setSavePending(false); setPhase("paid"); onFunded()
    } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't take that payment.")
    } finally { setBusy(false) }
  }
 const forget = async () => {
 if (!account) return
 setBusy(true)
 try { await deleteSavedPaypal(account.id); setSaved((p) => (p ?? []).filter((x) => x.id !== account.id)); setUseSaved(false) }
 catch { setError("Couldn't remove that account.") } finally { setBusy(false) }
  }
  // Stable identities: PaypalButton creates the PayPal order inside an effect keyed on these,
  // so a new function each render would tear the order down and mint another one every time
  // the parent re-renders.
  /**
   * WAS IT ACTUALLY REMEMBERED? The capture answers, and the answer is shown.
   *
   * Vault is a separate enablement on the PayPal account, so ticking the box is a REQUEST,
   * not an outcome — the order can be captured perfectly and the token simply not arrive.
   * Saying "saved" either way would promise a seller they will not be asked to sign in
   * again, and then ask them again next month with no explanation. §4: if a thing can't be
   * read versus doesn't exist, say which.
   */
 const [savedNow, setSavedNow] = useState<string | null>(null)
 const [savePending, setSavePending] = useState(false)
 const paid = useCallback((saved: string | null, pending: boolean) => {
 setSavedNow(saved); setSavePending(pending); setPhase("paid"); onFunded()
  }, [onFunded])
 const failed = useCallback((m: string) => setError(m || null), [])

 if (phase === "paid")
 return (
      <Success
 title={tl("topup", "Payment received")}
        /**
          * NOTHING UNDER IT WHEN IT WORKED.
          *
          * A saved account announced itself in a sentence here — and then announced itself
          * again, properly, the next time the tab is opened, by BEING there with a Pay
          * button. The screen that proves it is the one you use it on; a line of prose on
          * the way out is the third telling.
          *
          * The other two states keep their line, and the difference is not cosmetic: "PayPal
          * is still saving this" and "this could not be saved" are facts nothing else on any
          * screen will ever tell you. A refusal carries its reason (§4); a success that
          * demonstrates itself does not need a caption.
          */
 sub={savePending
 ? tl("topup", "PayPal is still saving this account — it should be ready by your next top-up.")
          : remember && !savedNow && !account
 ? tl("topup", "This account couldn't be remembered, so next time will ask you to sign in again.")
 : ""}
 onDone={onClose}
      />
    )
 if (phase === "pay")
 return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{tl("topup", "Topping up")}</span>
          <span className="font-semibold tabular-nums">{usd(Number(amount) || 0)}</span>
        </div>
        {sandboxNote}
        {account && useSaved ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">PayPal</span>
                <span className="block truncate text-xs text-muted-foreground">{account.label || tl("topup", "Saved account")}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={forget} disabled={busy}>{tl("topup", "Forget")}</Button>
            </div>
            {/* THE SAME THREE FIGURES as the interactive path. One click is not a reason to
                collect a fee somebody has not seen. Held back until the server answers,
                because a total that appears after the button would be worse than none. */}
            {quote && (
              <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{tl("topup", "Wallet credit")}</dt>
                  <dd className="tabular-nums">{usd(quote.credit)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    {tl("topup", "PayPal fee")}<span className="opacity-70"> · {quote.pct}% + {usd(quote.fixed)}</span>
                  </dt>
                  <dd className="tabular-nums">{usd(quote.fee)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <dt>{tl("topup", "You pay")}</dt>
                  <dd className="tabular-nums">{usd(quote.charge)}</dd>
                </div>
              </dl>
            )}
            <Button className="w-full" onClick={payWithSaved} disabled={busy || !quote}>
              {busy ? <CircleNotch size={16} className="animate-spin" /> : `${tl("topup", "Pay")} ${usd(quote?.charge ?? (Number(amount) || 0))}`}
            </Button>
            {/**
              * CARD CHOICE IS ALWAYS ONE CLICK AWAY.
              *
              * The saved account is the FAST path, not the only one. Pressing Pay lets PayPal
              * charge whichever funding source the payer authorised — we never see their
              * cards and cannot offer a list — so the way to choose one is PayPal's own
              * window, and that has to be permanently on offer rather than something you
              * discover after a decline.
              *
              * It used to read "Use a different PayPal account", which describes changing
              * ACCOUNTS. The thing people actually want is a different CARD on the same
              * account, and a link that appears to be about something else is a route nobody
              * takes.
              */}
            <button onClick={() => { setDeclined(false); setUseSaved(false) }} className="text-xs text-muted-foreground hover:text-foreground">
              {tl("topup", "Pay with a different card or account")}
            </button>
          </div>
        ) : (
          <>
            <PaypalButton amount={Number(amount) || 0} remember={remember} onPaid={paid} onError={failed} />
            {/* A CHECKBOX, NOT A BUTTON — it toggles, so it looks like a toggle (§4). The
                consent itself is given inside PayPal's window; this only asks for it. */}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-3.5 accent-primary" />
              {tl("topup", "Remember this PayPal account for next time")}
            </label>
          </>
        )}
        {declined ? (
          /* The refusal carries its reason AND its way out, in one place. */
          <div className="space-y-2 rounded-lg border border-hold/30 bg-hold/10 p-3">
            <div className="text-sm text-hold">{tl("topup", "That payment was declined — the card behind your PayPal account wouldn't pay.")}</div>
            <Button variant="outline" className="w-full" onClick={() => { setDeclined(false); setUseSaved(false) }}>
              {tl("topup", "Choose another card in PayPal")}
            </Button>
          </div>
        ) : error ? <div className="text-sm text-destructive">{error}</div> : null}
        <button onClick={() => setPhase("amount")} className="text-xs text-muted-foreground hover:text-foreground">{tl("topup", "← Change amount")}</button>
      </div>
    )
 return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {smallPresets.map((v) => (
          <button key={v} onClick={() => setAmount(String(v))}
 className={"rounded-lg border px-2 py-2 text-center text-sm font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{tl("topup", "Amount (USD)")}</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={String(minUsd)} />
        <MinHint amount={amount} minUsd={minUsd} />
      </label>
      {sandboxNote}
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={proceed} disabled={Number(amount) < minUsd}>{tl("topup", "Continue to PayPal")}</Button>
    </div>
  )
}

// ───────────────────────────── Transfer (manual) ─────────────────────────────
/* PAYPAL IS NOT HERE ANY MORE. It was a third row — send money to an address by hand, attach
   a screenshot, wait for an admin to agree it arrived — while the Orders v2 integration that
   does it properly sat in paypal.js with nothing calling it. It has its own tab now, with the
   real login and the fee priced in. PingPong and LianLian stay manual because they genuinely
   are: we have no API with either. */
const PROVIDERS = [
  { key: "PingPong", to: "helennguyen958@gmail.com" },
  { key: "LianLian", to: "phanmylinh0410@gmail.com" },
]
function TransferTopUp({ onFunded, onClose, cfg }: { onFunded: () => void; onClose: () => void; cfg: TopupConfig | null }) {
  const tl = useLabelT()
 const [provider, setProvider] = useState(PROVIDERS[0])
 const [amount, setAmount] = useState("")
 const { minUsd, small: smallPresets, bulk: bulkPresets } = amountOptions(cfg)
 useSeedAmount(cfg, amount, setAmount)
 const [ref, setRef] = useState("")
 const [proof, setProof] = useState<{ name: string; dataUrl: string } | null>(null)
 const [phase, setPhase] = useState<"form" | "sent">("form")
 const [saving, setSaving] = useState(false)
 const [error, setError] = useState<string | null>(null)
 const [copied, setCopied] = useState(false)

 const takeFile = (file?: File | null) => {
 if (!file) return
 if (!file.type.startsWith("image/")) { setError("Please attach an image (PNG/JPG)."); return }
 if (file.size > 8 * 1024 * 1024) { setError("Screenshot is over 8MB — please compress it."); return }
 const reader = new FileReader()
 reader.onload = () => { setError(null); setProof({ name: file.name, dataUrl: String(reader.result || "") }) }
 reader.readAsDataURL(file)
  }

 const submit = async () => {
 const amt = Number(amount) || 0
 if (amt <= 0) { setError("Enter an amount."); return }
 if (amt < minUsd) { setError(`Minimum top-up is ${usd0(minUsd)}.`); return }
 setSaving(true); setError(null)
 try {
 const r = await createTopupRequest({ amount: amt, method: provider.key, ref: ref.trim() || undefined, attachment: proof?.dataUrl })
 if (r.error) throw new Error(r.error)
 setPhase("sent")
 onFunded() // refresh the wallet so the pending request shows immediately
    } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't submit the request.")
    } finally {
 setSaving(false)
    }
  }

 if (phase === "sent")
 return <Success title={tl("topup", "Request submitted")} sub={`We'll credit ${usd(Number(amount) || 0)} once your ${provider.key} transfer is confirmed.`} onDone={onClose} />

 return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((p) => (
          <button key={p.key} onClick={() => setProvider(p)} className={"rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " + (provider.key === p.key ? "border-selected eg-selected" : "border-border hover:bg-accent")}>{p.key}</button>
        ))}
      </div>

      {provider.to && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground">Send your {provider.key} payment to</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <code className="truncate tabular-nums text-sm font-semibold">{provider.to}</code>
            <Button
 size="sm"
 variant="outline"
 onClick={async () => { try { await navigator.clipboard.writeText(provider.to!); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }}
            >
              {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />} {copied ? tl("topup", "Copied") : tl("topup", "Copy")}
            </Button>
          </div>
        </div>
      )}

      {/* Suggested amounts — same small + bulk picks as VietQR, but PLAIN USD: a transfer
 is USD → our USD wallet, so there's no exchange rate or "save" here. */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {smallPresets.map((v) => (
            <button key={v} onClick={() => setAmount(String(v))} /* SMALLER. These were p-3 at text-base — a row of buttons the size of the primary
             action, for a shortcut into a field that is right underneath them. A preset is a
             convenience, not the main way to enter an amount, and it was the loudest thing in
             the dialog. */
 className={"rounded-lg border px-2 py-2 text-center text-sm font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {bulkPresets.map((v) => (
            <button key={v} onClick={() => setAmount(String(v))} /* SMALLER. These were p-3 at text-base — a row of buttons the size of the primary
             action, for a shortcut into a field that is right underneath them. A preset is a
             convenience, not the main way to enter an amount, and it was the loudest thing in
             the dialog. */
 className={"rounded-lg border px-2 py-2 text-center text-sm font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{tl("topup", "Amount (USD)")}</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={String(minUsd)} />
        <MinHint amount={amount} minUsd={minUsd} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{tl("topup", "Reference / transaction note (optional)")}</span>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={tl("topup", "e.g. your PayPal transaction ID")} />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{tl("topup", "Payment screenshot")} <span className="font-normal text-muted-foreground">{tl("topup", "(optional)")}</span></span>
        {proof ? (
          <div className="flex items-center gap-3 rounded-xl border border-border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proof.dataUrl} alt={tl("topup", "Payment receipt")} className="size-14 shrink-0 rounded-lg border border-border object-cover" />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{proof.name}</span>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-alert" onClick={() => setProof(null)} aria-label={tl("topup", "Remove screenshot")}>
              <X size={15} weight="bold" />
            </Button>
          </div>
        ) : (
          <Dropzone
            accept="image/*"
            onFiles={(files) => takeFile(files[0])}
            label={tl("topup", "Drop a screenshot, or click to browse")}
            hint={tl("topup", "Helps us confirm your transfer faster")}
          />
        )}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={submit} disabled={saving}>{saving ? tl("topup", "Submitting…") : tl("topup", "I've sent it — submit request")}</Button>
    </div>
  )
}

// ───────────────────────────── Dialog ─────────────────────────────
export function TopUpDialog({ open, onOpenChange, onFunded }: { open: boolean; onOpenChange: (v: boolean) => void; onFunded: () => void }) {
  const tl = useLabelT()
 const close = () => onOpenChange(false)
  // One config fetch for the whole dialog — the admin-set minimum, quick-amount presets, and
  // (for the QR tab) the exchange rate + volume tiers. Shared so every method enforces the
  // same minimum and shows the same presets. Deferred so opening the dialog doesn't setState
  // synchronously; re-fetched each open so an admin's change shows without a reload.
 const [cfg, setCfg] = useState<TopupConfig | null>(null)
 useEffect(() => {
 if (!open) return
 const t = setTimeout(() => { getVietqrRate().then(setCfg).catch(() => {}) }, 0)
 return () => clearTimeout(t)
  }, [open])
 return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tl("topup", "Add funds")}</DialogTitle>
        </DialogHeader>
        {/* NO SENTENCE UNDER ANY OF THESE TABS. Each method used to end in a centred line
            under its button — "Secured by Stripe. Balance updates on success.", "Pay the VND
            amount with any VN banking app…", "Send to this PingPong account, attach your
            receipt, then submit." Every one described the control directly above it, which
            §4 calls a defect: the button says Generate QR Code, the address is on screen
            with a Copy beside it, and the receipt field is labelled. Removed on request. */}
        <Tabs defaultValue="transfer">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="transfer">{tl("topup", "Transfer")}</TabsTrigger>
            <TabsTrigger value="vietqr">{tl("topup", "QR Code")}</TabsTrigger>
            <TabsTrigger value="card">{tl("topup", "Card")}</TabsTrigger>
            <TabsTrigger value="paypal">{tl("topup", "PayPal")}</TabsTrigger>
          </TabsList>
          <TabsContent value="transfer" className="mt-4">
            <TransferTopUp onFunded={onFunded} onClose={close} cfg={cfg} />
          </TabsContent>
          <TabsContent value="vietqr" className="mt-4">
            <VietqrTopUp onFunded={onFunded} onClose={close} cfg={cfg} />
          </TabsContent>
          <TabsContent value="paypal" className="mt-4">
            <PaypalTopUp onFunded={onFunded} onClose={close} cfg={cfg} />
          </TabsContent>
          <TabsContent value="card" className="mt-4">
            <CardTopUp onFunded={onFunded} onClose={close} cfg={cfg} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
