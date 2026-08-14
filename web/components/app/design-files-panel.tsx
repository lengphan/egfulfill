"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { UploadSimple, FileArrowDown, CircleNotch, Warning, CurrencyDollar, Image as ImageIcon, FileZip, Sparkle, Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getDesignFiles, uploadDesignFile, setDesignFilePrice, downloadDesignFile, deleteDesignFile, filesForLine, postOrderDesign, type DesignFileRow, type OrderItem } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { useConfirm } from "@/components/app/confirm-dialog"
import { VariantField } from "@/components/app/variant-field"

/**
 * WHICH LINE IS THIS FILE FOR? — guessed from its name, never decided by it.
 *
 * Someone with an eight-line order has eight files named after the items ("dc21.png",
 * "ab13.png"), because that is how anyone keeps them straight on their own disk. Matching
 * on that is worth doing and worth CONFIRMING: the guess is pre-filled into a dropdown the
 * person can see and change before anything is written, which is the same rule the artwork
 * matcher follows — suggest, never auto-attach.
 *
 * Compared with punctuation and case stripped, so "DC-21 final.png" still finds "dc21".
 * A file that matches nothing lands on "All items", which is the common case (one design,
 * whole order) and costs no clicks.
 */
const squash = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "")
const ALL = "__all"
function matchLine(fileName: string, items: OrderItem[]): string {
  const base = squash(fileName.replace(/\.[a-z0-9]+$/i, ""))
  if (!base) return ALL
  let best = ""
  let bestLen = 0
  for (const it of items) {
    const key = it.line_id || it.sku || ""
    if (!key) continue
    for (const cand of [it.name, it.sku]) {
      const c = squash(cand ?? "")
      // Long enough to mean something: "l" or "os" would otherwise match half the order.
      if (c.length < 3) continue
      if ((base.includes(c) || c.includes(base)) && c.length > bestLen) { best = key; bestLen = c.length }
    }
  }
  return best || ALL
}

// A file id that's stable per (order, sku, filename) so re-dropping the same file
// REPLACES it rather than piling up duplicates on the card.
const idFor = (orderId: string, scope: string | undefined, name: string) =>
  `DF-${orderId}-${scope || "all"}-${name}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120)

// What counts as a machine file, in one place — the seller drop zone tests names against
// the regex and offers the same list in its accept attribute, so the picker can never
// suggest a type the handler then refuses.
const MACHINE_RE = /\.(emb|pes|dst|exp|jef|vp3|xxx|hus)$/i
const MACHINE_ACCEPT = ".emb,.pes,.dst,.exp,.jef,.vp3,.xxx,.hus"

// Sort newest-first and flag the LATEST machine file for each line. After a design goes to
// the board and comes back from the "Fix" lane, the corrected file is just the most recent
// .emb/.pes for that item — so this is how "the newest official fixed file" is made obvious.
// Only flagged when a line has MORE THAN ONE machine file (i.e. a revision actually happened),
// so a single-file order doesn't get a redundant badge.
type OrderedFile = DesignFileRow & { isLatest: boolean }
function orderFiles(files: DesignFileRow[]): OrderedFile[] {
  const sorted = [...files].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
  const isMachine = (f: DesignFileRow) => f.kind === "emb" || f.kind === "pes"
  const count: Record<string, number> = {}
  for (const f of sorted) if (isMachine(f)) { const k = f.sku || "__order"; count[k] = (count[k] || 0) + 1 }
  const seen: Record<string, boolean> = {}
  return sorted.map((f) => {
    let isLatest = false
    if (isMachine(f)) { const k = f.sku || "__order"; if (!seen[k]) { seen[k] = true; isLatest = count[k] > 1 } }
    return { ...f, isLatest }
  })
}

const KIND_META: Record<string, { label: string; hint: string; cls: string; icon: React.ReactNode }> = {
  pes: { label: "PES", hint: "seller deliverable · paid", cls: "bg-violet-100 text-violet-700", icon: <FileArrowDown size={12} weight="fill" /> },
  emb: { label: "EMB", hint: "factory working file", cls: "bg-amber-100 text-amber-700", icon: <FileZip size={12} weight="fill" /> },
  image: { label: "IMG", hint: "artwork / mockup", cls: "bg-sky-100 text-sky-700", icon: <ImageIcon size={12} weight="fill" /> },
  other: { label: "FILE", hint: "", cls: "bg-muted text-muted-foreground", icon: <FileZip size={12} weight="fill" /> },
}

/**
 * Drag-and-drop files onto an order (optionally a specific line item), and manage
 * them. Every type is stored; the SERVER decides who sees what by `kind`:
 *   .pes → the seller's deliverable, behind the wallet paywall
 *   .emb → factory working file (all factory boards)
 *   image/* → artwork + mockups (factory)
 * Pricing is admin/warehouse only — enforced server-side too, not just hidden here.
 */
/**
 * What this file APPLIES TO, in words — the thing the panel could never say before.
 *
 * A file with a line id belongs to that one item; without one it covers the order, which is
 * both what "apply to all" writes and what every file written before line_id existed already
 * does. Saying which is the whole point: two rows with the same filename and no scope shown
 * is exactly how a per-item file and an everything file became indistinguishable.
 *
 * The sku is shown as the item's name when there is one, because a bare line id means nothing
 * to a person. A marketplace line with no variant chosen yet gets that stated rather than left
 * blank — "not chosen yet" is information; an empty chip reads as missing data.
 */
function scopeLabel(f: DesignFileRow): string {
  if (!f.lineId) return "All items · "
  return f.sku ? `Item ${f.sku} · ` : "This item (variant not chosen yet) · "
}

export function DesignFilesPanel({ orderId, sku, lineId, compact }: { orderId: string; sku?: string; lineId?: string | null; compact?: boolean }) {
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [role, setRole] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()

  const canPrice = role === "admin" || role === "warehouse"
  /**
   * Mounted for a LINE → that line's own files, plus the order-wide ones. Mounted for the
   * order → everything.
   *
   * This filtered on `(f.sku || "") === sku`, which is the bug this panel is on both ends of:
   * two lines of the same SKU shared every file, and a marketplace line with no variant has
   * sku "" — so an empty-sku file matched every empty-sku line on the order. A designer's
   * file for one item appeared on items it was never made for.
   */
  const forLine = !!(lineId || sku)
  const shown = forLine ? filesForLine(files ?? [], { line_id: lineId, sku }) : (files ?? [])

  const load = useCallback(() => {
    getDesignFiles(orderId).then((r) => setFiles(r ?? [])).catch(() => setFiles([]))
  }, [orderId])
  useEffect(() => {
    const id = setTimeout(() => { setRole(getUser()?.role || ""); load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  const upload = async (list: FileList | File[]) => {
    const arr = Array.from(list)
    if (!arr.length) return
    setErr(null)
    for (const f of arr) {
      // 50MB: the API body limit is 60MB and base64 inflates ~33%, so anything
      // bigger would be rejected by the server with a confusing error.
      if (f.size > 50 * 1024 * 1024) { setErr(`${f.name} is too large (max 50 MB).`); continue }
      setBusy(f.name)
      try {
        const data = await new Promise<string>((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(String(fr.result))
          fr.onerror = () => rej(new Error("Could not read the file"))
          fr.readAsDataURL(f)
        })
        // The id is keyed on the LINE, not the sku: re-dropping the same filename on the
        // same line still replaces itself (which is the point of a stable id), but two lines
        // that share a SKU no longer overwrite each other's file.
        await uploadDesignFile({
          designId: idFor(orderId, lineId || sku, f.name),
          orderId, sku, lineId: lineId ?? undefined,
          name: f.name, mime: f.type || undefined, data,
        })
      } catch (e) {
        setErr(e instanceof Error ? e.message : `Could not upload ${f.name}`)
      } finally {
        setBusy(null)
      }
    }
    load()
  }

  const price = async (f: DesignFileRow, v: string) => {
    const n = Math.max(0, Number(v) || 0)
    setFiles((prev) => (prev ?? []).map((x) => (x.designId === f.designId ? { ...x, price: n } : x)))
    try { await setDesignFilePrice(f.designId, n) } catch { load() }
  }

  const get = async (f: DesignFileRow) => {
    setBusy(f.designId)
    try {
      const r = await downloadDesignFile(f.designId)
      if (!r.data) throw new Error("File has no data")
      const a = document.createElement("a")
      a.href = r.data
      a.download = r.name || f.name || "design"
      a.click()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not download the file")
    } finally { setBusy(null) }
  }

  // Remove a file. Drops it from the order and reverts the Design tag (the server records
  // it in the tag history and broadcasts, so the readiness pill flips back on its own).
  const remove = async (f: DesignFileRow) => {
    if (!(await confirm({ title: `Remove ${f.name}?`, body: "This can't be undone.", confirmLabel: "Remove" }))) return
    setBusy(f.designId); setErr(null)
    try {
      const r = await deleteDesignFile(f.designId)
      if (r?.error) throw new Error(r.error)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove the file")
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-2">
      {/* Drop zone — the thing that didn't exist before. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors " +
          (over ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40")
        }
      >
        {busy ? <CircleNotch size={18} className="animate-spin text-muted-foreground" /> : <UploadSimple size={18} weight="bold" className="text-muted-foreground" />}
        <span className="text-xs font-medium">{busy ? `Uploading ${busy}…` : "Drop files here or click to browse"}</span>
        {!compact && <span className="text-3xs text-muted-foreground">.pes goes to the seller · .emb + images stay on the factory boards</span>}
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = "" }} />
      </div>

      {err && <div className="flex items-center gap-1.5 text-xs text-destructive"><Warning size={12} weight="fill" /> {err}</div>}

      {files === null ? (
        <div className="flex justify-center py-3 text-muted-foreground"><CircleNotch size={14} className="animate-spin" /></div>
      ) : shown.length === 0 ? (
        <div className="py-2 text-center text-2xs text-muted-foreground">No files yet.</div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {orderFiles(shown).map((f) => {
            const k = KIND_META[f.kind || "other"] ?? KIND_META.other
            return (
              <div key={f.designId} className="flex items-center gap-2 p-2">
                <span className={"flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-bold " + k.cls}>{k.icon} {k.label}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{f.name}</span>
                    {f.isLatest && <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" title="Most recent machine file for this item — the current fixed version">LATEST</span>}
                  </div>
                  <div className="truncate text-3xs text-muted-foreground">{scopeLabel(f)}{k.hint}</div>
                </div>

                {/* Only .pes is sold, so only .pes gets a price — and only admin/warehouse
                    may set it (the server rejects anyone else regardless). */}
                {f.kind === "pes" && (
                  canPrice ? (
                    <label className="flex shrink-0 items-center gap-1" title="What the seller pays to download this">
                      <CurrencyDollar size={11} className="text-muted-foreground" />
                      <Input
                        defaultValue={String(f.price ?? 0)}
                        onBlur={(e) => price(f, e.target.value)}
                        inputMode="decimal"
                        aria-label={`Price for ${f.name}`}
                        className="h-7 w-16 text-center text-xs"
                      />
                    </label>
                  ) : (
                    <span className="shrink-0 text-2xs font-medium tabular-nums">{f.price ? `$${f.price}` : "Free"}</span>
                  )
                )}

                <Button size="sm" variant="ghost" className="shrink-0" disabled={busy === f.designId} onClick={() => get(f)} title="Download">
                  {busy === f.designId ? <CircleNotch size={12} className="animate-spin" /> : <FileArrowDown size={13} weight="bold" />}
                </Button>
                <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" disabled={busy === f.designId} onClick={() => remove(f)} title="Remove this file">
                  <Trash size={13} weight="bold" />
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Seller-side: their .pes deliverables for one order, bought from the wallet — and, now,
 * the place they can hand US a machine file.
 *
 * It used to be read-only and `return null` when empty, which left the "Design files" card
 * on the order page rendering a heading, the words "download once purchased", and nothing
 * at all. A seller could not tell that apart from a broken fetch. It now always says which
 * of the two it is, and the empty state does something useful instead of looking faulty.
 *
 * Taking uploads here is safe on the money side, and that is worth stating because it very
 * nearly isn't: a seller's own .pes is classified `kind: 'pes'` — the PAYWALLED kind — so
 * the obvious fear is that they'd have to buy back the file they just sent. They don't.
 * `price` defaults to 0, the download route only charges when `price > 0`, and only
 * admin/warehouse can ever set a price. Verified against design_files.js, not assumed.
 */
export function SellerDesignFiles({ orderId, items = [], onAttached }: {
  orderId: string
  /** The order's lines, so a dropped file can be pointed at one. Empty ⇒ everything a
   *  seller drops applies to the whole order, which is how this panel behaved before. */
  items?: OrderItem[]
  /** Artwork went onto a line — the page reloads its designs so the canvas shows it. */
  onAttached?: () => void
}) {
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [role, setRole] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  // Only staff may remove a file — this card is also shown to sellers, who must never be
  // able to delete a factory working file.
  const canRemove = !!role && role !== "seller"

  const load = useCallback(() => {
    getDesignFiles(orderId).then((r) => setFiles(r ?? [])).catch(() => setFiles([]))
  }, [orderId])
  useEffect(() => { const id = setTimeout(() => { setRole(getUser()?.role || ""); load() }, 0); return () => clearTimeout(id) }, [load])

  const remove = async (f: DesignFileRow) => {
    if (!(await confirm({ title: `Remove ${f.name}?`, body: "This can't be undone.", confirmLabel: "Remove" }))) return
    setBusy(f.designId); setErr(null)
    try {
      const r = await deleteDesignFile(f.designId)
      if (r?.error) throw new Error(r.error)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove the file")
    } finally { setBusy(null) }
  }

  const isImg = (f: File) => /^image\//i.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|avif)$/i.test(f.name)

  /**
   * DROP FIRST, DECIDE SECOND.
   *
   * A drop used to upload immediately, to the whole order, and that is only right when the
   * order is one design on every line. It rarely is: eight lines, eight artworks, and no way
   * to say which went where without opening the designer eight times.
   *
   * So a drop STAGES. Each file becomes a row carrying its own target — a line, or all
   * items — pre-filled from its filename, and nothing is written until Attach. One list
   * shows every decision at once, which is what makes a wrong guess obvious while it is
   * still free to fix.
   */
  type Staged = { file: File; name: string; target: string; image: boolean }
  const [staged, setStaged] = useState<Staged[]>([])
  const stage = (list: FileList | File[]) => {
    const arr = Array.from(list)
    if (!arr.length) return
    setErr(null); setSent(null)
    const wrong = arr.filter((f) => !MACHINE_RE.test(f.name) && !isImg(f))
    if (wrong.length) {
      setErr(`${wrong.map((f) => f.name).join(", ")} — not a machine file or an image, so there's nothing to do with it here.`)
    }
    // 50MB: the body limit is 60MB and base64 inflates by about a third, so a bigger file
    // returns a server error that says nothing useful. Caught here, before it is queued,
    // so the row never appears rather than failing at the end of a batch.
    const big = arr.filter((f) => f.size > 50 * 1024 * 1024)
    if (big.length) setErr(`${big.map((f) => f.name).join(", ")} — over the 50 MB limit.`)
    const ok = arr.filter((f) => (MACHINE_RE.test(f.name) || isImg(f)) && f.size <= 50 * 1024 * 1024)
    setStaged((prev) => [
      ...prev,
      ...ok.filter((f) => !prev.some((s) => s.name === f.name))
        .map((f) => ({ file: f, name: f.name, target: items.length ? matchLine(f.name, items) : ALL, image: isImg(f) })),
    ])
  }

  const readDataUrl = (f: File) => new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error("Could not read the file"))
    fr.readAsDataURL(f)
  })

  /**
   * WHAT EACH KIND BECOMES, which is not the same thing.
   *
   *   an image        → the LINE'S ARTWORK (order_designs), so it shows on the mockup and
   *                     in the designer, exactly as if it had been placed there
   *   a machine file  → a file on the line for us to check instead of digitising
   *
   * "All items" writes to every line rather than to a null line: artwork is read per line,
   * and a single order-wide row cannot say "this one is placed and that one isn't".
   */
  const attach = async () => {
    if (!staged.length) return
    setErr(null); setSent(null)
    const failed: string[] = []
    let images = 0, machines = 0
    for (const s of staged) {
      setBusy(s.name)
      try {
        const data = await readDataUrl(s.file)
        const targets = s.target === ALL
          ? (items.length ? items : [{ line_id: undefined, sku: "" } as OrderItem])
          : items.filter((it) => (it.line_id || it.sku) === s.target)
        for (const it of targets) {
          if (s.image) {
            const r = await postOrderDesign(orderId, { sku: it.sku ?? "", line_id: it.line_id ?? undefined, data, name: s.name })
            if (r?.error) throw new Error(r.error)
          } else {
            const scope = it.line_id || it.sku || undefined
            const r = await uploadDesignFile({
              designId: idFor(orderId, scope, s.name), orderId, sku: it.sku ?? undefined,
              lineId: it.line_id ?? undefined, name: s.name, mime: s.file.type || undefined, data,
            })
            if (r?.error) throw new Error(r.error)
          }
        }
        if (s.image) images++; else machines++
      } catch (e) {
        failed.push(`${s.name}${e instanceof Error ? ` (${e.message})` : ""}`)
      } finally { setBusy(null) }
    }
    setStaged(failed.length ? staged.filter((s) => failed.some((f) => f.startsWith(s.name))) : [])
    if (failed.length) setErr(`Couldn't attach: ${failed.join(", ")}`)
    const parts: string[] = []
    if (machines) parts.push(`${machines} machine file${machines === 1 ? "" : "s"} — we'll check ${machines === 1 ? "it" : "them"} before production`)
    if (images) parts.push(`${images} design image${images === 1 ? "" : "s"} — placed on the items`)
    if (parts.length) setSent(`Sent ${parts.join("; and ")}.`)
    load()
    if (images) onAttached?.()
  }

  const dropZone = (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); stage(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      className={
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors " +
        (over ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40")
      }
    >
      {busy ? <CircleNotch size={18} className="animate-spin text-muted-foreground" /> : <UploadSimple size={18} weight="bold" className="text-muted-foreground" />}
      <span className="text-xs font-medium">{busy ? `Sending ${busy}…` : "Have a machine file or a design image? Drop it here"}</span>
      <span className="text-3xs text-muted-foreground">Machine file (.pes · .dst · .emb …) — we check it instead of digitising · or a design image (PNG / JPG)</span>
      <input ref={inputRef} type="file" multiple accept={MACHINE_ACCEPT + ",image/*"} className="hidden"
        onChange={(e) => { if (e.target.files) stage(e.target.files); e.target.value = "" }} />
    </div>
  )

  /** The order's lines as picker options, plus the whole-order default. */
  const targetLabel = (it: OrderItem, i: number) => (it.name || it.sku || `Item ${i + 1}`) + (Number(it.qty) > 1 ? ` ×${it.qty}` : "")
  const targetOptions = ["All items", ...items.map(targetLabel)]
  const keyAt = (label: string) => {
    const i = targetOptions.indexOf(label) - 1
    return i < 0 ? ALL : (items[i]?.line_id || items[i]?.sku || ALL)
  }
  const labelFor = (key: string) => {
    const i = items.findIndex((it) => (it.line_id || it.sku) === key)
    return i < 0 ? "All items" : targetLabel(items[i], i)
  }

  /** WHAT IS ABOUT TO HAPPEN, one row per file, before anything is written. */
  const queue = staged.length > 0 && (
    <div className="rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {staged.length} file{staged.length === 1 ? "" : "s"} ready — check where each one goes
        </span>
        <button onClick={() => setStaged([])} className="text-2xs text-muted-foreground underline-offset-2 hover:underline">Clear</button>
      </div>
      <div className="divide-y divide-border">
        {staged.map((s) => (
          <div key={s.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className={"flex size-7 shrink-0 items-center justify-center rounded-lg " + (s.image ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700")}>
              {s.image ? <ImageIcon size={13} weight="fill" /> : <Sparkle size={13} weight="fill" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{s.name}</div>
              {/* Says what it will BECOME, because the two kinds land in different places
                  and only one of them shows up on the mockup. */}
              <div className="text-3xs text-muted-foreground">
                {s.image ? "artwork — placed on the item" : "machine file — we check it instead of digitising"}
                {items.length > 0 && s.target !== ALL ? " · matched by name" : ""}
              </div>
            </div>
            {items.length > 0 && (
              <VariantField
                label="Goes on" compact className="w-44"
                value={labelFor(s.target)} options={targetOptions}
                onChange={(v) => setStaged((prev) => prev.map((x) => (x.name === s.name ? { ...x, target: keyAt(v) } : x)))}
              />
            )}
            <button
              onClick={() => setStaged((prev) => prev.filter((x) => x.name !== s.name))}
              title="Take this one out" className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash size={13} weight="bold" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button size="sm" onClick={() => void attach()} disabled={!!busy}>
          {busy ? <><CircleNotch size={13} className="animate-spin" /> Sending {busy}…</> : `Attach ${staged.length} file${staged.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  )

  const notices = (
    <>
      {err && <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><Warning size={12} weight="fill" className="mt-0.5 shrink-0" /> {err}</div>}
      {sent && <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><Sparkle size={12} weight="fill" className="mt-0.5 shrink-0" /> {sent}</div>}
    </>
  )

  const buyAndGet = async (f: DesignFileRow) => {
    setBusy(f.designId); setErr(null)
    try {
      if (!f.paid) {
        const { purchaseDesignFile } = await import("@/lib/api")
        const r = await purchaseDesignFile(f.designId)
        if (r.error) throw new Error(r.error)
      }
      const r = await downloadDesignFile(f.designId)
      if (!r.data) throw new Error("File has no data")
      const a = document.createElement("a")
      a.href = r.data
      a.download = r.name || f.name || "design"
      a.click()
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not get the file")
    } finally { setBusy(null) }
  }

  if (files === null) return <div className="flex justify-center py-4 text-muted-foreground"><CircleNotch size={16} className="animate-spin" /></div>

  // NOTHING TO BUY is a real state and it now says so. Returning null here left the card
  // above it showing a title and blank space — a promise of files with no files and no
  // explanation, which reads exactly like a fetch that failed.
  if (!files.length) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          No files on this order yet. Machine files appear here once we&apos;ve cut them — or send us your own machine file or a design image.
        </p>
        {dropZone}
        {queue}
        {notices}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {notices}
      {orderFiles(files).map((f) => (
        <div key={f.designId} className="flex items-center gap-3 rounded-xl border border-border p-3">
          <span className={"flex size-8 shrink-0 items-center justify-center rounded-lg " + (f.kind === "image" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700")}>
            {f.kind === "image" ? <ImageIcon size={14} weight="fill" /> : <Sparkle size={14} weight="fill" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{f.name}</span>
              {f.isLatest && <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" title="Most recent machine file for this item — the current fixed version">LATEST</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {f.sku ? `Item ${f.sku} · ` : ""}
              {/* A file the SELLER sent says who sent it and when, and says nothing about
                  money — it is already theirs. Only what we made carries a price. */}
              {f.source === "seller" ? `You sent this${f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}`
                : f.kind === "image" ? "Design image"
                  : f.paid ? "Purchased" : f.price ? `$${f.price} — pays from your wallet` : "Free"}
            </div>
          </div>
          {/* No download for their own upload: the file came FROM this browser, and the
              route refuses a non-deliverable to a seller anyway — so a button here would
              only ever produce "forbidden". */}
          {f.source !== "seller" && (
            <Button size="sm" variant={f.paid || !f.price ? "outline" : "default"} disabled={busy === f.designId} onClick={() => buyAndGet(f)}>
              {busy === f.designId ? <CircleNotch size={13} className="animate-spin" />
                : (f.paid || !f.price) ? <><FileArrowDown size={13} weight="bold" /> Download</>
                : <>Buy ${f.price} &amp; download</>}
            </Button>
          )}
          {canRemove && (
            <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" disabled={busy === f.designId} onClick={() => remove(f)} title="Remove this file">
              <Trash size={13} weight="bold" />
            </Button>
          )}
        </div>
      ))}
      {/* Offered alongside existing files too, not only when the list is empty — a seller
          may send a corrected file after we've already delivered one. */}
      {dropZone}
      {queue}
    </div>
  )
}
