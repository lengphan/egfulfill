"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { CircleNotch, CheckCircle, Warning, UploadSimple, X } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPayoutMethod, savePayoutMethod, createPayoutRequest, type PayoutMethod } from "@/lib/api"

const usd = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Three channels. PingPong/LianLian each take a single account id (email/id). "Bank QR" is
// the richer one — account fields plus an optional uploaded bank QR image.
const METHODS = [
  { id: "pingpong", label: "PingPong" },
  { id: "lianlian", label: "LianLian" },
  { id: "bank", label: "Bank QR" },
]
const blankFor = (type: string): PayoutMethod => ({ type, account_name: "", account_id: "", account_number: "", bank_name: "", note: "", qr: "" })
const BLANK = blankFor("bank")
// Prefer Bank QR when picking which saved method to open on.
const firstSavedType = (m: Record<string, PayoutMethod>) => ["bank", "pingpong", "lianlian"].find((t) => m[t]) || "bank"

/**
 * Seller withdrawal. No bank API — the seller saves their payout details (which channel +
 * account, or an uploaded VietQR image) and requests an amount. It becomes a PENDING payout
 * that admin/warehouse pay by hand and mark Paid (which debits the wallet). Details + amount
 * live in one dialog so a first-time withdrawal is a single pass.
 */
export function PayoutDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const tl = useLabelT()
 const [info, setInfo] = useState<PayoutMethod>({ ...BLANK })
  // Saved details per method, so switching the dropdown prefills the right one.
 const [saved, setSaved] = useState<Record<string, PayoutMethod>>({})
  // Opt-in: remember these details for next time (default on).
 const [remember, setRemember] = useState(true)
  // max === 0 means "no fixed ceiling — the balance is the cap" (admin-configurable).
 const [bounds, setBounds] = useState<{ min: number; max: number; balance: number }>({ min: 10, max: 0, balance: 0 })
 const [amount, setAmount] = useState("")
 const [busy, setBusy] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [done, setDone] = useState(false)
 const [zoom, setZoom] = useState(false)   // lightbox for the uploaded QR

 const load = useCallback(() => {
 getPayoutMethod()
      .then((r) => {
 const methods = r.methods || {}
 setSaved(methods)
        // Open on a saved method if there is one, prefilled; else a blank Bank QR.
 const t = firstSavedType(methods)
 setInfo(methods[t] ? { ...blankFor(t), ...methods[t] } : blankFor(t))
 setBounds({ min: r.min, max: r.max, balance: r.balance })
      })
      .catch(() => {})
  }, [])
 useEffect(() => {
 if (!open) return
    // Deferred: this codebase's lint rule rejects a straight setState in an effect body.
 const t = setTimeout(() => { setErr(null); setDone(false); setZoom(false); load() }, 0)
 return () => clearTimeout(t)
  }, [open, load])

 const set = (k: keyof PayoutMethod, v: string) => setInfo((i) => ({ ...i, [k]: v }))
  // Switching method loads THAT method's saved details (or a blank form for it).
 const changeMethod = (t: string) => setInfo(saved[t] ? { ...blankFor(t), ...saved[t] } : blankFor(t))
 const onFile = (f?: File) => {
 if (!f) return
 if (f.size > 2 * 1024 * 1024) { setErr("That image is over 2 MB — please use a smaller QR image."); return }
 const r = new FileReader()
 r.onload = () => setInfo((i) => ({ ...i, qr: String(r.result) }))
 r.readAsDataURL(f)
  }

 const type = info.type || "bank"
  // Enough to pay it: the holder's name, plus the account number (Bank QR) or the account
  // id (PingPong/LianLian). Bank name + QR image are optional extras.
 const detailsOk = !!info.account_name?.trim() && (
 type === "bank" ? !!info.account_number?.trim() : !!info.account_id?.trim()
  )
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
      // Save for reuse only if asked; either way the request carries the details for THIS
      // payout, so an unsaved one-off still works.
 if (remember) {
 const s = await savePayoutMethod(info)
 if (s.error) { setErr(s.error); return }
      }
 const r = await createPayoutRequest(amt, info.note?.trim() || undefined, info)
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
        <DialogHeader><DialogTitle>{tl("payout", "Request a payout")}</DialogTitle></DialogHeader>

        {done ? (
          <div className="space-y-3 py-2 text-center">
            <CheckCircle size={40} weight="fill" className="mx-auto text-shipped" />
            <div className="font-medium">{tl("payout", "Payout requested")}</div>
            <p className="text-sm text-muted-foreground">{tl("payout", "Admin will review your details and pay it out. You’ll see it in your wallet history once paid.")}</p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>{tl("payout", "Done")}</Button>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Payout details */}
            <div className="space-y-2.5">
              <div className="eg-label text-muted-foreground">{tl("payout", "Your payout details")}</div>
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-muted-foreground">{tl("payout", "Method")}</span>
                <select value={type} onChange={(e) => changeMethod(e.target.value)} className="eg-select h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  {METHODS.map((m) => <option key={m.id} value={m.id}>{tl("payout", m.label)}{saved[m.id] ? tl("payout", " · saved") : ""}</option>)}
                </select>
              </label>
              <Input placeholder={tl("payout", "Account holder name")} value={info.account_name || ""} onChange={(e) => set("account_name", e.target.value)} className="h-9" />

              {type === "bank" ? (
                <>
                  <div className="flex gap-2">
                    <Input placeholder={tl("payout", "Account number")} value={info.account_number || ""} onChange={(e) => set("account_number", e.target.value)} className="h-9 flex-1" />
                    <Input placeholder={tl("payout", "Bank name")} value={info.bank_name || ""} onChange={(e) => set("bank_name", e.target.value)} className="h-9 flex-1" />
                  </div>
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">{tl("payout", "Bank QR code (optional)")}</div>
                    {info.qr ? (
                      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
                        {/* Click to enlarge — a QR scanned off a phone is unreadable at thumbnail size. */}
                        <button type="button" onClick={() => setZoom(true)} className="group relative overflow-hidden rounded-lg" title={tl("payout", "Click to enlarge")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={info.qr} alt={tl("payout", "Your bank QR code")} className="size-40 rounded-lg border border-border bg-white object-contain" />
                          <span className="absolute inset-0 flex items-center justify-center gap-1 bg-black/0 text-2xs font-medium text-transparent transition group-hover:bg-black/45 group-hover:text-white">
                            {tl("payout", "Enlarge")}
                          </span>
                        </button>
                        <Button variant="outline" size="sm" onClick={() => set("qr", "")}><X size={14} /> {tl("payout", "Remove")}</Button>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent">
                        <UploadSimple size={20} weight="bold" />
                        {tl("payout", "Upload your bank QR code")}
                        <span className="text-2xs">{tl("payout", "PNG or JPG · up to 2 MB")}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                      </label>
                    )}
                  </div>
                </>
              ) : (
                <Input placeholder={type === "pingpong" ? tl("payout", "PingPong email or ID") : tl("payout", "LianLian email or ID")} value={info.account_id || ""} onChange={(e) => set("account_id", e.target.value)} className="h-9" />
              )}

              <Input placeholder={tl("payout", "Note (optional)")} value={info.note || ""} onChange={(e) => set("note", e.target.value)} className="h-9" />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              {tl("payout", "Save these details for next time")}
            </label>

            {/* Amount */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="eg-label text-muted-foreground">{tl("payout", "Amount")}</div>
                <button onClick={() => setAmount(String(Math.max(0, Math.floor(ceiling))))} disabled={ceiling < bounds.min} className="text-xs font-medium text-primary hover:underline disabled:opacity-40">{tl("payout", "Withdraw all")}</button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input type="number" min={bounds.min} max={ceiling || undefined} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-10 pl-6 text-lg font-semibold tabular-nums" />
              </div>
              <p className="text-2xs text-muted-foreground">Balance {usd(bounds.balance)} · min {usd(bounds.min)}{bounds.max > 0 ? ` · max ${usd(bounds.max)}` : ""}</p>
              {amountErr && <p className="text-2xs font-medium text-hold">{amountErr}</p>}
            </div>

            {err && <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"><Warning size={13} weight="fill" className="mt-0.5 shrink-0" /> {err}</div>}
            <Button className="w-full" onClick={submit} disabled={busy || !detailsOk || amt < bounds.min || !!amountErr}>
              {busy ? <><CircleNotch size={14} className="animate-spin" /> {tl("payout", "Submitting…")}</> : `Request ${amt >= bounds.min ? usd(amt) : "payout"}`}
            </Button>
          </div>
        )}

        {/* Full-size QR lightbox — click anywhere to close. */}
        {zoom && info.qr && (
          <div onClick={() => setZoom(false)} className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-black/70 p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={info.qr} alt={tl("payout", "Bank QR code")} className="max-h-[80vh] max-w-[90vw] rounded-xl border border-white/10 bg-white object-contain p-2" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
