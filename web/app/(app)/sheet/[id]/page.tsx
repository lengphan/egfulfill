"use client"

/**
 * ONE SHEET, FULL SCREEN.
 *
 * Over the app shell rather than inside it: the sidebar is navigation, and this is a single
 * task you are in the middle of — the same reason a print dialog is not a page. It carries
 * its own way out, because a full-screen surface with no exit is a trap.
 *
 * COMPLETE IS NOT SUBMIT. Completing hands the rows to the import dialog, which creates DRAFT
 * orders and never touches the wallet; `SubmitOrderButton` ("Submit to production?") is the
 * paid action and lives on the order itself. Two verbs, two screens, two objects.
 *
 * AND COMPLETE DOES NOT IMPORT. The dialog owns templates, machine files, design rows, the
 * order id and its meta; a second importer here would agree with it exactly until one of them
 * changed (CLAUDE.md §5). If rows are wrong, the dialog's own preview names them row by row
 * and closing it comes straight back here to fix them.
 *
 * A COMPLETED SHEET IS READ-ONLY. Not a hidden button — the server 409s a PATCH on one. This
 * page shows the rows as they were sent and offers Duplicate, which starts a new draft from
 * them.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { OrderGrid } from "@/components/app/order-grid"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { CSV_COLUMNS, TEMPLATE_HEADERS } from "@/lib/order-import"
import {
  getOrderSheet, saveOrderSheet, duplicateOrderSheet, completeOrderSheet,
  type OrderSheet,
} from "@/lib/api"

/** Long enough that typing a street name is one save, short enough to survive a closed tab. */
const AUTOSAVE_MS = 1200

export default function SheetPage() {
  const router = useRouter()
  const id = String(useParams()?.id ?? "")

  const [sheet, setSheet] = useState<OrderSheet | null>(null)
  const [missing, setMissing] = useState(false)
  const [name, setName] = useState("")
  const [handoff, setHandoff] = useState<string[][] | null>(null)
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    getOrderSheet(id)
      .then((r) => { setSheet(r.sheet); setName(r.sheet.name || "") })
      .catch(() => setMissing(true))
  }, [id])

  /**
   * AUTOSAVE, DEBOUNCED.
   *
   * There is no Save button on purpose: a sheet you can lose by forgetting to press
   * something is the failure this whole thing exists to remove.
   *
   * The timer is a ref rather than state so a keystroke does not re-render the grid, and the
   * call is fired by an EVENT — the grid telling us it changed — never by an effect watching
   * the rows. An effect that writes on the state its own result produces is the shape §2.8
   * warns about.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const push = useCallback((body: { name?: string; rows?: string[][] }) => {
    if (timer.current) clearTimeout(timer.current)
    setSaved("saving")
    timer.current = setTimeout(() => {
      saveOrderSheet(id, body)
        .then((r) => setSaved(r && "error" in r && r.error ? "failed" : "saved"))
        .catch(() => setSaved("failed"))
    }, AUTOSAVE_MS)
  }, [id])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const rename = (v: string) => { setName(v); push({ name: v }) }

  const complete = (rows: string[][]) => {
    // Saved SYNCHRONOUSLY with the handoff, so what the sheet holds is what was sent even if
    // the import is abandoned at the preview.
    saveOrderSheet(id, { rows }).catch(() => {})
    setHandoff([TEMPLATE_HEADERS as unknown as string[], ...rows])
  }

  const copy = async () => {
    setBusy(true)
    try {
      const r = await duplicateOrderSheet(id)
      router.push(`/sheet/${r.sheet.id}`)
    } catch { setBusy(false) }
  }

  if (missing) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-border p-8 text-center">
          <div className="text-sm font-medium">That sheet isn&apos;t here</div>
          <Button className="mt-4" variant="outline" onClick={() => router.push("/sheet")}>All sheets</Button>
        </div>
      </div>
    )
  }
  if (!sheet) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>

  const done = sheet.status === "completed"

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        {done ? (
          <h1 className="text-base font-semibold tracking-tight">{sheet.name || "Untitled"}</h1>
        ) : (
          /* The title IS the field — click it and type, the way a spreadsheet renames. A
             separate "rename" control would be a second thing to find. */
          <input
            value={name}
            onChange={(e) => rename(e.target.value)}
            placeholder="Untitled"
            aria-label="Sheet name"
            className="min-w-40 max-w-80 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-semibold tracking-tight outline-none hover:border-border focus:border-border"
          />
        )}

        {done ? (
          <span className="rounded-full bg-shipped/10 px-2 py-0.5 text-2xs font-medium text-shipped">Sent</span>
        ) : (
          /* State, not decoration: without it autosave is invisible and the only way to
             believe it is to close the tab and find out. */
          <span className="text-xs text-muted-foreground">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "failed" ? "Not saved" : ""}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/sheet")}>Back</Button>
          {done && <Button size="sm" onClick={copy} disabled={busy}>Duplicate to edit</Button>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        {done ? (
          <ReadOnlyRows rows={sheet.rows ?? []} orderIds={sheet.orderIds} />
        ) : (
          <OrderGrid
            fill
            initialRows={sheet.rows && sheet.rows.length ? sheet.rows : undefined}
            onRowsChange={(rows) => push({ rows })}
            onComplete={complete}
          />
        )}
      </div>

      {handoff && (
        <ImportOrdersDialog
          key={handoff.length}
          open
          initialRows={handoff}
          /* Closing the preview is "Edit sheet" — you land back on the grid with the rows
             still there, which is the whole point of the errors being named by row. */
          onOpenChange={(v) => { if (!v) setHandoff(null) }}
          onImported={() => {
            completeOrderSheet(id, []).catch(() => {})
            router.push("/orders")
          }}
        />
      )}
    </div>
  )
}

/**
 * A SENT SHEET, as it was sent. Defined at module scope, never inside render —
 * react-hooks/static-components, and a component redefined each render remounts its subtree.
 */
function ReadOnlyRows({ rows, orderIds }: { rows: string[][]; orderIds: string[] }) {
  const filled = rows.filter((r) => r.some((c) => String(c ?? "").trim()))
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="w-10 border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
              {CSV_COLUMNS.map((c) => (
                <th key={c.key} className="min-w-32 border-b border-l border-border px-2 py-1.5 text-left font-medium whitespace-nowrap">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filled.map((row, r) => (
              <tr key={r}>
                <td className="border-b border-border bg-muted/40 px-2 py-1 text-right text-muted-foreground">{r + 1}</td>
                {CSV_COLUMNS.map((c, i) => (
                  <td key={c.key} className="border-b border-l border-border px-2 py-1">{row[i] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {orderIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Became {orderIds.length} order{orderIds.length === 1 ? "" : "s"}: {orderIds.join(", ")}
        </div>
      )}
    </div>
  )
}
