"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { UploadSimple, FileArrowDown, CircleNotch, Warning, CurrencyDollar, Image as ImageIcon, FileZip, Sparkle, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getDesignFiles, deleteOrderDesign, scopeDesignFile, uploadDesignFile, setDesignFilePrice, downloadDesignFile, deleteDesignFile, filesForLine, postOrderDesign, getOrderDesigns, designsBySide, sidesForLine, type DesignFileRow, type OrderDesign, type OrderItem } from "@/lib/api"
import { designSrc } from "@/lib/order-image"
import { getUser } from "@/lib/auth"
import { useConfirm } from "@/components/app/confirm-dialog"
import { VariantField } from "@/components/app/variant-field"
import { isEmbroidery } from "@/lib/variant-resolve"

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

/**
 * ARTWORK PLACED IN THE DESIGNER IS A FILE ON THIS ORDER — this card just could not see it.
 *
 * Two stores, and the card only ever read one. A drop into the designer writes
 * `order_designs` (the artwork ON a line, with its position); a drop into the zone below
 * writes `design_files`. So an order could carry artwork on every item, show it on every
 * mockup, and still say "No files on this order yet" over an empty dropzone — which reads
 * as "nothing arrived", and is why the same file kept being dropped a second time.
 *
 * These rows are DERIVED, not fetched: the order page already holds the designs it draws the
 * mockups from, so saying what is there costs nothing and can never disagree with what is on
 * screen.
 */
type PlacedRow = { key: string; name: string; src: string; no: number | null; item: string | null
  /** Which FACE this row is. One row per printed side — a line with a front and a back is
   *  two jobs, two hoopings and two rows, not one. */
  side: string
  /** Which line to detach. Sent to DELETE /api/orders/:id/designs, which is line-first. */
  lineId?: string | null; sku?: string | null }

/**
 * `numbered` — whether the caller's `items` are THE ORDER, in order.
 *
 * The number is a position on the order, and it is only meaningful when the list it is
 * counted from is the whole order. The designer board mounts this panel for ONE card and
 * passes that card's line alone, where an index would be 1 for every line on the order —
 * a confident, wrong number, which is worse than none.
 */
/**
 * ONE ROW PER PRINTED FACE.
 *
 * This listed one row per LINE, from the singular designForLine — so a garment with a front,
 * a back and a sleeve reported a single design and the card said nothing about the other two.
 * Three prints, three surcharge lines on the invoice, one row on screen.
 *
 * Ordered front first, then whatever else the line carries, so the row order matches the
 * order the pills are read in.
 */
const SIDE_ORDER = ["front", "back", "left", "right", "hood", "pocket"]
function placedRows(bySide: Record<string, Record<string, OrderDesign>> | undefined, items: OrderItem[], numbered = true): PlacedRow[] {
  if (!bySide) return []
  const out: PlacedRow[] = []
  items.forEach((it, i) => {
    const faces = sidesForLine(bySide, { line_id: it.line_id, sku: it.sku })
    const names = Object.keys(faces).sort((a, b) => {
      const ia = SIDE_ORDER.indexOf(a), ib = SIDE_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
    })
    for (const sd of names) {
      const d = faces[sd]
      if (!d?.data) continue
      out.push({
        key: `${it.line_id || it.sku || i}:${sd}`,
        // The stored name is the FILE's now; older rows carry the item's name instead, and
        // that is still better than "Artwork" — it is what someone typed or picked.
        name: d.name || it.name || it.sku || "Artwork",
        src: designSrc(d.data),
        no: numbered ? i + 1 : null,
        item: it.name || it.sku || null,
        side: sd,
        lineId: it.line_id ?? null, sku: it.sku ?? null,
      })
    }
  })
  return out
}

/**
 * THE LINE'S NUMBER, in the ONE shape it has anywhere on the order.
 *
 * Mirrors the badge on the item rows in app/(app)/orders/[id]/page.tsx — round, filled with
 * --primary, tabular. That badge is how you find item 3 by eye, so a file row claiming to
 * belong to item 3 has to carry the SAME mark: a tinted square next to a filled circle
 * reads as a different kind of fact, and the whole point is that it is the same fact.
 *
 * `null` is a file that applies to the WHOLE order rather than a line. It says "All" instead
 * of borrowing a number, at a smaller size so three characters still fit the circle.
 */
function ItemNumberBadge({ no, title }: { no: number | null; title?: string }) {
  return (
    <span
      className={"flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-bold tabular-nums text-primary-foreground " + (no == null ? "text-2xs" : "text-xs")}
      title={title ?? (no == null ? "Applies to every item on this order" : `Item ${no}`)}
    >
      {no ?? "All"}
    </span>
  )
}

/** One row per placed artwork. Module-level: `react-hooks/static-components`. */
function PlacedArtworkList({ rows, onRemove, busy }: {
  rows: PlacedRow[]
  /** Absent ⇒ no ✕. A row that cannot be acted on must not offer a control that errors. */
  onRemove?: (r: PlacedRow) => void
  busy?: string | null
}) {
  if (!rows.length) return null
  /**
   * ONE ROW SHAPE FOR EVERY FILE ON AN ORDER — number, picture, name, where it goes, get it.
   *
   * Placed artwork and machine files were two lists that looked like two different kinds of
   * object: this one carried a sentence ("Gildan Unisex Heavy Blend™ Crewneck Sweatshirt ·
   * placed in the designer") where the other carried controls, and neither offered the same
   * thing in the same place. They are both "a file on this order"; the only real difference
   * is what we do with it.
   *
   * NO CARD OF ITS OWN. It drew a rounded border inside the panel's card — a box in a box,
   * around a list the panel had already framed.
   */
  return (
    <div className="divide-y divide-border">
      {rows.map((r) => (
        <div key={r.key} className="relative flex items-center gap-2.5 py-2">
          {r.no != null && <ItemNumberBadge no={r.no} title={`Item ${r.no}${r.item ? ` — ${r.item}` : ""}`} />}
          {/* The artwork itself, small. A name alone leaves "is that the right one?"
              unanswered, and the picture is already loaded for the mockup above. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.src} alt="" className="size-9 shrink-0 rounded-md border border-border bg-white object-contain" />
          {/* NAME, then the face. The blank's title and "placed in the designer" are gone:
              the first repeats the item row this badge already points at, and the second
              describes every row in this list, so it distinguished nothing. */}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{r.name}</div>
          </div>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-medium capitalize text-foreground/70" title="Which face this artwork is on">
            {r.side}
          </span>
          {/* DOWNLOAD, matching the machine-file row — WORD ALONE, and for the same reason
              it is a word there: the glyph says nothing "Download" doesn't, and it made this
              button visibly heavier than the one a row below it. That change was made on the
              machine-file row only, so for a while the same action wore two faces in one
              list. Placed artwork is already same-origin (it renders on the mockup), so the
              link fetches the bytes it is showing rather than routing through the paywalled
              deliverable endpoint — this is the seller's own artwork on their own order, not
              a file we cut. */}
          {/**
            * THE ACTIONS, VISIBLE AND IN THE SAME PLACE ON EVERY ROW.
            *
            * They were behind a ⋯ for a moment, and that was the wrong call: this list holds
            * two or three files and the only two things you ever do to one are get it and
            * take it off. A menu to reach a two-item menu is a click spent on nothing.
            *
            * Same trailing pair as the machine-file rows below, so the two lists read as one
            * table rather than as two kinds of object.
            */}
          <Button
            variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs"
            onClick={() => {
              // Same-origin already (it draws on the mockup above), so the bytes are fetched
              // straight rather than through the paywalled deliverable route — this is
              // artwork on the seller's own order, not a file we cut.
              const a = document.createElement("a")
              a.href = r.src; a.download = r.name || "artwork"; a.click()
            }}
          >
            Download
          </Button>
          {onRemove && (
            <Button
              variant="ghost" size="sm"
              className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={busy === r.key}
              onClick={() => onRemove(r)}
              title={`Take the ${r.side} artwork off this item`}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
    </div>
  )
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

export function DesignFilesPanel({ orderId, sku, lineId, compact, item }: { orderId: string; sku?: string; lineId?: string | null; compact?: boolean
  /** The line this panel is mounted for, so a placed artwork row can name it. */
  item?: OrderItem }) {
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  /**
   * The artwork ON the line, which lives in a DIFFERENT table to the files below — see
   * placedRows. Fetched here rather than passed in, because the boards that mount this panel
   * hold design CARDS, not order designs. One call, and only when a card is open: this panel
   * renders inside an expanded card, never in the list.
   */
  const [placedMap, setPlacedMap] = useState<Record<string, Record<string, OrderDesign>> | null>(null)
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
    // Best-effort: the files list is the subject of this panel, and failing to learn what
    // artwork is placed must not empty it.
    getOrderDesigns(orderId)
      .then((r) => setPlacedMap(designsBySide(Array.isArray(r) ? r : (r?.designs ?? []))))
      .catch(() => setPlacedMap({}))
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
        {!compact && <span className="text-2xs text-muted-foreground">.pes goes to the seller · .emb + images stay on the factory boards</span>}
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = "" }} />
      </div>

      {err && <div className="flex items-center gap-1.5 text-xs text-destructive"><Warning size={12} weight="fill" /> {err}</div>}

      {/* The artwork placed on this line, named — it is a file on this job whichever table
          it happens to live in, and a panel that showed only one of the two reported "no
          files" for a line that had a design on it. */}
      {/* `false` — this panel is mounted for ONE line, so an index here would number every
          card "1". No number is better than a confident wrong one. */}
      <PlacedArtworkList rows={placedRows(placedMap ?? undefined, item ? [item] : [], false)} />

      {files === null ? (
        <div className="flex justify-center py-3 text-muted-foreground"><CircleNotch size={14} className="animate-spin" /></div>
      ) : shown.length === 0 ? (
        <div className="py-2 text-center text-2xs text-muted-foreground">No files yet.</div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {orderFiles(shown).map((f) => {
            const k = KIND_META[f.kind || "other"] ?? KIND_META.other
            return (
              <div key={f.designId} className="relative flex items-center gap-2 p-2">
                <span className={"flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-bold " + k.cls}>{k.icon} {k.label}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{f.name}</span>
                    {f.isLatest && <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-2xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" title="Most recent machine file for this item — the current fixed version">LATEST</span>}
                  </div>
                  <div className="truncate text-2xs text-muted-foreground">{scopeLabel(f)}{k.hint}</div>
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
                {/* Corner X, matching the seller card — see the note there. */}
                <button
                  onClick={() => remove(f)}
                  disabled={busy === f.designId}
                  title="Remove this file"
                  aria-label={`Remove ${f.name}`}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                >
                  <X size={10} weight="bold" />
                </button>
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
export function SellerDesignFiles({ orderId, items = [], designs, onAttached }: {
  orderId: string
  /** The order's lines, so a dropped file can be pointed at one. Empty ⇒ everything a
   *  seller drops applies to the whole order, which is how this panel behaved before. */
  items?: OrderItem[]
  /** The artwork already on the lines, BY FACE — line key → side → design. Passed in rather
   *  than fetched: the page has the rows, the bytes are large, and a second copy could
   *  disagree with the picture on screen. Absent ⇒ this card simply shows files, as before. */
  designs?: Record<string, Record<string, OrderDesign>>
  /** Artwork went onto a line — the page reloads its designs so the canvas shows it. */
  onAttached?: () => void
}) {
  const [files, setFiles] = useState<DesignFileRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [role, setRole] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  // Only staff may remove a file — this card is also shown to sellers, who must never be
  // able to delete a factory working file.
  const canRemove = !!role && role !== "seller"
  // The card is shown to the seller AND to every staff role on the same order page, so the
  // copy has to know which of them is reading it. Unknown role reads as the seller: that is
  // the cautious side — it never tells a seller that somebody else sent their own file.
  const isSeller = !role || role === "seller"

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
  /**
   * A CEILING ON THE QUEUE, and it is about legibility rather than bytes.
   *
   * Every staged row is a decision — which item does this one go on — and the whole point of
   * staging is that a wrong guess is obvious while it is still free to fix. Forty rows is not
   * a list anybody checks; it is a list somebody scrolls past and presses Attach on. Each one
   * is also a separate upload of up to 50MB, so a careless multi-select is a very long
   * request nobody asked for.
   *
   * Twenty is comfortably above a real order (a nine-line order needs nine) and well below
   * "I selected my whole downloads folder".
   */
  const MAX_STAGED = 20
  const stage = (list: FileList | File[]) => {
    const arr = Array.from(list)
    if (!arr.length) return
    setErr(null)
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
    /**
     * DECIDED HERE, not inside the updater.
     *
     * The cap and its message lived inside setStaged's updater, which React runs during
     * render and twice under StrictMode — so calling setErr from in there is a side effect
     * in a function that must be pure, and it throws. `staged` is in scope, so the updater
     * was buying nothing.
     */
    const fresh = ok.filter((f) => !staged.some((x) => x.name === f.name))
    const room = Math.max(0, MAX_STAGED - staged.length)
    const dropped = fresh.length - Math.min(fresh.length, room)
    if (dropped > 0) {
      // Named, not silently truncated: a queue that quietly drops half a selection is a
      // queue you believe you attached.
      setErr(`Too many files at once — ${MAX_STAGED} is the limit, so ${dropped} ${dropped === 1 ? "was" : "were"} left out. Attach these, then drop the rest.`)
    }
    const rows = fresh.slice(0, room).map((f) => {
      const image = isImg(f)
      const allowed = image ? items : items.filter((it) => isEmbroidery(it.print_type))
      return { file: f, name: f.name, target: allowed.length ? matchLine(f.name, allowed) : ALL, image }
    })
    if (rows.length) setStaged((prev) => [...prev, ...rows])
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
    setErr(null)
    const failed: string[] = []
    let images = 0, machines = 0
    const skipped: string[] = []
    for (const s of staged) {
      // Nowhere legal to put it: a stitch file on an order with no embroidered line. Left
      // in the list rather than written to the order as a whole — attaching it anywhere
      // would be inventing a target, and it is what raised a check fee for a file no
      // machine can run.
      if (!s.image && items.length > 0 && embItems.length === 0) { skipped.push(s.name); continue }
      setBusy(s.name)
      try {
        const data = await readDataUrl(s.file)
        const pool = targetsFor(s.image)
        const targets = s.target === ALL
          ? (pool.length ? pool : [{ line_id: undefined, sku: "" } as OrderItem])
          : pool.filter((it) => (it.line_id || it.sku) === s.target)
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
    const keep = new Set([...failed.map((f) => f.split(" (")[0]), ...skipped])
    setStaged(keep.size ? staged.filter((s) => keep.has(s.name)) : [])
    if (failed.length) setErr(`Couldn't attach: ${failed.join(", ")}`)
    if (skipped.length) {
      setErr((e) => [e, `${skipped.join(", ")} — a machine file needs an embroidered item, and this order has none.`].filter(Boolean).join(" "))
    }
    const parts: string[] = []
    if (machines) parts.push(`${machines} machine file${machines === 1 ? "" : "s"} — we'll check ${machines === 1 ? "it" : "them"} before production`)
    if (images) parts.push(`${images} design image${images === 1 ? "" : "s"} — placed on the items`)
    load()
    if (images) onAttached?.()
  }

  /**
   * `slim` — the zone STOPS BEING THE PAGE once there is something to look at.
   *
   * A tall dashed rectangle is the right thing when the card is empty: it is the only thing
   * to do, so it should be the biggest thing there. Under a list of files it is the loudest
   * element on a card whose actual subject is the list — which is what made an order that
   * already had artwork look like one still waiting for it.
   */
  const dropZone = (slim = false) => (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); stage(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      className={
        "flex cursor-pointer rounded-xl border border-dashed transition-colors " +
        (slim ? "items-center justify-center gap-2 px-3 py-2 " : "flex-col items-center justify-center gap-1 border-2 p-4 text-center ") +
        (over ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40")
      }
    >
      {busy ? <CircleNotch size={slim ? 14 : 18} className="animate-spin text-muted-foreground" /> : <UploadSimple size={slim ? 14 : 18} weight="bold" className="text-muted-foreground" />}
      <span className={slim ? "text-2xs font-medium text-muted-foreground" : "text-xs font-medium"}>
        {busy ? `Sending ${busy}…` : slim ? "Add another machine file or design image" : "Have a machine file or a design image? Drop it here"}
      </span>
      {!slim && <span className="text-2xs text-muted-foreground">Machine file (.pes · .dst · .emb …) — we check it instead of digitising · or a design image (PNG / JPG)</span>}
      <input ref={inputRef} type="file" multiple accept={MACHINE_ACCEPT + ",image/*"} className="hidden"
        onChange={(e) => { if (e.target.files) stage(e.target.files); e.target.value = "" }} />
    </div>
  )

  /**
   * A STITCH FILE ONLY FITS AN EMBROIDERY LINE.
   *
   * A .dst on a DTG line is not a near-miss, it is nothing: there is no machine to run it
   * and no check to perform, and letting one be assigned there is how six lines ended up
   * carrying a check fee for a file that could never be used. Images have no such
   * restriction — every line takes artwork.
   *
   * So the target list is filtered by what the FILE is, and when no line on the order is
   * embroidered the row says so instead of offering a choice that cannot be right.
   */
  const embItems = items.filter((it) => isEmbroidery(it.print_type))
  const targetsFor = (image: boolean) => (image ? items : embItems)

  /**
   * The order's lines as picker options, plus the whole-order default.
   *
   * THE NUMBER, AND ONLY THE NUMBER.
   *
   * It used to be "3 · <the product's name> ×2", and on a marketplace order the name is a
   * keyword list — "Custom Embroidered Apron with Name, Personalized Kitchen Apron, Cafe
   * Barista Soft Uniform, Custom Cooking Aprons, Mom Dad Gift". A select is as wide as its
   * widest option, so one such line stretched the control across the card and its open menu
   * past the edge of it.
   *
   * The number alone is enough BECAUSE the badge exists: the same figure is on the item row,
   * on the file row and here, so picking 3 and finding 3 is one glance. That was already the
   * stated intent of numbering these — the name was belt and braces, and it cost the layout.
   */
  const targetLabel = (it: OrderItem, i: number) => `Item ${i + 1}`
  // The number a line shows is its position in the ORDER, not in the filtered list — the
  // badge on the row must be the one you read in the dropdown, or the number is a lie.
  const numberOf = (it: OrderItem) => items.findIndex((x) => (x.line_id || x.sku) === (it.line_id || it.sku))
  // The whole-order choice. Kept short for the same reason the item labels are: a select is
  // as wide as its widest option, and "All embroidery items" was setting that on its own.
  const allLabel = (image: boolean) => (image ? "All items" : "All embroidery")
  const optionsFor = (image: boolean) => {
    const pool = targetsFor(image)
    return [allLabel(image), ...pool.map((it) => targetLabel(it, numberOf(it)))]
  }
  const keyAt = (image: boolean, label: string) => {
    const opts = optionsFor(image)
    const i = opts.indexOf(label) - 1
    const pool = targetsFor(image)
    return i < 0 ? ALL : (pool[i]?.line_id || pool[i]?.sku || ALL)
  }
  const labelFor = (image: boolean, key: string) => {
    const it = items.find((x) => (x.line_id || x.sku) === key)
    return it ? targetLabel(it, numberOf(it)) : allLabel(image)
  }

  /** WHAT IS ABOUT TO HAPPEN, one row per file, before anything is written. */
  const queue = staged.length > 0 && (
    <div className="rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
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
              <div className="text-2xs text-muted-foreground">
                {s.image ? "artwork — placed on the item" : "machine file — we check it instead of digitising"}
                {items.length > 0 && s.target !== ALL ? " · matched by name" : ""}
              </div>
            </div>
            {/* text-xs, matching the file name beside it — the field was two steps smaller
                than everything in its own row. clearable={false}: see the note on the prop;
                "no line at all" is not a state a file can hold. */}
            {items.length > 0 && (targetsFor(s.image).length > 0 ? (
              <VariantField
                label="Goes on" compact clearable={false} className="w-32 text-xs"
                value={labelFor(s.image, s.target)} options={optionsFor(s.image)}
                onChange={(v) => setStaged((prev) => prev.map((x) => (x.name === s.name ? { ...x, target: keyAt(s.image, v) } : x)))}
              />
            ) : (
              // Not a disabled dropdown — there is no choice to grey out. It says why, and
              // Attach below leaves this row alone.
              <span className="shrink-0 rounded-lg bg-amber-50 px-2 py-1 text-2xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                No embroidery item on this order
              </span>
            ))}
            <button
              onClick={() => setStaged((prev) => prev.filter((x) => x.name !== s.name))}
              title="Take this one out" aria-label={`Take ${s.name} out`}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <X size={11} weight="bold" />
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
      {/* The green "Sent 1 design image" banner is gone. A success message that sits above the
          list it just changed is telling you what the list is already showing — the new row is
          right there, and it stays, which the banner does not. Failures still speak up: an
          error is the one outcome you cannot see by looking. */}
    </>
  )

  /**
   * Move a file to one line, or back to the whole order.
   *
   * `key` is a line id when the picked item has one, and a bare sku otherwise. Only a line id
   * may be sent: the column IS line_id, and writing a sku into it would file the row against
   * an identity that does not exist — worse than leaving it where it was, because everything
   * downstream reads it as a line. Orders backfill line_id on read (orders.js), so the
   * fallback is the honest failure, not the normal path.
   */
  const rescope = async (f: DesignFileRow, key: string) => {
    const it = key === ALL ? null : items.find((x) => (x.line_id || x.sku) === key)
    if (it && !it.line_id) { setErr(`${it.name || it.sku || "That item"} has no line id yet, so a file can't be filed against it on its own.`); return }
    const lineId = it?.line_id ?? null
    if ((f.lineId ?? null) === lineId) return
    setBusy(f.designId); setErr(null)
    try {
      const r = await scopeDesignFile(f.designId, lineId)
      if (r?.error) throw new Error(r.error)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not move that file to another item.")
    } finally { setBusy(null) }
  }

  /**
   * Take a placed artwork off its line — the delete that did not exist until now, and the
   * reason these rows had no ✕ while every other row did.
   *
   * onAttached, not a local edit: the artwork belongs to the PAGE (it draws the mockups from
   * the same map), so the page re-reads and this list follows. Editing a copy here would
   * leave the row gone and the garment still wearing it.
   */
  const detach = async (r: { key: string; name: string; side: string; lineId?: string | null; sku?: string | null }) => {
    if (!(await confirm({
      title: `Take ${r.name} off the ${r.side}?`,
      body: "It comes off the line. Any design charge already made stays — ask an admin if it needs reversing.",
      confirmLabel: "Remove artwork",
      destructive: true,
    }))) return
    setBusy(r.key); setErr(null)
    try {
      const res = await deleteOrderDesign(orderId, { line_id: r.lineId ?? undefined, sku: r.sku ?? undefined, side: r.side })
      if (res?.error) throw new Error(res.error)
      onAttached?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't take that artwork off.")
    } finally { setBusy(null) }
  }

  /** Optimistic, then reconciled — the same shape the designer board's panel uses. */
  const priceIt = async (f: DesignFileRow, v: string) => {
    const n = Math.max(0, Number(v) || 0)
    setFiles((prev) => (prev ?? []).map((x) => (x.designId === f.designId ? { ...x, price: n } : x)))
    try {
      const r = await setDesignFilePrice(f.designId, n)
      if (r?.error) throw new Error(r.error)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not set that price.")
      load()
    }
  }

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

  const placed = placedRows(designs, items)

  // NOTHING TO BUY is a real state and it now says so. Returning null here left the card
  // above it showing a title and blank space — a promise of files with no files and no
  // explanation, which reads exactly like a fetch that failed.
  //
  // "No files" now means no files AND no placed artwork. It used to mean only the first, so
  // an order whose every item was already designed announced that nothing had arrived.
  if (!files.length && !placed.length) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          No files on this order yet. Machine files appear here once we&apos;ve cut them — or send us your own machine file or a design image.
        </p>
        {dropZone()}
        {queue}
        {notices}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {notices}
      <PlacedArtworkList rows={placed} onRemove={(r) => void detach(r)} busy={busy} />
      {/* SAME SHAPE AS THE ARTWORK ABOVE. These were bordered cards, one per file, stacked
          inside the panel's own card — a box per row inside a box — while the placed
          artwork above them was a plain divided list. Two lists of files on one order that
          did not look like the same kind of thing. Rows and hairlines for both. */}
      {orderFiles(files).map((f) => (
        <div key={f.designId} className="relative flex items-center gap-2.5 border-t border-border py-2 first:border-t-0">
          {/**
            * WHICH ITEM THIS FILE IS FOR — the number, not a glyph.
            *
            * Every row carried the same sparkle or the same picture icon, so the square said
            * only "this is a machine file" / "this is an image", which the filename already
            * says. On a six-line order with names two characters apart ("dc21", "dc22") the
            * question you are actually asking is WHICH LINE, and nothing on the row answered
            * it.
            *
            * The number is the one the target dropdown and the item rows use — position in
            * the ORDER — so picking 3 there and reading 3 here are the same 3. A file that
            * applies to everything says so rather than borrowing a line's number.
            */}
          {(() => {
            const it = items.find((x) =>
              (f.lineId && x.line_id === f.lineId) || (!f.lineId && !!f.sku && x.sku === f.sku))
            const n = it ? numberOf(it) + 1 : null
            // The SAME badge the item row carries — it was a tinted rounded square, which
            // reads as a category chip rather than as "this is item 3". Two shapes for one
            // fact is what made matching a file to its row a reading exercise. The kind is
            // still said, in words, on the line below.
            return <ItemNumberBadge no={n} title={n ? `Item ${n}${it?.name ? ` — ${it.name}` : ""}` : undefined} />
          })()}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{f.name}</span>
              {f.isLatest && <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-2xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" title="Most recent machine file for this item — the current fixed version">LATEST</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {f.sku ? `Item ${f.sku} · ` : ""}
              {/* WHO SENT IT, from the reader's side. "You sent this" is true for the seller
                  and false for every operator, warehouse hand and admin looking at the same
                  card — they are told who it was instead. */}
              {f.source === "seller"
                ? `${isSeller ? "You sent this" : "Sent by the seller"}${f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}`
                : f.kind === "image" ? "Design image"
                  : f.paid ? "Purchased" : f.price ? `$${f.price} — pays from your wallet` : "Free"}
            </div>
          </div>

          {/**
            * WHICH ITEM IT GOES ON — CHANGEABLE, not just displayed.
            *
            * The target was picked once, in the staging list, and then never again. A file
            * that landed on the wrong line (or on the whole order because its name matched
            * nothing) could not be moved without deleting and re-dropping it — which for a
            * seller's own machine file means losing the row we had already checked.
            *
            * /api/design_files/:id/scope has existed the whole time and nothing called it.
            * It is metadata only — no bytes move — and it is permission-checked server-side:
            * a non-staff caller may only re-scope a file on their OWN order, so this control
            * is safe to give to every role that can already see the row.
            */}
          {/* SIZED TO ITS NEIGHBOURS — text-xs, which is what Download and Remove are.
              It went to text-2xs, then to text-sm to match a Download button that was text-sm
              at the time; that button has since come down to text-xs and this stayed, so the
              pair drifted apart again in the other direction. It is the same size as the
              staging list's copy of this field for the same reason. The file NAME above is
              text-sm and stays there: a name is content, these are controls. */}
          {items.length > 0 && (
            <VariantField
              label="Goes on" compact clearable={false} className="w-32 shrink-0 text-xs"
              value={labelFor(f.kind === "image", f.lineId || ALL)}
              options={optionsFor(f.kind === "image")}
              onChange={(v) => void rescope(f, keyAt(f.kind === "image", v))}
            />
          )}
          {/**
            * WHAT THE SELLER PAYS, set by the people whose job that is.
            *
            * Only .pes is sold, and only admin/warehouse may price it — `canPrice` comes
            * from the SERVER (it decides, and rejects anyone else regardless), so this is
            * not a second opinion about who is allowed. It existed on the designer board's
            * panel and not here, which is the card admin and warehouse actually open, so a
            * deliverable could only be priced from a board that neither of them lives on.
            */}
          {f.kind === "pes" && f.canPrice && (
            <label className="flex shrink-0 items-center gap-1" title="What the seller pays to download this">
              <CurrencyDollar size={11} className="text-muted-foreground" />
              <Input
                defaultValue={String(f.price ?? 0)}
                onBlur={(e) => void priceIt(f, e.target.value)}
                inputMode="decimal"
                aria-label={`Price for ${f.name}`}
                className="h-7 w-16 text-center text-xs"
              />
            </label>
          )}

          {/**
            * DOWNLOAD ON EVERY ROW, FOR EVERYONE WHO MAY HAVE THE BYTES.
            *
            * Hidden for `source === "seller"` outright once, on the reasoning that the file
            * came from the seller's own browser so a button would only produce "forbidden".
            * Both halves of that were wrong. Staff may fetch ANY file — the route's first
            * check is `if (!isStaff(req.user))` — and the file staff most often want is the
            * one the seller just sent. And a seller may now take back what they sent: the
            * route's guards protect OUR work (factory files, the .pes paywall), neither of
            * which describes their own upload.
            *
            * An order opened months later is the only copy some of these have; "it is in
            * the browser you uploaded from" is not a filing system.
            */}
          {(
            <Button size="sm" variant={f.paid || !f.price ? "outline" : "default"} className="h-7 shrink-0 px-2 text-xs" disabled={busy === f.designId} onClick={() => buyAndGet(f)}>
              {/* Word alone. The glyph said nothing "Download" doesn't, and it made this
                  button visibly heavier than the field beside it — the pair is a control
                  and its action, so they should look like a pair. The spinner stays: that
                  one carries information the word cannot. */}
              {busy === f.designId ? <CircleNotch size={13} className="animate-spin" />
                : (f.paid || !f.price) ? "Download"
                : <>Buy ${f.price} &amp; download</>}
            </Button>
          )}
          {/**
            * REMOVE IS IN THE ROW, beside Download, on every row.
            *
            * It floated on the corner — a small ✕ hanging off the top-right, over the
            * content rather than in it. On a list where the artwork rows above carry their
            * actions inline that made the two look like different kinds of object, and the
            * ✕ itself read as "dismiss this notice" rather than "delete this file".
            *
            * Word, not glyph: this deletes a file off an order. A ✕ is the mark we use for
            * closing things, and it should not also mean destroying one.
            */}
          {canRemove && (
            <Button
              variant="ghost" size="sm"
              className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => remove(f)}
              disabled={busy === f.designId}
              title="Remove this file from the order"
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {/* Offered alongside existing files too, not only when the list is empty — a seller
          may send a corrected file after we've already delivered one. */}
      {dropZone(true)}
      {queue}
    </div>
  )
}
