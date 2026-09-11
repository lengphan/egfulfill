"use client"

import { useLabelT } from "@/lib/i18n"
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
import { cameFromImport, clearCameFromImport, requestImportOpen } from "@/lib/sheet-return"
import { ordersHomeFor } from "@/lib/staff-nav"
import { getUser } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { OrderGrid } from "@/components/app/order-grid"
import { ImportOrdersDialog } from "@/components/app/import-orders-dialog"
import { CSV_COLUMNS, TEMPLATE_HEADERS } from "@/lib/order-import"
import { STATUS_TONE } from "@/lib/status-tone"
import {
  getOrderSheet, saveOrderSheet, duplicateOrderSheet, completeOrderSheet,
  type OrderSheet,
} from "@/lib/api"

/** Long enough that typing a street name is one save, short enough to survive a closed tab. */
/**
 * FIVE SECONDS, not one point two (owner's call, 2026-09-09).
 *
 * A debounce short enough that it always beats you to it makes the Save button decorative —
 * there is never a moment where pressing it does anything the wait would not have done. At
 * five seconds a sheet still saves itself while you think, and pressing Save means something.
 *
 * THE LONGER WINDOW IS ONLY SAFE BECAUSE OF THE FLUSH BELOW. Four extra seconds is four
 * extra seconds in which a person can close the tab, and losing a sheet is the one outcome
 * this screen exists to prevent — so leaving the page sends whatever is still pending
 * instead of clearing the timer and walking away from it.
 */
const AUTOSAVE_MS = 5000
/** How long "Saved" stays on screen before the button goes back to reading "Save". Long
 *  enough to read at a glance, short enough not to be a permanent label by another name. */
const SAVED_MS = 2000

export default function SheetPage() {
  const tl = useLabelT()

  /**
   * WHERE BACK GOES, decided by where you came from.
   *
   * Read after mount, never during render: sessionStorage does not exist on the server, so
   * deciding the label while rendering means the server says "Back" and the browser says
   * "Back to import" — a hydration mismatch, and React throws the tree away. Deferred, the
   * label is simply correct by the time anyone can read it.
   */
  const [fromImport, setFromImport] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setFromImport(cameFromImport()), 0)
    return () => clearTimeout(id)
  }, [])
  const goBack = () => {
    if (!fromImport) { clearCameFromImport(); router.push("/sheet"); return }
    // The journey ends here, so the origin is cleared BEFORE the board is asked to reopen the
    // dialog — otherwise the next sheet opened from the list still claims an import origin.
    clearCameFromImport()
    requestImportOpen()
    router.push(ordersHomeFor(getUser()?.role))
  }
  const router = useRouter()
  const id = String(useParams()?.id ?? "")

  const [sheet, setSheet] = useState<OrderSheet | null>(null)
  const [missing, setMissing] = useState(false)
  const [name, setName] = useState("")
  const [handoff, setHandoff] = useState<string[][] | null>(null)
  /**
   * FIVE STATES, because the old four told one small lie.
   *
   * `push()` set "saving" the moment a key was pressed, while the request was still a
   * debounce away from being sent — so the sheet said it was saving during the window in
   * which it demonstrably was not. `dirty` is that window, and it is the state the Save
   * control is FOR: there are changes, they are going out shortly, and pressing sends them
   * now instead of waiting.
   */
  const [saved, setSaved] = useState<"idle" | "dirty" | "saving" | "saved" | "failed">("idle")
  const [busy, setBusy] = useState(false)
  /**
   * The title row's right-hand slot, handed to the grid so it can render its toolbar there.
   *
   * STATE, not a ref: a ref's `.current` changing does not re-render, so the grid would be
   * told `null` on the mount that matters and never told again — the portal would simply
   * never appear. A callback ref that sets state is what makes the node's arrival a render.
   */
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!id) return
    getOrderSheet(id)
      .then((r) => {
        setSheet(r.sheet)
        setName(r.sheet.name || "")
        /* Seeded so Save is pressable the moment the sheet opens. Without this, `latest` is
           empty until the first keystroke and the button would be a control that does
           nothing on a page that has just loaded — which is worse than not offering it. */
        latest.current = { name: r.sheet.name || "", rows: r.sheet.rows ?? [] }
      })
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
  /** The edit waiting to go out. Held so Save can send THIS body immediately rather than
   *  re-deriving what changed, and so a retry after a failure re-sends the same thing. */
  const pending = useRef<{ name?: string; rows?: string[][] } | null>(null)
  /** The last thing the grid told us, pending or not. Save is pressable at any time — with
   *  nothing outstanding it re-sends the current sheet, which is what a person means by
   *  pressing Save on a page that looks saved. */
  const latest = useRef<{ name?: string; rows?: string[][] }>({})
  /** Clears "Saved" back to quiet. A ref so unmount can cancel it — a setState after unmount
   *  is a warning nobody ever fixes because it only appears when you navigate away fast. */
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback(() => {
    const body = pending.current ?? latest.current
    if (!body || (body.name === undefined && body.rows === undefined)) return
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pending.current = null
    setSaved("saving")
    saveOrderSheet(id, body)
      .then((r) => {
        if (r && "error" in r && r.error) { pending.current = body; setSaved("failed"); return }
        setSaved("saved")
        /* SAY IT, THEN STOP SAYING IT. A permanent "Saved" is a word that is true from the
           moment the page loads until you close it, so it stops being read — and it was the
           only thing on this row that never changed. It goes quiet after a beat; the state
           that MATTERS (unsaved, failing) is the one that stays on screen. */
        if (quiet.current) clearTimeout(quiet.current)
        quiet.current = setTimeout(() => setSaved("idle"), SAVED_MS)
      })
      /* A FAILURE KEEPS THE BODY and never goes quiet. Losing a sheet is the one outcome
         this screen exists to prevent, so the control stays there saying so, and pressing it
         re-sends exactly what did not land. */
      .catch(() => { pending.current = body; setSaved("failed") })
  }, [id])

  const push = useCallback((body: { name?: string; rows?: string[][] }) => {
    if (timer.current) clearTimeout(timer.current)
    /* Merged, not replaced: a rename followed by an edit inside one debounce window would
       otherwise send only the second half. */
    pending.current = { ...(pending.current ?? {}), ...body }
    latest.current = { ...latest.current, ...body }
    setSaved("dirty")
    timer.current = setTimeout(send, AUTOSAVE_MS)
  }, [send])

  /**
   * LEAVING FLUSHES. Unmount used to clear the timer, which with a five-second window means
   * a click on the sidebar could throw away the last thing typed. The request is fired
   * without touching state — the component is going away, and a setState after unmount is a
   * warning nobody ever fixes because it only shows up when you navigate quickly.
   *
   * `beforeunload` covers the other exit: a browser tab closing gives us no time to finish a
   * request, so the only honest thing is to let the browser ask.
   */
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => {
      window.removeEventListener("beforeunload", warn)
      if (timer.current) clearTimeout(timer.current)
      if (quiet.current) clearTimeout(quiet.current)
      if (pending.current) saveOrderSheet(id, pending.current).catch(() => {})
    }
  }, [id])

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
          <div className="text-sm font-medium">{tl("sheet_[id]", "That sheet isn’t here")}</div>
          <Button className="mt-4" variant="outline" onClick={goBack}>{fromImport ? tl("sheet_[id]", "Back to import") : tl("sheet_[id]", "All sheets")}</Button>
        </div>
      </div>
    )
  }
  if (!sheet) return <div className="p-6 text-sm text-muted-foreground">{tl("sheet_[id]", "Loading…")}</div>

  const done = sheet.status === "completed"

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        {done ? (
          <h1 className="text-base font-semibold tracking-tight">{sheet.name || tl("sheet_[id]", "Untitled")}</h1>
        ) : (
          /* The title IS the field — click it and type, the way a spreadsheet renames. A
             separate "rename" control would be a second thing to find. */
          <input
            value={name}
            onChange={(e) => rename(e.target.value)}
            placeholder={tl("sheet_[id]", "Untitled")}
            aria-label={tl("sheet_[id]", "Sheet name")}
            className="min-w-40 max-w-80 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-semibold tracking-tight outline-none hover:border-border focus:border-border"
          />
        )}

        {done && (
          <span className={"text-sm " + STATUS_TONE.settled}>{tl("sheet_[id]", "Submitted")}</span>
        )}

        {/* ONE ROW OF CONTROLS, AND IT IS THIS ONE.
            Back used to live up here alone while Complete, Add rows and Undo sat at the
            BOTTOM of the sheet — under a full-height scroll, so the one thing this screen is
            for was off-screen until you had scrolled past every row. Moving the grid's
            toolbar above the data fixed that and put a second row of chrome between this
            title and the sheet. Now the grid renders its controls INTO this row (the div
            below is the target), so there is one row, the buttons are where Back always was,
            and the sheet starts higher. A completed sheet has no grid, so its two controls
            are still drawn here directly. */}
        {done ? (
          <div className="ms-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goBack}>{fromImport ? tl("sheet_[id]", "Back to import") : tl("sheet_[id]", "Back")}</Button>
            <Button size="sm" onClick={copy} disabled={busy}>{tl("sheet_[id]", "Duplicate to edit")}</Button>
          </div>
        ) : (
          <div ref={setToolbarEl} className="ms-auto flex items-center gap-2" />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        {done ? (
          <ReadOnlyRows rows={sheet.rows ?? []} orderIds={sheet.orderIds} />
        ) : (
          <OrderGrid
            fill
            toolbarTarget={toolbarEl}
            initialRows={sheet.rows && sheet.rows.length ? sheet.rows : undefined}
            onRowsChange={(rows) => push({ rows })}
            onComplete={complete}
            onBack={goBack}
            backLabel={fromImport ? tl("sheet_[id]", "Back to import") : tl("sheet_[id]", "Back")}
            /* SAVE IS A CONTROL NOW, and it is still not the thing that saves.
               The autosave is unchanged and remains the guarantee — a sheet you can lose by
               forgetting to press something is the failure this screen exists to remove.
               What this adds is the ability to stop WAITING for it, and a state you can read:
               "Save" while an edit is pending, "Saving…" while it is in flight, "Saved" for
               two seconds, then nothing at all.
               QUIET WHEN IDLE, deliberately. The word this replaced was true from the moment
               the page loaded until you closed it, which is how a status stops being read.
               The slot keeps its width so the buttons beside it do not jump as it changes. */
            saveSlot={
              /* ALWAYS THERE (owner's call, 2026-09-09). It hid itself when there was nothing
                 outstanding, which did two things wrong: the row kept a reserved gap where it
                 might reappear — so undo and redo sat marooned a hand's width from
                 everything else — and a page that saves itself had no visible way to be
                 saved on purpose. It is present at every moment now and pressable at every
                 moment: with nothing pending it re-sends the current sheet, which is what a
                 person means by pressing Save on a page that already looks saved.
                 Ghost, because the autosave is still the guarantee and this is a
                 reassurance, not the primary action — Complete is (§4's hierarchy). */
              <Button
                variant={saved === "failed" ? "outline" : "ghost"}
                size="sm"
                onClick={send}
                disabled={saved === "saving"}
                title={saved === "failed"
                  ? tl("sheet_[id]", "That change did not reach the server. Press to send it again.")
                  : tl("sheet_[id]", "Saves on its own — press to send it now")}
                className={saved === "failed" ? "border-alert/40 text-alert hover:bg-alert/10" : "text-muted-foreground"}
              >
                {saved === "saving" ? tl("sheet_[id]", "Saving…")
                  : saved === "saved" ? tl("sheet_[id]", "Saved")
                  : saved === "failed" ? tl("sheet_[id]", "Not saved · Retry")
                  : tl("sheet_[id]", "Save")}
              </Button>
            }
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
  const tl = useLabelT()
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
