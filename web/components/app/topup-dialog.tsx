"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { CheckCircle, Warning, CircleNotch, Copy, Check } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StripeCardForm } from "@/components/app/stripe-card-form"
import { createVietqrPayment, vietqrStatus, createTopupRequest, type VietqrPayment } from "@/lib/api"

const vnd = (n: number) => `${n.toLocaleString("en-US")}₫`
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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
const VND_PRESETS = [50_000, 100_000, 200_000, 500_000]
function VietqrTopUp({ onFunded, onClose }: { onFunded: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState("100000")
  const [phase, setPhase] = useState<"amount" | "qr" | "paid" | "error">("amount")
  const [payment, setPayment] = useState<VietqrPayment | null>(null)
  const [qrImg, setQrImg] = useState("")
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])
  useEffect(() => stopPoll, [stopPoll])

  const start = async () => {
    const amt = Math.round(Number(amount) || 0)
    if (amt < 1000) { setError("Enter at least 1,000₫."); return }
    setError(null); setPhase("qr")
    try {
      const p = await createVietqrPayment(amt)
      if (p.error) throw new Error(typeof p.error === "string" ? p.error : JSON.stringify(p.error))
      if (!(p.qrCode || p.qrLink)) throw new Error("VietQR returned no QR — check the server's VietQR keys, or that you're signed in.")
      setPayment(p)
      if (p.qrLink) setQrImg(p.qrLink)
      else if (p.qrCode) setQrImg(await QRCode.toDataURL(p.qrCode, { width: 240, margin: 1 }))
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
          <div className="text-center">
            <div className="text-lg font-semibold tabular-nums">{vnd(Number(payment.amount) || 0)}</div>
            <div className="font-mono text-xs text-muted-foreground">Ref {payment.note}</div>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><CircleNotch size={15} className="animate-spin" /> Waiting for payment…</div>
      </div>
    )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {VND_PRESETS.map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} className={"rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " + (Number(amount) === v ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}>{vnd(v)}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Amount (VND)</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="100000" />
      </label>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={start}>Generate VietQR</Button>
      <p className="text-center text-xs text-muted-foreground">Scan with any VN banking app. Balance updates automatically once paid.</p>
    </div>
  )
}

// ───────────────────────────── Card (Stripe) ─────────────────────────────
const USD_PRESETS = [20, 50, 100, 200]
function CardTopUp({ onFunded, onClose }: { onFunded: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState("50")
  const [phase, setPhase] = useState<"amount" | "pay" | "paid">("amount")
  const [error, setError] = useState<string | null>(null)

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
      <div className="flex flex-wrap gap-2">
        {USD_PRESETS.map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} className={"rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " + (Number(amount) === v ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}>{usd(v)}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Amount (USD)</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="50" />
      </label>
      <Button className="w-full" onClick={() => Number(amount) > 0 && setPhase("pay")} disabled={!(Number(amount) > 0)}>Continue to card</Button>
      <p className="text-center text-xs text-muted-foreground">Secured by Stripe. Balance updates on success.</p>
    </div>
  )
}

// ───────────────────────────── Transfer (manual) ─────────────────────────────
const PROVIDERS = [
  { key: "PayPal", to: "admin@embroiderygoods.com", hint: "Send to this PayPal, then submit — we credit your wallet once it lands." },
  { key: "PingPong", to: null, hint: "Submit and we'll email you the PingPong beneficiary details." },
  { key: "LianLian", to: null, hint: "Submit and we'll email you the LianLian beneficiary details." },
  { key: "Payoneer", to: null, hint: "Submit and we'll email you the Payoneer details." },
]
function TransferTopUp({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState(PROVIDERS[0])
  const [amount, setAmount] = useState("50")
  const [ref, setRef] = useState("")
  const [phase, setPhase] = useState<"form" | "sent">("form")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const submit = async () => {
    const amt = Number(amount) || 0
    if (amt <= 0) { setError("Enter an amount."); return }
    setSaving(true); setError(null)
    try {
      const r = await createTopupRequest({ amount: amt, method: provider.key, ref: ref.trim() || undefined })
      if (r.error) throw new Error(r.error)
      setPhase("sent")
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

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Amount (USD)</span>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="50" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Reference / transaction note (optional)</span>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. your PayPal transaction ID" />
      </label>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button className="w-full" onClick={submit} disabled={saving}>{saving ? "Submitting…" : "I've sent it — submit request"}</Button>
      <p className="text-center text-xs text-muted-foreground">{provider.hint}</p>
    </div>
  )
}

// ───────────────────────────── Dialog ─────────────────────────────
export function TopUpDialog({ open, onOpenChange, onFunded }: { open: boolean; onOpenChange: (v: boolean) => void; onFunded: () => void }) {
  const close = () => onOpenChange(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add funds</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="vietqr">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="vietqr">VietQR</TabsTrigger>
            <TabsTrigger value="card">Card</TabsTrigger>
            <TabsTrigger value="transfer">Transfer</TabsTrigger>
          </TabsList>
          <TabsContent value="vietqr" className="mt-4">
            <VietqrTopUp onFunded={onFunded} onClose={close} />
          </TabsContent>
          <TabsContent value="card" className="mt-4">
            <CardTopUp onFunded={onFunded} onClose={close} />
          </TabsContent>
          <TabsContent value="transfer" className="mt-4">
            <TransferTopUp onClose={close} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
