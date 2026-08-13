/**
 * READ THE RECIPIENT OFF A CARRIER LABEL, in the browser, before it is sent anywhere.
 *
 * An external label arrives as a PDF with no order behind it, so the dispatch queue has
 * nothing to put in its Customer and Ship-to columns — the two things that tell the floor
 * which parcel on the bench this row is. The label itself says both, in print, and the
 * file is already in the browser: parsing it here costs no upload, no round trip and no
 * dependency on the API box.
 *
 * WHAT THIS CANNOT DO, said plainly because it decides whether you get an answer at all:
 * a PDF only has text if it was GENERATED as text. Plenty of labels are a photograph or a
 * flattened scan wrapped in a PDF — pixels, no characters — and of the three sample labels
 * in this repo, two are exactly that. There is nothing to read in those, and no heuristic
 * fixes it; it would take OCR, which is a different feature with a different budget. Those
 * come back `no-text`, and the caller must show that as "couldn't read", never as blank.
 *
 * EVERYTHING HERE IS A SUGGESTION. Same rule as the artwork matcher: the machine proposes,
 * a human confirms. Nothing parsed out of a label is written anywhere the floor treats as
 * fact until someone has seen it on screen.
 */

/** Where the parse got to. Four outcomes, because "blank" has four different causes and
 *  they need four different sentences on screen. */
export type LabelParseReason = "ok" | "no-text" | "no-ship-to" | "failed"

export type LabelParse = {
  /** The addressee's name, as printed. */
  name: string | null
  /** Street lines and the city/state/zip line, in reading order. */
  addressLines: string[]
  /** "CITY, ST, ZIP" — the same shape the queue's Ship-to column uses for real orders,
   *  so a merged table doesn't hold two different address formats. */
  shipTo: string | null
  /** The tracking number if the label prints one in text. */
  tracking: string | null
  /** Pages in the file — what the queue counts as Units for an external label. */
  pages: number
  reason: LabelParseReason
}

const EMPTY: LabelParse = { name: null, addressLines: [], shipTo: null, tracking: null, pages: 0, reason: "failed" }

/** One rendered line: the text of every glyph run sharing a baseline, left to right. */
type Line = { y: number; x: number; text: string }

/**
 * pdf.js, loaded only when a label is actually dropped.
 *
 * A static import would put ~1MB of PDF machinery in the dispatch bundle for a feature
 * most sessions never touch. The worker URL is resolved through `import.meta.url` because
 * that is the form both bundlers understand; pointing `workerSrc` at a bare specifier
 * gets you a 404 at parse time, which surfaces as every label failing at once.
 */
let pdfjs: typeof import("pdfjs-dist") | null = null
/** Exported so artwork previews can reuse this loader rather than repeat the legacy-build
 *  and worker-URL decisions documented above — getting either wrong fails silently. */
export async function loadPdfjs() {
  if (pdfjs) return pdfjs
  // THE LEGACY BUILD, deliberately. pdfjs-dist v5's default build calls Promise.try and
  // Uint8Array.prototype.toHex — Chrome 128 and Chrome 140 respectively — and a floor
  // machine on anything older would fail every label with no clue why, because this
  // module swallows the error by design. Legacy is transpiled and polyfilled, costs a few
  // tens of KB in a chunk that only loads when a label is dropped, and has the useful
  // side effect of running under node, which is how the parser is actually tested.
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs")
  // Only if nobody has said otherwise. The bundler rewrites this specifier through module
  // resolution; a plain node runner does not, so a harness driving this module directly
  // sets the real path first and this leaves it alone.
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
  }
  pdfjs = lib
  return lib
}

/** Glyph runs → lines. pdf.js hands back positioned fragments, and a printed address line
 *  is often several of them; anything sharing a baseline within 2pt is one line. */
function toLines(items: { str: string; transform: number[] }[]): Line[] {
  const out: Line[] = []
  for (const it of items) {
    const s = it.str
    if (!s || !s.trim()) continue
    const x = it.transform[4], y = it.transform[5]
    const near = out.find((l) => Math.abs(l.y - y) <= 2)
    if (near) {
      near.text += (near.text.endsWith(" ") || s.startsWith(" ") ? "" : " ") + s.trim()
      near.x = Math.min(near.x, x)
    } else out.push({ y, x, text: s.trim() })
  }
  // PDF y grows upward, so descending y is top-to-bottom on the page.
  return out.sort((a, b) => b.y - a.y)
}

/** USPS prints the marker as two lines ("SHIP" / "TO:"), UPS and FedEx as one. Both, and
 *  the bare "TO:" some brokers use, resolve to the same anchor. */
const SHIP_TO = /^ship\s*to:?$/i
const SHIP = /^ship:?$/i
const TO = /^to:?$/i

/** Lines that are never part of an address, and that sit close enough below one to be
 *  swept up by a purely geometric window. */
const NOT_ADDRESS =
  /^(usps|ups|fedex|dhl)\b|tracking|^\d{4}[\s\d]{10,}$|postage|^zone\b|^commercial\b|priority|ground advantage|first[- ]class|^electronic|^rate\b|^\d{1,2}\s*(oz|lb)s?\b|^c\d{3}\b|^ref\b/i

/** CITY ST ZIP, the last line of a US address — the only line whose shape is reliable
 *  enough to key on, which is why it is what ends the block. */
const CITY_STATE_ZIP = /^(.+?)[,\s]+([A-Z]{2})[,\s]+(\d{5}(?:-\d{4})?)\s*$/

/** Tracking numbers as carriers print them: USPS 20-22 digits in groups, UPS 1Z…, FedEx 12/15. */
const TRACKING = /\b(1Z[0-9A-Z]{16}|(?:\d[\s-]?){19,25}\d|\d{12}|\d{15})\b/

function findTracking(lines: Line[]): string | null {
  for (const l of lines) {
    if (/tracking/i.test(l.text)) {
      // The number is usually on the NEXT line, not this one.
      const i = lines.indexOf(l)
      for (const cand of [l, lines[i + 1], lines[i + 2]]) {
        const m = cand && TRACKING.exec(cand.text.replace(/tracking\s*#?:?/i, ""))
        if (m) return m[1].replace(/[\s-]/g, "")
      }
    }
  }
  for (const l of lines) {
    const m = TRACKING.exec(l.text)
    if (m && m[1].replace(/[\s-]/g, "").length >= 12) return m[1].replace(/[\s-]/g, "")
  }
  return null
}

/**
 * The recipient block, found by anchoring on the SHIP TO marker rather than by guessing
 * at coordinates.
 *
 * The sender's address is on the same label and looks identical — the only thing that
 * separates them is that one of them is under the marker. On a USPS label the marker sits
 * to the LEFT of the block and the sender sits ABOVE it; taking everything below the
 * marker's baseline, within a hand's width, gets the addressee and leaves the sender.
 */
function recipientBlock(lines: Line[]): { name: string | null; addressLines: string[] } {
  let anchorY: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text
    if (SHIP_TO.test(t)) { anchorY = lines[i].y; break }
    // Split marker: "SHIP" over "TO:". NOT lines[i+1] — the marker sits to the LEFT of the
    // block it labels, so the addressee's name is typeset BETWEEN the two halves and comes
    // next in reading order. Measured on a real USPS Ground Advantage label: SHIP at y=248,
    // "AARON PASCUAL" at 244, TO: at 239. Look a few lines down and a few points down.
    if (SHIP.test(t) && lines.slice(i + 1, i + 4).some((l) => TO.test(l.text) && lines[i].y - l.y <= 16)) {
      anchorY = lines[i].y; break
    }
  }
  if (anchorY === null) return { name: null, addressLines: [] }

  // A shade above the anchor as well as below it: the marker and the first line of the
  // block are often typeset on the same baseline give or take a couple of points.
  const band = lines.filter((l) =>
    l.y <= anchorY + 6 && l.y >= anchorY - 80 &&
    !SHIP_TO.test(l.text) && !SHIP.test(l.text) && !TO.test(l.text) &&
    !NOT_ADDRESS.test(l.text))

  const block: string[] = []
  let prevY: number | null = null
  for (const l of band) {
    // A gap much larger than the block's own line spacing means the address ended and
    // something else began — stop rather than reach for whatever is down there.
    if (prevY !== null && prevY - l.y > 26) break
    block.push(l.text)
    prevY = l.y
    if (CITY_STATE_ZIP.test(l.text)) break   // the address is over; nothing follows it
    if (block.length >= 5) break
  }
  if (!block.length) return { name: null, addressLines: [] }
  return { name: block[0], addressLines: block.slice(1) }
}

/** "CITY, ST, ZIP" from the last address line, matching how the queue prints a real
 *  order's ship-to. Null when the line isn't a US city/state/zip — an international
 *  address is shown whole rather than forced into a shape it doesn't have. */
function shipToOf(addressLines: string[]): string | null {
  for (let i = addressLines.length - 1; i >= 0; i--) {
    const m = CITY_STATE_ZIP.exec(addressLines[i])
    if (m) return `${m[1].trim().toUpperCase()}, ${m[2]}, ${m[3]}`
  }
  return addressLines.length ? addressLines[addressLines.length - 1] : null
}

/**
 * Read one label PDF. Never throws — a file that can't be parsed is a normal outcome on
 * this screen, not an error the caller should have to catch.
 */
export async function readLabelPdf(file: File): Promise<LabelParse> {
  try {
    const lib = await loadPdfjs()
    const data = new Uint8Array(await file.arrayBuffer())
    const doc = await lib.getDocument({ data }).promise
    const pages = doc.numPages
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const items = content.items.filter((i): i is import("pdfjs-dist/types/src/display/api").TextItem => "str" in i)
    const lines = toLines(items)
    if (!lines.length) return { ...EMPTY, pages, reason: "no-text" }

    const { name, addressLines } = recipientBlock(lines)
    const tracking = findTracking(lines)
    if (!name) return { ...EMPTY, pages, tracking, reason: "no-ship-to" }
    return { name, addressLines, shipTo: shipToOf(addressLines), tracking, pages, reason: "ok" }
  } catch {
    return { ...EMPTY, reason: "failed" }
  }
}

/** One sentence for each way the parse can come back short, for the row that has to say
 *  why it has no customer. Never used for `ok`. */
/* Short enough to survive the Customer column, which is 6.5rem at its narrowest — the long
   versions were all cut off at "can'…", which reads as a rendering fault rather than a
   fact. The full sentence lives in the cell's title. */
export const PARSE_NOTE: Record<Exclude<LabelParseReason, "ok">, string> = {
  "no-text": "Scanned image — no text",
  "no-ship-to": "No “Ship to” on label",
  failed: "Couldn't open PDF",
}

/** The same four outcomes, at length, for the hover title. */
export const PARSE_WHY: Record<Exclude<LabelParseReason, "ok">, string> = {
  "no-text": "This label is a picture with no text in it, so there is nothing to read. Type the customer in by hand, or re-export the label from wherever it came from.",
  "no-ship-to": "The label has text but no “Ship to” block we could find — some brokers lay it out differently.",
  failed: "This PDF couldn't be opened at all. It may be damaged or password-protected.",
}
