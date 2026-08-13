import { pdfFirstPageDataUrl } from "@/lib/pdf-preview"
import { slipHtml } from "@/lib/packing-slip"
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

export async function printLabelPacket(labelBlobUrl: string, order: OrderRow | null): Promise<string | null> {
  // The label first: if it cannot be rendered there is no packet worth opening, and the
  // caller still has its own "Print again" path to fall back on.
  const labelPng = await pdfFirstPageDataUrl(labelBlobUrl, LABEL_PX)
  if (!labelPng) return "Couldn't read the label file to print it."

  const slip = order ? slipHtml([order]) : ""
  const w = window.open("", "_blank")
  if (!w) return "Your popup blocker stopped the print window — allow popups for this site."

  w.document.write(`<!doctype html><html><head><title>Label + packing slip</title><style>
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
  </style></head><body>
    <div class="page label"><img src="${labelPng}" alt="Shipping label"/></div>
    ${slip}
  </body></html>`)
  w.document.close()
  w.focus()
  // Wait for the image to be decoded before printing — printing a document whose only
  // element has not loaded yields a blank first page, which is worse than a slow one.
  const go = () => { try { w.print() } catch { /* the window is still usable by hand */ } }
  const img = w.document.querySelector("img")
  if (img && !(img as HTMLImageElement).complete) img.addEventListener("load", go, { once: true })
  else go()
  return null
}
