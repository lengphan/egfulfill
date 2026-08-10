"use client"

import { useCallback, useEffect, useState } from "react"
import { FilePdf, CircleNotch, ArrowSquareOut, Trash, UploadSimple, Barcode, CheckCircle } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { getDispatchUploads, uploadDispatchLabel, deleteDispatchUpload, type DispatchUpload } from "@/lib/api"

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
 */

/** Their upload refuses anything but a PDF — measured against the live API, 2026-08-10:
 *  `400 {"message":"Only PDF files are allowed"}`. A photo of a label is what a person
 *  actually has, so an image is converted to JPEG here and wrapped in a one-page PDF
 *  server-side. The conversion is the browser's job: it already decodes every format it
 *  can display (HEIC from a phone, WebP, PNG), and the server decodes none. */
const MAX_EDGE = 2400   // enough for a barcode to survive; well under their 50MB

function toJpegDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const c = document.createElement("canvas")
      c.width = w; c.height = h
      const ctx = c.getContext("2d")
      if (!ctx) { reject(new Error("This browser couldn't process the image.")); return }
      // WHITE FIRST. A transparent PNG drawn onto a fresh canvas exports as BLACK behind
      // the artwork in JPEG, which for a label means a black page with an unreadable
      // barcode — and their extractor would simply find nothing.
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL("image/jpeg", 0.92))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image couldn't be opened.")) }
    img.src = url
  })
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error("That file couldn't be read."))
    fr.readAsDataURL(file)
  })

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"

/**
 * What a batch is doing, in our words rather than theirs.
 *
 * `total_labels` null and 0 are DIFFERENT and the difference matters: null is "their
 * extractor hasn't looked yet", 0 is "it looked and found no label on the page". One is a
 * wait, the other is a file to re-shoot, and collapsing them would have someone waiting
 * forever on a photo that will never produce anything.
 */
function progressOf(u: DispatchUpload): { label: string; tone: "wait" | "warn" | "ok" | "part" } {
  if (u.total_labels == null) return { label: "Reading the file…", tone: "wait" }
  if (u.total_labels === 0) return { label: "No label found on the page", tone: "warn" }
  if (u.scanned_labels >= u.total_labels) return { label: `Picked · ${u.scanned_labels} of ${u.total_labels}`, tone: "ok" }
  return { label: `${u.scanned_labels} of ${u.total_labels} picked`, tone: "part" }
}

const TONE: Record<"wait" | "warn" | "ok" | "part", string> = {
  wait: "text-muted-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  ok: "text-emerald-700 dark:text-emerald-400",
  part: "text-sky-700 dark:text-sky-400",
}

export function ExternalLabels() {
  const confirm = useConfirm()
  const [uploads, setUploads] = useState<DispatchUpload[] | null>(null)
  const [configured, setConfigured] = useState(true)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const load = useCallback(() => {
    getDispatchUploads()
      .then((r) => { setUploads(r.uploads ?? []); setConfigured(r.configured !== false) })
      .catch(() => setUploads([]))
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 0)
    // Their extractor runs asynchronously and their floor scans on their own clock, so
    // this polls — slowly. Nothing else in the product depends on these being current.
    const id = setInterval(load, 30000)
    return () => { clearTimeout(t); clearInterval(id) }
  }, [load])

  const send = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    setBusy(true); setErr(null); setSent(null)
    let ok = 0
    for (const f of list) {
      try {
        const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name)
        const dataUrl = isPdf ? await readAsDataUrl(f) : await toJpegDataUrl(f)
        const r = await uploadDispatchLabel({ fileName: f.name, dataUrl })
        if (r.error) throw new Error(r.error)
        ok++
      } catch (e) {
        // Named, because a batch that half-fails must say WHICH file — the fix is
        // re-shooting that one page, and "upload failed" makes you re-do all of them.
        setErr(`${f.name}: ${e instanceof Error ? e.message : "couldn't be sent"}`)
        break
      }
    }
    if (ok) setSent(`${ok} label${ok === 1 ? "" : "s"} sent for pre-scan.`)
    setBusy(false)
    load()
  }

  const pullBack = async (u: DispatchUpload) => {
    const okToGo = await confirm({
      title: "Pull this label back?",
      body: `${u.file_name || "This label"} would be removed from byeastside's queue. Once a label has been picked they refuse the recall — the parcel is committed by then.`,
      confirmLabel: "Pull it back",
    })
    if (!okToGo) return
    setBusy(true); setErr(null)
    try {
      const r = await deleteDispatchUpload(u.id)
      if (r.error) throw new Error(r.error)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't pull that one back.")
    } finally { setBusy(false); load() }
  }

  return (
    <SectionCard
      title="External labels"
      actions={uploads?.length ? <span className="text-xs text-muted-foreground">{uploads.length} sent</span> : undefined}
      bodyClassName="p-4 space-y-3"
    >
      {!configured && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          The dispatch partner isn&apos;t connected (<code>BYEASTSIDE_API_KEY</code>), so nothing can be sent from here yet.
        </div>
      )}

      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files) }}
        className={"flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed py-7 text-center transition-colors "
          + (busy ? "pointer-events-none opacity-60 " : "")
          + (over ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/50")}
      >
        {busy ? <CircleNotch size={20} className="animate-spin text-muted-foreground" /> : <UploadSimple size={20} className="text-muted-foreground" />}
        <span className="text-sm font-medium">{busy ? "Sending…" : "Drop a label here"}</span>
        {/* Say what happens to a photo. Their API takes PDFs only; we wrap an image rather
            than refuse it, and someone dropping a phone photo deserves to know that
            worked on purpose rather than wonder whether it did. */}
        <span className="text-xs text-muted-foreground">
          PDF, or a photo of the label — a photo is wrapped into a PDF for you
        </span>
        <input
          type="file" multiple className="sr-only" disabled={busy || !configured}
          accept="application/pdf,image/*"
          onChange={(e) => { void send(e.target.files); e.target.value = "" }}
        />
      </label>

      {/* These go to the partner's queue and NOT onto an order — said once, here, because
          it is the single thing someone could reasonably assume wrong about this box. */}
      <p className="text-xs text-muted-foreground">
        These go straight to byeastside&apos;s pre-scan queue. They aren&apos;t attached to an
        EGFULFILL order and nothing is charged for them — for our own orders, use Push to dispatch above.
      </p>

      {err && <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{err}</div>}
      {sent && !err && <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle size={13} weight="fill" />{sent}</div>}

      {uploads === null ? (
        <div className="flex justify-center py-6 text-muted-foreground"><CircleNotch size={18} className="animate-spin" /></div>
      ) : uploads.length === 0 ? (
        /* Nothing sent yet — which is not the same as a broken feature, so it says which. */
        <p className="py-3 text-center text-xs text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-2xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">File</th>
                <th className="py-2 pr-3 font-medium">Progress</th>
                <th className="py-2 pr-3 font-medium">Tracking</th>
                <th className="py-2 pr-3 font-medium">Sent</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {uploads.map((u) => {
                const p = progressOf(u)
                const tracked = (u.labels ?? []).map((l) => l.trackingNumber).filter(Boolean) as string[]
                return (
                  <tr key={String(u.id)} className="align-top">
                    <td className="max-w-64 py-2.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        <FilePdf size={14} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">{u.file_name || "label.pdf"}</span>
                      </div>
                      {u.total_pages ? <div className="text-2xs text-muted-foreground">{u.total_pages} page{u.total_pages === 1 ? "" : "s"}</div> : null}
                    </td>
                    <td className={"py-2.5 pr-3 text-xs " + TONE[p.tone]}>
                      {p.label}
                      {/* Their own word for the state, kept verbatim beside ours — it is
                          what their dashboard shows, so the two can be matched up. */}
                      {u.status && <div className="text-2xs uppercase tracking-wide opacity-70">{u.status}</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      {tracked.length ? (
                        <div className="space-y-0.5">
                          {tracked.slice(0, 4).map((t) => (
                            <div key={t} className="flex items-center gap-1 font-mono"><Barcode size={11} className="shrink-0 opacity-60" />{t}</div>
                          ))}
                          {tracked.length > 4 && <div className="text-muted-foreground">+{tracked.length - 4} more</div>}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {dt(u.created_at)}
                      {u.created_by ? <div className="text-2xs">{u.created_by}</div> : null}
                    </td>
                    <td className="py-2.5">
                      <div className="flex justify-end gap-1">
                        {u.public_url && (
                          <a
                            href={u.public_url} target="_blank" rel="noopener noreferrer"
                            title="Open the label as they received it"
                            className="eg-tap inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <ArrowSquareOut size={14} />
                          </a>
                        )}
                        {/* Offered only while it can still work. Once every label is picked
                            their API refuses the recall, and a button that always errors is
                            worse than no button. */}
                        {!(u.total_labels != null && u.total_labels > 0 && u.scanned_labels >= u.total_labels) && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void pullBack(u)} aria-label="Pull back">
                            <Trash size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
