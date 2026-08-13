"use client"

import { useCallback, useEffect, useState } from "react"
import { Bank, CreditCard, ArrowsClockwise, Plus, CircleNotch, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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

  if (err && !view) {
    return (
      <SectionCard title="Accounts">
        <div className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
          <span>{err}</span>
        </div>
      </SectionCard>
    )
  }
  if (!view) {
    return (
      <SectionCard title="Accounts">
        <div className="flex items-center justify-center py-10 text-muted-foreground"><CircleNotch size={20} className="animate-spin" /></div>
      </SectionCard>
    )
  }

  const missing = SUGGESTED.filter((sg) => !view.accounts.some((a) => a.id === sg.id))

  return (
    <SectionCard
      title="Accounts"
      actions={<Button size="sm" variant="outline" onClick={() => add()}><Plus size={14} weight="bold" /> Add account</Button>}
    >
      <div className="px-5 py-4">
        <p className="mb-3 text-xs text-muted-foreground">
          Where the money actually sits. Balances are worked out from what has been attributed to each
          account — reconcile one when the real balance has drifted.
        </p>

        {view.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts yet. Add the ones money arrives in and the card it goes out on.</p>
        ) : (
          <div className="rounded-lg border border-border">
            {view.accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5 last:border-b-0">
                <span className="text-muted-foreground">
                  {a.kind === "card" ? <CreditCard size={15} /> : <Bank size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="text-2xs text-muted-foreground">
                    {a.movements} movement{a.movements === 1 ? "" : "s"}
                    {a.opening ? ` · opened at ${usd(a.opening)}` : ""}
                  </span>
                </span>
                {a.is_postage && <Badge variant="secondary" className="bg-primary/10 text-primary">Postage card</Badge>}
                <span className={"w-28 shrink-0 text-right text-sm font-semibold tabular-nums " + (a.balance < 0 ? "text-red-600 dark:text-red-400" : "")}>
                  {usd(a.balance)}
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => pay(a.id, a.name, "in")} title="Record money in">+</Button>
                  <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => pay(a.id, a.name, "out")} title="Record money out">−</Button>
                  <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => reconcile(a.id, a.name, a.balance)} title="Set the real balance">
                    {busy === a.id ? <CircleNotch size={13} className="animate-spin" /> : <ArrowsClockwise size={13} />}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* UNASSIGNED IS A LINE, not a silence. Money the platform has seen but nobody has
            placed — counted in the total, because leaving it out would make the total look
            complete while being wrong. */}
        {view.unassigned.entries > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Unassigned</span>
              <span className="text-2xs text-muted-foreground">
                {view.unassigned.entries} entries with no account yet — attribute them from the ledger below
              </span>
            </span>
            <span className="w-28 shrink-0 text-right font-semibold tabular-nums">{usd(view.unassigned.amount)}</span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm font-medium">Across all accounts</span>
          <span className="text-base font-bold tabular-nums">{usd(view.total)}</span>
        </div>

        {/* One-click setup for the rails, because their ids have to match what the server
            maps a top-up's method onto — typing "Ping Pong" would create `ping-pong` and
            silently never receive anything. */}
        {missing.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Add a rail:</span>
            {missing.map((sg) => (
              <button key={sg.id} onClick={() => add(sg)} disabled={busy === sg.id}
                className="eg-tap rounded-md border border-border px-2 py-1 font-medium transition-colors hover:bg-accent hover:text-foreground">
                {sg.name}
              </button>
            ))}
          </div>
        )}

        {err && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{err}</p>}
      </div>
    </SectionCard>
  )
}
