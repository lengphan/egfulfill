"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { CheckCircle, Warning, CircleNotch, Copy, Check, UploadSimple, X, Sparkle, CaretDown } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StripeCardForm } from "@/components/app/stripe-card-form"
import { createVietqrPayment, vietqrStatus, createTopupRequest, getVietqrRate, VN_BANK_NAMES, type VietqrPayment, type TopupConfig } from "@/lib/api"

const vnd = (n: number) => `${n.toLocaleString("en-US")}₫`
const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Whole-dollar form for the preset buttons — they're always round amounts, so the ".00"
// is just noise. Kept separate from usd() so real/typed amounts still show cents.
const usd0 = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`

function Success({ title, sub, onDone }: { title: string; sub: string; onDone: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <CheckCircle size={30} weight="fill" />
      </span>
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground">{sub}</div>
      <Button className="w-full" onClick={onDone}>Done</Button>
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
  const n = Number(amount)
  if (n > 0 && n < minUsd)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
        <Warning size={11} weight="fill" /> {usd0(n)} is below the {usd0(minUsd)} minimum — enter at least {usd0(minUsd)}.
      </span>
    )
  return <span className="text-[11px] text-muted-foreground">Minimum top-up {usd0(minUsd)}.</span>
}

function VietqrTopUp({ onFunded, onClose, cfg }: { onFunded: () => void; onClose: () => void; cfg: TopupConfig | null }) {
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
  useEffect(() => stopPoll, [stopPoll])

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
      if (ref) {
        pollRef.current = setInterval(async () => {
          try { const s = await vietqrStatus(ref); if (s.paid) { stopPoll(); setPhase("paid"); onFunded() } } catch { /* keep polling */ }
        }, 4000)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed."); setPhase("error")
    }
  }

  if (phase === "paid") return <Success title="Payment received" sub="Your wallet balance has been updated." onDone={onClose} />
  if (phase === "error")
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600"><Warning size={28} weight="fill" /></span>
        <div className="font-semibold">Couldn&apos;t start the payment</div>
        <div className="text-sm text-muted-foreground">{error}</div>
        <Button variant="outline" className="w-full" onClick={() => setPhase("amount")}>Try again</Button>
      </div>
    )
  if (phase === "qr")
    return (
      <div className="flex flex-col items-center gap-4 py-2">
        {qrImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrImg} alt="VietQR payment code" className="size-56 rounded-xl border border-border" />
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
              <Detail label="Receiver" value={payment.name} missing="Receiver name not returned" />
              <Detail
                label="Bank"
                value={payment.bankCode ? (VN_BANK_NAMES[payment.bankCode.toUpperCase()] ?? payment.bankCode) : ""}
                missing="Bank not returned"
              />
              <Detail label="Account" value={payment.vaAccount || payment.account} mono missing="Account not returned" />
              {/* The FULL description, not just our ref. VietQR wraps our EG-code in a
                  virtual-account prefix, so the bank shows something longer — which is
                  why this never matched what you saw on the VietQR side. Our ref is
                  inside it, and that substring is what the poll reconciles on. */}
              <Detail label="Description" value={payment.content || payment.note} mono missing="Description not returned" />
              {payment.content && payment.note && payment.content !== payment.note && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Send the description exactly as shown. Our reference <span className="font-mono">{payment.note}</span>{" "}sits inside it — that&apos;s what matches the payment to your wallet.
                </p>
              )}
            </dl>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><CircleNotch size={15} className="animate-spin" /> Waiting for payment…</div>
      </div>
    )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {smallPresets.map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} className={"rounded-xl border p-3 text-center text-base font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
        ))}
      </div>

      {/* Bulk top-ups — a better VND/$1 the more you add. Tucked behind a toggle so the
          common case stays simple; opens to a grid of amounts with their discounted rate
          and how much VND each one saves vs the base rate. Admin-configured. */}
      {tiers.length > 0 && (
        showBulk ? (
          <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkle size={13} weight="fill" /> Top up more, pay a better rate</span>
              <button onClick={() => setShowBulk(false)} className="text-[11px] text-muted-foreground hover:text-foreground">Hide</button>
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
                    {best && <span className="absolute right-0 top-0 rounded-bl-lg bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-foreground">Best rate</span>}
                    <span className="text-lg font-semibold tabular-nums">{usd0(t.usd)}</span>
                    <span className="w-fit rounded-lg bg-muted px-2.5 py-1.5 text-xs tabular-nums text-muted-foreground">$1 = <span className="font-semibold text-foreground">{vnd(t.rate)}</span></span>
                    {saveVnd > 0 && <span className="w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">save {vnd(saveVnd)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <button onClick={() => setShowBulk(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5">
            <Sparkle size={14} weight="fill" /> Top up more for a better rate <CaretDown size={13} weight="bold" />
          </button>
        )
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Amount (USD)</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={String(minUsd)} />
        <MinHint amount={amount} minUsd={minUsd} />
      </label>
      {/* Left: the rate ($1 = …). Right: the VND the QR will actually charge. */}
      <div className={"flex items-center justify-between rounded-lg border px-3 py-2 text-sm " + (discounted ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40")}>
        {rate > 0 ? (
          <>
            <span className="text-muted-foreground">
              $1 = <span className="font-medium tabular-nums text-foreground">{vnd(applicableRate)}</span>
              {discounted && <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-semibold text-primary">bulk rate</span>}
            </span>
            <span className="tabular-nums"><span className="text-muted-foreground">You&apos;ll pay </span><span className="font-semibold">{usdAmt > 0 ? vnd(vndAmt) : "—"}</span></span>
          </>
        ) : (
          <span className="text-muted-foreground">Loading exchange rate…</span>
        )}
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={start} disabled={!rate || usdAmt < minUsd}>Generate QR Code</Button>
      <p className="text-center text-xs text-muted-foreground">Pay the VND amount with any VN banking app. Your USD balance updates automatically once paid.</p>
    </div>
  )
}

/**
 * One receiver field. A MISSING value is called out rather than rendered blank —
 * these come from VIETQR_* env vars with hardcoded fallbacks on the server, so a
 * silent gap here could show someone the wrong account to pay.
 */
function Detail({ label, value, mono, missing }: { label: string; value?: string | null; mono?: boolean; missing: string }) {
  const ok = !!(value && String(value).trim())
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={"min-w-0 break-all text-right text-xs font-medium " + (ok ? (mono ? "font-mono" : "") : "text-amber-600")}>
        {ok ? value : missing}
      </dd>
    </div>
  )
}

// ───────────────────────────── Card (Stripe) ─────────────────────────────
function CardTopUp({ onFunded, onClose, cfg }: { onFunded: () => void; onClose: () => void; cfg: TopupConfig | null }) {
  const [amount, setAmount] = useState("")
  const [phase, setPhase] = useState<"amount" | "pay" | "paid">("amount")
  const [error, setError] = useState<string | null>(null)
  const { minUsd, small: smallPresets } = amountOptions(cfg)
  useSeedAmount(cfg, amount, setAmount)
  const proceed = () => {
    if (Number(amount) < minUsd) { setError(`Minimum top-up is ${usd0(minUsd)}.`); return }
    setError(null); setPhase("pay")
  }

  if (phase === "paid") return <Success title="Payment received" sub="Your card top-up has been credited." onDone={onClose} />
  if (phase === "pay")
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Topping up</span>
          <span className="font-semibold tabular-nums">{usd(Number(amount) || 0)}</span>
        </div>
        <StripeCardForm amount={Number(amount) || 0} onPaid={() => { setPhase("paid"); onFunded() }} onError={(m) => setError(m || null)} />
        {error && <div className="text-sm text-destructive">{error}</div>}
        <button onClick={() => setPhase("amount")} className="text-xs text-muted-foreground hover:text-foreground">← Change amount</button>
      </div>
    )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {smallPresets.map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} className={"rounded-xl border p-3 text-center text-base font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Amount (USD)</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={String(minUsd)} />
        <MinHint amount={amount} minUsd={minUsd} />
      </label>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={proceed} disabled={Number(amount) < minUsd}>Continue to card</Button>
      <p className="text-center text-xs text-muted-foreground">Secured by Stripe. Balance updates on success.</p>
    </div>
  )
}

// ───────────────────────────── Transfer (manual) ─────────────────────────────
const PROVIDERS = [
  { key: "PingPong", to: "helennguyen958@gmail.com", hint: "Send to this PingPong account, attach your receipt, then submit." },
  { key: "LianLian", to: "phanmylinh0410@gmail.com", hint: "Send to this LianLian account, attach your receipt, then submit." },
  { key: "PayPal", to: "admin@embroiderygoods.com", hint: "Send to this PayPal, attach your receipt, then submit — we credit your wallet once it lands." },
]
function TransferTopUp({ onFunded, onClose, cfg }: { onFunded: () => void; onClose: () => void; cfg: TopupConfig | null }) {
  const [provider, setProvider] = useState(PROVIDERS[0])
  const [amount, setAmount] = useState("")
  const { minUsd, small: smallPresets, bulk: bulkPresets } = amountOptions(cfg)
  useSeedAmount(cfg, amount, setAmount)
  const [ref, setRef] = useState("")
  const [proof, setProof] = useState<{ name: string; dataUrl: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
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
    return <Success title="Request submitted" sub={`We'll credit ${usd(Number(amount) || 0)} once your ${provider.key} transfer is confirmed.`} onDone={onClose} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((p) => (
          <button key={p.key} onClick={() => setProvider(p)} className={"rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " + (provider.key === p.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}>{p.key}</button>
        ))}
      </div>

      {provider.to && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground">Send your {provider.key} payment to</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <code className="truncate font-mono text-sm font-semibold">{provider.to}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => { try { await navigator.clipboard.writeText(provider.to!); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }}
            >
              {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {/* Suggested amounts — same small + bulk picks as VietQR, but PLAIN USD: a transfer
          is USD → our USD wallet, so there's no exchange rate or "save" here. */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {smallPresets.map((v) => (
            <button key={v} onClick={() => setAmount(String(v))} className={"rounded-xl border p-3 text-center text-base font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {bulkPresets.map((v) => (
            <button key={v} onClick={() => setAmount(String(v))} className={"rounded-xl border p-3 text-center text-base font-semibold tabular-nums transition-colors " + (Number(amount) === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40")}>{usd0(v)}</button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Amount (USD)</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={String(minUsd)} />
        <MinHint amount={amount} minUsd={minUsd} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Reference / transaction note (optional)</span>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. your PayPal transaction ID" />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Payment screenshot <span className="font-normal text-muted-foreground">(optional)</span></span>
        {proof ? (
          <div className="flex items-center gap-3 rounded-xl border border-border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proof.dataUrl} alt="Payment receipt" className="size-14 shrink-0 rounded-lg border border-border object-cover" />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{proof.name}</span>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-600" onClick={() => setProof(null)} aria-label="Remove screenshot">
              <X size={15} weight="bold" />
            </Button>
          </div>
        ) : (
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]) }}
            className={"flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors " + (dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-accent")}
          >
            <UploadSimple size={20} className="text-muted-foreground" />
            <span className="text-sm font-medium">Drop a screenshot or <span className="text-primary">browse</span></span>
            <span className="text-xs text-muted-foreground">Helps us confirm your transfer faster</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => takeFile(e.target.files?.[0])} />
          </label>
        )}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={submit} disabled={saving}>{saving ? "Submitting…" : "I've sent it — submit request"}</Button>
      <p className="text-center text-xs text-muted-foreground">{provider.hint}</p>
    </div>
  )
}

// ───────────────────────────── Dialog ─────────────────────────────
export function TopUpDialog({ open, onOpenChange, onFunded }: { open: boolean; onOpenChange: (v: boolean) => void; onFunded: () => void }) {
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
          <DialogTitle>Add funds</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="transfer">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="transfer">Transfer</TabsTrigger>
            <TabsTrigger value="vietqr">QR Code</TabsTrigger>
            <TabsTrigger value="card">Card</TabsTrigger>
          </TabsList>
          <TabsContent value="transfer" className="mt-4">
            <TransferTopUp onFunded={onFunded} onClose={close} cfg={cfg} />
          </TabsContent>
          <TabsContent value="vietqr" className="mt-4">
            <VietqrTopUp onFunded={onFunded} onClose={close} cfg={cfg} />
          </TabsContent>
          <TabsContent value="card" className="mt-4">
            <CardTopUp onFunded={onFunded} onClose={close} cfg={cfg} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
