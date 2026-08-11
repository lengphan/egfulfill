"use client"

import { useState } from "react"
import { FilePdf, CircleNotch, ArrowSquareOut, UploadSimple, Barcode, Lock, X, Clock, CheckCircle, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { DISPATCH_GRID, DISPATCH_HEAD } from "@/components/app/dispatch-grid"
import { uploadDispatchLabel, deleteDispatchUpload, type DispatchUpload } from "@/lib/api"

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
 *  byeastside gives it one, and identity has to survive re-renders before then. */
export type StagedLabel = { key: string; name: string; file: File }

/** Send one staged label. Lives here beside the drop zone, called by the board, because
 *  the button that triggers it sits in the board's header. Throws with the file's own
 *  words — a batch that half-fails must say WHICH file, since the fix is re-shooting that
 *  one page and "upload failed" makes you re-do all of them. */
export async function sendStagedLabel(s: StagedLabel): Promise<DispatchUpload | undefined> {
  const dataUrl = await readAsDataUrl(s.file)
  const r = await uploadDispatchLabel({ fileName: s.name, dataUrl })
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
  warn: "text-amber-700 dark:text-amber-400",
  ok: "text-emerald-700 dark:text-emerald-400",
  part: "text-sky-700 dark:text-sky-400",
}
const TONE_ICON = { wait: Clock, warn: Warning, ok: CheckCircle, part: Barcode } as const

/**
 * THE DROP TARGET, as a strip at the top of the screen rather than a panel in the middle.
 *
 * It was a tall dashed box inside the external-labels card, which put the one thing you DO
 * on this screen underneath both lists, and gave a rare action more room than the day's
 * work. It is also the only control here that isn't a row, so it belongs above the rows
 * rather than between them.
 *
 * One line, because that is all it has to say. The small print it used to carry — PDF only,
 * and dropping does not send — is now in the strip's own wording and in the row it creates,
 * which says "Waiting to send" in the status column and is the honest place for it.
 */
export function LabelDropBar({ onStage }: { onStage: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** Caught here, before anything leaves, so dropping a photo by accident answers instantly.
   *  The server checks the bytes as well — this one is about the wait, that one is the truth. */
  const stage = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    const bad = list.filter((f) => !isPdf(f))
    const good = list.filter(isPdf)
    setErr(bad.length ? `${bad.map((f) => f.name).join(", ")} — only PDFs can be pre-scanned, that's what carriers issue.` : null)
    if (good.length) onStage(good)
  }

  return (
    <div className="space-y-2">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); stage(e.dataTransfer.files) }}
        className={"flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm transition-colors "
          + (over ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/50")}
      >
        <UploadSimple size={15} className="shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">Drop a label PDF</span>
        <span className="truncate text-xs text-muted-foreground">
          or click to choose — it waits below until you send it to byeastside
        </span>
        <input
          type="file" multiple className="sr-only"
          accept="application/pdf"
          onChange={(e) => { stage(e.target.files); e.target.value = "" }}
        />
      </label>
      {err && <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{err}</div>}
    </div>
  )
}

/**
 * The list is passed IN rather than fetched here. GET /api/dispatch/uploads syncs from
 * byeastside on read, so two components polling it would double the calls we make to a
 * partner for one screen — and the dispatch board needs the same rows for its history.
 * One owner, one poll. The staged files and the selection are lifted for the same reason:
 * the buttons that act on them live in the board's header.
 */
export function ExternalLabels({
  uploads, staged, picked, onDiscard, onToggle, onToggleAll, busy, onChanged,
}: {
  uploads: DispatchUpload[] | null
  staged: StagedLabel[]
  picked: Set<string>
  onDiscard: (key: string) => void
  onToggle: (key: string) => void
  onToggleAll: () => void
  busy: boolean
  onChanged: () => void
}) {
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

  const rows = (uploads?.length ?? 0) + staged.length
  const selectable = staged.length + (uploads?.length ?? 0)
  const chosen = picked.size

  return (
    <SectionCard
      title="External labels"
      actions={
        <div className="flex items-center gap-2">
          {chosen > 0 && <span className="text-xs text-muted-foreground">{chosen} selected</span>}
          {selectable > 0 && (
            <Button size="sm" variant="outline" onClick={onToggleAll}>
              {chosen === selectable ? "Clear selection" : `Select all ${selectable}`}
            </Button>
          )}
        </div>
      }
      bodyClassName="space-y-3 p-4"
    >
      {/* These go to the partner's queue and NOT onto an order — said once, here, because
          it is the single thing someone could reasonably assume wrong about this card. */}
      <p className="text-xs text-muted-foreground">
        {/* The explicit space is load-bearing: the compiler drops the one after a closing
            tag mid-line, so "byeastsideabove" is what actually shipped without it. */}
        Tick a label and press <b>Send to byeastside</b>{" "}
        above to put it in their pre-scan queue.
        These aren&apos;t attached to an EGFULFILL order and nothing is charged for them — for our
        own orders, tick them in the queue above instead.
      </p>

      {err && <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{err}</div>}

      {uploads === null && !staged.length ? (
        <div className="flex justify-center py-6 text-muted-foreground"><CircleNotch size={18} className="animate-spin" /></div>
      ) : rows === 0 ? (
        /* Nothing here yet — which is not the same as a broken feature, so it says which. */
        <p className="py-3 text-center text-xs text-muted-foreground">Nothing dropped or sent yet.</p>
      ) : (
        /* Same nine columns as the dispatch queue above — see dispatch-grid.ts. The card's
           own padding is cancelled so the grid's px-5 lines up with the queue's. */
        <div className="-mx-4 overflow-x-auto">
          <div className={DISPATCH_GRID + " " + DISPATCH_HEAD}>
            <span />
            <span className="col-span-2">File</span>
            <span>Source</span>
            <span>Pages</span>
            <span>Sent</span>
            <span>Progress</span>
            <span>Tracking</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {/* WAITING TO GO first — it is the only part of this card anyone has to act on. */}
            {staged.map((s) => {
              const k = stagedKeyOf(s)
              return (
                <label key={k} className={DISPATCH_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"}>
                  <input
                    type="checkbox" checked={picked.has(k)} onChange={() => onToggle(k)}
                    className="size-4 shrink-0 accent-primary" aria-label={`Select ${s.name}`}
                  />
                  <span className="col-span-2 flex min-w-0 items-center gap-1.5">
                    <FilePdf size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm" title={s.name}>{s.name}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">On this machine</span>
                  <span className="text-xs text-muted-foreground">—</span>
                  <span className="text-xs text-muted-foreground">Not sent</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Clock size={13} weight="bold" className="shrink-0" /> Waiting to send
                  </span>
                  <span className="text-xs text-muted-foreground">—</span>
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
            })}

            {(uploads ?? []).map((u) => {
              const k = uploadKeyOf(u)
              const p = progressOf(u)
              const PI = TONE_ICON[p.tone]
              const tracked = (u.labels ?? []).map((l) => l.trackingNumber).filter(Boolean) as string[]
              return (
                <label key={k} className={DISPATCH_GRID + " cursor-pointer py-3 transition-colors hover:bg-accent/40"}>
                  <input
                    type="checkbox" checked={picked.has(k)} onChange={() => onToggle(k)}
                    className="size-4 shrink-0 accent-primary" aria-label={`Select ${u.file_name || "label"}`}
                  />
                  <span className="col-span-2 flex min-w-0 items-center gap-1.5">
                    <FilePdf size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm" title={u.file_name || undefined}>{u.file_name || "label.pdf"}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">byeastside</span>
                  <span className="text-xs text-muted-foreground">{u.total_pages ?? "—"}</span>
                  <span className="min-w-0 text-xs text-muted-foreground">
                    <span className="block truncate">{dt(u.created_at)}</span>
                    {u.created_by ? <span className="block truncate text-2xs">{u.created_by}</span> : null}
                  </span>
                  <span className={"min-w-0 text-xs font-medium " + TONE[p.tone]} title={p.title}>
                    <span className="flex items-center gap-1.5">
                      <PI size={13} weight="bold" className="shrink-0" />
                      <span className="truncate">{p.label}</span>
                    </span>
                    {/* Their own word for the state, kept verbatim beside ours — it is what
                        their dashboard shows, so the two can be matched up. */}
                    {u.status && <span className="block truncate text-2xs uppercase tracking-wide opacity-70">{u.status}</span>}
                  </span>
                  <span className="min-w-0 text-xs">
                    {tracked.length ? (
                      <>
                        {tracked.slice(0, 3).map((t) => (
                          <span key={t} className="flex items-center gap-1 font-mono"><Barcode size={11} className="shrink-0 opacity-60" /><span className="truncate">{t}</span></span>
                        ))}
                        {tracked.length > 3 && <span className="block text-muted-foreground">+{tracked.length - 3} more</span>}
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
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void pullBack(u) }}
                        className="eg-tap shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label={`Pull back ${u.file_name || "label"}`}
                        title="Pull this label back out of byeastside's queue"
                      >
                        {/* The SAME X the staged row uses. Two icons for one gesture —
                            discard here, bin there — read as two different powers, and the
                            row above is the only place the eye has to compare them. The
                            difference that matters is carried by the words (discard vs pull
                            back) and by the confirm, not by the glyph. */}
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
            })}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
