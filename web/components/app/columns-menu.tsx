"use client"

import { useLabelT } from "@/lib/i18n"
import { useState } from "react"
import { Columns, DotsSixVertical, Eye, EyeSlash } from "@phosphor-icons/react"

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ORDER_COLS, DEFAULT_ORDER_COLS, reorderCols, type OrderColId } from "@/lib/order-columns"

/** Show/hide + drag-to-reorder for the Orders table — the port of the old
 *  orders.html Columns menu. Dragging happens here rather than on the table
 *  headers so it also works on touch-less rows and narrow screens. */
export function ColumnsMenu({
  order,
  hidden,
  onOrder,
  onHidden,
}: {
  order: OrderColId[]
  hidden: OrderColId[]
  onOrder: (ids: OrderColId[]) => void
  onHidden: (ids: OrderColId[]) => void
}) {
  const tl = useLabelT()
  const [dragId, setDragId] = useState<OrderColId | null>(null)

  const toggle = (id: OrderColId) => {
    if (ORDER_COLS[id].locked) return
    onHidden(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id])
  }
  const reset = () => { onOrder([...DEFAULT_ORDER_COLS]); onHidden([]) }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="eg-control">
        <Columns size={14} weight="bold" /> {tl("columnsMenu", "Columns")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1.5">
        <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
          <span className="text-xs font-semibold text-muted-foreground">{tl("columnsMenu", "Columns")}</span>
          <button onClick={reset} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {tl("columnsMenu", "Reset")}
          </button>
        </div>
        {order.map((id, i) => {
          const col = ORDER_COLS[id]
          const off = hidden.includes(id)
          return (
            <div
              key={id}
              draggable
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== id) onOrder(reorderCols(order, dragId, i))
                setDragId(null)
              }}
              className={
                "flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-accent " +
                (dragId === id ? "opacity-40" : "")
              }
            >
              <DotsSixVertical size={13} weight="bold" className="shrink-0 text-muted-foreground" />
              <span className={"flex-1 truncate " + (off ? "text-muted-foreground line-through" : "")}>{col.label}</span>
              {col.locked ? (
                <span className="text-2xs text-muted-foreground">always</span>
              ) : (
                <button onClick={() => toggle(id)} aria-label={off ? `Show ${col.label}` : `Hide ${col.label}`} className="shrink-0 text-muted-foreground hover:text-foreground">
                  {off ? <EyeSlash size={14} /> : <Eye size={14} weight="fill" />}
                </button>
              )}
            </div>
          )
        })}
        <p className="px-1.5 pb-0.5 pt-1.5 text-2xs text-muted-foreground">{tl("columnsMenu", "Drag to reorder. Saved on this device.")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
