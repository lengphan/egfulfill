"use client"

/**
 * THE SHEET, FULL PAGE.
 *
 * It lives here rather than inside the import dialog because it is 21 columns wide and the
 * dialog showed four of them — editing there meant dragging a viewport across a spreadsheet.
 * The dialog keeps a door to this page, so a seller opens it in its own tab and the orders
 * behind it stay where they were.
 *
 * IT DOES NOT IMPORT ANYTHING. Complete hands the rows to ImportOrdersDialog, which owns the
 * whole pipeline — templates, machine files, design rows, the order id and its meta. Doing
 * the import here would have been a second importer that agrees with the first only until
 * somebody changes one of them (CLAUDE.md §5). So: this page edits, that dialog imports, and
 * the preview a seller reads is the same one a dropped .xlsx produces.
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

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold tracking-tight">Sheet</h1>

      <OrderGrid
        onComplete={(rows) => setHandoff([TEMPLATE_HEADERS as unknown as string[], ...rows])}
      />

      {/* Keyed on the row count so a second Complete re-opens with the NEW rows rather than
          rendering the previous preview — reset by remounting, not by an effect that shows
          stale state for a frame. */}
      {handoff && (
        <ImportOrdersDialog
          key={handoff.length}
          open
          initialRows={handoff}
          onOpenChange={(v) => { if (!v) setHandoff(null) }}
          onImported={() => router.push("/orders")}
        />
      )}
    </div>
  )
}
