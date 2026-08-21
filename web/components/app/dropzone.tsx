"use client"

import { useRef, useState } from "react"
import { CircleNotch, UploadSimple, type Icon } from "@phosphor-icons/react"
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
 * WHAT MAKES A DROP TARGET READ AS ONE, and what most of them were missing:
 *
 *   1. A FRAMED ICON, not a bare glyph. An 18px outline sitting on the page is decoration;
 *      the same glyph inside a small filled tile is an object, and the eye lands on it first.
 *      This is most of the difference between the good ones and the faint ones.
 *   2. TWO LINES, ranked. What to do, then what is allowed — the second line at the size of a
 *      caption rather than at the size of the first.
 *   3. A GROUND. A 1px dashed rule around nothing reads as an empty box that failed to load.
 *      A faint fill says the area is a target.
 *
 * The `action` slot is for a second way in — recording instead of uploading, pasting a URL —
 * and it sits under an "or", because two peer routes to the same end need a word between
 * them or the button looks like the thing you are supposed to press.
 */
export function Dropzone({
  onFiles, accept, multiple = false, icon, label, hint, action,
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

  const take = (files?: FileList | null) => { if (files && files.length) onFiles(files) }

  return (
    <div
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (disabled) return; e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
      className={cn(
        "flex flex-col items-center justify-center border-dashed transition-colors",
        slim ? "gap-2 rounded-lg border px-3 py-2" : "gap-2.5 rounded-xl border-2 px-6 py-7 text-center",
        disabled ? "cursor-not-allowed border-border bg-muted/40 opacity-60"
          : over ? "border-primary bg-primary/5"
          : "border-border bg-muted/40 hover:border-primary/50 hover:bg-accent/60",
        className,
      )}
    >
      {/* A real button, so the zone is reachable and operable from the keyboard. The whole
          area is the click target; `action` is a SIBLING rather than a child, because a
          button inside a button is invalid and the nested one stops working. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className={cn(
          "flex w-full cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed",
          slim ? "gap-2" : "flex-col gap-2",
        )}
      >
        {slim ? (
          busy
            ? <CircleNotch size={14} className="animate-spin text-muted-foreground" />
            : <I size={14} weight="bold" className="text-muted-foreground" />
        ) : (
          // THE TILE. A glyph on a filled square is an object you can aim at; the same glyph
          // loose on the page is a decoration you read past.
          <span className="grid size-10 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
            {busy ? <CircleNotch size={18} className="animate-spin" /> : <I size={18} />}
          </span>
        )}
        <span className={slim ? "text-xs font-medium text-muted-foreground" : "text-sm font-medium"}>
          {busy ?? label}
        </span>
        {hint && !slim && !busy && <span className="text-xs text-muted-foreground">{hint}</span>}
      </button>

      {action && !slim && !busy && (
        <>
          <span className="text-xs text-muted-foreground">or</span>
          {action}
        </>
      )}

      <input
        ref={ref} type="file" accept={accept} multiple={multiple} disabled={disabled}
        className="sr-only"
        onChange={(e) => { take(e.target.files); e.target.value = "" }}
      />
    </div>
  )
}
