"use client"

import { useEffect, useState } from "react"
import { CreditCard, Warning, CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  cardExpired, cardProblems, clearCard, loadCard, maskNumber, saveCard, type CardDetails,
  formatExpiry,
} from "@/lib/otto-card"

/**
 * Otto's card, entered once here instead of at every placement.
 *
 * Otto require the number, CVV and expiry on EVERY credit-card order and expose no saved-card
 * token, so the choice was never "store it or don't" — it was "type it every order, or keep it
 * somewhere". It is kept in this browser and never sent to our server for storage; see
 * lib/otto-card.ts for why that line is drawn there and what it costs.
 *
 * The same block appears in Order settings › Payment and in Settings › Supplier ordering,
 * from this one component — two copies of a card form is how the two quietly disagree about
 * which one the order actually uses.
 */
export function OttoCardOnFile({ compact = false, onSaved }: {
  compact?: boolean
  /** Fired once the card is stored. The window it sits in closes on it — saving a card IS
   *  the errand, so leaving the dialog open afterwards makes you dismiss it yourself. */
  onSaved?: () => void
}) {
  const [saved, setSaved] = useState<CardDetails | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [number, setNumber] = useState("")
  const [cvv, setCvv] = useState("")
  const [exp, setExp] = useState("")
  const [touched, setTouched] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  // Read on mount only. The store is this tab's own localStorage, so nothing else moves it
  // underneath us.
  useEffect(() => {
    const t = setTimeout(() => {
      const c = loadCard()
      setSaved(c)
      setEditing(!c)
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const errs = cardProblems({ name, card_number: number, cvv, exp_date: exp })

  const commit = () => {
    setTouched(true)
    if (errs.length) return
    const c: CardDetails = {
      name: name.trim(),
      card_number: number.replace(/\D/g, ""),
      cvv: cvv.replace(/\D/g, ""),
      exp_date: exp.trim(),
    }
    saveCard(c)
    setSaved(c)
    setEditing(false)
    setTouched(false)
    // Cleared from component state the moment it's stored — no reason for a second copy of
    // the number to sit in React state behind a closed panel.
    setName(""); setNumber(""); setCvv(""); setExp("")
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2500)
    onSaved?.()
  }

  const remove = () => {
    clearCard()
    setSaved(null)
    setEditing(true)
    setName(""); setNumber(""); setCvv(""); setExp(""); setTouched(false)
  }

  const expired = saved ? cardExpired(saved.exp_date) : false

  return (
    <div className="space-y-2">
      <h4 className={"flex items-center gap-1.5 font-medium " + (compact ? "text-sm" : "text-sm")}>
        <CreditCard size={14} weight="fill" /> Card on file
      </h4>

      {saved && !editing ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="tabular-nums">{maskNumber(saved.card_number)}</span>
            <span className="text-muted-foreground">{saved.name}</span>
            <span className={expired ? "font-medium text-destructive" : "text-muted-foreground"}>
              {expired ? `expired ${saved.exp_date}` : saved.exp_date}
            </span>
            <span className="ml-auto flex gap-3 text-xs">
              <button onClick={() => setEditing(true)} className="font-medium text-primary hover:underline">Replace</button>
              <button onClick={remove} className="text-muted-foreground hover:text-destructive">Remove</button>
            </span>
          </div>
          {expired ? (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
              This card has expired, so it won&apos;t be sent — Otto orders will ask for a card again
              until it&apos;s replaced.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {/* AUTOFILL IS THE OTHER HALF OF THIS. The cc-* hints let Safari, Chrome and
              1Password fill all four in one click, so even entering it here is one action. */}
          <label className="block space-y-1">
            <span className="text-sm font-medium">Name on card</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9"
                   autoComplete="cc-name" name="ccname" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Card number</span>
            <Input
              value={number}
              // Grouped as you type — a 16-digit run is unreadable, and unreadable is where a
              // transposed digit hides.
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim())}
              inputMode="numeric" autoComplete="cc-number" name="cardnumber"
              className="h-9 tabular-nums" placeholder="4111 1111 1111 1111" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Expiry</span>
              <Input value={exp} onChange={(e) => setExp(formatExpiry(e.target.value))}
                     placeholder="03/28" inputMode="numeric" autoComplete="cc-exp" name="cc-exp"
                     className="h-9 tabular-nums" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">CVV</span>
              <Input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                     inputMode="numeric" autoComplete="cc-csc" name="cvc" className="h-9 tabular-nums" />
            </label>
          </div>

          {touched && errs.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
              <span>{errs.join(" · ")}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={commit} disabled={touched && errs.length > 0}>
              Save card
            </Button>
            {saved && (
              <button onClick={() => { setEditing(false); setTouched(false); setName(""); setNumber(""); setCvv(""); setExp("") }}
                      className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            )}
          </div>
        </div>
      )}

      {justSaved && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle size={13} weight="fill" /> Saved — Otto orders will stop asking.
        </p>
      )}

      {/* NO STANDING EXPLANATION HERE. Where the card lives and what we never keep is worth
          saying once, in the code and in the docs — not on screen every time someone glances
          at this panel. lib/otto-card.ts holds the reasoning. */}
    </div>
  )
}
