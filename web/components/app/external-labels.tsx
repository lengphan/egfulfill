"use client"

import { useEffect, useState } from "react"
import { FilePdf, ArrowSquareOut, UploadSimple, Barcode, Lock, X, Clock, CheckCircle, Warning } from "@phosphor-icons/react"
import { useConfirm } from "@/components/app/confirm-dialog"
import { DISPATCH_GRID } from "@/components/app/dispatch-grid"
import { uploadDispatchLabel, deleteDispatchUpload, type DispatchUpload } from "@/lib/api"
import { readLabelPdf, PARSE_NOTE, PARSE_WHY, type LabelParse } from "@/lib/label-pdf"

/**
 * EXTERNAL LABELS — pre-scan a label that isn't one of our orders.
 *
 * Someone hands the floor a parcel from a different system, or a buyer's own postage, and
 * it still has to be scanned. Until now that meant opening byeastside's website: a second
 * login, a second place to look, and no record here of what was sent.
 *
 * UNLINKED, ON PURPOSE. This feature was declined once precisely because a dropped label
 * has no EGFULFILL order to hang scans on — so it does not pretend to have one. It touches
 * no order, moves no stage, and bills nothing. The expedite fee exists because a seller
 * asked us to rush THEIR order; there is no seller and no order here.
 *
 * A DROP IS NOT A SEND. Dropping a file used to upload it to the partner immediately, so
 * the gesture that costs nothing anywhere else on this screen was the one gesture that
 * handed a document to an outside company with no confirmation and no way back except
 * their recall. A dropped file now waits here with a tick box, exactly like a queued
 * order, and leaves when someone presses the same "Send to byeastside" button the orders
 * use. Nothing about the file has changed by waiting — it is still on this machine.
 */

/**
 * PDF ONLY, and it isn't a limitation worth working around.
 *
 * Their upload answers `400 {"message":"Only PDF files are allowed"}` to anything else —
 * measured against the live API on 2026-08-10 — and every label a carrier issues is
 * already a PDF, so there was nothing this would ever have converted. An earlier version
 * wrapped photos on the way through; it was removed rather than left dormant, because a
 * conversion path nobody exercises is one nobody notices breaking.
 */
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)

const readAsDataUrl = (file: File) =>
 new Promise<string>((resolve, reject) => {
 const fr = new FileReader()
 fr.onload = () => resolve(String(fr.result))
 fr.onerror = () => reject(new Error("That file couldn't be read."))
 fr.readAsDataURL(file)
  })

/** A file that has been dropped but NOT sent. `key` is ours — the file has no id until
 * byeastside gives it one, and identity has to survive re-renders before then.
 *  `parse` is null while the PDF is still being read; see readStagedLabel below. */
export type StagedLabel = {
 key: string; name: string; file: File
 parse: LabelParse | null
  /** When it was dropped, epoch ms. The board sorts orders, staged files and sent labels
   * into one newest-first list, and this is the only time a staged file has. */
 at: number
}

/**
 * Read the label so the row can say who the parcel is for.
 *
 * Done on STAGE rather than on send, because the whole point of the recipient is to tell
 * the floor which parcel on the bench this row is — and that question is asked while the
 * file is sitting there waiting, not after it has gone. Never rejects: an unreadable label
 * is a normal row that says why (see PARSE_NOTE), not a failure the caller handles.
 */
export function readStagedLabel(s: StagedLabel): Promise<LabelParse> {
 return readLabelPdf(s.file)
}

/** Send one staged label. Lives here beside the drop zone, called by the board, because
 * the button that triggers it sits in the board's header. Throws with the file's own
 * words — a batch that half-fails must say WHICH file, since the fix is re-shooting that
 * one page and "upload failed" makes you re-do all of them. */
export async function sendStagedLabel(s: StagedLabel): Promise<DispatchUpload | undefined> {
 const dataUrl = await readAsDataUrl(s.file)
  // What we read off the label travels WITH it. byeastside's extractor returns tracking
  // numbers and nothing else, so if this didn't cross the boundary the row would lose its
  // customer and ship-to at exactly the moment it stopped being a file on this machine.
 const r = await uploadDispatchLabel({
 fileName: s.name, dataUrl,
 recipient: s.parse?.name || undefined,
 shipTo: s.parse?.shipTo || undefined,
 tracking: s.parse?.tracking || undefined,
  })
 if (r.error) throw new Error(r.error)
 return r.upload
}

/** Ours to delete: a file that never left this machine. Nothing to recall, nothing logged. */
export const stagedKeyOf = (s: StagedLabel) => `s:${s.key}`
/** A row that IS with the partner. Prefixed so the two can share one selection set. */
export const uploadKeyOf = (u: DispatchUpload) => `u:${u.id}`

const dt = (iso: string | null) =>
 iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"

/**
 * What a batch is doing, in our words rather than theirs.
 *
 * `total_labels` null and 0 are DIFFERENT and the difference matters: null is "their
 * extractor hasn't looked yet", 0 is "it looked and found no label on the page". One is a
 * wait, the other is a file to re-shoot, and collapsing them would have someone waiting
 * forever on a photo that will never produce anything.
 *
 * NO COUNTS ON SCREEN. We upload one PDF per parcel, so the ratio was "0 of 1" or "1 of 1"
 * on every row it ever appeared on — a yes/no dressed up as a fraction, and precision that
 * looks like it means something is worse than none. A dropped file COULD carry a carrier's
 * multi-label sheet, and that is the only case where the numbers say anything the words
 * don't, so they moved to the row's hover title where they cost no one a reading.
 */
function progressOf(u: DispatchUpload): { label: string; tone: "wait" | "warn" | "ok" | "part"; title?: string } {
 if (u.total_labels == null) return { label: "Reading the file", tone: "wait" }
 if (u.total_labels === 0) return { label: "No label found", tone: "warn" }
 const many = u.total_labels > 1 ? `${u.scanned_labels} of ${u.total_labels} labels on this file picked` : undefined
 if (u.scanned_labels >= u.total_labels) return { label: "Picked", tone: "ok", title: many }
 return { label: "Waiting to be picked", tone: "part", title: many }
}

const TONE: Record<"wait" | "warn" | "ok" | "part", string> = {
 wait: "text-muted-foreground",
 warn: "text-hold",
 ok: "text-emerald-700 dark:text-emerald-400",
 part: "text-sky-700 dark:text-sky-400",
}
const TONE_ICON = { wait: Clock, warn: Warning, ok: CheckCircle, part: Barcode } as const

/**
 * THE drop card — drawn ONLY while a file is over the window.
 *
 * There is no resting version of it any more. The page itself is the drop target (see
 * PageDropZone), so a dashed rectangle sitting there at rest was never something you aimed
 * at — it was an announcement, and it took a whole band at the top of the screen to make
 * one. It got reshaped three times trying to be a better target, which was the wrong
 * problem to solve. The announcement is a button in the toolbar now; this card appears
 * under your cursor at the moment it means something.
 */
const DROP_CARD =
  "flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.02] px-6 py-8 text-center"

function DropCardBody() {
 return (
    <>
      <UploadSimple size={28} weight="duotone" className="text-primary" />
      <span className="text-base font-semibold">Drop label PDFs here</span>
      {/* Two facts, and only two: anywhere works, and dropping is not sending. Everything
 else this used to carry now lives in the row it creates. "or click to choose" went
 with the resting panel — this card only exists mid-drag now, where there is
 nothing to click; the picker is "Add label PDF" in the toolbar. */}
      <span className="max-w-md text-sm text-muted-foreground">
        Anywhere on this page works. They join the queue below and nothing is sent to
 byeastside until you press Send.
      </span>
    </>
  )
}

/**
 * ADD A LABEL PDF — a control in the toolbar, the size of the job it does.
 *
 * This was a full-width dashed panel above the list. It has been three shapes now (a tall
 * box under both lists, a one-line strip, a panel at the top) and all three were attempts
 * to make it a better DROP TARGET — which it never needed to be, because PageDropZone
 * makes the whole window one and lifts a card under your cursor while you drag. What was
 * left at rest was an announcement occupying a band of a screen whose actual work is rows.
 *
 * So it sits with the other things you can press. Dragging is unchanged and still the
 * primary gesture; this is the keyboard-and-mouse way in, and the place the feature admits
 * it exists when no file is being dragged.
 */
export function AddLabelButton({ onStage, onError }: { onStage: (files: File[]) => void; onError?: (msg: string | null) => void }) {
 return (
    <label
 title="Choose label PDFs — or just drop them anywhere on this page"
 className="eg-tap eg-control cursor-pointer"
    >
      Add label PDF
      <input
 type="file" multiple className="sr-only" accept="application/pdf"
 onChange={(e) => {
 const list = Array.from(e.target.files ?? [])
 e.target.value = ""
 if (!list.length) return
          // Caught before anything leaves, so picking a photo by accident answers instantly.
          // The server checks the bytes too — this one is about the wait, that one is truth.
 const bad = list.filter((f) => !isPdf(f))
 const good = list.filter(isPdf)
 onError?.(bad.length ? `${bad.map((f) => f.name).join(", ")} — only PDFs can be pre-scanned, that's what carriers issue.` : null)
 if (good.length) onStage(good)
        }}
      />
    </label>
  )
}

/**
 * THE PAGE-WIDE DROP TARGET — invisible until a file is over the window.
 *
 * Listens on the window rather than wrapping the screen in a handler, because a drop has
 * to be catchable over a table row, a button, or the gap between cards, and a wrapper
 * whose children stop propagation catches none of those.
 *
 * `dragenter`/`dragleave` fire for every element the cursor crosses, so a naive boolean
 * flickers the overlay on and off across the whole page. The depth counter is what makes
 * it steady: it only closes when as many leaves have fired as enters.
 *
 * FILES ONLY. Dragging a text selection or a row also fires these events, and an overlay
 * that appears when you drag a word across the screen is a bug that looks like a haunting;
 * `types` includes "Files" only for a real file drag.
 */
export function PageDropZone({ onStage }: { onStage: (files: File[]) => void }) {
 const [depth, setDepth] = useState(0)
 const [err, setErr] = useState<string | null>(null)

  // Bound to the window, once, for the life of the screen. An effect is the right home for
  // this one: it subscribes to something outside React and unsubscribes on the way out,
  // which is the case effects exist for — no state is set synchronously in the body.
 useEffect(() => {
 const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files")
 const enter = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDepth((d) => d + 1) } }
 const leave = (e: DragEvent) => { if (hasFiles(e)) setDepth((d) => Math.max(0, d - 1)) }
    // Without a preventDefault on dragover the browser opens the file instead of dropping it.
 const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
 const drop = (e: DragEvent) => {
 if (!hasFiles(e)) return
 e.preventDefault()
 setDepth(0)
 const list = Array.from(e.dataTransfer?.files ?? [])
 const bad = list.filter((f) => !isPdf(f))
 const good = list.filter(isPdf)
 setErr(bad.length ? `${bad.map((f) => f.name).join(", ")} — only PDFs can be pre-scanned, that's what carriers issue.` : null)
 if (good.length) onStage(good)
    }
 window.addEventListener("dragenter", enter)
 window.addEventListener("dragleave", leave)
 window.addEventListener("dragover", over)
 window.addEventListener("drop", drop)
 return () => {
 window.removeEventListener("dragenter", enter)
 window.removeEventListener("dragleave", leave)
 window.removeEventListener("dragover", over)
 window.removeEventListener("drop", drop)
    }
  }, [onStage])

 if (!depth && !err) return null
 if (!depth) {
 return (
      <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[90vw] rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 shadow-lg dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
        {err}
        <button onClick={() => setErr(null)} className="ml-2 font-semibold underline">Dismiss</button>
      </div>
    )
  }
 return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-8 backdrop-blur-sm">
      {/* The SAME card, scaled up and shadowed — the resting one lifting off the page. */}
      <div className={DROP_CARD + " w-full max-w-lg scale-105 border-primary bg-card/95 shadow-xl"}>
        <DropCardBody />
      </div>
    </div>
  )
}

/**
 * EXTERNAL LABELS AS QUEUE ROWS, not a second table underneath one.
 *
 * They were their own card with their own headers — Source, Pages, Sent, Progress — sitting
 * directly below a queue headed Channel, Units, Ship to, Status. Two tables asking the same
 * question in two vocabularies, one under the other, so the eye had to re-learn the layout
 * halfway down the screen and no single selection covered the parcels actually on the bench.
 *
 * The columns turned out to be the same columns all along:
 *
 *   Source   → Channel byeastside, or "On this machine" while it waits
 *   Pages    → Units one parcel per page, which is what a unit is here
 *   Sent     → (moved) under the file name, where the order number's own subtitle goes
 *   Progress → Status the label's state, in the same column the queue reads it from
 *
 * Customer and Ship-to were the only genuinely missing pair, and those are now read off the
 * label PDF itself (lib/label-pdf.ts) rather than left as dashes.
 *
 * WHAT DOES NOT MERGE IS THE MEANING. These touch no order, move no stage and bill nothing
 * — the whole reason this feature was once declined — so every row carries an "External"
 * tag and the block that explains them sits directly above. Sharing a table is a claim about
 * layout, not about what the rows are.
 *
 * ONE ROW PER COMPONENT, rather than one component rendering every external row in a block.
 * The block put them all after the orders, which is a sort order nobody chose — a file
 * dropped ten seconds ago sat below an order from yesterday. The board interleaves all
 * three kinds by time now, so it needs to render them one at a time.
 */

/** The pull-back, and the error it can produce, shared by every upload row on the board.
 *  Hoisted to one owner because the confirm dialog and the failure message belong to the
 * list, not to whichever row happened to be clicked. */
export function useLabelPullBack(onChanged: () => void) {
 const confirm = useConfirm()
 const [err, setErr] = useState<string | null>(null)
 const [pulling, setPulling] = useState(false)

 const pullBack = async (u: DispatchUpload) => {
 const okToGo = await confirm({
 title: "Pull this label back?",
 body: `${u.file_name || "This label"} would be removed from byeastside's queue. Once a label has been picked they refuse the recall — the parcel is committed by then.`,
 confirmLabel: "Pull it back",
    })
 if (!okToGo) return
 setPulling(true); setErr(null)
 try {
 const r = await deleteDispatchUpload(u.id)
 if (r.error) throw new Error(r.error)
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't pull that one back.")
    } finally { setPulling(false); onChanged() }
  }

 return { pullBack, pulling, err, clearErr: () => setErr(null) }
}

/** A file on this machine that has not been sent. */
export function StagedLabelRow({ s, picked, onToggle, onDiscard }: {
 s: StagedLabel
 picked: boolean
 onToggle: (key: string) => void
 onDiscard: (key: string) => void
}) {
 const k = stagedKeyOf(s)
 const p = s.parse
 return (
          <label className={DISPATCH_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"}>
            <input
 type="checkbox" checked={picked} onChange={() => onToggle(k)}
 className="size-4 shrink-0 accent-primary" aria-label={`Select ${s.name}`}
            />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <FilePdf size={13} className="shrink-0 text-muted-foreground" />
                <span className="truncate text-sm" title={s.name}>{s.name}</span>
              </span>
              <ExternalTag />
            </span>
            <Recipient parse={p} />
            <span className="truncate text-xs text-muted-foreground">On this machine</span>
            <span className="text-xs text-muted-foreground">{p?.pages || "—"}</span>
            <span className="truncate text-xs text-muted-foreground" title={p?.addressLines.join(", ") || undefined}>
              {p?.shipTo || "—"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock size={13} weight="bold" className="shrink-0" /> Waiting to send
            </span>
            <span className="truncate text-xs tabular-nums text-muted-foreground" title={p?.tracking || undefined}>
              {p?.tracking || "—"}
            </span>
            <span className="flex justify-end">
              {/* Nothing to recall — it never left. So this is a plain discard, not a
 pull-back, and it says the difference by being a different word. */}
              <button
 type="button"
 onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDiscard(k) }}
 className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
 aria-label={`Discard ${s.name}`}
 title="Discard — this file was never sent anywhere"
              >
                <X size={13} weight="bold" />
              </button>
            </span>
          </label>
  )
}

/** A label that IS with byeastside. */
export function UploadLabelRow({ u, picked, onToggle, busy, pulling, onPullBack }: {
 u: DispatchUpload
 picked: boolean
 onToggle: (key: string) => void
 busy: boolean
 pulling: boolean
 onPullBack: (u: DispatchUpload) => void
}) {
 const k = uploadKeyOf(u)
 const p = progressOf(u)
 const PI = TONE_ICON[p.tone]
  // Theirs first: an extractor that has READ the label beats what we parsed off it
  // before sending, because theirs is what their queue will actually scan.
 const tracked = (u.labels ?? []).map((l) => l.trackingNumber).filter(Boolean) as string[]
 const trackText = tracked[0] || u.tracking || null
 return (
          <label className={DISPATCH_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"}>
            <input
 type="checkbox" checked={picked} onChange={() => onToggle(k)}
 className="size-4 shrink-0 accent-primary" aria-label={`Select ${u.file_name || "label"}`}
            />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <FilePdf size={13} className="shrink-0 text-muted-foreground" />
                <span className="truncate text-sm" title={u.file_name || undefined}>{u.file_name || "label.pdf"}</span>
              </span>
              {/* WHEN IT WENT, where the order number's own subtitle sits. It had a column
 of its own; the queue has no such column and does not need one, because
                  "sent" is a fact about this file rather than a fact about dispatch. Who
 sent it stays in the title — it settles arguments, it doesn't need a line. */}
              <span className="truncate text-2xs text-muted-foreground" title={u.created_by || undefined}>
                Sent {dt(u.created_at)}
              </span>
            </span>
            <span className="min-w-0">
              {u.recipient
                ? <span className="truncate text-sm">{u.recipient}</span>
 : <span
 className="truncate text-xs italic text-muted-foreground"
 title="Either the label is a picture with no text in it, or it was sent before we started reading names off labels. Open the label to see who it's for."
                  >No name on file</span>}
            </span>
            <span className="truncate text-xs text-muted-foreground">byeastside</span>
            <span className="text-xs text-muted-foreground">{u.total_pages ?? "—"}</span>
            <span className="truncate text-xs text-muted-foreground" title={u.ship_to || undefined}>{u.ship_to || "—"}</span>
            <span className={"min-w-0 text-xs font-medium " + TONE[p.tone]} title={p.title}>
              <span className="flex items-center gap-1.5">
                <PI size={13} weight="bold" className="shrink-0" />
                <span className="truncate">{p.label}</span>
              </span>
              {/* Their own word for the state, kept verbatim beside ours — it is what
 their dashboard shows, so the two can be matched up. */}
              {u.status && <span className="block truncate eg-label opacity-70">{u.status}</span>}
            </span>
            <span className="min-w-0 text-xs">
              {trackText ? (
                <>
                  <span className="flex items-center gap-1 tabular-nums">
                    <Barcode size={11} className="shrink-0 opacity-60" /><span className="truncate">{trackText}</span>
                  </span>
                  {tracked.length > 1 && <span className="block text-muted-foreground">+{tracked.length - 1} more</span>}
                </>
              ) : <span className="text-muted-foreground">—</span>}
            </span>
            <span className="flex justify-end gap-1">
              {u.public_url && (
                <a
 href={u.public_url} target="_blank" rel="noopener noreferrer"
 onClick={(e) => e.stopPropagation()}
 title="Open the label as they received it"
 className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ArrowSquareOut size={13} weight="bold" />
                </a>
              )}
              {/* Offered only while it can still work. Their DELETE refuses the whole
                  PDF once ANY label on it has been picked — not just once all of them
 have — because those parcels are already committed. So the test is
                  `scanned_labels === 0`; gating on "fully picked" left a button on
 every part-scanned batch that could only ever return their 409. */}
              {u.scanned_labels === 0 ? (
                <button
 type="button" disabled={busy || pulling}
 onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPullBack(u) }}
 className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
 aria-label={`Pull back ${u.file_name || "label"}`}
 title="Pull this label back out of byeastside's queue"
                >
                  {/* The SAME X the staged row uses. Two icons for one gesture — discard
 here, bin there — read as two different powers, and the row above is
 the only place the eye has to compare them. The difference that
 matters is carried by the words and by the confirm, not by the glyph. */}
                  <X size={13} weight="bold" />
                </button>
              ) : (
                <span
 title={`${u.scanned_labels} already picked — byeastside won't take this batch back`}
 className="inline-flex size-7 items-center justify-center text-muted-foreground"
                >
                  <Lock size={13} />
                </span>
              )}
            </span>
          </label>
  )
}

/** The one thing a shared table must not blur: this row is not an order. Nothing is
 * charged for it, no stage moves, and no seller is behind it. */
function ExternalTag() {
 return (
    <span className="mt-0.5 w-fit rounded border border-border bg-muted px-1 py-px eg-label text-muted-foreground">
      External
    </span>
  )
}

/** The addressee we read off the PDF, or WHY there isn't one. Never a blank cell: "we
 * couldn't read this label" and "this label has no customer" would look identical, and
 * only one of them is worth someone typing the name in by hand. */
function Recipient({ parse }: { parse: LabelParse | null }) {
 if (!parse) {
 return <span className="truncate text-xs text-muted-foreground">Reading the label…</span>
  }
 if (parse.reason === "ok" && parse.name) {
 return <span className="truncate text-sm" title={parse.addressLines.join(", ")}>{parse.name}</span>
  }
  // "ok" with no name lands here too — the parse said it worked and produced nothing,
  // which is the no-ship-to case by another route.
 const why = parse.reason === "ok" ? "no-ship-to" : parse.reason
 return (
    <span className="truncate text-xs italic text-muted-foreground" title={PARSE_WHY[why]}>
      {PARSE_NOTE[why]}
    </span>
  )
}
