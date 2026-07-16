"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { PenNib, CircleNotch, Needle, CurrencyDollar, CheckCircle, ArrowRight, ArrowClockwise, Hand } from "@phosphor-icons/react"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getDesignCards, saveDesignCards, walletTransfer, type DesignCard } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"

// Board lanes — a linear left-to-right pipeline. Approving a card credits the designer
// once (no separate Paid lane; the credit is idempotent per card).
const COLS = [
  { id: "incoming", label: "Incoming", accent: "bg-slate-400" },
  { id: "inprogress", label: "In progress", accent: "bg-violet-500" },
  { id: "review", label: "In review", accent: "bg-amber-500" },
  { id: "fix", label: "Needs fix", accent: "bg-red-500" },
  { id: "approved", label: "Approved", accent: "bg-emerald-500" },
] as const
const colOf = (c: DesignCard) => {
  const v = String(c.col || "incoming").toLowerCase()
  return COLS.some((x) => x.id === v) ? v : "incoming"
}
const amt = (v: unknown) => Number(v) || 0
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function DesignerBoard() {
  const [cards, setCards] = useState<DesignCard[] | null>(null)
  const [dragId, setDragId] = useState<string | number | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | number | null>(null)
  const [view, setView] = useState<"board" | "list">("board")
  const me = getUser()?.name || "Designer"

  useEffect(() => {
    const id = setTimeout(() => {
      if (!getToken()) { setCards([]); return }
      getDesignCards().then((r) => setCards(r ?? [])).catch(() => setCards([]))
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Optimistic update + whole-board persist (POST replaces the board).
  const persist = useCallback((next: DesignCard[]) => {
    setCards(next)
    saveDesignCards(next).catch(() => {})
  }, [])
  const patch = useCallback((id: string | number, p: Partial<DesignCard>) => {
    setCards((prev) => {
      const next = (prev ?? []).map((c) => (c.id === id ? { ...c, ...p } : c))
      saveDesignCards(next).catch(() => {})
      return next
    })
  }, [])

  const grouped = useMemo(() => {
    const g: Record<string, DesignCard[]> = Object.fromEntries(COLS.map((c) => [c.id, []]))
    for (const c of cards ?? []) (g[colOf(c)] ??= []).push(c)
    return g
  }, [cards])

  const stats = useMemo(() => {
    const list = cards ?? []
    const approved = list.filter((c) => colOf(c) === "approved").length
    const credited = list.filter((c) => c.credited).reduce((s, c) => s + amt(c.payment), 0)
    return { total: list.length, active: list.filter((c) => ["inprogress", "review", "fix"].includes(colOf(c))).length, approved, credited }
  }, [cards])

  // Move a card; entering "approved" credits the designer ONCE (idempotent by DSN-<id> +
  // the card's `credited` flag), so re-dragging it never double-pays.
  const moveCard = useCallback((card: DesignCard, to: string, extra?: Partial<DesignCard>) => {
    patch(card.id, { col: to, ...extra })
    if (to === "approved" && !card.credited && amt(card.payment) > 0) {
      walletTransfer({ fromAccount: "factory", toAccount: "designer", amount: amt(card.payment), ref: `DSN-${card.id}`, type: "design-pay", note: `Design payout · ${card.title || card.id}` })
        .then((r) => { if (!r.error) patch(card.id, { credited: true, pay_status: "paid" }) })
        .catch(() => {})
    }
  }, [patch])

  const drop = (col: string) => {
    setOverCol(null)
    if (dragId == null) return
    const card = (cards ?? []).find((c) => c.id === dragId)
    if (card) moveCard(card, col)
    setDragId(null)
  }

  const openCard = (cards ?? []).find((c) => c.id === openId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><PenNib size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Designer</h1>
          <p className="truncate text-sm text-muted-foreground">{view === "board" ? "Drag cards between lanes." : "Scan every card in one list."} Claim work, send for review, get credited on approval.</p>
        </div>
        <div className="ml-auto flex rounded-lg border border-border p-0.5">
          {([{ id: "board", label: "Board" }, { id: "list", label: "List" }] as const).map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} className={"rounded-md px-3 py-1 text-sm font-medium transition-colors " + (view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{v.label}</button>
          ))}
        </div>
      </div>

      <StatGrid>
        <StatCard label="Open cards" value={String(stats.total)} sub="on the board" />
        <StatCard label="In progress" value={String(stats.active)} sub="being worked" />
        <StatCard label="Approved" value={String(stats.approved)} sub="in the approved lane" />
        <StatCard label="Credited" value={money(stats.credited)} sub="paid to designers" tone={stats.credited ? "pos" : undefined} />
      </StatGrid>

      {cards === null ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground"><CircleNotch size={24} className="animate-spin" /></div>
      ) : view === "list" ? (
        <DesignerList cards={cards} onOpen={setOpenId} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLS.map((col) => {
            const list = grouped[col.id] ?? []
            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.id) }}
                onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                onDrop={() => drop(col.id)}
                className={"flex w-72 shrink-0 flex-col rounded-2xl border bg-card transition-colors " + (overCol === col.id ? "border-primary bg-primary/5" : "border-border")}
              >
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <span className={"size-2 rounded-full " + col.accent} />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                  {list.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground/60">Drop cards here</div>
                  ) : (
                    list.map((c) => (
                      <button
                        key={String(c.id)}
                        draggable
                        onDragStart={() => setDragId(c.id)}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => setOpenId(c.id)}
                        className="group cursor-grab rounded-xl border border-border bg-background p-2.5 text-left shadow-sm transition-shadow hover:shadow active:cursor-grabbing"
                      >
                        <div className="flex gap-2.5">
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {c.thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={String(c.thumb)} alt="" className="size-full object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center text-muted-foreground/40"><PenNib size={16} weight="duotone" /></div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium leading-tight">{c.title || "Design"}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.product || c.type || "—"}</div>
                            <div className="mt-1 flex items-center gap-1.5">
                              {c.order_id && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{String(c.order_id).slice(0, 10)}</span>}
                              {c.is_emb && <span className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"><Needle size={9} weight="bold" /> EMB</span>}
                              {amt(c.payment) > 0 && <span className="ml-auto text-xs font-semibold tabular-nums">{money(amt(c.payment))}</span>}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {openCard && <CardDialog card={openCard} me={me} onClose={() => setOpenId(null)} patch={patch} onMove={moveCard} remove={(id) => persist((cards ?? []).filter((c) => c.id !== id))} />}
    </div>
  )
}

// List view — dense, scannable, sorted by lane. Same click-to-open detail.
function DesignerList({ cards, onOpen }: { cards: DesignCard[]; onOpen: (id: string | number) => void }) {
  const order: string[] = COLS.map((c) => c.id)
  const rows = [...cards].sort((a, b) => order.indexOf(colOf(a)) - order.indexOf(colOf(b)))
  if (rows.length === 0) return <div className="rounded-2xl border border-border py-16 text-center text-sm text-muted-foreground">No design cards yet — send one from the Operator board.</div>
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Design</th>
              <th className="px-4 py-2.5 font-medium">Order</th>
              <th className="px-4 py-2.5 font-medium">Product</th>
              <th className="px-4 py-2.5 font-medium">Lane</th>
              <th className="px-4 py-2.5 text-right font-medium">Payout</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const col = COLS.find((x) => x.id === colOf(c))
              return (
                <tr key={String(c.id)} onClick={() => onOpen(c.id)} className="cursor-pointer border-t border-border transition-colors hover:bg-accent">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2.5">
                      <div className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted">
                        {c.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={String(c.thumb)} alt="" className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center text-muted-foreground/40"><PenNib size={13} weight="duotone" /></div>
                        )}
                      </div>
                      <span className="truncate font-medium">{c.title || "Design"}</span>
                      {c.is_emb && <span className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"><Needle size={9} weight="bold" /> EMB</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.order_id ? String(c.order_id) : "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.product || c.type || "—"}</td>
                  <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"><span className={"size-1.5 rounded-full " + (col?.accent ?? "bg-muted-foreground")} /> {col?.label}</span></td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{amt(c.payment) > 0 ? money(amt(c.payment)) : "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Card detail — claim, move, set payout. Approving auto-credits the designer (via onMove).
function CardDialog({ card, me, onClose, patch, onMove, remove }: { card: DesignCard; me: string; onClose: () => void; patch: (id: string | number, p: Partial<DesignCard>) => void; onMove: (card: DesignCard, to: string, extra?: Partial<DesignCard>) => void; remove: (id: string | number) => void }) {
  const [pay, setPay] = useState(String(amt(card.payment) || ""))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const col = colOf(card)

  const move = (to: string, extra?: Partial<DesignCard>) => onMove(card, to, extra)

  // Fallback credit for a card approved before a payout was set (auto-credit needs an
  // amount at approval time). Idempotent by DSN-<id> so it can never double-pay.
  const creditNow = async () => {
    const amount = Number(pay) || 0
    if (amount <= 0) { setErr("Set a payout amount first."); return }
    setBusy(true); setErr(null)
    try {
      const r = await walletTransfer({ fromAccount: "factory", toAccount: "designer", amount, ref: `DSN-${card.id}`, type: "design-pay", note: `Design payout · ${card.title || card.id}` })
      if (r.error) throw new Error(r.error)
      patch(card.id, { credited: true, pay_status: "paid", payment: amount })
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't credit the designer.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="truncate">{card.title || "Design card"}</DialogTitle></DialogHeader>
        <div className="flex gap-4">
          <div className="relative size-28 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
            {card.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={String(card.thumb)} alt="" className="size-full object-contain" />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground/40"><PenNib size={26} weight="duotone" /></div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{COLS.find((c) => c.id === col)?.label}</span>
              {card.is_emb && <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"><Needle size={10} weight="bold" /> Embroidery</span>}
              {card.priority && card.priority !== "normal" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{String(card.priority)}</span>}
            </div>
            <div className="text-muted-foreground">{card.product || card.type || "—"}</div>
            {card.order_id && <div className="text-muted-foreground">Order <span className="font-mono text-foreground">{String(card.order_id)}</span></div>}
            {card.customer && <div className="text-muted-foreground">{String(card.customer)}</div>}
            {card.claimed_by && <div className="text-xs text-muted-foreground">Claimed by {String(card.claimed_by)}</div>}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <span className="text-sm font-medium">Payout</span>
          <div className="relative w-32">
            <CurrencyDollar size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={pay} onChange={(e) => setPay(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="h-9 pl-7" inputMode="decimal" onBlur={() => patch(card.id, { payment: Number(pay) || 0 })} />
          </div>
        </label>

        {err && <div className="text-sm text-destructive">{err}</div>}

        {/* Stage actions */}
        <div className="flex flex-wrap gap-2">
          {col === "incoming" && <Button size="sm" onClick={() => move("inprogress", { claimed_by: me })}><Hand size={14} weight="bold" /> Claim</Button>}
          {col === "inprogress" && <Button size="sm" onClick={() => move("review")}><ArrowRight size={14} weight="bold" /> Send for review</Button>}
          {col === "review" && (
            <>
              <Button size="sm" onClick={() => move("approved")}><CheckCircle size={14} weight="bold" /> Approve</Button>
              <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => move("fix")}><ArrowClockwise size={14} weight="bold" /> Needs fix</Button>
            </>
          )}
          {col === "fix" && <Button size="sm" onClick={() => move("inprogress")}><ArrowClockwise size={14} weight="bold" /> Back to work</Button>}
          {col === "approved" && (
            card.credited
              ? <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600"><CheckCircle size={15} weight="fill" /> Credited {money(amt(card.payment))}</span>
              : <Button size="sm" onClick={creditNow} disabled={busy}>{busy ? <CircleNotch size={14} className="animate-spin" /> : <><CurrencyDollar size={14} weight="bold" /> Credit {money(Number(pay) || 0)}</>}</Button>
          )}
          <button onClick={() => remove(card.id)} className="ml-auto text-xs font-medium text-muted-foreground hover:text-red-600">Remove card</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
