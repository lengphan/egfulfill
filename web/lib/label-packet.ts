import { pdfFirstPageDataUrl } from "@/lib/pdf-preview"
import { slipHtml } from "@/lib/packing-slip"
import { numOf } from "@/lib/order-format"
import type { OrderRow } from "@/lib/api"

/**
 * THE LABEL AND THE SLIP, AS ONE PRINT JOB.
 *
 * These are two documents that are always wanted together and were always printed apart:
 * the label fires the browser's print dialog on its own, and the slip needs a second window
 * — which a popup blocker stops, and which otherwise leaves two dialogs fighting over the
 * same printer. Two dialogs for one parcel is the thing to remove.
 *
 * So both go into ONE document, label first, and the printer is asked once. Page one is the
 * postage, page two is the pick list, `page-break-after` between them.
 *
 * THE LABEL IS RASTERISED, deliberately. Merging PDFs properly would need a writer library
 * (pdf-lib); rendering the label to an image needs only the pdf.js already here. That trade
 * would be wrong for an archival document and is fine for this one: these print to a 203 dpi
 * thermal, and the label is rendered at 300 — above the resolution the printer can put on
 * the paper, so the barcode gains nothing from staying vector. If labels ever go to a
 * higher-fidelity device, swap this for a real merge rather than raising the DPI forever.
 */

/** 300 dpi across a 6in page — the long edge of a 4×6 label. */
const LABEL_PX = 1800

const PACKET_CSS = `<style>
    *{box-sizing:border-box}
    body{margin:0;font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111}
    .page{width:4in;height:6in;page-break-after:always;overflow:hidden}
    /* The label fills its page and keeps its proportions — a stretched barcode is an
       unscannable barcode, so contain rather than cover, always. */
    .page.label{display:flex;align-items:center;justify-content:center}
    .page.label img{max-width:100%;max-height:100%;object-fit:contain;display:block}
    /* The slip markup carries its own .slip rule from lib/packing-slip; this only stops it
       adding a THIRD blank page after the last one. */
    .slip{page-break-after:auto}
    @page{size:4in 6in;margin:0}
</style>`

/**
 * Print a document WITHOUT opening a window.
 *
 * window.open only works inside a live user gesture. Buying a label takes seconds — the
 * carrier round-trip, then rendering the PDF — so by the time a packet is ready the click
 * that started it is long gone and Chrome blocks the popup silently. That is why the
 * automatic print stopped happening at all: not an error, just nothing.
 *
 * A same-origin iframe has no such restriction. It is written into this document, printed,
 * and removed. srcdoc rather than document.write so the content is parsed as one unit and
 * `load` genuinely means "ready to print".
 */
export function printHtmlViaIframe(html: string): Promise<void> {
  return new Promise((resolve) => {
    const f = document.createElement("iframe")
    // Offscreen, NOT display:none — a frame that was never laid out has nothing to print.
    f.setAttribute("aria-hidden", "true")
    f.style.cssText = "position:fixed;left:-9999px;top:0;width:4in;height:6in;opacity:0;pointer-events:none"
    f.srcdoc = html
    f.onload = () => {
      const w = f.contentWindow
      if (!w) { f.remove(); resolve(); return }
      const go = () => {
        try { w.focus(); w.print() } catch { /* nothing more to try */ }
        // Left in the DOM briefly: removing it while the print dialog is still reading the
        // document gives a blank sheet in some browsers.
        setTimeout(() => f.remove(), 60_000)
        resolve()
      }
      const imgs = Array.from(w.document.images)
      const pending = imgs.filter((i) => !i.complete)
      if (!pending.length) go()
      else {
        let left = pending.length
        pending.forEach((i) => i.addEventListener("load", () => { if (--left === 0) go() }, { once: true }))
        // A decode that never finishes must not mean a label that never prints.
        setTimeout(go, 8000)
      }
    }
    document.body.appendChild(f)
  })
}

/** The packet as markup, so it can be printed through an iframe (no popup) or embedded. */
export async function packetHtml(items: { labelBlobUrl: string; order: OrderRow | null }[]): Promise<{ html: string; skipped: string[] }> {
  const pages: string[] = []
  const skipped: string[] = []
  for (const it of items) {
    const png = await pdfFirstPageDataUrl(it.labelBlobUrl, LABEL_PX)
    if (!png) { skipped.push(it.order ? numOf(it.order) : "?"); continue }
    pages.push(`<div class="page label"><img src="${png}" alt="Shipping label"/></div>`)
    if (it.order) pages.push(slipHtml([it.order]))
  }
  return {
    html: `<!doctype html><html><head><title>Labels</title>${PACKET_CSS}</head><body>${pages.join("")}</body></html>`,
    skipped,
  }
}
