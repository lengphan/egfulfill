"use client"

import { useLabelT } from "@/lib/i18n"
import { useState } from "react"
import { DownloadSimple, CircleNotch } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { downloadDesignFile, filesForLine, type DesignFileRow, type OrderDesign } from "@/lib/api"
import { fileRoleLabel } from "@/components/app/dropzone"
import { designSrc } from "@/lib/order-image"

/**
 * THE FILES THIS LINE IS MADE FROM, downloadable from the line itself.
 *
 * The artwork and the stitch file were reachable only by opening the design window and
 * finding the button inside it — one line at a time, on an order with four of them. The
 * row already knows which files are its own; it just never offered them.
 *
 * KEYED ON THE LINE, never on the sku. Two lines of the same sku are different jobs
 * (CLAUDE.md §5), and a sku-keyed download hands you the sibling's artwork with no way to
 * tell — filesForLine is the shared resolver that gets this right, line first and the
 * order-wide legacy rows only as a fallback.
 *
 * The machine file goes through /api/design_files/:id rather than a direct link, because
 * that route is where the paywall and the seller/staff checks live. A raw URL would hand
 * out bytes the caller may not have bought.
 */
export function LineDownloads({ design, files, item }: {
  design?: OrderDesign | null
  files?: DesignFileRow[]
  item: { line_id?: string | null; sku?: string | null; name?: string | null }
}) {
  const tl = useLabelT()
  const [busy, setBusy] = useState<string | null>(null)
  const art = designSrc(design?.data)
  const mine = filesForLine(files, { line_id: item.line_id, sku: item.sku })
  const machine = mine.filter((f) => f.kind === "emb" || f.kind === "pes")
  if (!art && !machine.length) return null

  const stem = (item.name || item.sku || "design").replace(/[^a-z0-9]+/gi, "-").slice(0, 40)

  /**
   * THE FILE'S OWN NAME, the same as the stitch-file row beside it.
   *
   * This row said "Artwork" while the row under it said `dragon-print-v2.emb`, so the one
   * file somebody uploads by name was the one the list refused to name — and on an order
   * where two lines carry different art there was nothing to tell them apart. `name` is
   * stored per design row (order_designs.name) and written by every upload path.
   *
   * Truncated by the same `truncate` the machine row uses, with the full name in the title:
   * a 60-character marketplace filename must not widen the popover or wrap to three lines.
   */
  const artName = String(design?.name ?? "").trim()
  /* WHAT IT ACTUALLY IS, rather than a hardcoded "PNG". The badge is the fact you scan for
     when a line carries a JPG the printer will refuse; the extension is read from the name,
     then the URL, then the data: URI's own mime type. */
  const extFrom = (s: string) => (/\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(s)?.[1] ?? "").toUpperCase()
  const artExt = extFrom(artName)
    || extFrom(art.startsWith("data:") ? "" : art)
    || (/^data:image\/([a-z0-9.+-]+)/i.exec(art)?.[1] ?? "").toUpperCase()
    || "PNG"
  const artLabel = artExt === "JPEG" ? "JPG" : artExt

  const grab = async (f: DesignFileRow) => {
    setBusy(f.designId)
    try {
      const r = await downloadDesignFile(f.designId)
      const href = r.data || r.url
      if (!href) return
      const a = document.createElement("a")
      a.href = href
      a.download = f.name || `${stem}.emb`
      document.body.appendChild(a); a.click(); a.remove()
    } catch { /* the row stays; a failed fetch must not remove the way to retry */ }
    finally { setBusy(null) }
  }

  const count = (art ? 1 : 0) + machine.length

  /**
   * ON THE PICTURE, NOT UNDER THE TEXT.
   *
   * "⤓ Artwork" as a text link under the sku put a coloured word in the middle of a block
   * of grey facts — the loudest thing on a line whose job is naming the garment, for an
   * action nobody takes on most visits. And a second link beside it for the stitch file made
   * a row of links out of a row of information.
   *
   * The artwork IS the thumbnail, so the download belongs on the thumbnail: a quiet corner
   * button, mirroring the item number badge on the opposite corner, with a count when the
   * line has more than one file. Always visible rather than hover-only — a control that
   * appears on hover does not exist on a phone, and this is a floor tool.
   *
   * INSIDE THE CORNER, NOT HANGING OFF IT (2026-08-27). It sat at `-bottom-1.5 -left-1.5`,
   * so it broke the picture's edge and read as a blemish ON the photograph rather than as a
   * control OVER it — and there is one on every row of a long order. Moved within the tile's
   * bounds with a hair of translucency behind it, which is the ordinary grammar for a
   * control laid over an image. Still always visible: the paragraph above still holds. */
  return (
    <Popover>
      <PopoverTrigger
        title={`${count} file${count === 1 ? "" : "s"} on this line — artwork${machine.length ? tl("lineDownloads", " and stitch file") : ""}`}
        className="eg-tap absolute bottom-1 left-1 z-10 inline-flex items-center gap-0.5 rounded-lg border border-border bg-card/95 px-1.5 py-1 text-xs font-semibold text-muted-foreground backdrop-blur-[2px] transition-colors hover:border-primary hover:text-primary"
      >
        <DownloadSimple size={12} weight="bold" />
        {count > 1 && count}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {/* The ARTWORK is already a URL the browser can save — no round trip, and it is the
            same bytes the canvas is rendering, so what downloads is what you are looking at. */}
        {art && (
          <a
            href={art}
            download={artName || `${stem}.${artLabel.toLowerCase()}`}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            <DownloadSimple size={14} weight="bold" className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={artName || undefined}>{artName || tl("lineDownloads", "Artwork")}</span>
            <span className="shrink-0 text-2xs text-muted-foreground">{artLabel}</span>
          </a>
        )}
        {machine.map((f) => (
          <button
            key={f.designId}
            type="button"
            onClick={() => void grab(f)}
            disabled={busy === f.designId}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
          >
            {busy === f.designId
              ? <CircleNotch size={14} className="shrink-0 animate-spin" />
              : <DownloadSimple size={14} weight="bold" className="shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate" title={f.name || undefined}>{f.name || tl("lineDownloads", "Machine file")}</span>
            {/* The KIND, not the id. The slug this used to print is unreadable and
                unactionable; "EMB" is the fact somebody is looking for. */}
            <span className="shrink-0 text-2xs text-muted-foreground">{fileRoleLabel(f.kind)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
