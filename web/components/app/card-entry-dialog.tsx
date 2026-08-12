"use client"

import { useEffect, useState } from "react"
import { CreditCard, Warning, Lock } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cardExpired, cardProblems, loadCard, saveCard, type CardDetails } from "@/lib/otto-card"

export type { CardDetails }

/**
 * Card entry for an Otto order — the FALLBACK, not the normal path.
 *
 * Otto have NO saved-card concept: unlike S&S, who register a card once and hand back a
 * profileID, Otto's API wants the full number, CVV and expiry on EVERY credit-card order.
 * That used to mean this window on every purchase, which is exactly what it felt like.
 *
 * The card is now entered once in Order settings › Payment and kept in the browser
 * (lib/otto-card.ts), and placement reads it from there — so this only opens when no
 * usable card is saved on this machine, or the saved one has expired. "Save in this
 * browser" below is the same store, so answering it once is the last time it appears.
 *
 * Nothing here reaches our server as storage: the card goes out with that one order, is
 * never written to a purchase order, and is stripped from every payload the server echoes
 * back — the CVV entirely, since card networks prohibit keeping it in any form.
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
  // Default ON: this dialog exists because the card wasn't on file, and leaving it off
  // means it opens again on the next order — the thing being fixed.
  const [remember, setRemember] = useState(true)

  /**
   * PREFILL FROM THE CARD ON FILE, when there is one.
   *
   * This window used to mean "there is no card", so starting empty was right. It no longer
   * does: a payment refusal reopens it with "Enter card & retry", and an EXPIRED card also
   * brings it back — in both cases a card exists and the person is being asked to retype
   * sixteen digits they already gave us. Filling them in makes the common fix "change the
   * expiry" or "just press place again", which is what those two cases actually need.
   */
  const [onFile, setOnFile] = useState<CardDetails | null>(null)
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const c = loadCard()
      setOnFile(c)
      if (!c) return
      setName(c.name)
      setNumber(c.card_number.replace(/(.{4})/g, "$1 ").trim())
      setExp(c.exp_date)
      setCvv(c.cvv)
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (open) return
    // Clear on close, always. A card left in state after the dialog shuts is a card
    // sitting in memory for no reason.
    const t = setTimeout(() => { setName(""); setNumber(""); setCvv(""); setExp(""); setTouched(false); setRemember(true) }, 0)
    return () => clearTimeout(t)
  }, [open])

  const digits = number.replace(/\D/g, "")
  const cvvDigits = cvv.replace(/\D/g, "")
  // Same rules the settings form uses — one definition, so a card accepted in one place
  // can't be rejected in the other.
  const errs = cardProblems({ name, card_number: number, cvv, exp_date: exp })

  const submit = () => {
    setTouched(true)
    if (errs.length) return
    const card: CardDetails = { name: name.trim(), card_number: digits, cvv: cvvDigits, exp_date: exp.trim() }
    if (remember) saveCard(card)
    onSubmit(card)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CreditCard size={18} weight="fill" /> Card details</DialogTitle>
          <DialogDescription>
            {/* WHY IT OPENED. It no longer appears on every order, so "Otto require a card"
                alone doesn't explain this particular window — the answer is that this
                browser has no usable card on file. */}
            {onFile
              ? (cardExpired(onFile.exp_date)
                  ? "The card saved in this browser has expired, so Otto won't take it. Update the expiry — the rest is filled in."
                  : "The card saved in this browser is filled in below. Change it if you're paying with a different one, or just place the order again.")
              : "No card is saved in this browser, so this order needs one."}{" "}
            Otto require it on every order and have no saved-card API.
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

        {/* AUTOFILL IS THE "REMEMBER MY CARD".
              Every field was autoComplete="off", which is what forced the whole number to
              be retyped for each order. Otto require card_details on every credit-card
              order — they answered a card-less one with "card_details: Card details
              required for credit card" — and they expose no saved-card token the way S&S
              do, so there is nothing safer for us to send instead.
              Storing it HERE is not the answer: a PAN at rest puts this server in PCI DSS
              scope, and a CVV may never be stored at all, by anyone, encrypted or not. The
              browser's own card store is exactly the right place — it is the reader's, not
              ours — so the fields now carry the standard cc-* hints and Safari, Chrome and
              1Password fill all four in one click. Nothing changes about what we keep:
              still nothing. */}
          <div className="space-y-3 py-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Name on card</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" autoComplete="cc-name" name="ccname" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Card number</span>
            <Input
              value={number}
              // Grouped as you type — a 16-digit run is unreadable, and unreadable is
              // where a transposed digit hides.
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim())}
              inputMode="numeric" autoComplete="cc-number" name="cardnumber" className="h-9 font-mono"
              placeholder="4111 1111 1111 1111"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Expiry</span>
              <Input value={exp} onChange={(e) => setExp(e.target.value.replace(/[^0-9/]/g, "").slice(0, 7))}
                     placeholder="03/28" inputMode="numeric" autoComplete="cc-exp" name="cc-exp" className="h-9 font-mono" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">CVV</span>
              <Input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                     inputMode="numeric" autoComplete="cc-csc" name="cvc" className="h-9 font-mono" />
            </label>
          </div>

          {touched && errs.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
              <span>{errs.join(" · ")}</span>
            </div>
          )}

          {/* The way out of this window. Ticked, the card goes to the same browser store
              Order settings › Payment writes, and placement reads it from there. */}
          <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                   className="mt-0.5 size-3.5 accent-[var(--primary)]" />
            <span>
              <strong className="text-foreground">Save in this browser</strong> so Otto orders stop
              asking. Change or remove it any time at <strong>Order settings › Payment</strong>.
            </span>
          </label>

          {/* Said plainly, because "will this be saved" is the reasonable question and the
              honest answer is short. */}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock size={13} weight="fill" className="mt-0.5 shrink-0" />
            {remember
              ? "Kept in this browser only — never on EGFUL's server, never written to the purchase order, and stripped from anything the supplier sends back."
              : "Sent with this order only. Not saved here, not written to the purchase order, and stripped from anything the supplier sends back — so the next Otto order will ask again."}
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
