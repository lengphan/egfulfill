"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { Bank, CreditCard, ArrowsClockwise, CircleNotch, Warning, DotsThree, Plus, Minus } from "@phosphor-icons/react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePrompt } from "@/components/app/confirm-dialog"
import {
 getCashAccounts, saveCashAccount, reconcileCashAccount, recordCashPayment, backfillPostage,
 type CashAccountsView,
} from "@/lib/api"

const usd = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The rails money arrives on, offered as one-click setup so the ids match what the server
 * maps top-up methods onto (RAIL_TO_ACCOUNT). A PingPong account has to BE `pingpong`. */
const SUGGESTED = [
  { id: "pingpong", name: "PingPong", kind: "rail" },
  { id: "lianlian", name: "LianLian", kind: "rail" },
  { id: "paypal", name: "PayPal", kind: "rail" },
  /* The id stays `vietqr` — it keys the ledger and the reconciliation. Only the name a
 person reads changes; see lib/payment-method.ts. */
  { id: "vietqr", name: "BIDV", kind: "rail" },
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
  const tl = useLabelT()
 const [view, setView] = useState<CashAccountsView | null>(null)
 const [err, setErr] = useState<string | null>(null)
 const [busy, setBusy] = useState<string | null>(null)
 const prompt = usePrompt()

 const load = useCallback(() => {
 getCashAccounts().then(setView).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't read accounts."))
  }, [])
 useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

 const add = async (seed?: { id: string; name: string; kind: string }) => {
 const name = seed?.name ?? await prompt({ title: tl("cashAccounts", "New account"), body: "What is it called? e.g. US Bank ····4471", placeholder: tl("cashAccounts", "US Bank ····4471") })
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
   * because attribution has to have exactly one answer. */
 const setPostage = async (a: { id: string; name: string; kind: string; opening: number }) => {
 setBusy(a.id)
 try { await saveCashAccount({ id: a.id, name: a.name, kind: a.kind, opening: a.opening, isPostage: true }); load() }
 catch (e) { setErr(e instanceof Error ? e.message : "Couldn't set the postage card.") }
 finally { setBusy(null) }
  }

 const runBackfill = async () => {
 setBusy("backfill")
 try {
 const r = await backfillPostage()
 setErr(r.attributed ? null : "Nothing left to place — every past label cost already has an account.")
 load()
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't place past postage.") }
 finally { setBusy(null) }
  }

 const pay = async (id: string, name: string, direction: "in" | "out") => {
 const amount = await prompt({
 title: direction === "in" ? `Money into ${name}` : `Money out of ${name}`,
 body: "Recorded on the ledger against this account.",
 placeholder: "0.00",
    })
 if (!amount) return
 const note = await prompt({ title: tl("cashAccounts", "What was it for?"), placeholder: direction === "in" ? "Transfer from PingPong" : "Supplier payment" })
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
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Warning size={12} weight="fill" className="shrink-0 text-hold" /> {err}
      </p>
    )
  }
 if (!view) {
 return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleNotch size={12} className="animate-spin" /> {tl("cashAccounts", "Accounts…")}
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
    /* No tinted well. The account cards are white on white already and the tint drew a
 second box around a group the cards' own borders had already grouped. */
    <div className="space-y-2 p-0.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="eg-label text-muted-foreground">{tl("cashAccounts", "Accounts")}</span>
        {/* A BUTTON, NOT AN UNDERLINED LINK. This was `text-2xs text-primary hover:underline`
            — 11px of coloured text doing the job of the only "make a thing" control on the
            strip. §4: a button is an action and carries a control's shape; an underline is
            what a link inside a sentence wears. */}
        <Button size="sm" variant="outline" onClick={() => add()} className="h-7 gap-1 px-2 text-xs">
          <Plus size={12} weight="bold" /> {tl("cashAccounts", "Add")}
        </Button>
      </div>

      {/* Across, not down — six to a row on a wide screen, so five accounts and an
          Unassigned line are ONE strip rather than a column with dead space beneath it. */}
      {/* items-start: one card carries an extra button (Unassigned's "Place past postage"),
          and a grid stretches every sibling to match its tallest — so four accounts each grew
          ~50px of empty space under their balance to keep pace with a card they have nothing
          to do with. A row of half-empty boxes is most of what "undone" looks like. */}
      <div className="grid items-start gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {view.accounts.map((a) => (
        // group/acct so the controls stay out of sight until this card is pointed at — three
        // buttons on every card is a wall of chrome on a figure you mostly just read.
        <Card key={a.id} className="group/acct gap-0 px-3 py-2">
          <div className="flex items-center gap-1.5 eg-label text-muted-foreground">
            {a.kind === "card" ? <CreditCard size={11} /> : <Bank size={11} />}
            <span className="truncate">{a.name}</span>
            {a.is_postage && <span className="ml-auto shrink-0 rounded bg-primary/10 px-1 text-2xs normal-case text-primary">postage</span>}
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className={"text-base font-bold tracking-tight tabular-nums " + (a.balance < 0 ? "text-alert" : "")}>
              {usd(a.balance)}
            </span>
            {/* ── ONE MENU, NOT FOUR MICRO-BUTTONS ────────────────────────────────
                This was four buttons at `px-1 text-2xs leading-4` — roughly 14x16px targets,
                unlabelled (+ − ⟳ $), and `opacity-0` until the card was hovered. Two things
                were wrong with that, and the second is the one that matters.

                They are too small to hit. The size-picker in the blank dialog already fixed
                this exact thing and wrote down why: "Sized to be HIT as well as read. These
                were 10px text in a 2px pad — a target you aim at, on the control you are here
                to use." Same sentence applies here.

                And hiding them was the wrong answer to the right observation. The old note
                says three buttons on every card is "a wall of chrome on a figure you mostly
                just read" — true, but the fix for too much chrome is FEWER CONTROLS, not
                invisible ones. Hover-hidden means unreachable on touch and undiscoverable
                everywhere: nothing on the card said these actions existed.

                Four actions on one account is a menu. It is always visible, it is one proper
                target, and it can afford to say what each action does in words. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={busy === a.id}
                aria-label={tl("cashAccounts", "Actions for this account")}
                className="eg-tap -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {busy === a.id
                  ? <CircleNotch size={13} className="animate-spin" />
                  : <DotsThree size={15} weight="bold" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onClick={() => pay(a.id, a.name, "in")} className="gap-2 text-xs">
                  <Plus size={13} weight="bold" /> {tl("cashAccounts", "Money in")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => pay(a.id, a.name, "out")} className="gap-2 text-xs">
                  <Minus size={13} weight="bold" /> {tl("cashAccounts", "Money out")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => reconcile(a.id, a.name, a.balance)} className="gap-2 text-xs">
                  <ArrowsClockwise size={13} /> {tl("cashAccounts", "Set the real balance")}
                </DropdownMenuItem>
                {/* WHICH CARD SHIPPO CHARGES. Named once here, and every label cost places
                    itself against it from then on — the alternative is choosing an account on
                    every label, which nobody would do and which would leave postage in
                    Unassigned forever. Only offered on a card, because postage is charged to
                    one; marking a bank would attribute spend to a place it never left. */}
                {a.kind === "card" && !a.is_postage && (
                  <DropdownMenuItem onClick={() => setPostage(a)} className="gap-2 text-xs">
                    <CreditCard size={13} /> {tl("cashAccounts", "Charge postage here")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Card>
      ))}

      {view.unassigned.entries > 0 && (
        <Card className="group/un gap-0 border-dashed px-3 py-2">
          <div className="eg-label text-muted-foreground">{tl("cashAccounts", "Unassigned")}</div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-base font-bold tabular-nums">{usd(view.unassigned.amount)}</span>
            <span className="text-xs text-muted-foreground">{view.unassigned.entries} entries</span>
          </div>
          {/* Postage places itself from the moment a card is marked — but everything bought
              BEFORE that is still sitting here, and seventy-odd rows through a per-row picker
 is a chore nobody finishes. Only offered once a postage card exists, because
 without one there is nowhere to put them. */}
          {view.accounts.some((a) => a.is_postage) && (
            <Button size="sm" variant="outline" onClick={runBackfill} disabled={busy === "backfill"}
              className="mt-1.5 h-7 self-start px-2 text-xs">
              {busy === "backfill" ? <CircleNotch size={12} className="animate-spin" /> : tl("cashAccounts", "Place past postage")}
            </Button>
          )}
        </Card>
      )}
      </div>

      {/* The rails not yet added, as ONE line rather than a card each — an unset account is
 a prompt, not a figure, and giving each its own card put empty boxes on equal
 footing with real balances. The one-click id still matters: a hand-typed
          "Ping Pong" becomes `ping-pong` and then silently receives nothing. */}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <span>{tl("cashAccounts", "Add:")}</span>
          {missing.map((sg) => (
            <button key={sg.id} onClick={() => add(sg)} disabled={busy === sg.id}
 className="eg-tap rounded-md border border-dashed border-border px-2 py-1 font-medium transition-colors hover:border-primary hover:text-foreground">
              {sg.name}
            </button>
          ))}
        </div>
      )}

      {err && <p className="text-xs text-hold">{err}</p>}
    </div>
  )
}
