"use client"

import { useLabelT } from "@/lib/i18n"
import { useRef, useState } from "react"
import { CheckCircle, CircleNotch, DownloadSimple, UploadSimple, WarningCircle, X, type Icon } from "@phosphor-icons/react"
import { RegionMark, REGION_LINE, REGION_NOTE } from "@/components/app/region"
import { cn } from "@/lib/utils"

/**
 * THE DROP TARGET. One of them, for the whole app.
 *
 * There were about thirty, each written from scratch, and a count of what they disagreed on:
 * three radii (lg / xl / 2xl), two border widths (1px and 2px), four paddings (p-4 · px-4
 * py-10 · px-6 py-8 · px-3 py-2) and four grounds (none · bg-muted/40 · bg-muted/20 ·
 * bg-primary/[0.02]). Same job, same page sometimes, no two alike — because the only way to
 * add one was to type a dashed border again.
 *
 * THE PARTS ARE NOT THIS FILE'S — they are the four in components/app/region.tsx, shared
 * with EmptyState so a drop target and an empty list cannot drift apart. This file adds only
 * what is specific to accepting a file: the dashed edge, the drag state, the input, and the
 * RECEIPT.
 *
 * A GROUND, though, is this file's. A dashed rule around nothing reads as an empty box that
 * failed to load; a visible fill says the area is a target. bg-muted/20 on a white card is
 * not a fill.
 *
 * ── THE RECEIPT ──────────────────────────────────────────────────────────────────────────
 *
 * A drop target that looks identical before and after the drop is the single most-reported
 * fault in this app: "the files have no file names, no occurrence, or any indication that
 * the files have been uploaded". It was true of every one of the thirty. Dropping a file
 * would set some state deep in a page, and the thing you had just dropped ONTO said nothing.
 *
 * So `files` is not decoration and not optional-in-spirit: if a zone accepts a file and the
 * file stays around, the zone owes you a row with its NAME, its SIZE and its STATE. It is the
 * only proof the drop landed, and it is where the way OUT lives — you cannot remove a file
 * you were never shown.
 */

/** One row of the receipt. `size`, `thumb` and `error` are all optional — a data: url from a
 *  library has no File behind it and therefore no byte count to print. */
export type DroppedFile = {
  name: string
  size?: number | null
  /** A small preview, when the thing dropped is an image we can already show. */
  thumb?: string | null
  status?: "uploading" | "done" | "error"
  /** One more FACT about this file — "saved", "not saved yet", "front". Never a sentence
   *  explaining the control it sits under. */
  note?: string | null
  /** Carries its own reason — a refusal is the answer, not a subtitle (CLAUDE.md §4). */
  error?: string | null
  /** Take a copy of this file. Beside the remove, because a receipt that can only DELETE
   *  what it lists is half a receipt: the reason to show a file name is so the file can be
   *  got at, and every surface that listed one was sending people to open something else to
   *  get it. Optional — a row for a file that is still uploading has nothing to hand over. */
  onDownload?: () => void
  onRemove?: () => void
}

/**
 * BYTES, IN WORDS. Written eight separate times as `(n / 1024 / 1024).toFixed(1)`, which is
 * why a 4KB SVG reported "0.0MB" — an honest zero that reads as a failed upload.
 */
export function formatBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** The last path segment of a url, decoded, with the query dropped — a name for a file that
 *  arrived as a link rather than as a File. null when there is nothing name-shaped in it
 *  (a data: url, or a path ending in a slash), because a made-up name is worse than none. */
export function fileNameFrom(url: string | null | undefined): string | null {
  if (!url || url.startsWith("data:")) return null
  try {
    const path = url.split(/[?#]/)[0]
    const last = path.split("/").filter(Boolean).pop()
    if (!last || !last.includes(".")) return null
    return decodeURIComponent(last)
  } catch { return null }
}

/**
 * WHAT TO CALL A FILE'S FORMAT — the tail it was uploaded with, not the bucket it fell in.
 *
 * `kindOf` on the server sorts .emb, .dst, .exp, .jef, .vp3, .xxx and .hus all into `emb`,
 * because everything downstream only needs to know "this is a stitch file". That is right for
 * FILTERING and wrong for a LABEL: a .DST shown as "EMB" names a different format from the
 * one the seller uploaded, and .EMB and .DST are not interchangeable — one is Wilcom's own
 * working file and the other is what a machine reads. Someone reading "EMB" on a row and
 * going to look for a .emb finds a .dst.
 *
 * So the label comes off the NAME when there is one, and falls back to the kind when there
 * is not. Capped at four characters because that is every extension this takes.
 */
export function fileFormatLabel(name: string | null | undefined, kind?: string | null): string {
  const tail = String(name ?? "").split(".").pop() ?? ""
  // Only a real extension — a name with no dot returns the whole name from split().pop(),
  // and "COMELONES LOGO" is not a format.
  const ext = /^[A-Za-z0-9]{1,4}$/.test(tail) && String(name ?? "").includes(".") ? tail : ""
  return (ext || String(kind ?? "")).toUpperCase()
}

/**
 * WHAT A FILE IS FOR — the word beside the name, not the format.
 *
 * The name already ends in the format: "COMELONES LOGO.DST" says .DST, and repeating "DST"
 * next to it is the same fact twice. What the row cannot say for itself is the JOB — a .dst
 * and a .pes are both what the machine reads, a .png is what gets printed, and a .pdf from a
 * digitiser is neither. That is one word, and it is the same word whatever extension the
 * file happens to wear.
 *
 * Returns "" for a kind we have no word for, so the row prints nothing rather than a bucket
 * name like "other" that means nothing to the person reading it.
 */
export function fileRoleLabel(kind?: string | null): string {
  switch (String(kind ?? "").toLowerCase()) {
    case "emb":
    case "pes": return "MACHINE"
    case "image": return "ARTWORK"
    case "sheet": return "WORKSHEET"
    default: return ""
  }
}

/**
 * ONE ROW OF THE RECEIPT, exported so a surface that keeps its own list outside a Dropzone
 * (the designer's stage, where the "zone" is the garment itself) prints the same row rather
 * than inventing a ninth one.
 */
export function FileRow({ file, className }: { file: DroppedFile; className?: string }) {
  const tl = useLabelT()
  const size = formatBytes(file.size)
  const state = file.status ?? "done"
  const facts = [size, file.note].filter(Boolean).join(" · ")
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left",
        state === "error" && "border-alert/40 bg-alert/5",
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted">
        {file.thumb
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={file.thumb} alt="" className="size-full object-contain" />
          : state === "uploading" ? <CircleNotch size={14} className="animate-spin text-muted-foreground" />
          : state === "error" ? <WarningCircle size={14} weight="bold" className="text-alert" />
          : <CheckCircle size={14} weight="bold" className="text-shipped" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{file.name}</span>
        {/* NOT A SUBTITLE. This line only ever carries FACTS the row cannot show otherwise —
            the byte count, or the reason it was refused. It is never an explanation of the
            control above it. */}
        {(file.error || facts || state === "uploading") && (
          <span className={cn("block truncate text-2xs", file.error ? "text-alert" : "text-muted-foreground")}>
            {file.error ?? (state === "uploading" ? tl("dropzone", "Uploading…") : facts)}
          </span>
        )}
      </span>
      {file.onDownload && (
        <button
          type="button"
          onClick={file.onDownload}
          aria-label={`Download ${file.name}`}
          title={`Download ${file.name}`}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <DownloadSimple size={12} weight="bold" />
        </button>
      )}
      {file.onRemove && (
        <button
          type="button"
          onClick={file.onRemove}
          aria-label={`Remove ${file.name}`}
          title={`Remove ${file.name}`}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={12} weight="bold" />
        </button>
      )}
    </div>
  )
}

export function Dropzone({
  onFiles, accept, multiple = false, icon, label, hint, action, files, onPick,
  slim = false, busy = null, disabled = false, className,
}: {
  onFiles: (files: FileList) => void
  accept?: string
  multiple?: boolean
  icon?: Icon
  /** What to do. One short line. */
  label: string
  /** What is allowed — types, size. A caption, and optional. */
  hint?: string
  /** A second route in, under an "or". */
  action?: React.ReactNode
  /** THE RECEIPT — what is currently on this zone. See the note at the top of the file. */
  files?: DroppedFile[]
  /**
   * BROWSE WITH SOMEONE ELSE'S INPUT.
   *
   * The zone owns an <input type="file"> and clicking it opens that. Inside a POPOVER that
   * is a trap: opening the OS file dialog takes focus off the page, the popover treats it as
   * an outside interaction and closes — taking the input with it, so the picker never
   * appears and pressing the zone looks like it does nothing at all. A surface that already
   * keeps its inputs at dialog level passes the handler that clicks one of those instead,
   * and the picker survives the panel closing.
   */
  onPick?: () => void
  /** One inline row, for a zone under a list that already has files in it. */
  slim?: boolean
  /** Text to show beside a spinner while something is uploading. */
  busy?: string | null
  disabled?: boolean
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const I = icon ?? UploadSimple
  const receipt = files?.length ? files : null

  const take = (f?: FileList | null) => { if (f && f.length) onFiles(f) }

  return (
    <div
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (disabled) return; e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
      className={cn(
        /**
         * ONE HAIRLINE, NOT TWO PIXELS.
         *
         * The 2px dashed rule is the single most dated thing on these surfaces — it is the
         * default every framework ships and it shouts at a resting control that is asking
         * for nothing. A 1px dash on a filled panel with a generous radius reads as a place
         * to put something; the heavy dash reads as a validation error.
         */
        "flex flex-col items-center justify-center border border-dashed transition-colors duration-150",
        // AIR IS WHAT SAYS "PUT SOMETHING HERE". px-6 py-8 around a 40px tile left the zone
        // barely taller than the row of type inside it, so it read as a notice rather than as
        // a space with room in it. The radius goes up with the box: 12px on something this
        // large is the corner of a table cell.
        // SLIM IS STILL A TARGET. It was py-2 — a strip about as tall as its own text, which
        // you have to aim a dragged file at. A drop zone is the one control whose AREA is
        // the affordance: you cannot hover it to find out where it is, you have to already
        // be holding something. py-5 keeps it one quiet row beneath the files that are
        // already attached, while giving it something to hit.
        slim ? "gap-2 rounded-lg px-4 py-5" : "gap-4 rounded-2xl px-6 py-12 text-center",
        disabled ? "cursor-not-allowed border-border bg-muted/40 opacity-60"
          // The drag state is the one moment this control should be loud: a solid edge, so
          // dashed→solid is itself the signal that the file will land here.
          : over ? "border-solid border-primary bg-primary/[0.06]"
          // The resting ground is a HINT of one — the tile inside it is white, and the two
          // need to read as card-on-ground. bg-muted/40 was close enough to the tile that the
          // tile stopped lifting off it.
          : "border-border bg-muted/30 hover:border-muted-foreground/40 hover:bg-muted/60",
        className,
      )}
    >
      {/* A real button, so the zone is reachable and operable from the keyboard. The whole
          area is the click target; `action` is a SIBLING rather than a child, because a
          button inside a button is invalid and the nested one stops working. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => (onPick ? onPick() : ref.current?.click())}
        className={cn(
          "flex w-full cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed",
          slim ? "gap-2" : "flex-col gap-3",
        )}
      >
        {slim ? (
          busy
            ? <CircleNotch size={14} className="animate-spin text-muted-foreground" />
            : <I size={14} weight="bold" className="text-muted-foreground" />
        ) : (
          <RegionMark icon={I} busy={!!busy} size="md" />
        )}
        <span className={slim ? "text-xs font-medium text-muted-foreground" : REGION_LINE.md}>
          {busy ?? label}
        </span>
        {hint && !slim && !busy && <span className={cn(REGION_NOTE.md, "-mt-1.5")}>{hint}</span>}
      </button>

      {action && !slim && !busy && (
        <>
          <span className="text-xs text-muted-foreground">or</span>
          {action}
        </>
      )}

      {/* THE RECEIPT, inside the zone rather than under it — the answer belongs on the thing
          that was asked. Left-aligned against a centred zone on purpose: a file name is read,
          not admired, and centred names of different lengths give a list no left edge. */}
      {receipt && !slim && (
        <div className="mt-1 flex w-full flex-col gap-1.5">
          {receipt.map((f, i) => <FileRow key={`${f.name}-${i}`} file={f} />)}
        </div>
      )}
      {receipt && slim && (
        <span className="truncate text-2xs text-muted-foreground">
          {receipt.length === 1 ? receipt[0].name : `${receipt.length} files`}
        </span>
      )}

      <input
        ref={ref} type="file" accept={accept} multiple={multiple} disabled={disabled}
        className="sr-only"
        onChange={(e) => { take(e.target.files); e.target.value = "" }}
      />
    </div>
  )
}
