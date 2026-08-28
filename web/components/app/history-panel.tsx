"use client"

import type { ReactNode } from "react"
import { CircleNotch, Warning, type Icon } from "@phosphor-icons/react"

import { EmptyState } from "@/components/app/empty-state"
import { SectionCard } from "@/components/app/section-card"
import type { ColumnRegistry } from "@/lib/table-columns"

/**
 * THREE KINDS OF HISTORY WEAR ONE WORD, and only one of them had a primitive.
 *
 * Counted across the app, "History" means three different things:
 *
 *   trail    what happened to ONE record — order history, a card's timeline, Settings ›
 *            Activity. Already solved: `ActivityFeed`, used by five surfaces. NOT here.
 *   archive  settled records — Purchasing History, Dispatch History, wallet transactions,
 *            catalog exports, seller uploads, inventory movements. Six surfaces in four
 *            different containers: one in a SectionCard with a Show/Hide, one with a TabBar
 *            and a search, one in a bare <div> with no card at all, one on the shared Table.
 *   gallery  things this account GENERATED — listing photos, digitizer output. Two, both
 *            built from scratch.
 *
 * This covers the two that had nothing. Trails keep using ActivityFeed; a fourth container
 * for them would be the same mistake one layer up.
 *
 * AN ARCHIVE IS HANDED ITS LIVE LIST'S REGISTRY, and that is the load-bearing rule rather
 * than a convenience. Dispatch's To-scan and History line up because they share one column
 * template; Purchasing's Cart and History do not share one and read as unrelated pages
 * answering the same question. Passing the registry — the same object the live table renders
 * from — is what makes the archive feel like the same list with time applied to it, and it
 * is what lets both ends carry the same ColumnsMenu.
 */

export type HistoryState = {
  /** Null while loading. An archive that renders zero rows on a failed read is lying. */
  loading?: boolean
  /** The read failed. Reported, never drawn as an empty list. */
  error?: string | null
}

export function HistoryPanel<T extends string>({
  title,
  actions,
  filters,
  cols,
  order,
  rows,
  rowKey,
  cell,
  onRowClick,
  empty,
  loading,
  error,
  embedded,
}: HistoryState & {
  /** Omitted inside a shell or a tab that already names it — see the duplicate-title rule. */
  title?: string
  actions?: ReactNode
  /** A filter row or search, rendered under the header and above the table. */
  filters?: ReactNode
  /** THE LIVE LIST'S REGISTRY. Not a second one written for the archive. */
  cols: ColumnRegistry<T>
  /** Which columns, in which order — usually the live list's visible set. */
  order: T[]
  rows: readonly Record<string, unknown>[]
  rowKey: (row: Record<string, unknown>, i: number) => string
  /** One cell. Given the column id so a single function covers the row. */
  cell: (row: Record<string, unknown>, id: T) => ReactNode
  onRowClick?: (row: Record<string, unknown>) => void
  empty: { icon: Icon; title: string; note?: string }
  /** Renders bare, for a panel already inside a card or a tab. */
  embedded?: boolean
}) {
  const body =
    loading ? (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <CircleNotch size={22} className="animate-spin" />
      </div>
    ) : error ? (
      /* §4: a failed read is not an empty list, and the refusal carries its reason. */
      <div className="flex items-start gap-2 px-5 py-6 text-sm text-muted-foreground">
        <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-hold" />
        <span>Couldn&apos;t load this, so it isn&apos;t shown — this is not an empty history. {error}</span>
      </div>
    ) : rows.length === 0 ? (
      <EmptyState icon={empty.icon} size="sm" title={empty.title} note={empty.note} />
    ) : (
      /* Its own scroll container, so a wide archive never scrolls the page sideways. */
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border text-left eg-label text-muted-foreground">
              {order.map((id) => (
                <th
                  key={id}
                  className={
                    "px-3 py-2 " + (cols[id].width ?? "") +
                    (cols[id].align === "right" ? " text-right" : " text-left")
                  }
                >
                  {cols[id].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={rowKey(r, i)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={
                  "border-b border-border/60 last:border-0 " +
                  (onRowClick ? "cursor-pointer transition-colors hover:bg-accent/50" : "")
                }
              >
                {order.map((id) => (
                  <td
                    key={id}
                    className={"px-3 py-3 " + (cols[id].align === "right" ? "text-right" : "")}
                  >
                    {cell(r, id)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

  if (embedded) {
    return (
      <>
        {filters}
        {body}
      </>
    )
  }
  return (
    <SectionCard title={title} actions={actions}>
      {filters}
      {body}
    </SectionCard>
  )
}
