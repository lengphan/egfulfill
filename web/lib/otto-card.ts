import { getUser } from "@/lib/auth"

export type CardDetails = { name: string; card_number: string; cvv: string; exp_date: string }

/**
 * THE CARD OTTO ASK FOR ON EVERY ORDER — kept in THIS BROWSER, never on our server.
 *
 * Otto have no saved-card API. Unlike S&S, who register a card once and hand back an opaque
 * profileID, Otto reject a credit-card order that arrives without the full number, CVV and
 * expiry — so something has to supply all four on every single order. Until now that was a
 * dialog at placement, which is exactly what it looked like: the same card typed again for
 * every purchase.
 *
 * So it is entered ONCE, in Order settings › Payment, and it lives in this browser's
 * localStorage. That placement is the whole point and it is deliberate:
 *
 *   - NOT the database. A PAN at rest in Postgres puts this server inside PCI DSS scope,
 *     and it would land in every nightly pg_dump and every R2 backup. A CVV may never be
 *     stored server-side by anyone, encrypted or not — the card networks prohibit it
 *     outright. Neither is a rule we can accept and then work around.
 *   - The browser is the buyer's own machine, the same place their password manager keeps
 *     it. What changes here is only WHO holds it: them, not us.
 *
 * What that costs, stated plainly rather than buried: localStorage is readable by any
 * script on this origin, so an XSS on the app reaches it. It is per-browser, so a card
 * saved on the office desktop is not on the laptop. And it is keyed to the signed-in user
 * id, so the next person to sign in on a shared floor terminal doesn't inherit it — but
 * anyone with that machine unlocked and that session open can send an order with it.
 *
 * Nothing about the WIRE changes: the card is attached to that one order request, and the
 * server still strips it from everything it echoes back, so it never reaches
 * purchase_orders.meta.
 */
const KEY = "eg_otto_card"

const storeKey = () => `${KEY}:${getUser()?.id ?? "anon"}`

/** Luhn check, so an obvious typo is caught here rather than as a supplier rejection. */
export function luhnOk(n: string) {
  let sum = 0, alt = false
  for (let i = n.length - 1; i >= 0; i--) {
    let d = parseInt(n[i], 10)
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d; alt = !alt
  }
  return n.length > 0 && sum % 10 === 0
}

/** What's still wrong with these fields, in the reader's words. Empty means send it. */
export function cardProblems(c: Partial<CardDetails>): string[] {
  const digits = (c.card_number ?? "").replace(/\D/g, "")
  const cvv = (c.cvv ?? "").replace(/\D/g, "")
  const errs: string[] = []
  if (!(c.name ?? "").trim()) errs.push("Name on the card")
  if (digits.length < 13 || digits.length > 19 || !luhnOk(digits)) errs.push("A valid card number")
  if (cvv.length < 3 || cvv.length > 4) errs.push("A 3 or 4 digit CVV")
  if (!/^\d{2}\/\d{2,4}$/.test((c.exp_date ?? "").trim())) errs.push("Expiry as MM/YY")
  return errs
}

/**
 * Has this card's expiry month passed?
 *
 * A card expires at the END of its month, so 05/28 is good through 31 May 2028. Checked
 * because a saved card outlives the moment it was typed — an expired one sent silently
 * comes back as an Otto rejection that reads like a broken integration.
 */
export function cardExpired(exp: string): boolean {
  const m = /^(\d{2})\/(\d{2,4})$/.exec((exp ?? "").trim())
  if (!m) return false
  const month = Number(m[1])
  if (month < 1 || month > 12) return false
  const yr = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  // First instant of the following month.
  return new Date(yr, month, 1).getTime() <= Date.now()
}

/**
 * EXPIRY, TYPED AS DIGITS.
 *
 * Nobody should have to reach for "/" on a phone keypad to enter a date, and every card
 * form in the world takes the slash for granted. Type 0528 and get 05/28; the separator is
 * inserted as soon as the month is complete and removed again if you backspace into it.
 *
 * A leading digit above 1 is a month on its own — typing 5 means May, so it becomes 05/
 * rather than waiting for a second digit that would make no valid month.
 */
export function formatExpiry(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "").slice(0, 6)
  if (!d) return ""
  if (d.length === 1) return Number(d) > 1 ? `0${d}/` : d
  const mm = d.slice(0, 2)
  const yy = d.slice(2)
  return yy ? `${mm}/${yy}` : `${mm}/`
}

/** Last four only — the most that ever needs to be on screen to recognise a card. */
export function maskNumber(n: string): string {
  const d = (n ?? "").replace(/\D/g, "")
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : "••••"
}

/** The card saved in this browser, or null. Never throws — a blocked store is just "none". */
export function loadCard(): CardDetails | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(storeKey())
    if (!raw) return null
    const c = JSON.parse(raw) as CardDetails
    return cardProblems(c).length ? null : c
  } catch {
    return null
  }
}

/** The saved card only if it can actually be sent — a lapsed one is not silently used. */
export function usableCard(): CardDetails | null {
  const c = loadCard()
  return c && !cardExpired(c.exp_date) ? c : null
}

export function saveCard(c: CardDetails) {
  try {
    localStorage.setItem(storeKey(), JSON.stringify({
      name: c.name.trim(),
      card_number: c.card_number.replace(/\D/g, ""),
      cvv: c.cvv.replace(/\D/g, ""),
      exp_date: c.exp_date.trim(),
    }))
  } catch {
    /* a blocked store means the placement dialog asks instead — not an error worth raising */
  }
}

export function clearCard() {
  try { localStorage.removeItem(storeKey()) } catch { /* ignore */ }
}