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
    setBusy(id)
    try { await saveCashAccount({ id, name, kind: seed?.kind ?? "bank", opening: Number(opening) || 0 }); load() }
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
   * CARDS, matching the P&L row below — the page already speaks in cards, and a bordered
   * list of full-width rows read as a settings table bolted on top of a dashboard.
   *
   * Deliberately SMALLER than those cards: p-3 against p-5, text-xl against text-3xl. These
   * are reference figures checked occasionally; the P&L underneath is the headline. Same
   * language, quieter voice — which is also why there is no SectionCard chrome around them,
   * so they read as part of the page rather than a second panel competing with it.
   */
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Accounts
        </span>
        <span className="flex items-center gap-2">
          {view.unassigned.entries > 0 && (
            <span className="text-2xs text-muted-foreground">
              {usd(view.unassigned.amount)} unassigned
            </span>
          )}
          <button onClick={() => add()}
            className="eg-tap text-2xs font-medium text-primary hover:underline">+ Account</button>
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {view.accounts.map((a) => (
          // group/acct so the actions can stay out of sight until this card is pointed at —
          // three controls on every card is a wall of buttons on a reference figure.
          <Card key={a.id} className="group/acct relative gap-0 p-3">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              {a.kind === "card" ? <CreditCard size={12} /> : <Bank size={12} />}
              <span className="truncate">{a.name}</span>
              {a.is_postage && <span className="ml-auto shrink-0 rounded bg-primary/10 px-1 py-0.5 text-3xs normal-case text-primary">postage</span>}
            </div>
            <div className={"mt-1.5 text-xl font-extrabold tracking-tight tabular-nums " + (a.balance < 0 ? "text-red-600 dark:text-red-400" : "")}>
              {usd(a.balance)}
            </div>
            <div className="mt-0.5 text-2xs text-muted-foreground">
              {a.movements ? `${a.movements} movement${a.movements === 1 ? "" : "s"}` : "no movements yet"}
            </div>
            <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover/acct:opacity-100 focus-within:opacity-100">
              <button onClick={() => pay(a.id, a.name, "in")} disabled={busy === a.id}
                className="eg-tap rounded border border-border px-1.5 py-0.5 text-2xs hover:bg-accent" title="Money in">+</button>
              <button onClick={() => pay(a.id, a.name, "out")} disabled={busy === a.id}
                className="eg-tap rounded border border-border px-1.5 py-0.5 text-2xs hover:bg-accent" title="Money out">−</button>
              <button onClick={() => reconcile(a.id, a.name, a.balance)} disabled={busy === a.id}
                className="eg-tap ml-auto inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs hover:bg-accent" title="Set the real balance">
                {busy === a.id ? <CircleNotch size={10} className="animate-spin" /> : <ArrowsClockwise size={10} />} Reconcile
              </button>
            </div>
          </Card>
        ))}

        {/* The rails, as empty cards rather than a row of links — an account you have not
            added yet still occupies a place in the answer, and its id has to match what the
            server maps a top-up's method onto. */}
        {missing.map((sg) => (
          <button key={sg.id} onClick={() => add(sg)} disabled={busy === sg.id}
            className="eg-tap flex min-h-[5.25rem] flex-col items-start justify-center rounded-xl border border-dashed border-border p-3 text-left transition-colors hover:border-primary hover:bg-accent/40">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{sg.name}</span>
            <span className="mt-1 text-xs text-muted-foreground">+ add this rail</span>
          </button>
        ))}
      </div>

      {err && <p className="text-2xs text-amber-700 dark:text-amber-400">{err}</p>}
    </div>
  )
}
