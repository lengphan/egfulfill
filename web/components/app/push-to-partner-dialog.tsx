"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, PaperPlaneTilt, Trash, UploadSimple, Warning, CheckCircle } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPinkStatus, pushToPink, uploadPinkAttachment } from "@/lib/api"

/** One option in a mapped dropdown. Their lists come back loosely shaped, so both the
 *  key and the label are read defensively rather than assumed. */
type Opt = { value: string; label: string }

/** Pull {value,label} pairs out of whatever shape the partner's list endpoint returns —
 *  an array, or an object with a `data` array, of strings or of objects. */
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

/**
 * "Send to design partner" — the manual route out to Pink Design.
 *
 * Deliberately manual. Sellers usually upload print-ready artwork, so most jobs need no
 * outsourced design at all; sending automatically would open, and pay for, a task for
 * every one of them. This is the escape hatch for the files that genuinely need work.
 *
 * Shows the artwork that will be sent, what it maps to on their side, and anything extra
 * being attached — because once it's gone it's on someone else's board, and the moment to
 * notice you're sending the wrong file is before, not after.
 */
export function PushToPartnerDialog({
  open, onOpenChange, orderId, sku, cardId, itemName, qty, printType, artworkUrl, onPushed,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  // All three optional: a send can be anchored to a line item, to an existing board card,
  // or to nothing at all (speculative artwork with no order behind it yet).
  orderId?: string
  sku?: string
  cardId?: string
  itemName?: string | null
  qty?: number | null
  printType?: string | null
  artworkUrl?: string | null
  onPushed?: (refId?: string) => void
}) {
  const [status, setStatus] = useState<{ configured: boolean; ok?: boolean; error?: string } | null>(null)
  const [productTypes, setProductTypes] = useState<Opt[]>([])
  const [boards, setBoards] = useState<Opt[]>([])

  const [title, setTitle] = useState("")
  const [count, setCount] = useState("")
  const [desc, setDesc] = useState("")
  const [productType, setProductType] = useState("")
  const [board, setBoard] = useState("")
  const [extras, setExtras] = useState<{ url: string; name: string }[]>([])

  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const sending = useRef(false)

  const load = useCallback(() => {
    getPinkStatus().then((s) => {
      setStatus(s)
      setProductTypes(toOptions(s.productTypes))
      const b = toOptions(s.boards)
      setBoards(b)
      // One board is not a choice — pick it rather than making someone confirm it.
      if (b.length === 1) setBoard(b[0].value)
      else if (s.boardId) setBoard(String(s.boardId))
    }).catch(() => setStatus({ configured: false, error: "Couldn't reach the design partner." }))
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      load()
      setTitle(orderId ? `${itemName || sku || "Design"} · order ${orderId}` : (itemName || sku || "Design"))
      setCount(String(qty || 1))
      setDesc([
        printType ? `Print method: ${printType}.` : null,
        orderId ? `Order ${orderId}${sku ? `, SKU ${sku}` : ""}.` : "Not tied to an order.",
      ].filter(Boolean).join(" "))
      setMsg(null)
      setExtras([])
    }, 0)
    return () => clearTimeout(t)
  }, [open, load, itemName, sku, orderId, qty, printType])

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
      const r = await pushToPink({
        orderId, sku, cardId,
        title: title.trim() || undefined,
        qty: Number(count) || undefined,
        description: desc.trim() || undefined,
        productType: productType || undefined,
        boardId: board || undefined,
        extraImages: extras.map((e) => e.url),
      })
      if (r.error) { setMsg({ ok: false, text: r.error }); return }
      setMsg({ ok: true, text: `Sent — their task ref is ${r.refId}.` })
      onPushed?.(r.refId)
      setTimeout(() => onOpenChange(false), 1200)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't send this to the design partner." })
    } finally { sending.current = false; setBusy(false) }
  }

  const notReady = !!status && (!status.configured || status.ok === false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send to design partner</DialogTitle>
          <DialogDescription>
            Opens a task on Pink Design&apos;s board. They return finished files to this card.
          </DialogDescription>
        </DialogHeader>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
        {notReady && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
            <span>{status?.error || "The design partner isn't connected — add PINKDESIGN_API_KEY in Settings › Integrations."}</span>
          </div>
        )}

        {/* What's actually going. The artwork leads on their side too, so it leads here. */}
        <div className="flex gap-3">
          <div className="size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
            {artworkUrl
              ? <img src={artworkUrl} alt="" className="size-full object-contain" />
              : <div className="flex size-full items-center justify-center px-2 text-center text-[11px] text-muted-foreground">No artwork on this line</div>}
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="truncate font-medium">{itemName || sku || "Untitled design"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {sku || (orderId ? "" : "No order — speculative work")}{printType ? ` · ${printType}` : ""}
            </div>
            {!artworkUrl && (
              <p className="text-xs text-muted-foreground">
                {extras.length
                  ? "No stored artwork — the image you attached below will be sent as the design."
                  : "No stored artwork here. Attach an image under Reference files below and it'll be sent as the design."}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} className="h-9" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input value={count} onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ""))}
                     inputMode="numeric" disabled={busy} className="h-9" />
            </Field>
            <Field label="Product type">
              {/* min-w-0 lets the select shrink inside the grid cell — a long option label
                  gives it an intrinsic width that otherwise pushed the whole dialog wider
                  than its box and clipped on the right. */}
              <select value={productType} onChange={(e) => setProductType(e.target.value)} disabled={busy}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm">
                <option value="">— not set —</option>
                {productTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          {boards.length > 1 && (
            <Field label="Board">
              <select value={board} onChange={(e) => setBoard(e.target.value)} disabled={busy}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm">
                {boards.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Description">
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} disabled={busy} rows={3}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
          </Field>
        </div>

        {/* Extra reference files. Not the artwork — notes FOR the designer. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Reference files</span>
            <label className={"inline-flex cursor-pointer items-center gap-1.5 text-xs " + (uploading ? "opacity-60" : "text-primary hover:underline")}>
              {uploading ? <CircleNotch size={13} className="animate-spin" /> : <UploadSimple size={13} weight="bold" />}
              Add files
              <input type="file" multiple className="hidden" disabled={uploading || busy}
                     onChange={(e) => { addFiles(e.target.files); e.target.value = "" }} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Mockups, spec sheets, a marked-up screenshot — anything that tells their designer what you want.
            Sent alongside the artwork; if there&apos;s no stored artwork, the first image here is sent as the design.
          </p>
          {extras.map((f, i) => (
            <div key={f.url} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button onClick={() => setExtras((p) => p.filter((_, j) => j !== i))} disabled={busy}
                      className="text-muted-foreground hover:text-red-600" title="Remove">
                <Trash size={13} />
              </button>
            </div>
          ))}
        </div>

        {msg && (
          <div className={"flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
            (msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/30 bg-destructive/10 text-destructive")}>
            {msg.ok ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={send} disabled={busy || uploading || notReady || (!artworkUrl && !extras.length)}>
          {busy ? <CircleNotch size={13} className="animate-spin" /> : <PaperPlaneTilt size={13} weight="bold" />}
          Send to partner
        </Button>
      </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A labelled form row. min-w-0 so a wide child (a select with long options) can shrink
 *  inside a grid cell instead of overflowing the dialog. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
