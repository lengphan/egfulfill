"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useRef, useState } from "react"
import { Check, X } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateOrder, type OrderRow } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { numOf, shortOrderRef, egfRef } from "@/lib/order-format"
import { cn } from "@/lib/utils"

/**
 * THE ORDER NUMBER, AND THE ONE PLACE IT CAN BE CHANGED.
 *
 * `#6` is `orders.seq` — an integer minted per seller as max(seq)+1. It is a LABEL: nothing
 * joins on it, and it is not `orders.id`, which is the primary key and is referenced by
 * order_items, order_designs, order_messages, order_threads, design_cards, design_file_data,
 * shipments, manifests and the wallet ledger. Changing the id is a migration; changing this
 * is an edit, and that distinction is the whole reason this component only offers the one.
 *
 * ONE COMPONENT, not an edit affordance per board. §4: a rule with no primitive is a wish —
 * the number is rendered on the order page, the staff hub, the dashboard and the staff
 * dashboard, and four hand-rolled inline editors would be four sets of behaviour for the
 * same field.
 *
 * THE EDIT LIVES ON THE ORDER PAGE, AND NOWHERE ELSE. In a LIST the number is the row's
 * identity and the row opens the order — so a click there has one meaning, and an editor
 * that opened instead was a control ambushing the gesture the whole table teaches. It also
 * put the field where the least context is: a hub row shows a number, a store and a date,
 * which is not enough to be sure you are renumbering the right order. Open it and change it
 * there, where the buyer, the lines and the money are on screen. Lists therefore pass no
 * `editable` at all and get the plain span the component replaced.
 *
 * IT OWNS ITS OWN SIZE, and that is the point of the rest of this docblock being true.
 * The number was rendered at THREE sizes across eight sites — text-sm/600 on the staff hub,
 * dispatch and the staff dashboard, text-xs/600 on the seller dashboard, text-xs/500 on the
 * seller list, text-xs/400 in the assign dialog — because this component took `className`
 * and rendered whatever it was handed. A primitive that owns behaviour but not appearance
 * is half a primitive; the size drifts at the speed new call sites are written.
 *
 * It is the row's IDENTITY, so it is the heaviest thing in the row: `text-sm font-semibold`
 * against a table body that is `text-sm` at normal weight.
 *
 * That line used to end "and a store/date/tracking that are text-xs", and the TRACKING half
 * of it was wrong — §4 names a tracking number in the VALUE band explicitly ("something
 * read, copied or transcribed: an account number, a tracking number, a reference, a total,
 * an order number"), and it is the longest identifier in the row and the one people
 * actually transcribe. It is text-sm now. Only the genuinely derived captions — Age, and
 * the store's second line — stay text-xs.
 *
 * SIZE says what a thing IS, WEIGHT says what is happening to it. A staff row was measured
 * at two sizes and three weights with no rule joining them: the order number and a single
 * digit of quantity were both semibold, and so is a LIVE status (lib/status-tone.ts) — so
 * semibold meant three unrelated things in one row. Weight now belongs to identity and to
 * status; every other value sits at text-sm, normal.
 * `cn()` is tailwind-merge, so a caller that genuinely needs another size still wins by
 * passing one — but it has to say so.
 *
 * SHAPE SAYS KIND (§4). Read-only it is type, because that is what it is. Pressed, it becomes
 * a real `Input` — a field you SET — with its own confirm and cancel. It never wears button
 * chrome while it is only a label; the hover tint is the whole hint, and the `title` says the
 * rest so no sentence has to sit underneath it.
 */
/** The row's identity, and the largest thing in it. See the docblock above. */
const BASE = "tabular-nums text-sm font-semibold"

export function OrderNumber({
  order,
  editable = false,
  onSaved,
  className = "",
}: {
  order: OrderRow
  /** Staff only. The server refuses a seller regardless — this decides whether to OFFER it. */
  editable?: boolean
  /** Re-read the row: the number changed, so every list showing it is now stale. */
  onSaved?: (label: string | null) => void
  className?: string
}) {
  const tl = useLabelT()
  const label = numOf(order)
  /**
   * THE NUMBER THE SELLER GAVE US, beside the one we minted.
   *
   * An import sheet's Order Number column is stored on every order that carried one — 46 of
   * them on this floor — and until now nothing read it back. It was written, grouped lines
   * into orders, and then vanished: a seller typed 56232323, opened the order and found #2.
   *
   * BESIDE, never instead. `#seq` is what staff quote in messages, what the design-fee notes
   * reference and what the boards sort on; swapping it for a seller's own reference would
   * break every one of those. This is the buyer's number in the marketplace sense — the same
   * job an Etsy receipt number does on an Etsy order — so it sits where that would.
   *
   * Nothing shows for an order that never carried one, which is most of them: an empty
   * caption under every number is worse than the omission it is fixing.
   */
  /**
   * THE NUMBER THE OTHER SIDE USES, under ours.
   *
   * This carried the import sheet's reference and nothing else, so a row imported from a
   * spreadsheet showed the buyer's number and a row synced from Etsy showed none at all
   * (owner: "the platform synced ID should be underneath — not just for imported sheet").
   * The two are the same question: what does whoever sent us this order call it?
   *
   * For a synced order that number is in the id — `etsy-4176340642` — and shortOrderRef is
   * the shared rule for taking the routing prefix off, which "leaves the number the buyer and
   * the marketplace both use". Reusing it means the wallet, the purchase orders and this row
   * all shorten an id the same way rather than three of them agreeing by luck (§5).
   *
   * A MANUAL ORDER GETS NOTHING, deliberately. shortOrderRef would hand back `FF-2mfrc`, the
   * tail of a key we minted ourselves — not a number anyone else holds, and the line under
   * EGF-001295 is for the other side's reference. An order nobody else numbered has none.
   */
  const sheetRef = String(
    (order.meta as { sourceOrderNumber?: unknown } | undefined)?.sourceOrderNumber ?? ""
  ).trim()
  const fromPlatform = !!order.source && String(order.source).toLowerCase() !== "manual"
  const otherRef = sheetRef || (fromPlatform ? shortOrderRef(String(order.id ?? "")) : "")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  /*
   * THE GATE LIVES HERE, not at the call site.
   *
   * `editable` says whether this SURFACE wants to offer the edit; this says whether the
   * person may have it. It MIRRORS the server, which is the boundary that actually refuses —
   * a control that is always refused is worse than no control (§4). Deriving it in each board
   * is how one board forgets.
   *
   * STAFF ALWAYS; THE SELLER ONLY WHILE IT IS A DRAFT (owner's call, 2026-09-10). Their draft
   * is their own document — nobody has quoted it and nothing has been charged — and the
   * number exists so it can line up with whatever they run their shop on. Once pushed it is
   * on the floor, in their emails and in the audit trail, so it stops being theirs to move.
   *
   * The same three statuses everything else treats as "not submitted yet", and the same test
   * the PATCH route makes before it will write `seq`.
   */
  const role = getUser()?.role || ""
  /* `unsubmitted`, not `draft` — the edit box already owns that name in this component. */
  const unsubmitted = ["", "new", "draft"].includes(String(order.factory_status ?? "").toLowerCase())
  const mayEdit = editable && !!role && (role !== "seller" || unsubmitted)

  if (!mayEdit) {
    if (!otherRef) return <span className={cn(BASE, className)}>{label}</span>
    return (
      /* TWO CHANGES, BOTH MEASURED (2026-09-21, "this look jammed").
         GAP: the two lines abutted at exactly 0px — measured 188-210 and 210-231 — so a
         number and its reference read as one mushy block rather than a title with a note
         under it.
         AND `className` NOW REACHES THE NUMBER. It was on the CONTAINER, where a font size
         cannot survive a child that sets its own: BASE is text-sm, so the order page's
         `text-2xl` never applied and both lines rendered at the same 15px. The note at that
         call site says it passes the size "so it overrides the primitive's row size
         explicitly" — it did not, and this is what makes that sentence true. Only that one
         call site passes a className at all, so nothing else moves. */
      <span className="inline-flex flex-col gap-0.5 leading-tight">
        {/**
         * THE OTHER SIDE'S NUMBER GOES ON TOP (owner, 2026-09-21: "push the order ID /
         * marketplace or self entered order ID on top - instead of our web ID on top").
         *
         * It is the number the work is FOUND by: a buyer quotes it, a marketplace shows it,
         * a seller typed it into their own sheet. `EGF-002056` is ours, and ours is the one
         * that can be looked up from either end — so the reference nobody else holds was
         * sitting above the one everybody does.
         *
         * STILL BESIDE, NEVER INSTEAD, which is what the note above actually protects: `#seq`
         * remains on the row, quotable, sortable and the thing the boards key on. Only the
         * emphasis moved. Swapping it OUT is what would break the design-fee notes and every
         * message that cites it.
         *
         * An order that never carried one still shows ours alone — the branch above returns
         * before this, so there is no stack to invert and no empty line where the marketplace
         * number would have been.
         */}
        <span className={cn(BASE, className)}
              title={sheetRef
                ? tl("orderNumber", "The number from the import sheet")
                : tl("orderNumber", "The order's number on the platform it came from")}>
          {otherRef}
        </span>
        {/* A VALUE, so text-xs and not smaller — it is a reference somebody reads off a sheet
            and matches against ours, which §4 puts at 12px minimum and never at 11. */}
        {/* text-sm, NOT text-xs. §4 puts an order number in the VALUE band — "an account
            number, a tracking number, a reference, a total, an order number" — with a 14px
            floor, because it is read, copied and matched against somebody's own records. The
            Store column's second line IS 12px, and correctly: "Manual · linh" is a label, read
            once and ignored. This is the other kind.
            It still sits under #74 rather than beside it, and still gives way to it — by
            WEIGHT and COLOUR, which is what §4 says carries importance. Shrinking a value
            below its floor is not a way to make it secondary, it is a way to make it
            unreadable, and at 12px against a semibold 14px the size jump was the thing that
            read as untidy. */}
        {/* OURS, UNDER IT. Still text-sm: §4 puts an order number in the VALUE band with a
            14px floor because it is read, copied and matched against somebody's records —
            it gives way by WEIGHT and COLOUR, never by being shrunk below legibility. */}
        <span
          className="text-sm font-normal tabular-nums text-muted-foreground"
          title={tl("orderNumber", "Our reference for this order")}
        >
          {label}
        </span>
      </span>
    )
  }

  const open = () => {
    setDraft(String(order.ref_label ?? ""))
    setErr(null)
    setEditing(true)
  }

  /**
   * A CUSTOM ORDER ID, not a number (owner, 2026-09-26: "T01" was refused with "a whole
   * number above zero"). It is stored as `ref_label` and printed in place of the EGF number
   * everywhere numOf runs; empty puts the EGF number back.
   *
   * This used to write `seq` — which numOf never shows on an order that has an EGF number,
   * so even an accepted edit changed nothing on screen.
   */
  const commit = async () => {
    const want = draft.replace(/^\s*#\s*/, "").replace(/\s+/g, " ").trim()
    // Refuse locally what the server would refuse anyway, so the common typo costs no round
    // trip and the reason is the same sentence either way.
    if (want.length > 32) { setErr(tl("orderNumber", "An order ID is at most 32 characters.")); return }
    if (want && !/^[A-Za-z0-9][A-Za-z0-9 ._\/-]*$/.test(want)) { setErr(tl("orderNumber", "Use letters, numbers, spaces, and - _ . / only.")); return }
    if (/^EGF-?\d+$/i.test(want)) { setErr(tl("orderNumber", "EGF- numbers belong to the platform — choose an ID without that prefix.")); return }
    if (want === String(order.ref_label ?? "")) { setEditing(false); return }
    setBusy(true); setErr(null)
    try {
      const r = await updateOrder(String(order.id), { refLabel: want || null })
      // The server owns the collision check — it is the only side that can see every other
      // order — so its refusal is the one shown, verbatim.
      if (r?.error) { setErr(r.error); return }
      setEditing(false)
      onSaved?.(want || null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change the number.")
    } finally { setBusy(false) }
  }

  if (!editing) {
    return (
      <button
        type="button"
        /* These numbers sit inside rows that navigate on click. Without this, pressing the
           number both opened the editor and left the page it was on. */
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); open() }}
        title={tl("orderNumber", "Change this order's ID")}
        className={cn("-mx-1 rounded px-1 text-left hover:bg-accent", BASE, className)}
      >
        {label}
        {/* The editable state shows it too, or pressing the number would make the seller's own
            reference disappear — a control that hides a fact while you use it. */}
        {otherRef && (
          <span className="ml-1.5 text-sm font-normal tabular-nums text-muted-foreground">{otherRef}</span>
        )}
      </button>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="inline-flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          autoFocus
          maxLength={32}
          /* The number it reads as without one — clearing the field goes back to it. */
          placeholder={egfRef(order.ref_no) || "T01"}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commit() }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); setErr(null) }
          }}
          className="h-8 w-44 tabular-nums"
          aria-label={tl("orderNumber", "Order ID")}
        />
        <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => void commit()} aria-label={tl("orderNumber", "Save number")}>
          <Check size={15} />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" disabled={busy}
          onClick={() => { setEditing(false); setErr(null) }} aria-label={tl("orderNumber", "Cancel")}>
          <X size={15} />
        </Button>
      </span>
      {/* A refusal carries its reason — that is the answer, not a subtitle (§4). */}
      {err && <span className="text-xs font-normal text-destructive">{err}</span>}
    </span>
  )
}
