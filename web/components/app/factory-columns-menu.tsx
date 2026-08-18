"use client"

import { useState } from "react"
import { Columns, DotsSixVertical, Check } from "@phosphor-icons/react"

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { useLabelT } from "@/lib/i18n"
import {
  FACTORY_COLS, FACTORY_DATA_COLS, DEFAULT_HIDDEN_FACTORY_COLS,
  isFactoryColLocked, reorderFactoryCols, type FactoryColId,
} from "@/lib/order-columns"

/**
 * Show/hide + drag-to-reorder for the orders table, as a TOOLBAR control.
 *
 * It used to be a button sitting in the table's own header row, in the pinned last cell —
 * which put the word "Columns" on the same line as ORDER, AGE, TRACKING, styled like them,
 * where it read as one more column name rather than a control. It sits beside Filters now:
 * the two things that reshape the table, in one place, directly above it.
 *
 * Reordering is IN here as well as on the header labels. Dragging a header still works and
 * is the faster gesture once you know it exists — but a drag target with no affordance is a
 * feature only its author can find, and "where do I reorder columns" was the question that
 * prompted this. The rows carry a grip handle, so the menu shows that it's possible.
 */
export function FactoryColumnsMenu({ order, hidden, onOrder, onHidden, className = "" }: {
  order: FactoryColId[]
  hidden: FactoryColId[]
  onOrder: (ids: FactoryColId[]) => void
  onHidden: (ids: FactoryColId[]) => void
  className?: string
}) {
  const tl = useLabelT()
  const [dragId, setDragId] = useState<FactoryColId | null>(null)

  const toggle = (id: FactoryColId) => {
    if (isFactoryColLocked(id)) return
    onHidden(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id])
  }
  // Back to the shipped defaults, not to "everything visible" — Items is hidden out of the
  // box because it's the widest column and the one least read at a glance, and a Reset that
  // turned it on would be undoing a decision rather than restoring one.
  const reset = () => { onOrder([...FACTORY_DATA_COLS]); onHidden([...DEFAULT_HIDDEN_FACTORY_COLS]) }

  const nHidden = hidden.filter((id) => !isFactoryColLocked(id)).length

  return (
    <Popover>
      {/* Same metric as the Filters trigger beside it — h-8, 13px, and the same violet
          "something is on" treatment, so the pair reads as one group. */}
      <PopoverTrigger
        className={
          "eg-tap inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
          (nHidden
            ? "border-primary/40 bg-primary/5 text-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground") +
          " " + className
        }
      >
        <Columns size={14} weight="bold" />
        Columns
        {/* How many are OFF. A table quietly missing a column you rely on is the same trap
            as a filter you forgot you set, so it gets the same badge. */}
        {nHidden > 0 && (
          <span className="rounded bg-primary px-1.5 text-2xs font-bold leading-[1.45] text-primary-foreground">{nHidden}</span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60 p-2">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-sm font-semibold">Columns</span>
          <button
            onClick={reset}
            className="eg-tap inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Reset
          </button>
        </div>
        <p className="mb-1.5 px-1 text-2xs leading-relaxed text-muted-foreground">Drag to reorder · click to show or hide.</p>
        {order.map((id, i) => {
          const locked = isFactoryColLocked(id)
          const shown = !hidden.includes(id)
          return (
            <div
              key={id}
              draggable
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== id) onOrder(reorderFactoryCols(order, dragId, i))
                setDragId(null)
              }}
              className={
                "flex cursor-grab items-center gap-1.5 rounded-md px-1 py-1.5 transition-colors hover:bg-accent " +
                (dragId === id ? "opacity-40" : "")
              }
            >
              <DotsSixVertical size={13} weight="bold" className="shrink-0 text-muted-foreground/60" />
              <button
                type="button"
                disabled={locked}
                onClick={() => toggle(id)}
                className="flex flex-1 items-center gap-2 text-left text-sm disabled:cursor-default"
              >
                <span className={"flex size-4 shrink-0 items-center justify-center rounded border " + (shown ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {shown && <Check size={11} weight="bold" />}
                </span>
                <span className="truncate">{tl("col", FACTORY_COLS[id].label)}</span>
                {/* Says WHY it can't be turned off, rather than just refusing the click. */}
                {locked && <span className="ml-auto shrink-0 text-2xs text-muted-foreground">always on</span>}
              </button>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
