"use client"

import { useState } from "react"
import { DotsThree, SkipForward, Truck } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { FACTORY_STAGES, EXCEPTION_STAGES, normalizeStage, nextStage, orderStage, isException, canSetStage, stageDenialReason, canWalk } from "@/lib/factory-status"
import { postItemStatus, updateOrder, type OrderRow } from "@/lib/api"

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
  onNewLabel?: () => void
  canFulfill?: boolean
  onError?: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const items = order.items ?? []
  const stage = orderStage(items)
  const stopped = isException(stage)
  const next = nextStage(stage)
  const canAdvance = !!next && canSetStage(role, stage, next)
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
      const deny = stageDenialReason(role, stage, s.id)
      return { ...s, deny, walk: !!deny && canWalk(role, stage, s.id) }
    })
  const prod = withReason([{ id: "", label: "Draft", tone: "new" as const }, ...FACTORY_STAGES])
  const exc = withReason(EXCEPTION_STAGES)

  const onStage = (s: { id: string; label: string; deny: string | null; walk: boolean }) => {
    if (s.walk) {
      if (window.confirm(`This records every stage up to “${s.label}”. Continue?`)) setOrderStatus(s.id)
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
        {canAdvance && <DropdownMenuItem onClick={() => next && setOrderStatus(next)}><SkipForward size={14} weight="fill" /> Next stage</DropdownMenuItem>}
        {canShip && <DropdownMenuItem onClick={() => onNewLabel?.()}><Truck size={14} weight="bold" /> New label</DropdownMenuItem>}
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
              {s.walk && <span className="ml-auto text-[10px] text-muted-foreground">catch up</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
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
