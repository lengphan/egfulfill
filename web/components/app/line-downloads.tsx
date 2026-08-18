"use client"

import { useState } from "react"
import { DownloadSimple, CircleNotch } from "@phosphor-icons/react"
import { downloadDesignFile, filesForLine, type DesignFileRow, type OrderDesign } from "@/lib/api"
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
  const [busy, setBusy] = useState<string | null>(null)
  const art = designSrc(design?.data)
  const mine = filesForLine(files, { line_id: item.line_id, sku: item.sku })
  const machine = mine.filter((f) => f.kind === "emb" || f.kind === "pes")
  if (!art && !machine.length) return null

  const stem = (item.name || item.sku || "design").replace(/[^a-z0-9]+/gi, "-").slice(0, 40)

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

  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
      {/* The ARTWORK is already a URL the browser can save — no round trip, and it is the
          same bytes the canvas is rendering, so what downloads is what you are looking at. */}
      {art && (
        <a
          href={art}
          download={`${stem}.png`}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <DownloadSimple size={12} weight="bold" /> Artwork
        </a>
      )}
      {machine.map((f) => (
        <button
          key={f.designId}
          type="button"
          onClick={() => void grab(f)}
          disabled={busy === f.designId}
          title={f.name || "Machine file"}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-60"
        >
          {busy === f.designId
            ? <CircleNotch size={12} className="animate-spin" />
            : <DownloadSimple size={12} weight="bold" />}
          {f.name || "Machine file"}
        </button>
      ))}
    </span>
  )
}
