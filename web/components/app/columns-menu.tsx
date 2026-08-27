"use client"

import { useState } from "react"
import { Columns, DotsSixVertical, Check } from "@phosphor-icons/react"

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { useLabelT } from "@/lib/i18n"

/**
 * Show/hide + drag-to-reorder for ANY table, as a toolbar control.
 *
 * ONE MENU, NOT TWO. This and factory-columns-menu.tsx were near-duplicates — 81 and 120
 * lines doing the same job, differing only in which registry they imported and whether a
 * column was toggled by an eye icon or a checkbox. Two components for one idea is how a
 * house style dies: the next table to need this would have produced a third.
 *
 * The factory version's treatment won and is what survives here — a checkbox reads as
 * "on/off" where an eye reads as "peek", the trigger carries a count of what is HIDDEN
 * (a table quietly missing a column you rely on is the same trap as a filter you forgot you
 * set), and Reset returns to the shipped defaults rather than to everything-visible, because
 * a column hidden out of the box was a decision and turning it on would undo it.
 *
 * It sits BESIDE Filters in a toolbar, never inside the table's own header row: as a button
 * in the pinned last cell it was styled like ORDER / AGE / TRACKING and read as one more
 * column name rather than a control.
 *
 * Reordering is here as well as on the header labels. Dragging a header is the faster
 * gesture once you know it exists, but a drag target with no affordance is a feature only
 * its author can find — so the rows carry a grip.
 */
export function ColumnsMenu<T extends string>({
  cols,
  order,
  hidden,
  onOrder,
  onHidden,
  isLocked,
  defaults,
  labelNs = "col",
  className = "",
}: {
  /** id → definition. Only `label` is read; pass the same registry the table renders from. */
  cols: Record<T, { label: string }>
  order: T[]
  hidden: T[]
  onOrder: (ids: T[]) => void
  onHidden: (ids: T[]) => void
  /** Columns that may not be hidden — without them a row is unidentifiable. */
  isLocked?: (id: T) => boolean
  /** What Reset restores. Both halves, because the shipped state hides some columns. */
  defaults: { order: T[]; hidden: T[] }
  /** i18n namespace the column LABELS are looked up in. */
  labelNs?: string
  className?: string
}) {
  const tl = useLabelT()
  const [dragId, setDragId] = useState<T | null>(null)
  const locked = (id: T) => isLocked?.(id) ?? false

  const toggle = (id: T) => {
    if (locked(id)) return
    onHidden(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id])
  }
  const reset = () => { onOrder([...defaults.order]); onHidden([...defaults.hidden]) }
  const move = (id: T, toIndex: number) => {
    const from = order.indexOf(id)
    if (from < 0 || toIndex < 0 || toIndex >= order.length || from === toIndex) return order
    const next = [...order]
    next.splice(from, 1)
    next.splice(toIndex, 0, id)
    return next
  }

  const nHidden = hidden.filter((id) => !locked(id)).length

  return (
    <Popover>
      {/* Same metric as the Filters trigger beside it — h-8, 14px, and the same "something is
          on" treatment, so the pair reads as one group. */}
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
        {tl("columnsMenu", "Columns")}
        {nHidden > 0 && (
          <span className="rounded bg-primary px-1.5 text-2xs font-bold leading-[1.45] text-primary-foreground">{nHidden}</span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60 p-2">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-sm font-semibold">{tl("columnsMenu", "Columns")}</span>
          <button
            onClick={reset}
            className="eg-tap inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {tl("columnsMenu", "Reset")}
          </button>
        </div>
        {/* The one sentence an empty-handed control is allowed: two gestures live on these
            rows and neither is visible until you try it. */}
        <p className="mb-1.5 px-1 text-2xs leading-relaxed text-muted-foreground">
          {tl("columnsMenu", "Drag to reorder · click to show or hide.")}
        </p>
        {order.map((id, i) => {
          const isOff = hidden.includes(id)
          const lock = locked(id)
          return (
            <div
              key={id}
              draggable
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== id) onOrder(move(dragId, i))
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
                disabled={lock}
                onClick={() => toggle(id)}
                className="flex flex-1 items-center gap-2 text-left text-sm disabled:cursor-default"
              >
                <span className={"flex size-4 shrink-0 items-center justify-center rounded border " + (!isOff ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {!isOff && <Check size={11} weight="bold" />}
                </span>
                <span className="truncate">{tl(labelNs, cols[id].label)}</span>
                {/* Says WHY it can't be turned off, rather than just refusing the click. */}
                {lock && <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{tl("columnsMenu", "always on")}</span>}
              </button>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
