"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, CheckCircle, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { addLedgerEntry, getEntryTypes, getUsers, type AdminUser } from "@/lib/api"

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`

/**
 * Write one row into the ledger by hand.
 *
 * For everything real money does that no integration covers — rent, a partner invoice
 * that arrived by email, a supplier paid by bank transfer, a goodwill credit. Without
 * this those movements simply never appear, and a balance that omits them is not a
 * balance, it's an estimate.
 *
 * TWO THINGS THIS DELIBERATELY MAKES HARD.
 *
 * The ledger is APPEND-ONLY: nothing written here can be edited or deleted, and a mistake
 * is corrected by writing its opposite. So the dialog confirms the exact signed amount and
 * account in words before it will submit — the difference between crediting and debiting
 * is one character, and by the time it's wrong it's permanent.
 *
 * And the reason is required, server-side too. This note is the only explanation that will
 * ever exist for the row; an entry nobody can account for later is indistinguishable from
 * a mistake, and the person reading it will be doing so months from now.
 */
export function LedgerEntryDialog({ open, onOpenChange, onDone }: {
 open: boolean
 onOpenChange: (v: boolean) => void
 onDone?: () => void
}) {
  // null = not loaded yet, [] = the load FAILED. Both are "no categories", and they must
  // not be conflated: an empty <select> with a state default still submits that default, so
  // a failed load would have booked "manual-expense" under a dropdown showing nothing.
 const [types, setTypes] = useState<{ id: string; label: string }[] | null>(null)
 const [typesErr, setTypesErr] = useState(false)
 const [users, setUsers] = useState<AdminUser[]>([])
 const [dir, setDir] = useState<1 | -1>(-1)
 const [amount, setAmount] = useState("")
 const [type, setType] = useState("manual-expense")
 const [account, setAccount] = useState("factory")
 const [note, setNote] = useState("")
 const [ref, setRef] = useState("")
 const [busy, setBusy] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [done, setDone] = useState<string | null>(null)
 const [confirming, setConfirming] = useState(false)

 const reset = useCallback(() => {
 setAmount(""); setNote(""); setRef(""); setErr(null); setDone(null); setConfirming(false)
 setTypes(null); setTypesErr(false)
  }, [])

 useEffect(() => {
 if (!open) return
 const t = setTimeout(() => {
 reset()
 getEntryTypes()
        .then((r) => { setTypes(r.types ?? []); setTypesErr(!(r.types ?? []).length) })
        .catch(() => { setTypes([]); setTypesErr(true) })
      // Sellers only — staff share the factory wallet, so listing them would offer
      // accounts that can't meaningfully hold a balance.
 getUsers().then((u) => setUsers((u ?? []).filter((x) => x.role === "seller"))).catch(() => setUsers([]))
    }, 0)
 return () => clearTimeout(t)
  }, [open, reset])

 const amt = Math.abs(Number(amount) || 0)
 const delta = dir * amt
 const accountLabel = account === "factory" ? "the house wallet"
 : account === "designer" ? "the designer pool"
 : users.find((u) => String(u.id) === account)?.email ?? "that seller"

 const submit = async () => {
 if (!amt) { setErr("Enter an amount."); return }
 if (note.trim().length < 3) { setErr("Add a reason — this lands in the ledger permanently."); return }
 if (!confirming) { setConfirming(true); setErr(null); return }
 setBusy(true); setErr(null)
 try {
 const r = await addLedgerEntry({
 account, delta, type, note: note.trim(),
        // A ref makes the write idempotent. Including the amount and a stamp means two
        // genuinely separate entries of the same kind on the same day still both land —
        // de-duping those would be worse than the double-submit it guards against.
 ref: ref.trim() || `manual-${type}-${amt}-${Date.now()}`,
      })
 if (r.error) throw new Error(r.error)
 setDone(r.duplicate
        ? "That exact entry was already recorded — nothing was written twice."
 : `Recorded. ${accountLabel} is now ${typeof r.balance === "number" ? `at ${money(r.balance)}` : "updated"}.`)
 onDone?.()
    } catch (e) { setErr((e as Error).message); setConfirming(false) } finally { setBusy(false) }
  }

 return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a ledger entry</DialogTitle>
          <DialogDescription>
            For money that moved without an integration behind it. This cannot be edited or
 deleted afterwards — a mistake is fixed by entering its opposite.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex items-start gap-2 rounded-lg border border-shipped/30 bg-shipped/12 px-3 py-2 text-sm text-shipped">
            <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /><span>{done}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Direction first and as two large buttons, not a +/- typed into the amount.
                It is the field most costly to get wrong and the easiest to skim past. */}
            <div>
              <span className="mb-1 block text-xs font-medium">Direction</span>
              <div className="grid grid-cols-2 gap-2">
                <button
 type="button" onClick={() => { setDir(-1); setConfirming(false) }}
 className={"flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors " +
                    (dir === -1 ? "border-rose-300 bg-rose-50 text-rose-700" : "border-border text-muted-foreground hover:bg-accent")}
                >
                  Money out
                </button>
                <button
 type="button" onClick={() => { setDir(1); setConfirming(false) }}
 className={"flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors " +
                    (dir === 1 ? "border-shipped/30 bg-shipped/12 text-shipped" : "border-border text-muted-foreground hover:bg-accent")}
                >
                  <Plus size={14} weight="bold" /> Money in
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="le-amt" className="mb-1 block text-xs font-medium">Amount</label>
                <Input id="le-amt" inputMode="decimal" value={amount}
 onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setConfirming(false) }}
 placeholder="0.00" className="h-9" />
              </div>
              <div>
                <label htmlFor="le-type" className="mb-1 block text-xs font-medium">Category</label>
                <select id="le-type" value={type}
 onChange={(e) => { setType(e.target.value); setConfirming(false) }}
 disabled={!types?.length}
 className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-60">
                  {types === null && <option>Loading…</option>}
                  {typesErr && <option>Couldn&apos;t load</option>}
                  {(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="le-acct" className="mb-1 block text-xs font-medium">Account</label>
              <select id="le-acct" value={account}
 onChange={(e) => { setAccount(e.target.value); setConfirming(false) }}
 className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
                <option value="factory">House wallet (the factory)</option>
                <option value="designer">Designer pool</option>
                {users.length > 0 && (
                  <optgroup label="Sellers">
                    {users.map((u) => (
                      <option key={String(u.id)} value={String(u.id)}>{u.email}{u.name ? ` — ${u.name}` : ""}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {account !== "factory" && account !== "designer" && (
                // Naming the consequence, because crediting a seller is not an internal
                // bookkeeping move — they can withdraw it.
                <p className="mt-1 text-2xs text-hold">
                  This changes a seller&apos;s spendable balance, not just our books.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="le-note" className="mb-1 block text-xs font-medium">Reason</label>
              <Input id="le-note" value={note}
 onChange={(e) => { setNote(e.target.value); setConfirming(false) }}
 placeholder="Pink Design invoice #4471, paid by transfer" className="h-9" />
            </div>

            <div>
              <label htmlFor="le-ref" className="mb-1 block text-xs font-medium">
                Reference <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input id="le-ref" value={ref} onChange={(e) => setRef(e.target.value)}
 placeholder="INV-4471" className="h-9" />
              <p className="mt-1 text-2xs text-muted-foreground">
                An invoice or PO number. Entering the same one twice records once, so a
 re-entered invoice can&apos;t double-count.
              </p>
            </div>

            {confirming && amt > 0 && (
              // The whole entry in one sentence before it becomes permanent. Reading back
              // what was typed catches a misplaced decimal or a wrong direction in a way
              // re-reading the fields you just filled does not.
              <div className="rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-sm text-hold">
                <strong>{dir === 1 ? "Add" : "Take"} {money(delta)}</strong>{" "}
                {dir === 1 ? "to" : "from"} <strong>{accountLabel}</strong>, filed as{" "}
                {types?.find((t) => t.id === type)?.label ?? type}. This is permanent — press again to confirm.
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{done ? "Done" : "Cancel"}</Button>
          {!done && (
            <Button onClick={submit} disabled={busy || !amt || !types?.length}>
              {busy ? <CircleNotch size={14} className="animate-spin" /> : confirming ? "Confirm and record" : "Review"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
