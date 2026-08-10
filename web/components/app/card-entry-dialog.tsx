"use client"

import { useEffect, useState } from "react"
import { CreditCard, Warning, Lock } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type CardDetails = { name: string; card_number: string; cvv: string; exp_date: string }

/** Luhn check, so an obvious typo is caught here rather than as a supplier rejection. */
function luhnOk(n: string) {
  let sum = 0, alt = false
  for (let i = n.length - 1; i >= 0; i--) {
    let d = parseInt(n[i], 10)
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d; alt = !alt
  }
  return n.length > 0 && sum % 10 === 0
}

/**
 * Card entry for an Otto order.
 *
 * Otto have NO saved-card concept — unlike S&S, who register a card once and hand back a
 * profileID. Otto's API wants the full number, CVV and expiry on EVERY credit-card order,
 * so it has to be typed each time.
 *
 * Nothing here is stored. The card lives in this component's state, is sent with the one
 * order, and is discarded when the dialog closes. It is never written to a purchase
 * order, and the server strips it from every payload it echoes back — the CVV entirely,
 * since card networks prohibit keeping it in any form.
 *
 * That is not a limitation to work around later: a card number at rest in the database
 * would put the whole of it in PCI scope.
 */
export function CardEntryDialog({
  open, onOpenChange, onSubmit, amount,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSubmit: (card: CardDetails) => void
  amount?: number
}) {
  const [name, setName] = useState("")
  const [number, setNumber] = useState("")
  const [cvv, setCvv] = useState("")
  const [exp, setExp] = useState("")
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) return
    // Clear on close, always. A card left in state after the dialog shuts is a card
    // sitting in memory for no reason.
    const t = setTimeout(() => { setName(""); setNumber(""); setCvv(""); setExp(""); setTouched(false) }, 0)
    return () => clearTimeout(t)
  }, [open])

  const digits = number.replace(/\D/g, "")
  const cvvDigits = cvv.replace(/\D/g, "")
  const errs: string[] = []
  if (!name.trim()) errs.push("Name on the card")
  if (digits.length < 13 || digits.length > 19 || !luhnOk(digits)) errs.push("A valid card number")
  if (cvvDigits.length < 3 || cvvDigits.length > 4) errs.push("A 3 or 4 digit CVV")
  if (!/^\d{2}\/\d{2,4}$/.test(exp.trim())) errs.push("Expiry as MM/YY")

  const submit = () => {
    setTouched(true)
    if (errs.length) return
    onSubmit({ name: name.trim(), card_number: digits, cvv: cvvDigits, exp_date: exp.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CreditCard size={18} weight="fill" /> Card details</DialogTitle>
          <DialogDescription>
            Otto require the card on every order — they have no saved-card API.
            {/* The figure we hold is the PRODUCT subtotal, and Otto bill freight on top of
                it: a $3.60 order of caps came back charged at $21.35. Presenting the
                subtotal as "this order is $3.60" understates the card by the whole of the
                shipping, so it is named as the products and the rest is declared rather
                than left to be discovered on the statement. */}
            {amount
              ? ` Products $${amount.toFixed(2)} — Otto bill freight on top, charged to this card.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Name on card</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" autoComplete="off" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Card number</span>
            <Input
              value={number}
              // Grouped as you type — a 16-digit run is unreadable, and unreadable is
              // where a transposed digit hides.
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim())}
              inputMode="numeric" autoComplete="off" className="h-9 font-mono"
              placeholder="4111 1111 1111 1111"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Expiry</span>
              <Input value={exp} onChange={(e) => setExp(e.target.value.replace(/[^0-9/]/g, "").slice(0, 7))}
                     placeholder="03/28" inputMode="numeric" autoComplete="off" className="h-9 font-mono" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">CVV</span>
              <Input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                     inputMode="numeric" autoComplete="off" className="h-9 font-mono" />
            </label>
          </div>

          {touched && errs.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
              <span>{errs.join(" · ")}</span>
            </div>
          )}

          {/* Said plainly, because "will this be saved" is the reasonable question and the
              honest answer is a selling point rather than a caveat. */}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock size={13} weight="fill" className="mt-0.5 shrink-0" />
            Sent with this order only. Not saved here, not written to the purchase order, and
            stripped from anything the supplier sends back — so it has to be entered each time.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={touched && errs.length > 0}>
            <CreditCard size={13} weight="bold" /> Pay &amp; place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
