"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { PenNib, X, CircleNotch, Needle, CurrencyDollar, CheckCircle, ArrowRight, ArrowClockwise, Hand, Columns, CheckSquare, Square, LinkSimple, PaperPlaneTilt, Plus, PencilSimple, Paperclip, MagnifyingGlassPlus, UploadSimple, Trash } from "@phosphor-icons/react"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getDesignCards, saveDesignCards, deleteDesignCard, creditDesignCard, walletTransfer, getFactorySettings, createDesignCard, pinkRequestFix, getDesignBoardHistory, getDesignLanes, createDesignLane, renameDesignLane, deleteDesignLane, uploadPinkAttachment, getEmbPreview, type DesignCard, type AuditRow, type DesignLane } from "@/lib/api"
import { ActivityFeed } from "@/components/app/activity-feed"
import { getToken, getUser } from "@/lib/auth"
import { DesignFilesPanel } from "@/components/app/design-files-panel"
import { AssignCardDialog } from "@/components/app/assign-card-dialog"
import { PushToPartnerInline } from "@/components/app/push-to-partner-dialog"
import { OrderHistory } from "@/components/app/order-history"
import { useConfirm } from "@/components/app/confirm-dialog"

/**
 * Renders a Wilcom TrueView PNG for an EMB card's raw .emb, falling back to `children` (the
 * usual pen-nib placeholder) whenever there's nothing to show. Deliberately ISOLATED and
 * best-effort: any failure — Wilcom not configured, keys removed, route gone, not a native
 * .emb, network error — just leaves the placeholder. Deleting this component + the one call
 * site restores the old behaviour with nothing else touched, and the preview never blocks
 * the card render (it swaps in asynchronously if it arrives).
 */
function EmbPreview({ orderId, sku, children }: { orderId?: string | null; sku?: string | null; children: ReactNode }) {
  const [png, setPng] = useState<string | null>(null)
  useEffect(() => {
    if (!orderId) return
    let live = true
    getEmbPreview({ orderId, sku }).then((r) => { if (live && r.ok && r.png) setPng(r.png) }).catch(() => {})
    return () => { live = false }
  }, [orderId, sku])
  // eslint-disable-next-line @next/next/no-img-element
  if (png) return <img src={`data:image/png;base64,${png}`} alt="" className="size-full object-cover" />
  return <>{children}</>
}

// Board lanes — a linear left-to-right pipeline. Approving a card credits the designer
// once (no separate Paid lane; the credit is idempotent per card).
// There is no Design-partner LANE: outsourcing is an action on a card ("Send to partner"
// in the card dialog), not a column, and the old drop-lane was always empty anyway — a
// vendor card groups into whichever real lane its status maps to, carrying its vendor
// badge. canOutsource still gates that action; it just no longer paints a column.
const canOutsource = () => { const r = getUser()?.role; return r === "admin" || r === "warehouse" || r === "operator" }
/**
 * Deleting a card destroys the record of work someone did, so it is a custody call —
 * warehouse or admin, matching what the server enforces. An operator or designer sees no
 * delete control at all rather than one that 403s.
 */
const canDeleteCard = () => { const r = getUser()?.role; return r === "admin" || r === "warehouse" }

// The seed set + the fallback the board renders with before the server's lanes load.
// Mirrors the design_lanes seed in server/src/routes/design_cards.js. `system` marks the
// two load-bearing lanes: incoming (the fallback) and approved (which credits a designer).
const DEFAULT_LANES: DesignLane[] = [
  { id: "incoming", label: "Incoming", accent: "bg-slate-400", sort: 0, system: true },
  { id: "inprogress", label: "In progress", accent: "bg-violet-500", sort: 1, system: false },
  { id: "review", label: "In review", accent: "bg-amber-500", sort: 2, system: false },
  { id: "fix", label: "Fix", accent: "bg-red-500", sort: 3, system: false },
  { id: "approved", label: "Approved", accent: "bg-emerald-500", sort: 4, system: true },
]
// A card's lane, validated against the CURRENT lanes — an unknown col (a lane that was
// deleted, say) falls back to the first lane rather than vanishing from the board.
const laneOf = (c: DesignCard, lanes: DesignLane[]) => {
  const v = String(c.col || "incoming").toLowerCase()
  return lanes.some((l) => l.id === v) ? v : (lanes[0]?.id ?? "incoming")
}
// Label + accent for a lane id, live lanes first, defaults as a fallback, and the raw id
// last so a card in a lane we somehow don't know still shows *something* rather than blank.
const laneMeta = (id: string, lanes: DesignLane[]) =>
  lanes.find((l) => l.id === id) ?? DEFAULT_LANES.find((l) => l.id === id) ?? { id, label: id, accent: "bg-muted-foreground", sort: 99, system: false }
// Partner keys are storage values ("pinkdesign"); the board shows a human name. Unknown
// vendors fall back to the raw key rather than hiding that the card is outsourced.
const VENDOR_NAMES: Record<string, string> = { pinkdesign: "Pink Design" }
const vendorLabel = (v?: string | null) => (v ? (VENDOR_NAMES[v] ?? v) : "")

// The card's display name. EMB cards arrive titled "Seller file · Ambar.emb"; the seller
// now shows as its own tag, so strip that prefix and show just the file — the "who" is the
// tag, the "what" is the title.
const cardLabel = (c: { title?: string | null; is_emb?: boolean }): string => {
  const t = String(c.title ?? "").trim()
  if (c.is_emb) return t.replace(/^seller file\s*[·:–-]?\s*/i, "").trim() || t || "Embroidery file"
  return t || "Design"
}

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
  // Inline card rename — a single click on the card's NAME edits it in place (Enter/blur
  // saves, Esc cancels). Held at board level so only one name edits at a time, and so the
  // card being edited can suspend its own drag (below) while you select text.
  const [editNameId, setEditNameId] = useState<string | number | null>(null)
  const [nameDraft, setNameDraft] = useState("")
  const [view, setView] = useState<"board" | "list" | "history">("board")
  // The History tab is warehouse+admin, matching who may delete — it's the record of
  // deletions and moves, so the people who make those calls are the ones who see it. An
  // operator or designer gets no tab rather than one that 403s on load.
  const canSeeHistory = canDeleteCard()
  const [query, setQuery] = useState("")
  const [designFee, setDesignFee] = useState(0) // platform default payout per design
  const [partnerCost, setPartnerCost] = useState(0) // what an outsourced design partner costs per task
  const [delErr, setDelErr] = useState<string | null>(null)
  const me = getUser()?.name || "Designer"

  // Lanes as data. Seeded with the defaults so the board paints immediately, then replaced
  // by the server's set (which may add/rename/remove). canManageLanes matches card
  // deletion — a lane holds work, so re-homing or removing it is the same custody call.
  const [lanes, setLanes] = useState<DesignLane[]>(DEFAULT_LANES)
  const canManageLanes = canDeleteCard()
  const loadLanes = useCallback(() => {
    getDesignLanes().then((r) => { if (Array.isArray(r) && r.length) setLanes(r) }).catch(() => {})
  }, [])
  useEffect(() => { const t = setTimeout(loadLanes, 0); return () => clearTimeout(t) }, [loadLanes])

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
      getFactorySettings().then((s) => { setDesignFee(Number(s.designer_payout) || 0); setPartnerCost(Number(s.design_partner_cost) || 0) }).catch(() => {})
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

  // ── Lane management (warehouse+admin) ──
  const addLane = useCallback(async () => {
    const label = window.prompt("Name the new lane")?.trim()
    if (!label) return
    const r = await createDesignLane({ label })
    if (r?.error) { setDelErr(r.error); return }
    loadLanes()
  }, [loadLanes])

  const renameLane = useCallback(async (lane: DesignLane, label: string) => {
    const next = label.trim()
    if (!next || next === lane.label) return
    setLanes((prev) => prev.map((l) => (l.id === lane.id ? { ...l, label: next } : l)))
    const r = await renameDesignLane(lane.id, { label: next })
    if (r?.error) { setDelErr(r.error); loadLanes() }
  }, [loadLanes])

  const removeLane = useCallback(async (lane: DesignLane) => {
    const n = (cards ?? []).filter((c) => laneOf(c, lanes) === lane.id).length
    const ok = await confirm({
      title: `Delete the “${lane.label}” lane?`,
      body: n > 0
        ? `${n} card${n === 1 ? "" : "s"} in this lane will move to “${lanes[0]?.label ?? "Incoming"}”. The lane itself is removed for everyone.`
        : `This lane is empty. It's removed for everyone.`,
      confirmLabel: "Delete lane",
      cancelLabel: "Keep it",
    })
    if (!ok) return
    const r = await deleteDesignLane(lane.id)
    if (r?.error) { setDelErr(r.error); return }
    loadLanes(); load()   // cards may have been re-homed to the fallback
  }, [cards, lanes, confirm, loadLanes, load])

  const patch = useCallback((id: string | number, p: Partial<DesignCard>) => {
    setCards((prev) => {
      const next = (prev ?? []).map((c) => (c.id === id ? { ...c, ...p } : c))
      saveDesignCards(next).catch(() => {})
      return next
    })
  }, [])

  // One search, both views. Matches the things you'd actually look a card up by — its id,
  // title, product/method, order #, and the partner Ref/Task ids. Stats above stay on the
  // FULL set so the totals don't change as you type.
  // WHO sees outsourced (Pink Design, etc.) cards is a ROLE decision, not a blanket one.
  //
  //  • DESIGNER — the internal design portal. A partner card is someone else's work, made
  //    outside and paid by invoice; a designer can't claim, drag or be credited for it, so
  //    it's hidden entirely. Their board is internal work, full stop.
  //  • FACTORY (operator / warehouse / admin) — sees BOTH. The factory tracks the whole
  //    pipeline, internal and outsourced, so a partner card stays on their board, badged
  //    and non-draggable (the partner drives its status, so it can't be dragged through
  //    our lanes).
  //
  // This is the gate the designer portal needs: the same /designer route serves both, and
  // the viewer's role — not the card — decides whether outsourced work is visible.
  const isDesigner = getUser()?.role === "designer"
  const boardCards = useMemo(
    // Designers see neither outsourced (vendor) cards nor EMB-check cards: a seller-supplied
    // .emb is already digitised and only needs a factory check before stitching, so it never
    // enters the designer claim/payout flow — it's factory-internal until it's sent out.
    () => (isDesigner ? (cards ?? []).filter((c) => !c.vendor && !c.is_emb) : (cards ?? [])),
    [cards, isDesigner],
  )
  // Only meaningful on the designer portal, where partner cards are the ones being hidden;
  // the factory sees them, so nothing is withheld there.
  const outsourced = isDesigner ? (cards?.length ?? 0) - boardCards.length : 0

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return boardCards
    return boardCards.filter((c) =>
      [c.id, c.title, c.product, c.type, c.sku, c.order_id, c.vendor_ref, c.vendor_task_id]
        .some((f) => String(f ?? "").toLowerCase().includes(term)))
  }, [boardCards, query])

  const grouped = useMemo(() => {
    const g: Record<string, DesignCard[]> = Object.fromEntries(lanes.map((l) => [l.id, []]))
    for (const c of filtered) (g[laneOf(c, lanes)] ??= []).push(c)
    return g
  }, [filtered, lanes])

  const stats = useMemo(() => {
    const list = boardCards
    const approved = list.filter((c) => laneOf(c, lanes) === "approved").length
    const credited = list.filter((c) => c.credited).reduce((s, c) => s + amt(c.payment), 0)
    // "In progress" = anything past the fallback and short of approved — computed from the
    // lanes rather than a hardcoded id list, so a custom lane counts too.
    const active = list.filter((c) => { const l = laneOf(c, lanes); return l !== (lanes[0]?.id ?? "incoming") && l !== "approved" }).length
    return { total: list.length, active, approved, credited }
  }, [boardCards, lanes])

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
        // Use the filename as the name ONLY when a person actually typed it. An
        // auto-generated name — a screenshot, a random export hash, an IMG_1234 — is noise,
        // so those become a plain "New design" (and a push later sets the real title). This
        // is why a card wasn't titled after a design: its file was a screenshot/hash.
        const base = f.name.replace(/\.[^.]+$/, "").trim()
        const looksAuto = !base || /screenshot/i.test(base) || /^IMG[-_]?\d/i.test(base) || /^[A-Z0-9]{6,}$/.test(base)
        const title = looksAuto ? "New design" : base
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
    moveCard(card, col)
  }

  // Whether the viewer may send to a design partner. The send form now lives INLINE inside
  // the card window (see CardDialog), so there's no separate push dialog to open here.
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
        {/* One search box for BOTH views — id, title, product, order #, partner ids. */}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search designs…"
          className="ml-auto h-9 w-36 sm:w-56"
          aria-label="Search designs"
        />
        <label className="eg-tap inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
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
          {([{ id: "board", label: "Board" }, { id: "list", label: "List" }, ...(canSeeHistory ? [{ id: "history", label: "History" }] as const : [])] as const).map((v) => (
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

      {/* Outsourced work is off the board, but not hidden: it's named so nobody wonders
          where a card went. Its status lives on the order and the partner's board. */}
      {outsourced > 0 && (
        <p className="text-xs text-muted-foreground">
          {outsourced} card{outsourced === 1 ? "" : "s"} outsourced to a design partner — tracked on the order, not on this board.
        </p>
      )}

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
      ) : view === "history" && canSeeHistory ? (
        <BoardHistory />
      ) : view === "list" ? (
        <DesignerList cards={filtered} onOpen={setOpenId} lanes={lanes} />
      ) : (
        // minmax(17rem, 1fr): FILL when there's room, SCROLL when there isn't. With a few
        // lanes the 1fr max stretches them to span the full content width — same margins as
        // the stat cards above, no dead gutter on the right. Add enough that 17rem each no
        // longer fits and the min forces a horizontal scroll instead of shrinking them into
        // slivers. Fixed 17rem (the previous attempt) never filled; pure 1fr never stopped
        // shrinking — minmax is the one rule that does both.
        // A trailing auto track holds the "Add lane" affordance for warehouse/admin.
        <div className="grid gap-2 overflow-x-auto pb-2"
             style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(17rem, 1fr))${canManageLanes ? " auto" : ""}` }}>
          {lanes.map((col) => {
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
                className={"flex h-[calc(100vh-14rem)] min-h-[22rem] min-w-0 flex-col rounded-2xl border bg-card transition-colors " + (overCol === col.id ? "border-primary bg-primary/5" : "border-border")}
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
                  <span className={"size-2 shrink-0 rounded-full " + col.accent} />
                  {/* Rename in place (warehouse+admin) — click the name, edit, Enter/blur
                      saves. A system lane renames too; only its DELETION is blocked. */}
                  {canManageLanes ? (
                    <input
                      defaultValue={col.label}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => void renameLane(col, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { e.currentTarget.value = col.label; e.currentTarget.blur() } }}
                      aria-label={`Rename ${col.label} lane`}
                      className="min-w-0 flex-1 truncate rounded bg-transparent px-1 text-sm font-semibold outline-none hover:bg-accent focus:bg-background focus:ring-2 focus:ring-ring/40"
                    />
                  ) : (
                    <span className="truncate text-sm font-semibold">{col.label}</span>
                  )}
                  <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{list.length}</span>
                  {/* Delete — non-system lanes only. Its cards move to the fallback, so this
                      never strands work; system lanes (fallback + payout) carry no button. */}
                  {canManageLanes && !col.system && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void removeLane(col) }}
                      title={`Delete the ${col.label} lane`}
                      aria-label={`Delete ${col.label} lane`}
                      className="eg-tap shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={13} weight="bold" />
                    </button>
                  )}
                </div>
                {/* Scroll INSIDE the column (min-h-0 lets a flex child scroll) — the page
                    itself stays put instead of growing down as a lane fills. */}
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {list.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground/60">Drop cards or artwork here</div>
                  ) : (
                    list.map((c) => (
                      <div
                        key={String(c.id)}
                        // A vendor card is driven by the partner's board, so it can't be
                        // dragged through our lanes — the same gate the card dialog applies,
                        // enforced on the tile so a drag can't route around it. Renaming also
                        // suspends drag so text selection in the name works.
                        draggable={!c.vendor && editNameId !== c.id}
                        onDragStart={() => { if (!c.vendor) setDragId(c.id) }}
                        onDragEnd={() => setDragId(null)}
                        // shrink-0 is load-bearing: the card area is a flex column, and without
                        // it flexbox COMPRESSES every card to fit the fixed-height lane instead
                        // of overflowing — so cards shrank as you added them and the column never
                        // scrolled. Pinned to their natural height, the lane scrolls as intended.
                        // `relative` anchors the hover-revealed delete button, now a SIBLING of
                        // the image (a button can't be nested inside the image button).
                        // EMB-check cards get a distinct amber frame so the floor spots "already
                        // digitised — verify only", set apart from normal and pink vendor cards.
                        className={"group relative shrink-0 overflow-hidden rounded-xl border text-left shadow-sm transition-shadow hover:shadow " + (c.is_emb ? "border-amber-400 bg-amber-50/60 " : "border-border bg-background ") + (c.vendor ? "cursor-default" : "cursor-grab active:cursor-grabbing")}
                      >
                        {/* IMAGE = open full details on a single click. FIXED-height cover (h-48)
                            so every card is the same height; object-cover fills the frame at any
                            aspect. (The name below has its own click — to rename in place.) */}
                        <button
                          type="button"
                          onClick={() => setOpenId(c.id)}
                          title="Open card details"
                          aria-label={`Open ${c.title || "card"} details`}
                          className="relative block h-48 w-full cursor-pointer overflow-hidden bg-muted"
                        >
                          {c.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={String(c.thumb)} alt="" className="size-full object-cover" />
                          ) : c.is_emb ? (
                            // No thumbnail for a stitch file — try a Wilcom TrueView, else the placeholder.
                            <EmbPreview orderId={c.order_id} sku={c.sku}>
                              <div className="flex size-full items-center justify-center text-muted-foreground/30"><PenNib size={26} weight="duotone" /></div>
                            </EmbPreview>
                          ) : (
                            <div className="flex size-full items-center justify-center text-muted-foreground/30"><PenNib size={26} weight="duotone" /></div>
                          )}
                          {c.is_emb && <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white"><Needle size={9} weight="bold" /> EMB</span>}
                          {/* Top-right tag = WHO owns this card's queue. A partner card shows the
                              partner (pink). Otherwise, if someone on OUR side has claimed it, their
                              NAME shows here — VIOLET when a designer claimed it (e.g. Abdul), SLATE
                              (secondary) when it's factory (operator/warehouse/admin, e.g. Linh) —
                              so at a glance you see who's on the job. */}
                          {c.vendor ? (
                            <span className="absolute right-1.5 top-1.5 inline-flex max-w-[75%] items-center gap-0.5 rounded bg-pink-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">{vendorLabel(c.vendor)}</span>
                          ) : c.claimed_by ? (
                            <span
                              title={`Claimed by ${c.claimed_by}${c.claimed_role ? ` (${c.claimed_role})` : ""}`}
                              className={"absolute right-1.5 top-1.5 inline-flex max-w-[75%] items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white " + (String(c.claimed_role || "").toLowerCase() === "designer" ? "bg-primary/90" : "bg-slate-600/90")}
                            >
                              <span className="truncate">{String(c.claimed_by)}</span>
                            </span>
                          ) : c.seller_name ? (
                            // Unclaimed: show WHOSE order this is — the seller name tag, same
                            // as every other card carries an owner, so an EMB card reads as
                            // "Ambar's file" rather than a faceless "Seller file".
                            <span title={`Seller · ${c.seller_name}`} className="absolute right-1.5 top-1.5 inline-flex max-w-[75%] items-center rounded bg-slate-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              <span className="truncate">{String(c.seller_name)}</span>
                            </span>
                          ) : null}
                        </button>
                        {/* Cancel the card — hover-revealed, a SIBLING of the image button (a
                            button can't nest inside another), positioned over the cover.
                            Warehouse/admin only, matching the server. */}
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
                          className="eg-tap absolute right-1.5 top-1.5 z-10 grid size-5 place-items-center rounded-full bg-background/85 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <X size={11} weight="bold" />
                        </button>}
                        {/* Footer is a flex column: title + meta at the TOP, the DSN id and payout
                            DOCKED to the bottom (mt-auto) so they line up across every card. Kept
                            NEUTRAL — no green/amber tint on the bottom row. */}
                        <div className="flex min-h-[4.75rem] flex-col p-2.5">
                          {/* NAME — a single click edits it in place. Enter/blur saves, Esc cancels. */}
                          {editNameId === c.id ? (
                            <input
                              autoFocus
                              value={nameDraft}
                              onChange={(e) => setNameDraft(e.target.value)}
                              onBlur={() => { const t = nameDraft.trim(); setEditNameId(null); if (t && t !== (c.title || "")) patch(c.id, { title: t }) }}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") setEditNameId(null) }}
                              className="w-full rounded border border-input bg-background px-1 py-0.5 text-sm font-medium leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setEditNameId(c.id); setNameDraft(c.title || "") }}
                              title="Click to rename"
                              className="line-clamp-2 rounded text-left text-sm font-medium leading-tight transition-colors hover:bg-accent"
                            >
                              {cardLabel(c)}
                            </button>
                          )}
                          {/* Order ID + file number ALWAYS show so a card is readable at a glance —
                              a card with no order says "No order" rather than going blank, and the
                              file count shows even at 0. Method/product sits between them when set. */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono" title={c.order_id ? `Order ${c.order_id}` : "Not attached to an order"}>
                              {c.order_id ? String(c.order_id).slice(0, 14) : "No order"}
                            </span>
                            {(c.product || c.type) && (
                              <span className="rounded bg-muted px-1.5 py-0.5">{c.product || c.type}</span>
                            )}
                            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5" title={`${c.file_count ?? 0} design file${(c.file_count ?? 0) === 1 ? "" : "s"}`}>
                              <Paperclip size={9} weight="bold" />{c.file_count ?? 0}
                            </span>
                          </div>
                          {/* Docked to the bottom: DSN id (left) + what the design pays (right).
                              The amount is FACTORY-ONLY — a designer never sees it (their earnings
                              live in their wallet), on internal AND partner cards. Internal = the
                              designer payout (the card's own, or the platform default); partner =
                              what the outsourced task costs us. Neutral text, NO colour — " · paid"
                              once actually credited, " · partner" for an outsourced card, else the
                              plain rate. */}
                          <div className="mt-auto flex items-center justify-between gap-1.5 pt-1.5 text-xs text-muted-foreground">
                            <span className="shrink-0 font-mono">DSN-{c.id}</span>
                            {/* EMB-check cards carry no payout (factory check, not designer
                                work), so the footer figure is suppressed for them. */}
                            {!isDesigner && !c.is_emb && (() => {
                              // Always show a figure — including $0.00 — so the whole board can be
                              // scanned for payout at a glance (a blank used to read as "unknown").
                              const payout = c.vendor ? partnerCost : (amt(c.payment) || designFee)
                              const suffix = c.credited ? " · paid" : c.vendor ? " · partner" : ""
                              return (
                                <span
                                  className="shrink-0 font-medium tabular-nums text-foreground"
                                  title={c.vendor ? "Outsourced — partner cost" : c.credited ? "Credited to the designer" : (c.claimed_by ? `Payout to ${c.claimed_by} on approval` : "Designer payout on approval")}
                                >
                                  {money(payout)}{suffix}
                                </span>
                              )
                            })()}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
          {/* Add a lane — a slim column so it never competes with a real lane for width,
              only offered to warehouse/admin. */}
          {canManageLanes && (
            <button
              onClick={() => void addLane()}
              className="flex h-[calc(100vh-14rem)] min-h-[22rem] w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              title="Add a lane"
            >
              <Plus size={18} weight="bold" />
              <span className="[writing-mode:vertical-rl] text-xs font-medium">Add lane</span>
            </button>
          )}
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
        onPushed={() => { setOpenId(null); load() }} canPush={showPartner} lanes={lanes} />}
    </div>
  )
}

// Every column the list CAN show. `design` is locked on (the thumb + title).
type ListCol = { id: string; label: string; align?: "right"; locked?: boolean; cell: (c: DesignCard) => React.ReactNode }
const makeListCols = (lanes: DesignLane[]): ListCol[] => [
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
      <span className="max-w-[220px] truncate font-medium">{cardLabel(c)}</span>
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
    ? <span className="inline-flex items-center gap-1 rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700">{vendorLabel(c.vendor)}</span>
    : c.claimed_by
      ? <span className="text-foreground">{String(c.claimed_by)}</span>
      : <span className="text-muted-foreground">Unclaimed</span> },
  { id: "priority", label: "Priority", cell: (c) => (c.priority && c.priority !== "normal" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{String(c.priority)}</span> : <span className="text-muted-foreground">—</span>) },
  { id: "files", label: "Files", cell: (c) => ((c.file_count ?? 0) > 0 ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Paperclip size={11} weight="bold" /> {c.file_count}</span> : <span className="text-muted-foreground">—</span>) },
  // The lane IS the status, so it's labelled "Status". (The old separate "Status" column only
  // said Credited/—, which the Payout column already implies — removed.)
  { id: "lane", label: "Status", cell: (c) => { const col = laneMeta(laneOf(c, lanes), lanes); return <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"><span className={"size-1.5 rounded-full " + col.accent} /> {col.label}</span> } },
  { id: "payout", label: "Payout", align: "right", cell: (c) => <span className="font-semibold tabular-nums">{amt(c.payment) > 0 ? money(amt(c.payment)) : "—"}</span> },
]
const DEFAULT_LIST_COLS = ["design", "order", "product", "claimed", "files", "lane", "payout"]

// List view — columns are add/remove + renameable (admin/warehouse/operator), persisted.
function DesignerList({ cards, onOpen, lanes }: { cards: DesignCard[]; onOpen: (id: string | number) => void; lanes: DesignLane[] }) {
  const LIST_COLS = makeListCols(lanes)
  const order: string[] = lanes.map((l) => l.id)
  const rows = [...cards].sort((a, b) => order.indexOf(laneOf(a, lanes)) - order.indexOf(laneOf(b, lanes)))
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
          // Same one-time surfacing for the new "Files" column.
          if (!v.includes("files") && !localStorage.getItem("eg_dsn_cols_files")) {
            const at = v.indexOf("lane")
            v = at >= 0 ? [...v.slice(0, at), "files", ...v.slice(at)] : [...v, "files"]
            localStorage.setItem("eg_dsn_cols", JSON.stringify(v))
          }
          localStorage.setItem("eg_dsn_cols_files", "1")
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
function CardDialog({ card, me, designFee, onClose, patch, onMove, remove, onAssign, onPushed, canPush, lanes }: { card: DesignCard; me: string; designFee: number; lanes: DesignLane[]; onClose: () => void; patch: (id: string | number, p: Partial<DesignCard>) => void; onMove: (card: DesignCard, to: string, extra?: Partial<DesignCard>) => void; remove: (id: string | number) => void; onAssign: () => void; onPushed: () => void; canPush: boolean }) {
  // Default the payout to the platform Design fee when the card hasn't set one.
  const [pay, setPay] = useState(String(amt(card.payment) || designFee || ""))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const col = laneOf(card, lanes)

  // Click-to-rename the card. Saves only on a real change, so opening and closing the editor
  // by accident doesn't rewrite the title. A vendor card is renameable here too, but note the
  // change stays on OUR side — it doesn't push back to the partner's board.
  const [editTitle, setEditTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(card.title || "")
  const saveTitle = () => {
    const t = titleDraft.trim()
    setEditTitle(false)
    if (t && t !== card.title) patch(card.id, { title: t })
  }

  // Card DESCRIPTION / notes — free text for customised-design instructions. Persisted in the
  // card's `specs` blob (specs.description), which already round-trips through the whole-list
  // save, so no schema change. This is the single place notes live; the partner push reads
  // the same text, so there aren't two separate windows to keep in sync.
  const cardSpecs = (card.specs && typeof card.specs === "object" ? card.specs : {}) as Record<string, unknown>
  const [desc, setDesc] = useState(String(cardSpecs.description ?? ""))
  const saveDesc = () => {
    const next = desc.trim()
    if (next === String(cardSpecs.description ?? "")) return
    patch(card.id, { specs: { ...cardSpecs, description: next } })
  }

  // The partner-send form is revealed INLINE in this same window (no second dialog). The
  // card supplies the artwork, title and description; only the partner-specific fields show.
  const [showPush, setShowPush] = useState(false)
  // Click the artwork to view it full size (a lightbox, not a new tab — a data-URL thumb
  // can't be opened as a top-level navigation in Chrome).
  const [zoom, setZoom] = useState(false)

  // Reference files kept ON the card (mockups, spec sheets — custom designs often need
  // several). Persisted in specs.reference_files, so they stay with the card, and reused as
  // the attachments on a Pink Design push. Upload goes through the same object-storage
  // endpoint the push uses, so each returns a real URL.
  type RefFile = { url: string; name?: string }
  const refFiles: RefFile[] = Array.isArray(cardSpecs.reference_files) ? (cardSpecs.reference_files as RefFile[]) : []
  const [refBusy, setRefBusy] = useState(false)
  const [refErr, setRefErr] = useState<string | null>(null)
  const addRefFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setRefBusy(true); setRefErr(null)
    const added: RefFile[] = []
    try {
      for (const f of Array.from(files)) {
        const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("unreadable")); r.readAsDataURL(f) })
        const r = await uploadPinkAttachment({ data, name: f.name })
        if (r.url) added.push({ url: r.url, name: f.name })
        else setRefErr(r.error || `Couldn't upload ${f.name}.`)
      }
      if (added.length) patch(card.id, { specs: { ...cardSpecs, reference_files: [...refFiles, ...added] } })
    } catch (e) { setRefErr(e instanceof Error ? e.message : "Couldn't upload that file.") } finally { setRefBusy(false) }
  }
  const removeRefFile = (i: number) => patch(card.id, { specs: { ...cardSpecs, reference_files: refFiles.filter((_, j) => j !== i) } })

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
        <DialogHeader>
          {/* Title (wraps to two lines) on the left; the STATUS pill sits up here by the close
              X so the card's state reads at a glance and the title has room to be long. */}
          <div className="flex items-start justify-between gap-3 pr-7">
            <DialogTitle className="min-w-0 flex-1 text-base leading-snug">
              {editTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveTitle() }
                    else if (e.key === "Escape") { setTitleDraft(card.title || ""); setEditTitle(false) }
                  }}
                  placeholder="Card title"
                  className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-base font-semibold outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { setTitleDraft(card.title || ""); setEditTitle(true) }}
                  title="Click to rename"
                  className="group -ml-1 inline-flex max-w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="line-clamp-2">{cardLabel(card)}</span>
                  <PencilSimple size={13} weight="bold" className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
            </DialogTitle>
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              <span className={"size-1.5 rounded-full " + laneMeta(col, lanes).accent} />
              {laneMeta(col, lanes).label}
            </span>
          </div>
        </DialogHeader>

        {/* Enlarged artwork on the LEFT (click to view full size) + description/notes on the
            RIGHT — the notes area is the whole point of this window for a custom design. */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => { if (card.thumb) setZoom(true) }}
            disabled={!card.thumb}
            title={card.thumb ? "Click to view full size" : undefined}
            className="group relative size-52 shrink-0 overflow-hidden rounded-xl border border-border bg-muted disabled:cursor-default"
          >
            {card.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={String(card.thumb)} alt="" className="size-full object-contain" />
            ) : card.is_emb ? (
              <EmbPreview orderId={card.order_id} sku={card.sku}>
                <div className="flex size-full items-center justify-center text-muted-foreground/40"><PenNib size={40} weight="duotone" /></div>
              </EmbPreview>
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground/40"><PenNib size={40} weight="duotone" /></div>
            )}
            {card.thumb && (
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/80 py-1 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                <MagnifyingGlassPlus size={11} weight="bold" /> Full size
              </span>
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <label htmlFor={`card-desc-${card.id}`} className="mb-1 text-sm font-medium">{card.is_emb ? "Check notes" : "Description / notes"}</label>
            <textarea
              id={`card-desc-${card.id}`}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={saveDesc}
              placeholder={card.is_emb
                ? "Notes for the factory check — thread colours, placement, anything to verify before stitching. Saved to the card."
                : "Notes for this design — placement, colours, personalisation, anything the designer needs. Saved to the card."}
              className="min-h-[9rem] w-full flex-1 resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
        </div>

        {/* Compact meta line — method / priority / product, order state, customer, claimer.
            Status moved up to the header, so it isn't repeated here. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {card.is_emb && <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"><Needle size={10} weight="bold" /> Embroidery</span>}
          {card.priority && card.priority !== "normal" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{String(card.priority)}</span>}
          <span>{card.product || card.type || "No product / type set"}</span>
          <span aria-hidden>·</span>
          {card.order_id
            ? <span>Order <span className="font-mono text-foreground">{String(card.order_id)}</span></span>
            : <span>Not attached to an order yet</span>}
          {card.customer && <><span aria-hidden>·</span><span>{String(card.customer)}</span></>}
          {card.claimed_by && <><span aria-hidden>·</span><span>Claimed by {String(card.claimed_by)}</span></>}
        </div>

        {/* Routes out of the card — assign to an order, or send to the design partner (the
            send form opens inline below). */}
        <div className="flex flex-wrap gap-2">
          {!card.order_id && (
            <Button size="sm" variant="outline" onClick={onAssign}>
              <LinkSimple size={14} weight="bold" /> Assign to an order
            </Button>
          )}
          {/* EMB-check cards are already digitised — Pink Design DIGITISES raw art, so it's
              not an option here. They only get a factory check before stitching. */}
          {canPush && !card.vendor && !card.is_emb && (
            <Button size="sm" variant={showPush ? "secondary" : "outline"} onClick={() => setShowPush((v) => !v)}>
              <PaperPlaneTilt size={14} weight="bold" /> Send to Pink Design
            </Button>
          )}
        </div>

        {/* Reference files kept ON OUR card — mockups, spec sheets, the several refs a custom
            design usually needs. Persisted (specs.reference_files) so they stay with the card,
            and reused as the attachments when it's sent to Pink Design. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Reference files{refFiles.length ? ` (${refFiles.length})` : ""}</span>
            <label className={"inline-flex cursor-pointer items-center gap-1.5 text-xs " + (refBusy ? "opacity-60" : "text-primary hover:underline")}>
              {refBusy ? <CircleNotch size={13} className="animate-spin" /> : <UploadSimple size={13} weight="bold" />}
              Add files
              <input type="file" multiple className="hidden" disabled={refBusy} onChange={(e) => { void addRefFiles(e.target.files); e.currentTarget.value = "" }} />
            </label>
          </div>
          {refErr && <p className="text-xs text-destructive">{refErr}</p>}
          {refFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">{card.is_emb
              ? "Mockups, spec sheets, marked-up screenshots — anything to check the stitch file against. Kept on the card."
              : "Mockups, spec sheets, marked-up screenshots — anything that tells the designer what you want. Kept on the card and sent with a Pink Design push."}</p>
          ) : (
            <div className="space-y-1">
              {refFiles.map((f, i) => (
                <div key={f.url + i} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
                  <Paperclip size={12} weight="bold" className="shrink-0 text-muted-foreground" />
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">{f.name || f.url}</a>
                  <button onClick={() => removeRefFile(i)} className="shrink-0 text-muted-foreground hover:text-red-600" title="Remove"><Trash size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Partner send, inline in THIS window — revealed by the "Send to Pink Design" button
            above, no separate popup. The card supplies the artwork, title and notes; only the
            partner-specific fields (product type, board, reference files) show here. On a
            successful send the parent closes and reloads, and the card returns as a Pink card. */}
        {showPush && canPush && !card.vendor && (
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <PushToPartnerInline
              cardId={String(card.id)}
              orderId={card.order_id ? String(card.order_id) : undefined}
              sku={card.sku ? String(card.sku) : undefined}
              itemName={card.title}
              printType={card.type}
              artworkUrl={card.thumb ? String(card.thumb) : null}
              initialDescription={desc}
              // The card's own reference files ARE the attachments — no separate uploader here.
              presetExtras={refFiles.map((f) => ({ url: f.url, name: f.name || "reference" }))}
              onPushed={() => onPushed()}
              onCancel={() => setShowPush(false)}
            />
          </div>
        )}

        {/* Their task ref (= our vendor_ref). Shown so it can be cross-referenced on Pink's
            board and pasted into their test-webhook form to verify the sync. select-all makes
            it one click to copy. */}
        {card.vendor && ((card.vendor_ref || card.vendor_task_id) ? (
          // Ref ID + Task ID side by side, big enough to read and copy — labelled to match
          // Pink's test-webhook form. Either one is enough for our webhook to match.
          <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
              {card.vendor_task_id && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Task ID</div>
                  <div className="select-all font-mono text-sm font-medium text-foreground">{String(card.vendor_task_id)}</div>
                </div>
              )}
              {card.vendor_ref && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ref ID</div>
                  <div className="select-all font-mono text-sm font-medium text-foreground">{String(card.vendor_ref)}</div>
                </div>
              )}
            </div>
            {card.vendor_ref && !card.vendor_task_id && (
              <div className="text-[10px] text-muted-foreground">
                Pink returns only the Ref ID on push — on their test-webhook form, put this in <span className="font-semibold">both</span> the Ref ID and Task ID fields.
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-amber-600">
            No Ref/Task ID was recorded for this card, so status sync is off for it. Re-push to capture it.
          </div>
        ))}

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

        {/* What the partner RETURNED (their webhook deliverables — often a Drive folder link).
            Shown as openable links since a folder can't be previewed. */}
        {card.vendor && Array.isArray(card.vendor_files) && card.vendor_files.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-emerald-700">Received from {vendorLabel(card.vendor)}</span>
            <div className="flex flex-col gap-1">
              {card.vendor_files.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 truncate rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
                  <LinkSimple size={13} weight="bold" className="shrink-0" />
                  <span className="truncate">{src}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Payout is a DESIGNER's earning. A vendor card is paid by invoice (field hidden),
            and only a designer is actually credited on approval — so if the claimer is an
            operator/warehouse/admin, don't show an amount that implies a credit the server
            will refuse. Say plainly it won't pay out instead. */}
        {(() => {
          // No payout on a vendor card (invoiced) or an EMB-check card (a factory check, not
          // designer work — nobody is credited for it).
          if (card.vendor || card.is_emb) return null
          const claimedRole = String(card.claimed_role || "").toLowerCase()
          const wontPay = !!card.claimed_by && !!claimedRole && claimedRole !== "designer"
          if (wontPay) {
            return (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                No payout — claimed by {claimedRole}
              </div>
            )
          }
          return canFee ? (
            <label className="flex items-center gap-2">
              <span className="text-sm font-medium">Payout</span>
              <div className="relative w-32">
                <CurrencyDollar size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={pay} onChange={(e) => setPay(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="h-9 pl-7" inputMode="decimal" onBlur={() => patch(card.id, { payment: Number(pay) || 0 })} />
              </div>
            </label>
          ) : (
            amt(card.payment) > 0 ? <div className="text-sm text-muted-foreground">Payout <span className="font-medium text-foreground">{money(amt(card.payment))}</span></div> : null
          )
        })()}

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

        {/* Full-size artwork lightbox — fixed to the viewport (escapes the dialog's scroll
            box), click anywhere to close. Works for a remote URL or a base64 data-URL thumb. */}
        {zoom && card.thumb && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Close full-size view"
            onClick={() => setZoom(false)}
            onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") setZoom(false) }}
            className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={String(card.thumb)} alt={card.title || "Design"} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Board history ──────────────────────────────────────────────────────────────
// The record of what happened to cards — deletions first in prominence, then moves,
// credits, assignments and creations. Reads the warehouse+admin board-history endpoint
// (its own, so a warehouse never touches the admin-only global audit feed). The action
// badges + wording come from the shared activity registry (activity-meta), same as every
// other history feed; only the per-row SUBJECT (card title, lane move, lost payout) is
// board-specific and lives here.
function boardSubject(r: AuditRow) {
  const b = (r.before ?? {}) as Record<string, unknown>
  const title = String(b.title || "") || (r.entity_id ? `Card ${r.entity_id}` : "a card")
  const from = String(((r.before ?? {}) as Record<string, unknown>).col ?? "")
  const to = String(((r.after ?? {}) as Record<string, unknown>).col ?? "")
  return (
    <>
      <span className="text-foreground">{title}</span>
      {r.action === "design.lane" && (from || to) && (
        <span className="text-muted-foreground"> · {from || "?"} → {to || "?"}</span>
      )}
      {r.action === "design_card.deleted" && amt(b.payment) > 0 && (
        <span className="text-muted-foreground"> · was worth {money(amt(b.payment))}</span>
      )}
    </>
  )
}

function BoardHistory() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [onlyDeletes, setOnlyDeletes] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      getDesignBoardHistory()
        .then((r) => setRows(Array.isArray(r) ? r : []))
        .catch(() => setErr("Couldn't load the board history."))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  if (err) return <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</div>
  if (rows === null) return <div className="flex items-center justify-center py-24 text-muted-foreground"><CircleNotch size={24} className="animate-spin" /></div>

  const shown = onlyDeletes ? rows.filter((r) => r.action === "design_card.deleted") : rows
  const deletes = rows.filter((r) => r.action === "design_card.deleted").length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{rows.length} action{rows.length === 1 ? "" : "s"} recorded · {deletes} deletion{deletes === 1 ? "" : "s"}</span>
        {/* The tab exists mainly to answer "what got deleted?" — so a one-click filter to
            exactly that, without hunting through moves and credits. */}
        <button onClick={() => setOnlyDeletes((v) => !v)}
          className={"eg-tap ml-auto rounded-full border px-3 py-1 text-xs font-medium transition-colors " + (onlyDeletes ? "border-red-300 bg-red-50 text-red-700" : "border-border text-muted-foreground hover:bg-accent")}>
          {onlyDeletes ? "Showing deletions only" : "Deletions only"}
        </button>
      </div>

      <ActivityFeed
        rows={shown}
        variant="card"
        note={false}
        subject={boardSubject}
        empty={onlyDeletes ? "No cards have been deleted." : "Nothing recorded yet."}
      />
    </div>
  )
}
