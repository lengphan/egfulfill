"use client"

import { useLabelT } from "@/lib/i18n"
/**
 * THE SHEETS A SELLER HAS.
 *
 * Drafts they are part-way through, and completed ones kept as the record of what was
 * submitted. Both live in the same list because "what did I send on the 14th" and "where did
 * I get to on Tuesday" are the same question asked at different times.
 *
 * A COMPLETED SHEET IS NOT EDITABLE, and the way back to one is Duplicate — a new draft
 * carrying its rows. The server enforces that with a 409 on PATCH; this page only has to
 * avoid offering a door that is already locked.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "@phosphor-icons/react"
import { cameFromImport, clearCameFromImport, requestImportOpen } from "@/lib/sheet-return"
import { ordersHomeFor } from "@/lib/staff-nav"
import { getUser } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  getOrderSheets, createOrderSheet, duplicateOrderSheet, deleteOrderSheet,
  type OrderSheet,
} from "@/lib/api"

/** A name you can tell apart in a list, for a sheet nobody has named. */
const defaultName = () =>
  `Sheet · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}`

export default function SheetsPage() {
  const tl = useLabelT()

  /**
   * IMPORT LANDS HERE FIRST — "Open Sheet" pushes /sheet, not a sheet — and this page had no
   * way back at all: no Back, no breadcrumb, just a list and a New sheet button. So the one
   * step between deciding to import and having a sheet was also the step you could not undo.
   * Read after mount for the same hydration reason as the sheet page itself.
   */
  const [fromImport, setFromImport] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setFromImport(cameFromImport()), 0)
    return () => clearTimeout(id)
  }, [])
  const router = useRouter()
  const [sheets, setSheets] = useState<OrderSheet[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getOrderSheets()
      .then((r) => { setSheets(r.sheets || []); setErr(null) })
      .catch(() => { setSheets([]); setErr("Couldn't load your sheets.") })
  }, [])

  useEffect(() => { load() }, [load])

  const start = async () => {
    setBusy(true)
    try {
      const r = await createOrderSheet({ name: defaultName() })
      router.push(`/sheet/${r.sheet.id}`)
    } catch { setErr("Couldn't start a new sheet."); setBusy(false) }
  }

  const copy = async (id: string) => {
    setBusy(true)
    try {
      const r = await duplicateOrderSheet(id)
      router.push(`/sheet/${r.sheet.id}`)
    } catch { setErr("Couldn't copy that sheet."); setBusy(false) }
  }

  const remove = async (id: string) => {
    setBusy(true)
    const r = await deleteOrderSheet(id).catch(() => ({ error: "Couldn't delete that sheet." }))
    // A completed sheet refuses deletion server-side and says why. That refusal IS the
    // answer, so it is shown rather than swallowed.
    if (r && "error" in r && r.error) setErr(r.error)
    load(); setBusy(false)
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        {fromImport && (
          <Button
            variant="ghost"
            size="sm"
            className="-ms-2"
            onClick={() => { clearCameFromImport(); requestImportOpen(); router.push(ordersHomeFor(getUser()?.role)) }}
          >
            <ArrowLeft size={14} weight="bold" /> {tl("sheet", "Back to import")}
          </Button>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{tl("sheet", "Sheets")}</h1>
        <Button className="ms-auto" onClick={start} disabled={busy}>{tl("sheet", "New sheet")}</Button>
      </div>

      {err && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{err}</div>
      )}

      {sheets === null ? (
        <div className="text-sm text-muted-foreground">{tl("sheet", "Loading…")}</div>
      ) : !sheets.length ? (
        /* An empty state may carry one sentence, because there is nothing else to read. */
        <div className="rounded-xl border border-border p-8 text-center">
          <div className="text-sm font-medium">{tl("sheet", "No sheets yet")}</div>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            {tl("sheet", "A sheet is where you type orders in bulk. It saves as you go, so you can leave it and come back.")}
          </p>
          <Button className="mt-4" onClick={start} disabled={busy}>{tl("sheet", "New sheet")}</Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{tl("sheet", "Name")}</th>
                <th className="px-3 py-2 text-left font-medium">{tl("sheet", "Status")}</th>
                {/* Right-aligned, so tabular figures are already on — globals.css does that
                    for every text-right cell; adding tabular-nums here would be the second
                    copy the alignment rule exists to prevent. */}
                <th className="px-3 py-2 text-right font-medium">{tl("sheet", "Rows")}</th>
                <th className="px-3 py-2 text-left font-medium">{tl("sheet", "Updated")}</th>
                <th className="w-40 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/sheet/${s.id}`)}
                      className="text-left font-medium hover:underline"
                    >
                      {s.name || tl("sheet", "Untitled")}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    {/* A pill carries MEANING here — the one-way draft/completed state — which
                        is the only thing §4 allows one for. */}
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${
                        s.status === "completed"
                          ? "bg-shipped/10 text-shipped"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.status === "completed" ? tl("sheet", "Sent") : tl("sheet", "Draft")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{s.rowCount}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(s.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => copy(s.id)} disabled={busy}>
                        {tl("sheet", "Duplicate")}
                      </Button>
                      {s.status === "draft" && (
                        <Button variant="ghost" size="sm" onClick={() => remove(s.id)} disabled={busy}>
                          {tl("sheet", "Delete")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
