"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Trash, UploadSimple, Warning, CheckCircle } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPinkStatus, pushToPink, uploadPinkAttachment } from "@/lib/api"

/** One option in a mapped dropdown. Their lists come back loosely shaped, so both the
 * key and the label are read defensively rather than assumed. */
type Opt = { value: string; label: string }

/** Pull {value,label} pairs out of whatever shape the partner's list endpoint returns —
 * an array, or an object with a `data` array, of strings or of objects. */
function toOptions(raw: unknown): Opt[] {
 const arr = Array.isArray(raw) ? raw
 : (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown[] }).data))
      ? (raw as { data: unknown[] }).data : []
 return arr.map((x) => {
 if (typeof x === "string") return { value: x, label: x }
 const o = (x ?? {}) as Record<string, unknown>
 const value = String(o.id ?? o.key ?? o.value ?? o.code ?? o.name ?? "")
 const label = String(o.name ?? o.title ?? o.label ?? value)
 return { value, label }
  }).filter((o) => o.value)
}

const readFile = (f: File) => new Promise<string>((res, rej) => {
 const r = new FileReader()
 r.onload = () => res(String(r.result))
 r.onerror = () => rej(new Error("Couldn't read that file"))
 r.readAsDataURL(f)
})

/** What a send needs to know, shared by the dialog and the inline (in-card) forms. All
 * optional: a send can be anchored to a line item, to an existing board card, or to
 * nothing at all (speculative artwork with no order behind it yet). */
type PushProps = {
 orderId?: string
 sku?: string
 cardId?: string
 itemName?: string | null
 qty?: number | null
 printType?: string | null
 artworkUrl?: string | null
  /** THE LINE'S OWN IMAGE, when no design has been stored yet.
   *
   *  Marketplace orders arrive with the buyer's artwork inlined as a `data:` URL, and Pink
   * accept URLs ONLY — so a line that plainly HAS a picture reported "no artwork to send"
   * and asked you to attach the file you were already looking at. It is uploaded on push
   * and sent as the design. Absolute http(s) values pass straight through. */
 lineImage?: string | null
  // The card's own description/notes, pre-filled so the notes typed on the card carry into
  // the push rather than being retyped in a second window.
 initialDescription?: string | null
  // Reference files already kept on the card — used as the attachments instead of a separate
  // uploader here (inline/compact mode), so files live in one place.
 presetExtras?: { url: string; name: string }[]
 onPushed?: (refId?: string) => void
}

/**
 * The Send-to-Pink-Design form BODY, without dialog chrome. Rendered two ways:
 *  - full, inside the standalone dialog (PushToPartnerDialog) — shows artwork, title and
 * description because the dialog has no other context.
 *  - `compact`, inline inside the card window (PushToPartnerInline) — the card already
 * shows the artwork and owns the title + description, so those are hidden here and the
 * card supplies them at send time. This is what keeps it ONE window.
 *
 * `active` gates the seeding effect: the dialog only seeds while open; the inline form is
 * always active once mounted (mounted only when its section is opened).
 */
function PushToPartnerPanel({
 orderId, sku, cardId, itemName, qty, printType, artworkUrl, lineImage, initialDescription, presetExtras,
 compact = false, active = true, onPushed, onCancel,
}: PushProps & { compact?: boolean; active?: boolean; onCancel?: () => void }) {
  const tl = useLabelT()
 const [status, setStatus] = useState<{ configured: boolean; ok?: boolean; error?: string } | null>(null)
 const [productTypes, setProductTypes] = useState<Opt[]>([])
 const [boards, setBoards] = useState<Opt[]>([])

 const [title, setTitle] = useState("")
 const [desc, setDesc] = useState("")
 const [productType, setProductType] = useState("")
  // When a default type is set in Settings, pre-select it and HIDE the picker — a single-type
  // shop shouldn't re-pick it every push. Empty string = no default, so the picker still shows.
 const [defaultType, setDefaultType] = useState("")
 const [board, setBoard] = useState("")
 const [extras, setExtras] = useState<{ url: string; name: string }[]>([])

 const [busy, setBusy] = useState(false)
 const [uploading, setUploading] = useState(false)
 const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
 const sending = useRef(false)
 const didSeed = useRef(false)

  // In compact (in-card) mode the card owns the reference files and passes them in live via
  // presetExtras; in full mode they're uploaded here into local `extras`.
 const effExtras = compact ? (presetExtras ?? []) : extras

 const load = useCallback(() => {
 getPinkStatus().then((s) => {
 setStatus(s)
 setProductTypes(toOptions(s.productTypes))
      // Default product type from Settings — pre-select it; the picker is then hidden below.
 const dt = String(s.productTypeDefault || "")
 setDefaultType(dt)
 if (dt) setProductType(dt)
 const b = toOptions(s.boards)
 setBoards(b)
      // One board is not a choice — pick it rather than making someone confirm it.
 if (b.length === 1) setBoard(b[0].value)
 else if (s.boardId) setBoard(String(s.boardId))
    }).catch(() => setStatus({ configured: false, error: "Couldn't reach the design partner." }))
  }, [])

  // The auto-derived title/description, used verbatim in compact mode (where those fields
  // aren't shown) and as the seed for the editable fields in full mode.
 const defaultTitle = orderId ? `${itemName || sku || "Design"} · order ${orderId}` : (itemName || sku || "Design")
 const defaultDesc = [
 printType ? `Print method: ${printType}.` : null,
 orderId ? `Order ${orderId}${sku ? `, SKU ${sku}` : ""}.` : "Not tied to an order.",
  ].filter(Boolean).join(" ")

 useEffect(() => {
 if (!active) { didSeed.current = false; return }
 if (didSeed.current) return
    // Seed ONCE per activation, not on every prop change — otherwise typing in the card's
    // description (which flows in as initialDescription) would reset the board / product-type
    // picks on every keystroke. Compact mode reads the card's files live at send time, so
    // there's nothing to seed for extras here.
 didSeed.current = true
 const t = setTimeout(() => {
 load()
 setTitle(defaultTitle)
      // Prefer the card's own notes when it has some; otherwise fall back to the auto summary.
 const d = (initialDescription ?? "").trim()
 setDesc(d || defaultDesc)
 setMsg(null)
 setExtras([])
    }, 0)
 return () => clearTimeout(t)
  }, [active, load, defaultTitle, defaultDesc, initialDescription])

 const addFiles = async (files: FileList | null) => {
 if (!files?.length) return
 setUploading(true); setMsg(null)
 try {
 for (const f of Array.from(files)) {
 const data = await readFile(f)
 const r = await uploadPinkAttachment({ data, name: f.name })
 if (r.error || !r.url) { setMsg({ ok: false, text: r.error || `Couldn't attach ${f.name}.` }); continue }
 setExtras((prev) => [...prev, { url: r.url as string, name: f.name }])
      }
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't attach that file." })
    } finally { setUploading(false) }
  }

 const send = async () => {
 if (sending.current) return
 sending.current = true
 setBusy(true); setMsg(null)
 try {
      // In compact mode the title/description fields aren't shown, so send the card's own
      // (via props) rather than the hidden local state.
 const effTitle = (compact ? defaultTitle : title).trim()
 const effDesc = (compact ? ((initialDescription ?? "").trim() || defaultDesc) : desc).trim()
      /**
       * PROMOTE THE LINE'S IMAGE, uploading it if it isn't already an address.
       *
       * Pink fetch the artwork over HTTP, so a `data:` URL — which is how marketplace
       * artwork arrives — is not something they can be handed. Rather than telling you to
       * re-attach a file you can already see on screen, it goes to object storage here and
       * the resulting URL is sent as the design. Done at PUSH time, not on open, so merely
       * looking at this dialog uploads nothing.
       */
      /**
       * SENDABLE, not merely PRESENT — the distinction this got wrong.
       *
       * Pink fetch artwork over HTTP, so the only question that matters is whether we hold
       * an ADDRESS. A stored design is normally base64 in order_designs, which designSrc
       * hands back as a `data:` URL — truthy, renderable, and completely unsendable. Keying
       * the upload off "is artworkUrl set" therefore skipped promotion exactly when a design
       * existed, and the push failed with "no URL to send" while the preview sat there
       * showing the artwork. Line images have the same property.
       *
       * So: take the best image we have, and if it is not already an address, make one.
       * Absolute http(s) passes straight through; `data:` is uploaded as-is; a
       * /api/order_items/:id/img reference is fetched same-origin and turned into bytes
       * first (the order LIST serves references rather than inlining megabytes of
       * thumbnails, and this page renders from whichever response landed first).
       */
 let directImage: string | undefined
 const candidate = artworkUrl || lineImage
 if (candidate) {
 if (/^https?:\/\//i.test(candidate)) {
 directImage = candidate
        } else {
 let data = candidate
 if (!/^data:/i.test(data)) {
 try {
 const blob = await (await fetch(candidate, { credentials: "include" })).blob()
 data = await new Promise<string>((res, rej) => {
 const fr = new FileReader()
 fr.onload = () => res(String(fr.result || ""))
 fr.onerror = () => rej(new Error("unreadable"))
 fr.readAsDataURL(blob)
              })
            } catch {
 setMsg({ ok: false, text: "Couldn't read this line's image to send as the design. Attach it below instead." })
 return
            }
          }
 const up = await uploadPinkAttachment({ data, name: `${sku || "artwork"}.png` })
 if (up.error || !up.url) { setMsg({ ok: false, text: up.error || "Couldn't upload the artwork to send as the design." }); return }
 directImage = up.url
        }
      }
 const r = await pushToPink({
 orderId, sku, cardId,
 imageUrl: directImage,
 title: effTitle || undefined,
        // The order's real quantity is still sent as context (server falls back to the line's
        // qty when absent); it just isn't an editable field, because a design is one job.
 qty: qty ?? undefined,
 description: effDesc || undefined,
 productType: productType || undefined,
 boardId: board || undefined,
 extraImages: effExtras.map((e) => e.url),
      })
 if (r.error) { setMsg({ ok: false, text: r.error }); return }
      // A warning means the task WAS created but we couldn't capture its reference, so status
      // sync won't work for it — show that plainly rather than a cheerful "sent".
 setMsg(r.warning ? { ok: false, text: r.warning } : { ok: true, text: `Sent — their task ref is ${r.refId}.` })
 onPushed?.(r.refId)
 if (onCancel) setTimeout(() => onCancel(), 1200)
    } catch (e) {
 setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't send this to the design partner." })
    } finally { sending.current = false; setBusy(false) }
  }

 const notReady = !!status && (!status.configured || status.ok === false)
  // What the partner will actually receive as the design, in the order the server resolves
  // it: a stored design, else the line's own image, else the first attachment.
 const sendableArt = artworkUrl || lineImage || null
 const noArtwork = !sendableArt && !effExtras.length

 return (
    <div className={compact ? "space-y-3" : "max-h-[60vh] space-y-4 overflow-y-auto py-2"}>
      {notReady && (
        <div className="flex items-start gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3 py-2 text-sm text-hold">
          <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
          <span>{status?.error || tl("pushPartner", "The design partner isn't connected — add PINKDESIGN_API_KEY in Settings › Integrations.")}</span>
        </div>
      )}

      {/* Full mode leads with the artwork + what it maps to. Compact mode drops it — the card
 window already shows the design above this section. */}
      {!compact && (
        <div className="flex gap-3">
          <div className="size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
            {sendableArt
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={sendableArt} alt="" className="size-full object-contain" />
 : <div className="flex size-full items-center justify-center px-2 text-center text-2xs text-muted-foreground">{tl("pushPartner", "No artwork on this line")}</div>}
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="truncate font-medium">{itemName || sku || tl("pushPartner", "Untitled design")}</div>
            <div className="truncate text-xs text-muted-foreground">
              {sku || (orderId ? "" : tl("pushPartner", "No order — speculative work"))}{printType ? ` · ${printType}` : ""}
            </div>
            {!artworkUrl && (
              <p className="text-xs text-muted-foreground">
                {lineImage
                  ? tl("pushPartner", "The image above will be uploaded and sent as the design.")
 : extras.length
                    ? tl("pushPartner", "No stored artwork — the image you attached below will be sent as the design.")
 : tl("pushPartner", "No stored artwork here. Attach an image under Reference files below and it'll be sent as the design.")}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {!compact && (
          <Field label={tl("pushPartner", "Title")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} className="h-9" />
          </Field>
        )}
        {/* No "Quantity" field: a design is made ONCE regardless of how many units get
 printed, so a per-task quantity is meaningless to a design partner. The order's
 real qty is still sent in the payload as context, just not surfaced. */}
        {/* Product type picker — hidden once a default is set in Settings › Integrations, since
 a single-type shop shouldn't re-pick it every send (the default is applied server-side). */}
        {!defaultType && (
          <Field label={tl("pushPartner", "Product type")}>
            {/* min-w-0 lets the select shrink so a long option label can't push the box wider. */}
            <select value={productType} onChange={(e) => setProductType(e.target.value)} disabled={busy}
 className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="">{tl("pushPartner", "— not set —")}</option>
              {productTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {boards.length > 1 && (
          <Field label={tl("pushPartner", "Board")}>
            <select value={board} onChange={(e) => setBoard(e.target.value)} disabled={busy}
 className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm">
              {boards.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {!compact && (
          <Field label={tl("pushPartner", "Description")}>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} disabled={busy} rows={3}
 className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
          </Field>
        )}
      </div>

      {/* Extra reference files (full/dialog mode only). In compact/inline mode the card owns
 the reference files and passes them in as presetExtras, so no uploader shows here. */}
      {!compact && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{tl("pushPartner", "Reference files")}</span>
          <label className={"inline-flex cursor-pointer items-center gap-1.5 text-xs " + (uploading ? "opacity-60" : "text-primary hover:underline")}>
            {uploading ? <CircleNotch size={13} className="animate-spin" /> : <UploadSimple size={13} weight="bold" />}
            Add files
            <input type="file" multiple className="hidden" disabled={uploading || busy}
 onChange={(e) => { addFiles(e.target.files); e.target.value = "" }} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {tl("pushPartner", "Mockups, spec sheets, a marked-up screenshot — anything that tells their designer what you want. Sent alongside the artwork; if there’s no stored artwork, the first image here is sent as the design.")}
        </p>
        {extras.map((f, i) => (
          <div key={f.url} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <button onClick={() => setExtras((p) => p.filter((_, j) => j !== i))} disabled={busy}
 className="text-muted-foreground hover:text-alert" title={tl("pushPartner", "Remove")}>
              <Trash size={13} />
            </button>
          </div>
        ))}
      </div>
      )}

      {/* In compact mode, a one-line reminder of what will be attached (the card lists/edits
 them above), so it's clear the files are going even without the uploader here. */}
      {compact && (
        <p className="text-xs text-muted-foreground">
          {effExtras.length
            ? `${effExtras.length} reference file${effExtras.length === 1 ? "" : "s"} from the card will be attached.`
 : tl("pushPartner", "No reference files on the card yet — add them above; the artwork still sends.")}
        </p>
      )}

      {msg && (
        <div className={"flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
          (msg.ok ? "border-shipped/30 bg-shipped/12 text-shipped" : "border-destructive/30 bg-destructive/10 text-destructive")}>
          {msg.ok ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>{tl("pushPartner", "Cancel")}</Button>}
        <Button size="sm" onClick={send} disabled={busy || uploading || notReady || noArtwork}>
          {busy ? <CircleNotch size={13} className="animate-spin" /> : null}
          Send to Pink Design
        </Button>
      </div>
    </div>
  )
}

/**
 * "Send to design partner" as a standalone dialog — the manual route out to Pink Design.
 *
 * Deliberately manual. Sellers usually upload print-ready artwork, so most jobs need no
 * outsourced design at all; sending automatically would open, and pay for, a task for every
 * one of them. This is the escape hatch for the files that genuinely need work.
 */
export function PushToPartnerDialog({
 open, onOpenChange, ...props
}: PushProps & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const tl = useLabelT()
 return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tl("pushPartner", "Send to design partner")}</DialogTitle>
          <DialogDescription>
            {tl("pushPartner", "Opens a task on Pink Design’s board. They return finished files to this card.")}
          </DialogDescription>
        </DialogHeader>
        <PushToPartnerPanel {...props} active={open} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** The same send form, embedded inline in the card window (no popup). The card supplies the
 * artwork, title and description, so only the partner-specific fields show here. */
export function PushToPartnerInline(props: PushProps & { onCancel?: () => void }) {
 return <PushToPartnerPanel {...props} compact active />
}

/** A labelled form row. min-w-0 so a wide child (a select with long options) can shrink
 * inside a grid cell instead of overflowing. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
 return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
