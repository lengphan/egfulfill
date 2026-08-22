"use client"

/**
 * THE SHEET, FULL SCREEN.
 *
 * It is not in the import dialog because it is 21 columns wide and the dialog showed four —
 * editing there meant dragging a viewport across a spreadsheet. It is not in a second browser
 * tab either: a seller who came from Orders expects Back to take them there, and a new tab
 * turns that into "close this window", which is a different and worse promise.
 *
 * So it takes the whole screen in the SAME window, over the app shell, and carries its own
 * way out. A full-page surface with no exit is a trap, which is why `onBack` is not optional
 * in spirit even though the prop is.
 *
 * IT DOES NOT IMPORT ANYTHING. Complete hands the rows to ImportOrdersDialog, which owns the
 * whole pipeline — templates, machine files, design rows, the order id and its meta. Doing
 * the import here would have been a second importer that agrees with the first only until
 * somebody changes one of them (CLAUDE.md §5). The preview a seller reads is the one a
 * dropped .xlsx produces, because it is the same preview.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import { OrderGrid } from "@/components/app/order-grid"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { TEMPLATE_HEADERS } from "@/lib/order-import"

export default function SheetPage() {
  const router = useRouter()
  /** Header row included, because that is the shape rowsToRecords parses. */
  const [handoff, setHandoff] = useState<string[][] | null>(null)

  const leave = () => router.push("/orders")

  return (
    /* Over the shell rather than inside it. The sidebar is navigation, and this screen is a
       single task you are in the middle of — the same reason a print dialog is not a page. */
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-base font-semibold tracking-tight">Sheet</h1>
        <span className="text-xs text-muted-foreground">Orders · new</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <OrderGrid
          fill
          onBack={leave}
          onComplete={(rows) => setHandoff([TEMPLATE_HEADERS as unknown as string[], ...rows])}
        />
      </div>

      {/* Keyed on the row count so a second Complete re-opens with the NEW rows rather than
          rendering the previous preview — reset by remounting, not by an effect that shows
          stale state for a frame. */}
      {handoff && (
        <ImportOrdersDialog
          key={handoff.length}
          open
          initialRows={handoff}
          onOpenChange={(v) => { if (!v) setHandoff(null) }}
          onImported={leave}
        />
      )}
    </div>
  )
}
