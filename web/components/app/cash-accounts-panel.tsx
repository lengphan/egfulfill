"use client"

import { useCallback, useEffect, useState } from "react"
import { Bank, CreditCard, ArrowsClockwise, CircleNotch, Warning } from "@phosphor-icons/react"
import { Card } from "@/components/ui/card"
import { usePrompt } from "@/components/app/confirm-dialog"
import {
  getCashAccounts, saveCashAccount, reconcileCashAccount, recordCashPayment,
  type CashAccountsView,
} from "@/lib/api"

const usd = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The rails money arrives on, offered as one-click setup so the ids match what the server
 *  maps top-up methods onto (RAIL_TO_ACCOUNT). A PingPong account has to BE `pingpong`. */
const SUGGESTED = [
  { id: "pingpong", name: "PingPong", kind: "rail" },
  { id: "lianlian", name: "LianLian", kind: "rail" },
  { id: "paypal", name: "PayPal", kind: "rail" },
  { id: "vietqr", name: "VietQR", kind: "rail" },
]

/**
 * WHERE THE MONEY ACTUALLY IS.
 *
 * The wallet below answers "what has moved through the platform". This answers the question
 * that used to need three browser tabs: how much is in PingPong, and what is on the card
 * Shippo charges.
 *
 * Balances are DERIVED — opening plus everything attributed — so nobody maintains them. They
 * still drift, because a rail takes a fee and a card gets used elsewhere, so Reconcile
 * records the difference as its own entry rather than overwriting the history that produced
 * it. The gap is the point: it is money that moved without the platform seeing it.
 */
export function CashAccountsPanel() {
  const [view, setView] = useState<CashAccountsView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const prompt = usePrompt()

  const load = useCallback(() => {
    getCashAccounts().then(setView).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't read accounts."))
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const add = async (seed?: { id: string; name: string; kind: string }) => {
    const name = seed?.name ?? await prompt({ title: "New account", body: "What is it called? e.g. US Bank ····4471", placeholder: "US Bank ····4471" })
    if (!name) return
    // The id is the key the server maps payment rails onto, so a suggested rail keeps its
    // slug; anything typed gets a slug derived from its name.
    const id = seed?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)
    const opening = await prompt({ title: `Opening balance for ${name}`, body: "What is in it right now? Leave blank for zero.", placeholder: "0.00" })
    if (opening === null) return
    // A rail is always a rail. Anything else is a card if it names one, because that is what
    // decides whether it can be the postage account — and typing "Visa ····1241" and then
    // being unable to charge postage to it would be a dead end with no explanation.
    const kind = seed?.kind ?? (/visa|mastercard|amex|card|credit|debit|\d{4}$/i.test(name) ? "card" : "bank")
    setBusy(id)
    try { await saveCashAccount({ id, name, kind, opening: Number(opening) || 0 }); load() }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save that account.") }
    finally { setBusy(null) }
  }

  const reconcile = async (id: string, name: string, shown: number) => {
    const actual = await prompt({
      title: `Reconcile ${name}`,
      body: `We think it holds ${usd(shown)}. What does it really hold? The difference is recorded as its own entry, so nothing is overwritten.`,
      placeholder: shown.toFixed(2),
    })
    if (actual === null || actual === "") return
    setBusy(id)
    try {
      const r = await reconcileCashAccount(id, Number(actual))
      if (r.adjustment) setErr(null)
      load()
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reconcile.") }
    finally { setBusy(null) }
  }

  /** Mark this card as the one Shippo charges. The server clears the flag from any other,
   *  because attribution has to have exactly one answer. */
  const setPostage = async (a: { id: string; name: string; kind: string; opening: number }) => {
    setBusy(a.id)
    try { await saveCashAccount({ id: a.id, name: a.name, kind: a.kind, opening: a.opening, isPostage: true }); load() }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't set the postage card.") }
    finally { setBusy(null) }
  }

  const pay = async (id: string, name: string, direction: "in" | "out") => {
    const amount = await prompt({
      title: direction === "in" ? `Money into ${name}` : `Money out of ${name}`,
      body: "Recorded on the ledger against this account.",
      placeholder: "0.00",
    })
    if (!amount) return
    const note = await prompt({ title: "What was it for?", placeholder: direction === "in" ? "Transfer from PingPong" : "Supplier payment" })
    if (note === null) return
    setBusy(id)
    try { await recordCashPayment(id, { amount: Number(amount), direction, note }); load() }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't record that payment.") }
    finally { setBusy(null) }
  }

  // Both quiet states stay one line: this block sits above the P&L and must never push it
  // down to report on itself.
  if (err && !view) {
    return (
      <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Warning size={12} weight="fill" className="shrink-0 text-amber-500" /> {err}
      </p>
    )
  }
  if (!view) {
    return (
      <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <CircleNotch size={12} className="animate-spin" /> Accounts…
      </p>
    )
  }

  const missing = SUGGESTED.filter((sg) => !view.accounts.some((a) => a.id === sg.id))

  /**
   * ONE THIN STRIP across the top.
   *
   * This has been three shapes. A grid of tall cards took two bands before the numbers
   * anyone came for. A side column was worse: as a sibling of the whole dashboard it
   * squeezed the P&L from four cards to two, narrowed the transaction table, and left the
   * space under five accounts dead.
   *
   * What made the first version tall was the CARD SIZE and giving every unset rail one.
   * Halve the cards, turn the rails into chips, and the whole set is a single strip — so it
   * can sit above and full width without taking the page.
   *
   * Still smaller than the P&L cards: text-base against text-3xl. These are reference
   * figures; that is the headline. Same language, lower voice.
   */
  /**
   * A TINTED REGION, not a new colour.
   *
   * These need to read as a different KIND of thing from the P&L beside them — money that
   * exists, against money that moved — but the palette's hues are spoken for: emerald is
   * shipped, amber is on hold, red is an alert, violet is working. A fifth hue here would
   * mean nothing while sitting next to four that mean something, and start eroding them.
   *
   * So the separation is a muted GROUND with white cards on it, which is the same device
   * the order panel already uses. Different region, no new vocabulary.
   */
  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-2.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Accounts</span>
        <button onClick={() => add()} className="eg-tap text-2xs font-medium text-primary hover:underline">+ Add</button>
      </div>

      {/* Across, not down — six to a row on a wide screen, so five accounts and an
          Unassigned line are ONE strip rather than a column with dead space beneath it. */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {view.accounts.map((a) => (
        // group/acct so the controls stay out of sight until this card is pointed at — three
        // buttons on every card is a wall of chrome on a figure you mostly just read.
        <Card key={a.id} className="group/acct gap-0 px-3 py-2">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            {a.kind === "card" ? <CreditCard size={11} /> : <Bank size={11} />}
            <span className="truncate">{a.name}</span>
            {a.is_postage && <span className="ml-auto shrink-0 rounded bg-primary/10 px-1 text-3xs normal-case text-primary">postage</span>}
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className={"text-base font-bold tracking-tight tabular-nums " + (a.balance < 0 ? "text-red-600 dark:text-red-400" : "")}>
              {usd(a.balance)}
            </span>
            <span className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/acct:opacity-100">
              <button onClick={() => pay(a.id, a.name, "in")} disabled={busy === a.id}
                className="eg-tap rounded border border-border px-1 text-2xs leading-4 hover:bg-accent" title="Money in">+</button>
              <button onClick={() => pay(a.id, a.name, "out")} disabled={busy === a.id}
                className="eg-tap rounded border border-border px-1 text-2xs leading-4 hover:bg-accent" title="Money out">−</button>
              <button onClick={() => reconcile(a.id, a.name, a.balance)} disabled={busy === a.id}
                className="eg-tap rounded border border-border px-1 text-2xs leading-4 hover:bg-accent" title="Set the real balance">
                {busy === a.id ? <CircleNotch size={9} className="animate-spin" /> : <ArrowsClockwise size={9} />}
              </button>
              {/* WHICH CARD SHIPPO CHARGES. Named once here, and every label cost places
                  itself against it from then on — the alternative is choosing an account on
                  every label, which nobody would do and which would leave postage in
                  Unassigned forever. Only offered on a card, because postage is charged to
                  one; marking a bank would attribute spend to a place it never left. */}
              {a.kind === "card" && !a.is_postage && (
                <button onClick={() => setPostage(a)} disabled={busy === a.id}
                  className="eg-tap rounded border border-border px-1 text-2xs leading-4 hover:bg-accent"
                  title="Charge postage to this card">$</button>
              )}
            </span>
          </div>
        </Card>
      ))}

      {view.unassigned.entries > 0 && (
        <Card className="gap-0 border-dashed px-3 py-2">
          <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Unassigned</div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-base font-bold tabular-nums">{usd(view.unassigned.amount)}</span>
            <span className="text-3xs text-muted-foreground">{view.unassigned.entries} entries</span>
          </div>
        </Card>
      )}
      </div>

      {/* The rails not yet added, as ONE line rather than a card each — an unset account is
          a prompt, not a figure, and giving each its own card put empty boxes on equal
          footing with real balances. The one-click id still matters: a hand-typed
          "Ping Pong" becomes `ping-pong` and then silently receives nothing. */}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5 text-3xs text-muted-foreground">
          <span>Add:</span>
          {missing.map((sg) => (
            <button key={sg.id} onClick={() => add(sg)} disabled={busy === sg.id}
              className="eg-tap rounded border border-dashed border-border px-1.5 py-0.5 font-medium transition-colors hover:border-primary hover:text-foreground">
              {sg.name}
            </button>
          ))}
        </div>
      )}

      {err && <p className="text-2xs text-amber-700 dark:text-amber-400">{err}</p>}
    </div>
  )
}
