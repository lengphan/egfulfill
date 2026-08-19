"use client"

import { useState } from "react"
import { DotsThree } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { FACTORY_STAGES, EXCEPTION_STAGES, normalizeStage, nextStage, orderStage, isException, canSetStage, stageDenialReason, canWalk, isFactoryOrder } from "@/lib/factory-status"
import { postItemStatus, updateOrder, type OrderRow } from "@/lib/api"
import { useConfirm } from "@/components/app/confirm-dialog"

/**
 * The per-order factory ⋯ menu — the SAME stage/permission surface the boards row carries,
 * lifted out so the order-detail page can offer it too. The board row is the quick option;
 * the detail page is where an order is actually worked, so the full move set belongs here.
 *
 * Every rule comes from lib/factory-status (canSetStage / stageDenialReason / canWalk), which
 * mirrors the server — so what this menu allows is exactly what the API would allow, and a
 * refusal shows the server's own reason rather than a guess. Nothing is hidden per role: a
 * disallowed stage is disabled with its reason, so "you may not" never looks like "no such
 * thing". A skippable stage this role could legally walk becomes a confirmed catch-up.
 */
export function OrderStageMenu({ order, role, onChanged, onNewLabel, canFulfill, onError }: {
  order: OrderRow
  role: string
  onChanged: () => void
  /**
   * PASS THIS ONLY IF THE CALLER IS NOT ALREADY SHOWING A LABEL CONTROL.
   *
   * Omitted ⇒ no "New label" row. The order-detail page renders LabelActionButton in the
   * same button row under the same condition (staff who can fulfil), so the menu was
   * offering a second door to a window already open two buttons to its left — and the two
   * did not even agree on the name, one saying "Create label" and the other "New label".
   * The button is the better of the pair: it also knows when a label already EXISTS, where
   * this row would cheerfully buy a second one.
   */
  onNewLabel?: () => void
  canFulfill?: boolean
  onError?: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  const items = order.items ?? []
  const stage = orderStage(items)
  const stopped = isException(stage)
  // The factory's own order runs a line without Pending on it — see FACTORY_LINE. Every
  // rule below reads it, so the menu offers the same moves the API would accept.
  const fac = isFactoryOrder(order)
  const next = nextStage(stage, fac)
  const canAdvance = !!next && canSetStage(role, stage, next, fac)
  const canShip = !!canFulfill && !stopped && !!onNewLabel

  const setOrderStatus = async (to: string) => {
    setBusy(true)
    try {
      for (const it of items) if (it.sku || it.line_id) await postItemStatus(order.id, it.sku ?? "", to, it.line_id)
      await updateOrder(order.id, { factoryStatus: to })
      onChanged()
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Couldn't change that order's status.")
    } finally { setBusy(false) }
  }

  // Every stage, each tagged with the server's refusal (if any) and whether this role could
  // legally WALK to it (a confirmed catch-up rather than an outright refusal).
  const withReason = (list: typeof FACTORY_STAGES) =>
    list.map((s) => {
      const deny = stageDenialReason(role, stage, s.id, fac)
      return { ...s, deny, walk: !!deny && canWalk(role, stage, s.id, fac) }
    })
  // Pending is left OUT for a factory order rather than greyed: a disabled row means "you
  // may not", and this is "this order can't be there at all". Every other stage still lists
  // with its reason.
  const prod = withReason([{ id: "", label: "Draft", tone: "new" as const },
    ...FACTORY_STAGES.filter((s) => !(fac && s.id === "in_review"))])
  const exc = withReason(EXCEPTION_STAGES)
  /** On hold is a STOP, not a stage — it has to be leavable from the same menu that set it.
   *  `resumeTo` is where the order goes back to: what it was doing before, when the order
   *  remembers, else Working, which is what "carry on" means. */
  const isOnHold = normalizeStage(stage) === "on_hold"
  const resumeTo = String((order as { meta?: { held_from?: string } } | null)?.meta?.held_from || "") || "working"

  const onStage = async (s: { id: string; label: string; deny: string | null; walk: boolean }) => {
    if (s.walk) {
      if (await confirm({ title: "Record every stage?", body: `This records every stage up to “${s.label}”.`, confirmLabel: "Record", destructive: false })) setOrderStatus(s.id)
      return
    }
    if (!s.deny) setOrderStatus(s.id)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Order actions"
        disabled={busy}
        className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <DotsThree size={18} weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* WORDS, NOT GLYPHS. These two carried an icon and the two dozen rows below them
            did not, so one menu read as two lists sharing a popup. */}
        {/*
          * WHERE IT IS, THEN THE ONE PLACE IT GOES.
          *
          * The menu opened straight into actions, so you had to already know the current
          * stage to judge any of them — and the advance row said "Next stage" without
          * naming which. Stating the stage first makes the row underneath self-evident:
          * "Working" over "Approved" reads as a step, and needs no verb.
          *
          * Every stage is still listed further down for a correction or a move backwards.
          * This is the one you almost always want, lifted out of that list.
          */}
        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">
          Now: {FACTORY_STAGES.find((x) => x.id === stage)?.label
             ?? EXCEPTION_STAGES.find((x) => x.id === stage)?.label
             ?? "New"}
        </DropdownMenuLabel>
        {canAdvance && next && (
          <DropdownMenuItem className="font-medium" onClick={() => setOrderStatus(next)}>
            {FACTORY_STAGES.find((x) => x.id === next)?.label ?? next}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* NEW LABEL ONLY IF THE PAGE ISN'T ALREADY OFFERING IT — see onNewLabel. */}
        {canShip && <DropdownMenuItem onClick={() => onNewLabel?.()}>New label</DropdownMenuItem>}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Set all items to</DropdownMenuLabel>
          {prod.map((s) => (
            <DropdownMenuItem
              key={s.id || "new"}
              disabled={(!!s.deny && !s.walk) || normalizeStage(stage) === s.id}
              title={s.walk ? `Records every stage up to ${s.label} — asks first` : s.deny ?? (normalizeStage(stage) === s.id ? "Already at this stage" : undefined)}
              onClick={() => onStage(s)}
            >
              {s.label}
              {s.walk && <span className="ml-auto text-2xs text-muted-foreground">catch up</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {/* THE WAY OFF HOLD. Putting an order on hold was one click and taking it off was
            none: the exception list offers On hold / Cancelled / Refunded, and every
            production stage below is disabled for a held order, so the menu that put it
            there had no row that brought it back. This one does, and it names where it
            goes — the stage the order was at is the honest destination, and Working is
            what "carry on" means when there is nothing recorded. */}
        {isOnHold && (
          <>
            <DropdownMenuSeparator />
            {/* TWO WORDS AND A HINT, not a sentence that wraps. "Take off hold — back to
                Working" ran onto two lines and took a whole row of the menu for one action;
                the destination is a detail, so it sits on the right in muted ink the way
                "catch up" does above, and in the title for anyone who wants it spelled out. */}
            <DropdownMenuItem
              onClick={() => setOrderStatus(resumeTo)}
              title={`Puts this back to ${FACTORY_STAGES.find((x) => x.id === resumeTo)?.label ?? "Working"} — where it was when it was held`}
            >
              Clear hold
              <span className="ml-auto text-2xs text-muted-foreground">
                {FACTORY_STAGES.find((x) => x.id === resumeTo)?.label ?? "Working"}
              </span>
            </DropdownMenuItem>
          </>
        )}
        {exc.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Flag / hold</DropdownMenuLabel>
              {exc.map((s) => (
                <DropdownMenuItem key={s.id} disabled={!!s.deny} title={s.deny ?? undefined} onClick={() => onStage(s)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
