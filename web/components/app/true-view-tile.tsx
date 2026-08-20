"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, ArrowSquareOut, Needle } from "@phosphor-icons/react"
import { downloadDesignFile, filesForLine, getEmbPreview, type DesignFileRow, type OrderItem } from "@/lib/api"

/**
 * WHAT THE MACHINE WILL ACTUALLY SEW — beside the mockup, not instead of it.
 *
 * The line already shows the mockup: the blank with the artwork placed, which is what the
 * buyer was sold. This is the other claim, from the other party: the stitch file, rendered.
 * They are different statements about the same job and the whole point is seeing them
 * together before a garment is hooped — a design that looks right in the mockup and wrong
 * in the stitches is exactly the thing nobody catches by opening two screens in turn.
 *
 * It used to be a TOGGLE inside the canvas dialog (`toggleStitch` swapped the stage between
 * artwork and stitches), which is the one arrangement that cannot answer the question,
 * because comparing means holding both at once.
 *
 * TWO SOURCES, CHEAPEST FIRST:
 *
 *  1. THE WORKSHEET PDF, when the digitiser sent one with the file. It is the design as it
 *     will sew plus the stitch count, the colour changes, the thread list by brand and code,
 *     the machine and the hoop — the digitiser's own statement about their own file. Free,
 *     instant, and available for files Wilcom cannot open at all (a licence-locked .emb is
 *     refused outright, and that is precisely when someone needs to see the design).
 *  2. WILCOM TRUEVIEW, rendered from the stitch file. Cached server-side by content hash, so
 *     it costs one EWA call per file ever — but that first call is slow and metered, so it
 *     is a BUTTON, not something forty order lines fire on page load.
 */
export function TrueViewTile({ orderId, item, files, size = 144 }: {
  orderId: string
  item: OrderItem
  files: DesignFileRow[] | undefined
  size?: number
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [png, setPng] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [why, setWhy] = useState<string | null>(null)
  const objectUrl = useRef<string | null>(null)

  // The worksheet on THIS line — its own files first, then the order-wide ones, which is the
  // same precedence artwork uses. `sheet` is set by kindOf server-side.
  const sheet = filesForLine(files, item).find((f) => f.kind === "sheet")

  /**
   * IS THERE ANYTHING TO SEW? Asked HERE, from files the page already holds, instead of by
   * asking the renderer and rendering its refusal.
   *
   * A line with no machine file drew a full-size empty square reading "No machine file for
   * that design." — the 404 from /api/wilcom/design-preview. On an order of plain DTG items
   * that is a 144px hole beside every line, holding space for a thing that does not exist
   * and never will on that line. An absence does not need a frame.
   *
   * The predicate MIRRORS THE LOOKUP in server/src/routes/wilcom.js: the line's own .emb,
   * else ANY .emb on the order — checking only this line would hide a tile the renderer
   * would in fact have answered, which is the opposite mistake and the more expensive one.
   *
   * `files === undefined` means they have not arrived yet, which is not the same as "none":
   * nothing is drawn until it is known, so the tile appears WITH a file rather than as a
   * box that might later fill.
   */
  const hasMachineFile = (files ?? []).some(
    (f) => f.kind === "emb" || /\.emb$/i.test(String(f.name || "")),
  )

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])

  // A worksheet costs nothing, so it loads itself. Keyed on the design id: a line whose file
  // is replaced gets the new sheet rather than the old one held in state.
  const sheetId = sheet?.designId ?? null
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      if (!sheetId) { setPdfUrl(null); return }
      downloadDesignFile(sheetId)
        .then((r) => {
          if (!live) return
          const src = r.data || r.url
          if (!src) return
          // A data: URL renders in a frame directly; a stored file comes back as a link we
          // can point at. Either way nothing is fetched twice.
          if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null }
          setPdfUrl(src)
        })
        .catch(() => { if (live) setPdfUrl(null) })
    }, 0)
    return () => { live = false; clearTimeout(t) }
  }, [sheetId])

  const render = useCallback(() => {
    setBusy(true); setWhy(null)
    getEmbPreview({ orderId, sku: item.sku ?? null })
      .then((r) => {
        if (r.ok && r.png) { setPng(r.png); return }
        /* Each reason needs a DIFFERENT person to act, so it is turned into the sentence
           that says who — the same wording the designer board uses, because a floor that
           reads two different explanations of one refusal learns to trust neither. */
        setWhy(
          r.reason === "not-stitch-file" ? "No stitch file on this line yet."
            : r.reason === "not-configured" ? "Wilcom isn't connected — an admin adds the keys in Integrations."
              : r.reason === "file-security" ? "Locked by the digitiser's Wilcom licence. Ask them for an unprotected file."
                : r.reason === "ewa-rejected" ? "Wilcom refused the file without saying why."
                  : r.error || "The renderer returned no image.",
        )
      })
      .catch((e) => setWhy(e instanceof Error ? e.message : "Couldn't reach the renderer."))
      .finally(() => setBusy(false))
  }, [orderId, item.sku])

  const frame = "shrink-0 overflow-hidden rounded-md border border-border bg-card"
  const style = { width: size, height: size }

  // THE WORKSHEET WINS when there is one. It carries the thread list and the stitch count,
  // which a bare render does not, and it did not cost anything to get.
  if (pdfUrl) {
    return (
      <div className={frame} style={style}>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`${sheet?.name || "Production worksheet"} — open full size`}
          className="group relative block size-full"
        >
          {/* pointer-events-none so the frame never swallows the click: the tile is small on
              purpose and the thread codes are unreadable at this size — it says "there IS a
              worksheet, and here is roughly what it shows", and opening it is the point. */}
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title={sheet?.name || "Production worksheet"}
            className="pointer-events-none size-full border-0"
          />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-foreground/70 px-1.5 py-0.5 text-2xs font-medium text-background">
            Worksheet
            <ArrowSquareOut size={10} weight="bold" className="opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
        </a>
      </div>
    )
  }

  if (png) {
    return (
      <div className={frame} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a base64 PNG from the
            renderer; next/image would want a loader and a domain for bytes we already hold. */}
        <img src={`data:image/png;base64,${png}`} alt="Stitch preview" className="size-full object-contain" />
      </div>
    )
  }

  // NOTHING TO SHOW AND NOTHING TO OFFER. No worksheet, no stitch file, and no render in
  // hand — so there is no tile. The reason states below are kept for the case that matters:
  // a file that EXISTS and could not be read, which sends someone to the digitiser rather
  // than to the designer, and must still say so.
  if (!hasMachineFile && !why && !busy) return null

  return (
    <div className={`${frame} grid place-items-center p-2 text-center`} style={style}>
      {busy ? (
        <CircleNotch size={18} className="animate-spin text-muted-foreground" />
      ) : why ? (
        /* THE REASON, not a broken tile. "Cannot be read" and "does not exist" send someone
           to different people, so the tile says which rather than showing nothing. */
        <span className="text-2xs leading-tight text-muted-foreground">{why}</span>
      ) : (
        <button
          type="button"
          onClick={render}
          className="flex flex-col items-center gap-1 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Needle size={16} />
          Stitch view
          {/* Said out loud, because the first one is slow and metered and every one after it
              is free — which is the difference between "why is this hanging" and "of course
              it is, it is rendering". */}
          <span className="font-normal opacity-70">renders once</span>
        </button>
      )}
    </div>
  )
}
