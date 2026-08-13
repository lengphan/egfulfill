import { useEffect, useState } from "react"
import { loadPdfjs } from "@/lib/label-pdf"
import { canvasReadableSrc } from "@/lib/thread-match"

/**
 * ARTWORK THAT ISN'T AN IMAGE.
 *
 * A buyer's personalisation upload on Etsy is whatever they had — and often that is a PDF,
 * not a PNG. We rendered every `design_src` into an `<img>`, which a PDF can never satisfy,
 * so a perfectly good file showed as a broken thumbnail over "This artwork couldn't be
 * loaded — replace it, or remove it and upload again". The file was fine. The advice was
 * wrong, and it told an operator to go back to a customer for no reason.
 *
 * So the first page is rendered to a PNG data URL and used wherever the image would have
 * been. Two things follow from rendering rather than embedding it in an <iframe>:
 *
 *   - It works everywhere an image works — the thumbnail, the big preview, the layout box.
 *   - THREAD COLOURS STILL WORK. The result is a data URL drawn on our own canvas, so
 *     extractDominant can read it. An <iframe> would display the file and silently cost
 *     the colour match, which is half of what this screen is for.
 *
 * pdf.js is loaded through label-pdf's loader, not a second copy: the legacy build and the
 * worker URL are decided there for reasons that fail silently when got wrong.
 */

/** Does this source point at a PDF? Query strings are normal on Etsy CDN URLs
 *  (`…_h4ooyent.pdf?version=0`), so the extension test has to ignore them. */
export function isPdfSrc(src: string | null | undefined): boolean {
  if (!src) return false
  const s = String(src)
  if (/^data:application\/pdf/i.test(s)) return true
  return /\.pdf(?:[?#]|$)/i.test(s)
}

const cache = new Map<string, string>()

/**
 * First page of a PDF as a PNG data URL, or null if it can't be read.
 *
 * Null rather than a throw: the caller's job is to show artwork, and a file we cannot
 * render should degrade to "open it yourself" rather than take the panel down.
 *
 * Fetched through canvasReadableSrc so the bytes come same-origin via our proxy — a
 * cross-origin fetch of the Etsy CDN is blocked, and even if it weren't, the canvas would
 * be tainted and the colour read would throw.
 */
export async function pdfFirstPageDataUrl(src: string, maxPx = 1200): Promise<string | null> {
  if (!src || typeof document === "undefined") return null
  const hit = cache.get(src)
  if (hit) return hit
  try {
    const res = await fetch(canvasReadableSrc(src))
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
    const page = await doc.getPage(1)

    // Scale so the LONGER side lands near maxPx: artwork is as often landscape as portrait,
    // and fixing the width alone renders a tall design at a few hundred pixels of height,
    // which is too coarse for the colour read this feeds.
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(4, Math.max(0.2, maxPx / Math.max(base.width, base.height)))
    const viewport = page.getViewport({ scale })

    const cv = document.createElement("canvas")
    cv.width = Math.max(1, Math.floor(viewport.width))
    cv.height = Math.max(1, Math.floor(viewport.height))
    const ctx = cv.getContext("2d")
    if (!ctx) return null
    // WHITE FIRST. A PDF page is transparent where nothing is drawn, and black artwork on a
    // transparent ground reads as black-on-black once it lands in an <img>. Paper is white,
    // and this is a picture of paper.
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, cv.width, cv.height)
    await page.render({ canvas: cv, canvasContext: ctx, viewport }).promise

    const out = cv.toDataURL("image/png")
    cache.set(src, out)
    doc.destroy?.()
    return out
  } catch {
    return null
  }
}

/**
 * Any artwork source, resolved to something an <img> can actually show.
 *
 * A PDF becomes its rendered first page; anything else is passed through untouched, so
 * every existing image behaves exactly as before. Callers get `pdf` and `loading` so they
 * can say "opening PDF…" rather than flashing a broken frame — the whole point is to stop
 * telling people a good file is broken.
 *
 * No synchronous reset when `src` changes: the resolved value is stored WITH the src it
 * belongs to and only used when they match. That keeps a previous PDF from appearing under
 * a new one for a frame, without a set-state-in-effect the lint rules forbid.
 */
export function useArtworkSrc(src: string | null | undefined): { src: string; pdf: boolean; loading: boolean } {
  const pdf = isPdfSrc(src)
  const [done, setDone] = useState<{ key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!src || !pdf) return
    let live = true
    const id = setTimeout(() => {
      pdfFirstPageDataUrl(src).then((u) => { if (live) setDone({ key: src, url: u }) })
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [src, pdf])

  if (!src) return { src: "", pdf: false, loading: false }
  if (!pdf) return { src, pdf: false, loading: false }
  const ready = done && done.key === src ? done.url : null
  // An unrenderable PDF resolves to "" rather than the .pdf URL: handing that to an <img>
  // is what produced the broken thumbnail this exists to remove.
  return { src: ready ?? "", pdf: true, loading: !done || done.key !== src }
}
