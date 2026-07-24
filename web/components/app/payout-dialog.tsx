"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, CheckCircle, Warning, UploadSimple, X } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPayoutMethod, savePayoutMethod, createPayoutRequest, type PayoutMethod } from "@/lib/api"

const usd = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// One channel: a Vietnam bank transfer. The account fields are what a payout is made
// against; a bank QR image is an optional convenience on top.
const BLANK: PayoutMethod = { type: "bank", account_name: "", account_number: "", bank_name: "", note: "", qr: "" }

/**
 * Seller withdrawal. No bank API — the seller saves their payout details (which channel +
 * account, or an uploaded VietQR image) and requests an amount. It becomes a PENDING payout
 * that admin/warehouse pay by hand and mark Paid (which debits the wallet). Details + amount
 * live in one dialog so a first-time withdrawal is a single pass.
 */
export function PayoutDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [info, setInfo] = useState<PayoutMethod>({ ...BLANK })
  // max === 0 means "no fixed ceiling — the balance is the cap" (admin-configurable).
  const [bounds, setBounds] = useState<{ min: number; max: number; balance: number }>({ min: 10, max: 0, balance: 0 })
  const [amount, setAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const load = useCallback(() => {
    getPayoutMethod()
      .then((r) => {
        if (r.info) setInfo({ ...BLANK, ...r.info })
        setBounds({ min: r.min, max: r.max, balance: r.balance })
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!open) return
    // Deferred: this codebase's lint rule rejects a straight setState in an effect body.
    const t = setTimeout(() => { setErr(null); setDone(false); load() }, 0)
    return () => clearTimeout(t)
  }, [open, load])

  const set = (k: keyof PayoutMethod, v: string) => setInfo((i) => ({ ...i, [k]: v }))
  const onFile = (f?: File) => {
    if (!f) return
    if (f.size > 2 * 1024 * 1024) { setErr("That image is over 2 MB — please use a smaller QR image."); return }
    const r = new FileReader()
    r.onload = () => setInfo((i) => ({ ...i, qr: String(r.result) }))
    r.readAsDataURL(f)
  }

  // Enough to pay it: the account holder's name and account number. Bank name + QR image
  // are optional extras.
  const detailsOk = !!info.account_name?.trim() && !!info.account_number?.trim()
  const amt = Number(amount) || 0
  // What the seller can actually take: their balance, further limited by an admin max if
  // one is set (max === 0 → balance is the only ceiling).
  const ceiling = bounds.max > 0 ? Math.min(bounds.max, bounds.balance) : bounds.balance
  const amountErr =
    amt <= 0 ? null :
    amt < bounds.min ? `Minimum payout is ${usd(bounds.min)}.` :
    (bounds.max > 0 && amt > bounds.max) ? `Maximum payout is ${usd(bounds.max)}.` :
    amt > bounds.balance ? `You can withdraw up to ${usd(bounds.balance)}.` : null

  const submit = async () => {
    setErr(null)
    if (!detailsOk) { setErr("Fill in your payout details first."); return }
    // amountErr already encodes min / admin-max / balance (max 0 = balance-only); a zero
    // amount has no error but still can't be submitted.
    if (!amt || amountErr) { setErr(amountErr || "Enter an amount to withdraw."); return }
    setBusy(true)
    try {
      const s = await savePayoutMethod(info)
      if (s.error) { setErr(s.error); return }
      const r = await createPayoutRequest(amt, info.note?.trim() || undefined)
      if (r.error) { setErr(r.error); return }
      setDone(true)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't submit the payout request.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Request a payout</DialogTitle></DialogHeader>

        {done ? (
          <div className="space-y-3 py-2 text-center">
            <CheckCircle size={40} weight="fill" className="mx-auto text-emerald-500" />
            <div className="font-medium">Payout requested</div>
            <p className="text-sm text-muted-foreground">Admin will review your details and pay it out. You&apos;ll see it in your wallet history once paid.</p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Payout details */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your payout details</div>
              <p className="text-[11px] text-muted-foreground">Vietnam bank transfer — the account admin pays your payout into.</p>
              <Input placeholder="Account holder name" value={info.account_name || ""} onChange={(e) => set("account_name", e.target.value)} className="h-9" />
              <div className="flex gap-2">
                <Input placeholder="Account number" value={info.account_number || ""} onChange={(e) => set("account_number", e.target.value)} className="h-9 flex-1" />
                <Input placeholder="Bank name" value={info.bank_name || ""} onChange={(e) => set("bank_name", e.target.value)} className="h-9 flex-1" />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Bank QR code (optional)</div>
                {info.qr ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={info.qr} alt="Your bank QR code" className="size-20 rounded-lg border border-border object-contain" />
                    <Button variant="outline" size="sm" onClick={() => set("qr", "")}><X size={14} /> Remove</Button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground transition-colors hover:bg-accent">
                    <UploadSimple size={16} /> Upload your bank QR code
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                  </label>
                )}
              </div>
              <Input placeholder="Note (optional)" value={info.note || ""} onChange={(e) => set("note", e.target.value)} className="h-9" />
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount</div>
                <button onClick={() => setAmount(String(Math.max(0, Math.floor(ceiling))))} disabled={ceiling < bounds.min} className="text-xs font-medium text-primary hover:underline disabled:opacity-40">Withdraw all</button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input type="number" min={bounds.min} max={ceiling || undefined} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-10 pl-6 text-lg font-semibold tabular-nums" />
              </div>
              <p className="text-[11px] text-muted-foreground">Balance {usd(bounds.balance)} · min {usd(bounds.min)}{bounds.max > 0 ? ` · max ${usd(bounds.max)}` : ""}</p>
              {amountErr && <p className="text-[11px] font-medium text-amber-700">{amountErr}</p>}
            </div>

            {err && <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"><Warning size={13} weight="fill" className="mt-0.5 shrink-0" /> {err}</div>}
            <Button className="w-full" onClick={submit} disabled={busy || !detailsOk || amt < bounds.min || !!amountErr}>
              {busy ? <><CircleNotch size={14} className="animate-spin" /> Submitting…</> : `Request ${amt >= bounds.min ? usd(amt) : "payout"}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
