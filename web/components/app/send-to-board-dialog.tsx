"use client"

import { useEffect, useState } from "react"
import { Cards, CircleNotch, Paperclip } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createDesignCard, assignDesignCard, getDesignFiles, filesForLine, type DesignFileRow } from "@/lib/api"
import { useLabelT } from "@/lib/i18n"

/**
 * WHAT IS ABOUT TO BE SENT, BEFORE IT IS SENT.
 *
 * Send to Board used to fire on the click. It minted the card with
 * `title: itemName || sku || "Design"` and whatever picture the line happened to carry, and
 * the first time anyone saw either was on the board — so correcting a title meant opening
 * the card in the designer window and editing it there, one card at a time, after the fact.
 *
 * Everything here is a field the board itself already stores, so nothing new is being
 * invented to hold it: `title` is the card's title and `description` is `specs.description`,
 * which is the SAME field the board's own card editor patches. Setting them here and setting
 * them there are one field, not two that agree by luck.
 *
 * The files are READ-ONLY on purpose. This is a confirmation of what the line is carrying,
 * not a second uploader — artwork arrives through the order's own design panel, and a
 * separate way in here would be a second path to the same table with its own bugs.
 */
export function SendToBoardDialog({
  open, onOpenChange, orderId, sku, lineId, itemName, artworkUrl, lineImage, printType, onSent,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderId: string
  sku: string
  lineId?: string | null
  itemName?: string | null
  artworkUrl?: string | null
  lineImage?: string | null
  printType?: string | null
  onSent?: () => void
}) {
  const tl = useLabelT()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const image = artworkUrl || lineImage || null

  /* Seeded on OPEN, not on mount. The dialog stays mounted between rows, so seeding once
     would carry the previous line's title onto the next one — which is the failure this
     whole dialog exists to prevent, just moved one step earlier. */
  useEffect(() => {
    if (!open) return
    let alive = true
    /* Deferred, not synchronous: react-hooks/set-state-in-effect bans setting state during
       an effect (CLAUDE.md 5). A microtask satisfies it and still lands before paint, so the
       dialog never flashes the previous line's title. */
    queueMicrotask(() => {
      if (!alive) return
      setTitle(itemName || sku || "Design")
      setDescription("")
      setErr(null)
      setFiles(null)
    })
    getDesignFiles(orderId)
      .then((rows) => { if (alive) setFiles(filesForLine(rows ?? [], { line_id: lineId, sku })) })
      .catch(() => { if (alive) setFiles([]) })
    return () => { alive = false }
  }, [open, orderId, sku, lineId, itemName])

  const send = async () => {
    const t = title.trim()
    if (!t) { setErr(tl("sendBoard", "Give the card a title — it is what the designer sees first.")) ; return }
    setBusy(true); setErr(null)
    try {
      /* Create then assign, never one call: a card that exists but is attached to nothing
         shows on the board with no order behind it, which is worse than no card. */
      const card = await createDesignCard({
        title: t,
        description: description.trim() || undefined,
        data: image || undefined,
        sku: sku || undefined,
        col: "incoming",
      })
      if (card.error) throw new Error(card.error)
      if (card.id) {
        const a = await assignDesignCard(String(card.id), { orderId, sku, lineId: lineId || undefined })
        if ((a as { error?: string })?.error) throw new Error(String((a as { error?: string }).error))
      }
      onSent?.()
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : tl("sendBoard", "Couldn't send this line to the board."))
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cards size={18} weight="fill" />
            {tl("sendBoard", "Send to design board")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-4">
            {/* The picture the card will carry. Shown at the size it will be recognised at,
                not as a thumbnail — the point is to catch the wrong artwork here. */}
            <div className="size-28 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
              {image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={image} alt="" className="size-full object-contain p-1.5" />
                : <div className="flex size-full items-center justify-center px-2 text-center text-2xs text-muted-foreground">
                    {tl("sendBoard", "No artwork on this line")}
                  </div>}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium">{tl("sendBoard", "Card title")}</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
              </div>
              <p className="text-xs text-muted-foreground">
                {sku}{printType ? ` · ${printType}` : ""}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">{tl("sendBoard", "Brief for the designer")}</label>
            <textarea
              rows={3}
              className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              placeholder={tl("sendBoard", "Thread colours, placement, anything the artwork doesn't say on its own")}
            />
          </div>

          {/* WHAT IS ALREADY ON THE LINE. A card sent without its stitch file is the trip to
              the board this dialog exists to save, so the count is stated rather than left
              to be discovered. */}
          <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Paperclip size={13} />
              {files === null
                ? tl("sendBoard", "Reading attached files…")
                : files.length === 0
                ? tl("sendBoard", "No files attached to this line")
                : `${files.length} ${files.length === 1 ? tl("sendBoard", "file attached") : tl("sendBoard", "files attached")}`}
            </div>
            {!!files?.length && (
              <ul className="mt-1.5 space-y-0.5">
                {files.slice(0, 5).map((f, i) => (
                  <li key={i} className="truncate text-xs text-muted-foreground">{f.name || f.designId}</li>
                ))}
              </ul>
            )}
          </div>

          {/* A refusal carries its reason. */}
          {err && <p className="text-sm text-alert">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {tl("sendBoard", "Cancel")}
          </Button>
          <Button onClick={() => void send()} disabled={busy}>
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <Cards size={14} weight="fill" />}
            {busy ? tl("sendBoard", "Sending…") : tl("sendBoard", "Send to board")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
