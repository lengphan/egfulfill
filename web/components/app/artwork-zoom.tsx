"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Warning, CheckCircle, DownloadSimple, UploadSimple, PaperPlaneTilt, PenNib } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { uploadDesignFile, type OrderItem, type OrderRow } from "@/lib/api"
import { numOf } from "@/lib/order-format"

/** Machine-file extensions the embroidery side actually uses. Kept in one place so the
 *  accept attribute, the drop filter and the error message can't drift apart. */
const MACHINE_EXT = [".emb", ".pes", ".dst", ".exp", ".jef", ".vp3", ".xxx", ".hus"]
const isMachineFile = (name: string) => MACHINE_EXT.some((e) => name.toLowerCase().endsWith(e))

/**
 * The artwork, big, with the two things you actually need while looking at it.
 *
 * DOWNLOAD, because the person checking a design is often about to open it in embroidery
 * software, and "right-click, save as" on a canvas that may be a signed URL or a data-URL
 * is not a workflow. The customer's file is the reference the machine file gets judged
 * against.
 *
 * DROP A MACHINE FILE, because the common case is that our designer cut it and sent it
 * back out-of-band, and the operator is the one holding it. Uploading it here rather than
 * hunting for a separate screen is the difference between the file being filed and it
 * sitting in someone's inbox.
 *
 * Machine files only — an image dropped here would be stored as `kind: 'image'` and quietly
 * fail to count as a deliverable anywhere, which looks identical to a successful upload.
 */
export function ArtworkZoom({ order, item, artwork, open, onOpenChange, onUploaded, onSendToDesigner }: {
  order: OrderRow
  item: OrderItem
  /** The customer's artwork — a URL or data-URL, whichever the designs map holds. */
  artwork: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onUploaded?: () => void
  /** Offered only when the line has no machine file yet — see the note by the button. */
  onSendToDesigner?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { setErr(null); setDone(null); setOver(false) }, 0)
    return () => clearTimeout(t)
  }, [open])

  const upload = useCallback(async (files: File[]) => {
    const machine = files.filter((f) => isMachineFile(f.name))
    if (!machine.length) {
      setErr(files.length
        ? `Only machine files go here (${MACHINE_EXT.join(", ")}). An image dropped here would be stored but wouldn't count as a deliverable.`
        : null)
      return
    }
    setBusy(true); setErr(null); setDone(null)
    const failed: string[] = []
    for (const f of machine) {
      try {
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error("unreadable"))
          r.readAsDataURL(f)
        })
        // designId is per FILE, and carries the line so two siblings of the same SKU get
        // distinct deliverables rather than one overwriting the other.
        const designId = `EMB-${item.line_id ?? item.sku ?? "line"}-${f.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`
        const r = await uploadDesignFile({
          designId, orderId: order.id, sku: item.sku ?? undefined, name: f.name, mime: f.type || undefined, data,
        })
        if (r?.error) throw new Error(r.error)
      } catch (e) { failed.push(`${f.name}${e instanceof Error ? ` (${e.message})` : ""}`) }
    }
    setBusy(false)
    if (failed.length) setErr(`Couldn't upload: ${failed.join(", ")}`)
    else {
      setDone(`${machine.length} file${machine.length === 1 ? "" : "s"} attached to this line.`)
      onUploaded?.()
    }
  }, [order.id, item, onUploaded])

  const artName = `${numOf(order)}-${item.sku ?? "artwork"}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{item.name ?? item.sku ?? "Artwork"}</DialogTitle>
          <DialogDescription>
            {numOf(order)}
            {item.sku && <> · <span className="font-mono text-xs">{item.sku}</span></>}
            {item.print_type && <> · {item.print_type}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="space-y-2">
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-border bg-muted p-2">
              {artwork ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artwork} alt={`Artwork for ${item.name ?? item.sku ?? "this line"}`}
                  className="max-h-[52vh] w-auto max-w-full object-contain" />
              ) : (
                <div className="flex h-56 w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <PenNib size={28} weight="duotone" className="opacity-50" />
                  <span className="text-sm">No artwork attached to this line.</span>
                </div>
              )}
            </div>
            {artwork && (
              // `download` with a filename — without it a signed storage URL opens in a tab
              // and a data-URL saves as "download", neither of which is usable later.
              <a href={artwork} download={artName}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
                <DownloadSimple size={14} weight="bold" /> Download the customer&apos;s file
              </a>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-xs font-medium">Machine file</span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); void upload(Array.from(e.dataTransfer?.files ?? [])) }}
                className={"flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-6 text-center text-xs transition-colors " +
                  (over ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-accent")}
              >
                {busy ? <CircleNotch size={18} className="animate-spin" /> : <UploadSimple size={18} weight="duotone" />}
                <span>{busy ? "Uploading…" : "Drop the .emb here, or click to choose"}</span>
                <span className="text-[11px] text-muted-foreground/80">{MACHINE_EXT.join(" · ")}</span>
              </button>
              <input ref={fileRef} type="file" multiple accept={MACHINE_EXT.join(",")} className="hidden"
                onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = "" }} />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Filing it here counts as done for this line. Nobody is credited — a payout
                follows a card someone claimed, and this path has no card.
              </p>
            </div>

            {onSendToDesigner && (
              <div className="border-t border-border pt-3">
                {/* The alternative to uploading, not a step after it. Offering both without
                    saying they're alternatives is how a line ends up with a finished file
                    AND an open card nobody closes. */}
                <p className="mb-1.5 text-[11px] text-muted-foreground">Don&apos;t have the file yet?</p>
                <Button size="sm" variant="outline" onClick={onSendToDesigner} disabled={!artwork}>
                  <PaperPlaneTilt size={14} weight="bold" /> Send this line to a designer
                </Button>
                {!artwork && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Needs artwork first — there&apos;s nothing to digitise.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {done && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" /> {done}
          </div>
        )}
        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
