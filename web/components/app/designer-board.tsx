"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { PenNib, X, CircleNotch, Needle, CurrencyDollar, CheckCircle, ArrowRight, ArrowClockwise, Hand, Columns, CheckSquare, Square, LinkSimple, PaperPlaneTilt, Plus } from "@phosphor-icons/react"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getDesignCards, saveDesignCards, deleteDesignCard, creditDesignCard, walletTransfer, getFactorySettings, createDesignCard, pinkRequestFix, type DesignCard } from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"
import { DesignFilesPanel } from "@/components/app/design-files-panel"
import { AssignCardDialog } from "@/components/app/assign-card-dialog"
import { PushToPartnerDialog } from "@/components/app/push-to-partner-dialog"
import { OrderHistory } from "@/components/app/order-history"
import { useConfirm } from "@/components/app/confirm-dialog"

// Board lanes — a linear left-to-right pipeline. Approving a card credits the designer
// once (no separate Paid lane; the credit is idempotent per card).
// The partner lane is a DESTINATION, not a status: dropping a card here means "send this
// out". It's appended rather than inserted so existing lane order is untouched, and it's
// hidden entirely from designers — sending work out spends money and gives away a job
// they'd otherwise do.
const PARTNER_COL = { id: "partner", label: "Design partner", accent: "bg-amber-500" } as const
const canOutsource = () => { const r = getUser()?.role; return r === "admin" || r === "warehouse" || r === "operator" }
/**
 * Deleting a card destroys the record of work someone did, so it is a custody call —
 * warehouse or admin, matching what the server enforces. An operator or designer sees no
 * delete control at all rather than one that 403s.
 */
const canDeleteCard = () => { const r = getUser()?.role; return r === "admin" || r === "warehouse" }

const COLS = [
  { id: "incoming", label: "Incoming", accent: "bg-slate-400" },
  { id: "inprogress", label: "In progress", accent: "bg-violet-500" },
  { id: "review", label: "In review", accent: "bg-amber-500" },
  { id: "fix", label: "Fix", accent: "bg-red-500" },
  { id: "approved", label: "Approved", accent: "bg-emerald-500" },
] as const
const colOf = (c: DesignCard) => {
  const v = String(c.col || "incoming").toLowerCase()
  return COLS.some((x) => x.id === v) ? v : "incoming"
}
// Partner keys are storage values ("pinkdesign"); the board shows a human name. Unknown
// vendors fall back to the raw key rather than hiding that the card is outsourced.
const VENDOR_NAMES: Record<string, string> = { pinkdesign: "Pink Design" }
const vendorLabel = (v?: string | null) => (v ? (VENDOR_NAMES[v] ?? v) : "")

const amt = (v: unknown) => Number(v) || 0
const money = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function DesignerBoard() {
  const confirm = useConfirm()
  const [cards, setCards] = useState<DesignCard[] | null>(null)
  const [dragId, setDragId] = useState<string | number | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  // Board-level, distinct from the card panel's own busy/err further down: an upload
  // failing has to be visible on the board, not inside a card that was never created.
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [assignCard, setAssignCard] = useState<DesignCard | null>(null)
  const [openId, setOpenId] = useState<string | number | null>(null)
  const [view, setView] = useState<"board" | "list">("board")
  const [designFee, setDesignFee] = useState(0) // platform default payout per design
  const [delErr, setDelErr] = useState<string | null>(null)
  const me = getUser()?.name || "Designer"

  // Reload the board from the server. Named because a partner push writes the card on the
  // SERVER (vendor badge + their task ref), so the local list has to be re-read rather
  // than patched — the row that matters afterwards isn't the one we were holding.
  const load = useCallback(() => {
    if (!getToken()) { setCards([]); return }
    getDesignCards().then((r) => setCards(r ?? [])).catch(() => setCards([]))
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      load()
      getFactorySettings().then((s) => setDesignFee(Number(s.designer_payout) || 0)).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [load])

  // persist() is gone: its only remaining callers were the two delete paths, and
  // "POST the whole board minus one card" is exactly what made a card undeletable.
  // Edits still round-trip through patch() below, which sends the full list — that is
  // fine for a field change, where a failed request loses an edit rather than silently
  // resurrecting a row.
  /**
   * Delete one card through the dedicated endpoint.
   *
   * This used to POST the entire board minus the card and let the server drop what was
   * missing. Every card carries a base64 thumb, so on a busy board that request is huge —
   * and when it failed the upserts had already applied while the delete had not, so the
   * card reappeared on reload with the error swallowed. That is how a card survives being
   * deleted repeatedly.
   *
   * Optimistic, but a failure now RELOADS and says why, rather than leaving the board
   * showing a card that is still on the server.
   */
  const removeCard = useCallback(async (id: string | number) => {
    setCards((prev) => (prev ?? []).filter((c) => c.id !== id))
    try {
      const r = await deleteDesignCard(id)
      if (r?.error) throw new Error(r.error)
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : "Couldn't delete that card.")
      load()
    }
  }, [load])

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
    // Credit on approval — use the card's payout, or the platform Design fee as the default.
    const amount = amt(card.payment) || designFee
    if (to === "approved" && !card.credited && amount > 0) {
      // The SERVER decides who gets paid: only a designer earns a payout (staff upload
      // files too, and that isn't billable design work), and on a shared board the credit
      // follows whoever claimed the card rather than a common pool.
      creditDesignCard(card.id, amount)
        .then((r) => {
          if (r?.error) return
          if (r?.credited) patch(card.id, { credited: true, pay_status: "paid", payment: amount })
        })
        .catch(() => {})
    }
  }, [patch, designFee])

  /**
   * A FILE dropped on a lane becomes a new card there.
   *
   * The board only ever accepted its own cards being dragged between lanes, so dropping a
   * PNG on it did nothing at all — no error, no card, which reads as the feature being
   * broken rather than absent. Artwork often arrives before the order does (a seller emails
   * a design, someone makes one speculatively), and this is the door for it.
   *
   * Images only: the card's whole purpose is showing the design, and a .zip renders as a
   * blank tile that looks like a failed upload forever.
   */
  const dropFiles = async (files: File[], col: string) => {
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (!images.length) {
      setErr(files.length ? "Only image files become cards — drop a PNG, JPG or WEBP." : null)
      return
    }
    setBusy(true); setErr(null)
    const failed: string[] = []
    for (const f of images) {
      try {
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error("unreadable"))
          r.readAsDataURL(f)
        })
        // The filename minus its extension is the card's name. It is what the person who
        // sent the file called it, which beats "Untitled 3" every time.
        const title = f.name.replace(/\.[^.]+$/, "") || "Untitled design"
        const r = await createDesignCard({ title, data })
        if (r?.error) throw new Error(r.error)
        // Cards land in Incoming regardless of which lane took the drop: a brand-new design
        // has not been started, and letting a drop declare it in-progress would make the
        // lane a lie the moment someone drops onto the wrong column.
        void col
      } catch { failed.push(f.name) }
    }
    setBusy(false)
    if (failed.length) setErr(`Couldn't add ${failed.length} file${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}`)
    load()
  }

  const drop = (col: string) => {
    setOverCol(null)
    if (dragId == null) return
    const card = (cards ?? []).find((c) => c.id === dragId)
    setDragId(null)
    if (!card) return
    // Dropping on the partner lane OPENS the send window rather than sending. A drag is
    // easy to do by accident and this one spends money and hands the job to someone
    // outside the building — so the drop proposes it and a person confirms.
    if (col === PARTNER_COL.id) { setPushCard(card); return }
    moveCard(card, col)
  }

  // The card a drop (or the toolbar button) has proposed sending out. Null = window shut.
  const [pushCard, setPushCard] = useState<DesignCard | null>(null)
  const showPartner = canOutsource()

  const openCard = (cards ?? []).find((c) => c.id === openId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* Icon+title hidden on desktop (top bar names the page); the board/list toggle
            on the right stays. On mobile the hero is the title. */}
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary md:hidden"><PenNib size={18} weight="fill" /></span>
        <div className="min-w-0 md:hidden">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Designer</h1>
          <p className="truncate text-sm text-muted-foreground">{view === "board" ? "Drag cards between lanes." : "Scan every card in one list."} Claim work, send for review, get credited on approval.</p>
        </div>
        {/* Add design — the explicit way in, in EITHER view. Drag-drop onto a lane only
            works in Board view, which left List view with no way to bring artwork in.
            Files land in Incoming regardless (see dropFiles), so no lane choice is needed. */}
        <label className="eg-tap ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          <Plus size={14} weight="bold" /> Add design
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.currentTarget.value = "" // let the same file be picked again after a failure
              if (files.length) void dropFiles(files, "incoming")
            }}
          />
        </label>
        {/* rounded-full to match the pill buttons inside — see suppliers-view. */}
        <div className="flex rounded-full border border-border p-0.5">
          {([{ id: "board", label: "Board" }, { id: "list", label: "List" }] as const).map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} className={"eg-tap rounded-full px-3 py-1 text-sm font-medium transition-colors " + (view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{v.label}</button>
          ))}
        </div>
      </div>

      <StatGrid>
        <StatCard label="Open cards" value={String(stats.total)} sub="on the board" />
        <StatCard label="In progress" value={String(stats.active)} sub="being worked" />
        <StatCard label="Approved" value={String(stats.approved)} sub="in the approved lane" />
        <StatCard label="Credited" value={money(stats.credited)} sub="paid to designers" tone={stats.credited ? "pos" : undefined} />
      </StatGrid>

      {/* One window serves the row menu, the toolbar button and the lane drop. A card
          with an order sends that line; one without sends the artwork on its own. */}
      <PushToPartnerDialog
        open={!!pushCard}
        onOpenChange={(v) => { if (!v) setPushCard(null) }}
        cardId={pushCard ? String(pushCard.id) : undefined}
        orderId={pushCard?.order_id ? String(pushCard.order_id) : undefined}
        sku={pushCard?.sku ? String(pushCard.sku) : undefined}
        itemName={pushCard?.title}
        printType={pushCard?.type}
        artworkUrl={pushCard?.thumb ? String(pushCard.thumb) : null}
        onPushed={() => { setPushCard(null); load() }}
      />

      {/* Assigning writes the artwork into the order's designs server-side, so the order's
          design tag lights in the same action — see assign-card-dialog. */}
      <AssignCardDialog
        card={assignCard}
        open={!!assignCard}
        onOpenChange={(v) => { if (!v) setAssignCard(null) }}
        onDone={() => { setAssignCard(null); load() }}
      />

      {(err || busy) && (
        <div className={"flex items-center gap-2 rounded-lg border px-3 py-2 text-xs " +
          (err ? "border-amber-300 bg-amber-50 text-amber-800" : "border-border text-muted-foreground")}>
          {busy && <CircleNotch size={13} className="animate-spin" />}
          {err ?? "Adding artwork to the board…"}
        </div>
      )}

      {cards === null ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground"><CircleNotch size={24} className="animate-spin" /></div>
      ) : view === "list" ? (
        <DesignerList cards={cards} onOpen={setOpenId} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[...COLS, ...(showPartner ? [PARTNER_COL] : [])].map((col) => {
            const list = grouped[col.id] ?? []
            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.id) }}
                onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                onDrop={(e) => {
                  // A file drop and a card drag both land here. Files win when present —
                  // dragId can be stale from an earlier drag that never cleared.
                  const files = Array.from(e.dataTransfer?.files ?? [])
                  if (files.length) { e.preventDefault(); setOverCol(null); void dropFiles(files, col.id); return }
                  drop(col.id)
                }}
                className={"flex w-72 shrink-0 flex-col rounded-2xl border bg-card transition-colors " + (overCol === col.id ? "border-primary bg-primary/5" : "border-border")}
              >
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <span className={"size-2 rounded-full " + col.accent} />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                  {list.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground/60">Drop cards or artwork here</div>
                  ) : (
                    list.map((c) => (
                      <button
                        key={String(c.id)}
                        // A vendor card is driven by the partner's board, so it can't be
                        // dragged through our lanes — the same gate the card dialog applies,
                        // enforced on the tile so a drag can't route around it.
                        draggable={!c.vendor}
                        onDragStart={() => { if (!c.vendor) setDragId(c.id) }}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => setOpenId(c.id)}
                        className={"group overflow-hidden rounded-xl border border-border bg-background text-left shadow-sm transition-shadow hover:shadow " + (c.vendor ? "cursor-pointer" : "cursor-grab active:cursor-grabbing")}
                      >
                        {/* Large preview so the design is actually visible on the card */}
                        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                          {c.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={String(c.thumb)} alt="" className="size-full object-cover" />
                          ) : (
                            <div className="flex size-full items-center justify-center text-muted-foreground/30"><PenNib size={26} weight="duotone" /></div>
                          )}
                          {c.is_emb && <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white"><Needle size={9} weight="bold" /> EMB</span>}
                          {/* Outsourced: whose queue this is actually in. Our designers do
                              embroidery, so DTG/DTF is worked by a partner — showing it on
                              the tile stops anyone reaching for a job that isn't theirs. */}
                          {c.vendor && <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">{vendorLabel(c.vendor)}</span>}
                          {/* Cancel the card without opening it. Hover-revealed so a full
                              column isn't a grid of delete buttons, and it confirms —
                              removal is not undoable and these sit under a drag handle.
                              Warehouse/admin only, matching the server: showing a button
                              that always 403s is worse than showing none. */}
                          {canDeleteCard() && <button
                            aria-label={`Cancel ${c.title || "card"}`}
                            title="Cancel this card"
                            onClick={async (e) => {
                              e.stopPropagation()
                              const ok = await confirm({
                                title: c.vendor ? `Remove this ${vendorLabel(c.vendor)} card?` : "Cancel this card?",
                                body: c.vendor
                                  ? `This was sent to ${vendorLabel(c.vendor)}. Removing it here does NOT cancel it on their board — they have no cancel API, so they may still design and invoice it, and their finished file can no longer reach us. Cancel it on their board first, then remove this.`
                                  : `"${c.title || "This card"}" will be removed from the board. The order itself isn't affected.`,
                                confirmLabel: c.vendor ? "Remove anyway" : "Cancel card",
                                cancelLabel: "Keep it",
                              })
                              if (ok) void removeCard(c.id)
                            }}
                            className="eg-tap absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-background/85 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <X size={11} weight="bold" />
                          </button>}
                        </div>
                        <div className="p-2.5">
                          <div className="truncate text-sm font-medium leading-tight">{c.title || "Design"}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.product || c.type || "—"}</div>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            {c.order_id && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{String(c.order_id).slice(0, 12)}</span>}
                            {amt(c.payment) > 0 && <span className="ml-auto text-xs font-semibold tabular-nums">{money(amt(c.payment))}</span>}
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

      {delErr && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {delErr}
          <button onClick={() => setDelErr(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}
      {openCard && <CardDialog card={openCard} me={me} designFee={designFee} onClose={() => setOpenId(null)} patch={patch} onMove={moveCard} remove={(id) => void removeCard(id)}
        onAssign={() => { setAssignCard(openCard); setOpenId(null) }}
        onPush={() => { setPushCard(openCard); setOpenId(null) }} canPush={showPartner} />}
    </div>
  )
}

// Every column the list CAN show. `design` is locked on (the thumb + title).
type ListCol = { id: string; label: string; align?: "right"; locked?: boolean; cell: (c: DesignCard) => React.ReactNode }
const LIST_COLS: ListCol[] = [
  { id: "design", label: "Design", locked: true, cell: (c) => (
    <div className="flex items-center gap-3">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
        {c.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={String(c.thumb)} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40"><PenNib size={18} weight="duotone" /></div>
        )}
      </div>
      <span className="max-w-[220px] truncate font-medium">{c.title || "Design"}</span>
      {c.is_emb && <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"><Needle size={9} weight="bold" /> EMB</span>}
    </div>
  ) },
  { id: "order", label: "Order", cell: (c) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{c.order_id ? String(c.order_id) : "—"}</span> },
  { id: "customer", label: "Customer", cell: (c) => <span className="text-muted-foreground">{c.customer ? String(c.customer) : "—"}</span> },
  { id: "product", label: "Product", cell: (c) => <div className="max-w-[220px] truncate text-muted-foreground">{c.product || c.type || "—"}</div> },
  { id: "method", label: "Method", cell: (c) => <span className="text-muted-foreground">{c.type ? String(c.type) : (c.is_emb ? "Embroidery" : "—")}</span> },
  // Who's actually working it: an OUTSOURCED card is with the partner (shown as their
  // name, tinted like the board badge), a claimed card is with that designer, and anything
  // else is genuinely unclaimed — said plainly rather than a bare dash.
  { id: "claimed", label: "Assigned to", cell: (c) => c.vendor
    ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{vendorLabel(c.vendor)}</span>
    : c.claimed_by
      ? <span className="text-foreground">{String(c.claimed_by)}</span>
      : <span className="text-muted-foreground">Unclaimed</span> },
  { id: "priority", label: "Priority", cell: (c) => (c.priority && c.priority !== "normal" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{String(c.priority)}</span> : <span className="text-muted-foreground">—</span>) },
  { id: "lane", label: "Lane", cell: (c) => { const col = COLS.find((x) => x.id === colOf(c)); return <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"><span className={"size-1.5 rounded-full " + (col?.accent ?? "bg-muted-foreground")} /> {col?.label}</span> } },
  { id: "status", label: "Status", cell: (c) => (c.credited ? <span className="font-medium text-emerald-600">Credited</span> : <span className="text-muted-foreground">—</span>) },
  { id: "payout", label: "Payout", align: "right", cell: (c) => <span className="font-semibold tabular-nums">{amt(c.payment) > 0 ? money(amt(c.payment)) : "—"}</span> },
]
const DEFAULT_LIST_COLS = ["design", "order", "product", "claimed", "lane", "payout"]

// List view — columns are add/remove + renameable (admin/warehouse/operator), persisted.
function DesignerList({ cards, onOpen }: { cards: DesignCard[]; onOpen: (id: string | number) => void }) {
  const order: string[] = COLS.map((c) => c.id)
  const rows = [...cards].sort((a, b) => order.indexOf(colOf(a)) - order.indexOf(colOf(b)))
  const canEdit = (() => { const r = getUser()?.role; return r === "admin" || r === "warehouse" || r === "operator" })()

  const [visible, setVisible] = useState<string[]>(DEFAULT_LIST_COLS)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        let v = JSON.parse(localStorage.getItem("eg_dsn_cols") || "null")
        if (Array.isArray(v) && v.length) {
          // One-time: surface the new "Assigned to" column for anyone whose SAVED layout
          // predates it (a saved list overrides the default, so a default change alone
          // wouldn't reach them). Inserted just before "lane" and only once, so it never
          // fights a deliberate hide later.
          if (!v.includes("claimed") && !localStorage.getItem("eg_dsn_cols_assigned")) {
            const at = v.indexOf("lane")
            v = at >= 0 ? [...v.slice(0, at), "claimed", ...v.slice(at)] : [...v, "claimed"]
            localStorage.setItem("eg_dsn_cols", JSON.stringify(v))
          }
          localStorage.setItem("eg_dsn_cols_assigned", "1")
          setVisible(v)
        }
      } catch { /* default */ }
      try { const l = JSON.parse(localStorage.getItem("eg_dsn_labels") || "null"); if (l && typeof l === "object") setLabels(l) } catch { /* default */ }
    }, 0)
    return () => clearTimeout(id)
  }, [])
  const save = (v: string[], l: Record<string, string>) => { try { localStorage.setItem("eg_dsn_cols", JSON.stringify(v)); localStorage.setItem("eg_dsn_labels", JSON.stringify(l)) } catch { /* ignore */ } }
  const toggle = (id: string) => { const next = visible.includes(id) ? visible.filter((x) => x !== id) : [...visible, id]; setVisible(next); save(next, labels) }
  const rename = (id: string, label: string) => { const next = { ...labels, [id]: label }; setLabels(next); save(visible, next) }
  const reset = () => { setVisible(DEFAULT_LIST_COLS); setLabels({}); save(DEFAULT_LIST_COLS, {}) }
  const labelOf = (col: ListCol) => labels[col.id] || col.label
  const shown = LIST_COLS.filter((c) => visible.includes(c.id))

  if (rows.length === 0) return <div className="rounded-2xl border border-border py-16 text-center text-sm text-muted-foreground">No design cards yet — use <span className="font-medium text-foreground">Add design</span> above, or send one from the Operator board.</div>

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex justify-end">
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setMenuOpen((o) => !o)}><Columns size={14} weight="bold" /> Columns</Button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-72 rounded-xl border border-border bg-card p-2 shadow-xl">
                  <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Columns — toggle & rename</div>
                  {LIST_COLS.map((col) => (
                    <div key={col.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
                      <button onClick={() => !col.locked && toggle(col.id)} disabled={col.locked} title={col.locked ? "Always shown" : "Toggle"} className="flex size-5 shrink-0 items-center justify-center disabled:opacity-40">
                        {visible.includes(col.id) ? <CheckSquare size={16} weight="fill" className="text-primary" /> : <Square size={16} className="text-muted-foreground" />}
                      </button>
                      <Input value={labelOf(col)} onChange={(e) => rename(col.id, e.target.value)} className="h-7 flex-1 text-xs" />
                    </div>
                  ))}
                  <button onClick={reset} className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-primary hover:bg-accent">Reset to default</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {shown.map((c) => <th key={c.id} className={"px-4 py-2.5 font-medium " + (c.align === "right" ? "text-right" : "")}>{labelOf(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={String(c.id)} onClick={() => onOpen(c.id)} className="cursor-pointer border-t border-border transition-colors hover:bg-accent">
                  {shown.map((col) => <td key={col.id} className={"px-4 py-2 " + (col.align === "right" ? "text-right" : "")}>{col.cell(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Card detail — claim, move, set payout. Approving auto-credits the designer (via onMove).
function CardDialog({ card, me, designFee, onClose, patch, onMove, remove, onAssign, onPush, canPush }: { card: DesignCard; me: string; designFee: number; onClose: () => void; patch: (id: string | number, p: Partial<DesignCard>) => void; onMove: (card: DesignCard, to: string, extra?: Partial<DesignCard>) => void; remove: (id: string | number) => void; onAssign: () => void; onPush: () => void; canPush: boolean }) {
  // Default the payout to the platform Design fee when the card hasn't set one.
  const [pay, setPay] = useState(String(amt(card.payment) || designFee || ""))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const col = colOf(card)

  const move = (to: string, extra?: Partial<DesignCard>) => onMove(card, to, extra)
  // Only warehouse + admin set the design fee / credit; operators & designers can't.
  const canFee = (() => { const r = getUser()?.role; return r === "admin" || r === "warehouse" })()

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

  // Send a returned proof BACK to the partner for changes — the one outbound action on a
  // vendor card that's ours to take. It goes through THEIR API (a note + a status flip on
  // their board), not a local lane move, so their board and ours stay in step.
  const requestFix = async () => {
    const message = (typeof window !== "undefined"
      ? window.prompt(`What needs changing? This note is sent to ${vendorLabel(card.vendor)}.`) : "")?.trim()
    if (!message) return
    setBusy(true); setErr(null)
    try {
      const r = await pinkRequestFix({ cardId: card.id, message })
      if (r?.error) throw new Error(r.error)
      patch(card.id, { col: "fix" })
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Couldn't send that back to ${vendorLabel(card.vendor)}.`)
    } finally { setBusy(false) }
  }

  // Removing a card only deletes OUR row. For a vendor card that means the partner's task
  // lives on — they don't offer a cancel API, so it may still be designed AND invoiced, and
  // we've dropped the vendor_ref their finished-work webhook needs (so the file would land
  // as an unknown ref and be ignored). Say all of that before letting it go.
  const removeThis = () => {
    if (card.vendor && typeof window !== "undefined" && !window.confirm(
      `This card was sent to ${vendorLabel(card.vendor)}. Removing it here does NOT cancel it on their board — they have no cancel API, so they may still design and invoice it, and their finished file can no longer reach us. Cancel it on ${vendorLabel(card.vendor)}'s board first.\n\nRemove from our board anyway?`
    )) return
    remove(card.id)
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle className="line-clamp-2 pr-6 text-base leading-snug">{card.title || "Design card"}</DialogTitle></DialogHeader>
        <div className="flex gap-4">
          <div className="relative size-44 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
            {card.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={String(card.thumb)} alt="" className="size-full object-contain" />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground/40"><PenNib size={34} weight="duotone" /></div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{COLS.find((c) => c.id === col)?.label}</span>
              {card.is_emb && <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"><Needle size={10} weight="bold" /> Embroidery</span>}
              {card.priority && card.priority !== "normal" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{String(card.priority)}</span>}
            </div>
            <div className="text-muted-foreground">{card.product || card.type || "—"}</div>
            {card.order_id
              ? <div className="text-muted-foreground">Order <span className="font-mono text-foreground">{String(card.order_id)}</span></div>
              // Saying it belongs to no order, rather than leaving a gap. An orderless card
              // is a normal state here, not missing data — and it's the one state where
              // "Assign to an order" is the obvious next move.
              : <div className="text-muted-foreground">Not attached to an order yet</div>}
            {card.customer && <div className="text-muted-foreground">{String(card.customer)}</div>}
            {card.claimed_by && <div className="text-xs text-muted-foreground">Claimed by {String(card.claimed_by)}</div>}
          </div>
        </div>

        {/* THE THREE ROUTES OUT OF A CARD, in one row because they are alternatives, not a
            sequence. Assign is offered only while the card has no order — reassigning is a
            different and far more dangerous operation (one seller's artwork landing on
            another's job), so it is deliberately not a click away. */}
        <div className="flex flex-wrap gap-2">
          {!card.order_id && (
            <Button size="sm" variant="outline" onClick={onAssign}>
              <LinkSimple size={14} weight="bold" /> Assign to an order
            </Button>
          )}
          {canPush && !card.vendor && (
            <Button size="sm" variant="outline" onClick={onPush}>
              <PaperPlaneTilt size={14} weight="bold" /> Send to Pink Design
            </Button>
          )}
          {card.vendor && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
              With {String(card.vendor)} — paid by invoice, so approving it credits no designer
            </span>
          )}
        </div>

        {/* Their task ref (= our vendor_ref). Shown so it can be cross-referenced on Pink's
            board and pasted into their test-webhook form to verify the sync. select-all makes
            it one click to copy. */}
        {card.vendor && card.vendor_ref && (
          <div className="text-[11px] text-muted-foreground">
            {vendorLabel(card.vendor)} task ref: <span className="select-all font-mono text-foreground">{String(card.vendor_ref)}</span>
          </div>
        )}

        {/* What we actually SENT them — small previews so it's obvious which files already
            went, no filenames needed. Click one to open it full size. */}
        {card.vendor && Array.isArray(card.pushed_images) && card.pushed_images.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Sent to {vendorLabel(card.vendor)}</span>
            <div className="flex flex-wrap gap-2">
              {card.pushed_images.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer"
                   className="block size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
                   title="Open full size">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="size-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Payout is a DESIGNER's earning — a vendor card is paid by invoice, not a payout,
            so the field is hidden for it (the notice above already says so). */}
        {!card.vendor && (canFee ? (
          <label className="flex items-center gap-2">
            <span className="text-sm font-medium">Payout</span>
            <div className="relative w-32">
              <CurrencyDollar size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={pay} onChange={(e) => setPay(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="h-9 pl-7" inputMode="decimal" onBlur={() => patch(card.id, { payment: Number(pay) || 0 })} />
            </div>
          </label>
        ) : (
          amt(card.payment) > 0 && <div className="text-sm text-muted-foreground">Payout <span className="font-medium text-foreground">{money(amt(card.payment))}</span></div>
        ))}

        {/* Files for this card's order — drop the .emb/.pes/mockup right here. The
            card already knows its order_id + sku, so a dropped file is LINKED to the
            order item with no extra step. */}
        {card.order_id && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Files</span>
            <DesignFilesPanel orderId={String(card.order_id)} sku={card.sku || undefined} />
            {/* Who touched this design and when. A designer is gated to the design story
                server-side; operator/warehouse/admin see the order's full history here
                too, including which team member uploaded or removed a file. */}
            <OrderHistory orderId={String(card.order_id)} />
          </div>
        )}

        {err && <div className="text-sm text-destructive">{err}</div>}

        {/* Stage actions */}
        <div className="flex flex-wrap gap-2">
          {card.vendor ? (
            /* This portal is OURS; the partner never sees it — they work the task on their
               own board and their webhook advances OUR lane (In progress → In review →
               Approved). So the internal designer actions (Claim, Send for review, Back to
               work, Credit) are GATED off a vendor card: a hand-move here would silently
               disagree with their board. What's left is a read-only mirror of where it is,
               plus the two calls that are genuinely ours — accepting a returned proof, and
               sending one back for changes (which goes through THEIR API, not a local move). */
            <>
              {(col === "incoming" || col === "inprogress") && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                  Being designed by {vendorLabel(card.vendor)}
                </span>
              )}
              {col === "review" && (
                <>
                  <Button size="sm" onClick={() => move("approved")}><CheckCircle size={14} weight="bold" /> Accept</Button>
                  <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" disabled={busy} onClick={requestFix}><ArrowClockwise size={14} weight="bold" /> Request changes</Button>
                </>
              )}
              {col === "fix" && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
                  Sent back to {vendorLabel(card.vendor)} for changes
                </span>
              )}
              {col === "approved" && (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600"><CheckCircle size={15} weight="fill" /> Approved · {vendorLabel(card.vendor)} (invoiced)</span>
              )}
            </>
          ) : (
            <>
              {/* Sending out lives on the ORDER's item row, not here: the decision is made
                  while looking at the line and its artwork, and a designer opening a card to
                  claim it is not the person deciding to outsource it. */}
              {col === "incoming" && <Button size="sm" onClick={() => move("inprogress", { claimed_by: me })}><Hand size={14} weight="bold" /> Claim</Button>}
              {col === "inprogress" && <Button size="sm" onClick={() => move("review")}><ArrowRight size={14} weight="bold" /> Send for review</Button>}
              {col === "review" && (
                <>
                  <Button size="sm" onClick={() => move("approved")}><CheckCircle size={14} weight="bold" /> Approve</Button>
                  <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => move("fix")}><ArrowClockwise size={14} weight="bold" /> Fix</Button>
                </>
              )}
              {col === "fix" && <Button size="sm" onClick={() => move("inprogress")}><ArrowClockwise size={14} weight="bold" /> Back to work</Button>}
              {col === "approved" && (
                card.credited
                  ? <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600"><CheckCircle size={15} weight="fill" /> Credited {money(amt(card.payment))}</span>
                  : <Button size="sm" onClick={creditNow} disabled={busy}>{busy ? <CircleNotch size={14} className="animate-spin" /> : <><CurrencyDollar size={14} weight="bold" /> Credit {money(Number(pay) || 0)}</>}</Button>
              )}
            </>
          )}
          <button onClick={removeThis} className="ml-auto text-xs font-medium text-muted-foreground hover:text-red-600">Remove card</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
