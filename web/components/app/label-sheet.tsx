"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Printer, Minus, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Barcode } from "@/components/app/barcode"
import { QrCode } from "@/components/app/qr-code"
import { prettyColorName } from "@/lib/color-name"

export type LabelSpec = { sku: string; name?: string | null; variant?: string | null; copies?: number }

/**
 * The ONE printable barcode sheet. Inventory prints selected variants; the Orders
 * hub prints the blanks a specific order needs. Both land here so a label looks
 * identical wherever it came from — and so the print CSS lives in one place.
 *
 * `copies` is per label: a variant needing 12 pieces prints 12 identical barcodes,
 * which is what actually happens on the floor.
 */
/** "031753A - Blk/Dk.Grn/Dk.Kha · OSFM" → "Black/Dark Green/Dark Khaki · OSFM". */
function prettyVariant(v: string): string {
  return v.split("·").map((part) => prettyColorName(part.trim())).join(" · ")
}

type StockId = "2x1" | "2.25x1.25" | "3x2" | "4x6" | "a4"
/** Physical label stock. Dimensions are what gets written into @page, so what you see in
 *  the preview is the sheet the printer is handed. */
const STOCKS: { id: StockId; label: string; w: number; h: number }[] = [
  { id: "2x1", label: '2" × 1"', w: 2, h: 1 },
  { id: "2.25x1.25", label: '2.25" × 1.25" (Dymo)', w: 2.25, h: 1.25 },
  { id: "3x2", label: '3" × 2"', w: 3, h: 2 },
  { id: "4x6", label: '4" × 6" (shipping)', w: 4, h: 6 },
  { id: "a4", label: "A4 sheet (multi-up)", w: 8.27, h: 11.69 },
]

export function LabelSheet({
  labels,
  open,
  onClose,
  title = "labels",
}: {
  labels: LabelSpec[]
  open: boolean
  onClose: () => void
  title?: string
}) {
  // Global multiplier on top of each label's own `copies` — for "print the whole
  // sheet twice" without editing every row.
  const [multiplier, setMultiplier] = useState(1)
  // Label stock. A thermal printer feeds ONE label at a time, so the page must BE the
  // label — an A4 grid sent to a 2×1 roll prints one clipped label per sticker and wastes
  // the rest of the roll. Sizes are the common thermal stocks; "A4 sheet" keeps the old
  // multi-up behaviour for anyone printing on a laser.
  const [stock, setStock] = useState<StockId>("2x1")
  /**
   * Barcode or QR — an EXPLICIT choice, defaulted by device rather than decided by it.
   *
   * A gun reads Code-128 and cannot read a QR; a phone camera reads a QR easily and
   * fights a 1D code held at any angle. So a phone should get QR — but these labels are
   * PRINTED and stuck on stock that outlives the session, and letting the output silently
   * depend on which device happened to press print is how a warehouse ends up with two
   * incompatible label formats in one bin. Defaulted, visible, overridable.
   */
  const [codeType, setCodeType] = useState<"barcode" | "qr">("barcode")
  /**
   * WHAT THE STICKER CARRIES: the code, the number, or both.
   *
   * Both is right for a bin label — the gun reads the code, a person reads the number when
   * the gun won't. But a 2×1 that has to hold a long style name is tight, and a code-only
   * sticker frees the height; a number-only one is what goes on something a scanner never
   * sees. One choice, made once, applied to the whole sheet.
   */
  const [content, setContent] = useState<"both" | "code" | "sku">("both")
  useEffect(() => {
    // Coarse pointer = finger. Resolved after mount because matchMedia doesn't exist
    // during prerender and would render a different tree on server than client.
    const t = setTimeout(() => {
      if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) setCodeType("qr")
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const spec = STOCKS.find((s) => s.id === stock) ?? STOCKS[0]
  const oneUp = spec.id !== "a4"
  // Portalled to <body> so print CSS can display:none every OTHER body child. The
  // old rule used `visibility:hidden`, which hides but still RESERVES layout space —
  // the whole app (sidebar, table, stat cards) kept its full height, so a single
  // label printed across 4 mostly-blank pages. display:none is the only way to
  // actually remove it, and that needs the sheet to be a top-level body child.
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => { const id = setTimeout(() => setHost(document.body), 0); return () => clearTimeout(id) }, [])
  if (!open || !host) return null

  // Expand into one entry per physical sticker.
  const sheet: { key: string; l: LabelSpec }[] = []
  labels.forEach((l, i) => {
    const n = Math.max(1, (l.copies ?? 1) * multiplier)
    for (let c = 0; c < n; c++) sheet.push({ key: `${l.sku}-${i}-${c}`, l })
  })

  return createPortal(
    /**
     * A PREVIEW WINDOW, not a page takeover.
     *
     * This filled the whole screen to show six stickers: one label per line down the left
     * edge with the rest of a 27-inch monitor blank, which reads as a broken page rather
     * than a preview. Bounded and centred, the labels tile, and what is on screen is the
     * sheet — the print CSS still flattens this back to plain page content (see globals.css,
     * .eg-print-card / .eg-print-body), so what prints is unchanged.
     */
    <div className="eg-print-root fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/45 p-4 backdrop-blur-sm">
      <div className="eg-print-card flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <span className="font-medium">{sheet.length} {title}</span>
        <span className="text-xs text-muted-foreground">{labels.length} variant{labels.length === 1 ? "" : "s"}</span>

        <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          Copies of each
          <span className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="size-7 p-0" onClick={() => setMultiplier((m) => Math.max(1, m - 1))} aria-label="Fewer copies"><Minus size={12} weight="bold" /></Button>
            <span className="w-6 text-center text-sm font-semibold text-foreground tabular-nums">{multiplier}</span>
            <Button size="sm" variant="outline" className="size-7 p-0" onClick={() => setMultiplier((m) => Math.min(50, m + 1))} aria-label="More copies"><Plus size={12} weight="bold" /></Button>
          </span>
        </label>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
          {/* Which code, said out loud. A gun cannot read a QR and a phone fights a 1D
              code — so the wrong choice here produces a bin of labels nothing can scan,
              and that is not a discovery to make at the scanner. */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Print
            <select
              value={content}
              onChange={(e) => setContent(e.target.value as "both" | "code" | "sku")}
              className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="both">Code + SKU</option>
              <option value="code">Code only</option>
              <option value="sku">SKU only</option>
            </select>
          </label>
          <label className={"flex items-center gap-1.5 text-xs text-muted-foreground " + (content === "sku" ? "hidden" : "")}>
            Code
            <select
              value={codeType}
              onChange={(e) => setCodeType(e.target.value as "barcode" | "qr")}
              className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="barcode">Barcode — scanner guns</option>
              <option value="qr">QR — phone cameras</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Label stock
            <select
              value={stock}
              onChange={(e) => setStock(e.target.value as StockId)}
              className="eg-select h-8 rounded-2xl border border-border bg-card px-2 text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {STOCKS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <Button size="sm" onClick={() => window.print()} disabled={!sheet.length}><Printer size={14} weight="bold" /> Print</Button>
        </div>
      </div>

      <div className="eg-print-body min-h-0 flex-1 overflow-auto bg-muted/30">
      {sheet.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">Nothing selected to print.</div>
      ) : (
        <>
          {/* @page must match the STOCK, or the printer scales/clips to whatever it
              thinks the page is. Injected rather than hardcoded so the preview and the
              print use one source of truth. */}
          <style>{`@media print { @page { size: ${spec.w}in ${spec.h}in; margin: 0; } }`}</style>
          <div className={oneUp ? "print-area flex flex-wrap items-start justify-center gap-4 p-4" : "print-area grid grid-cols-3 gap-3 p-4 sm:grid-cols-4"}>
            {sheet.map(({ key, l }) => (
              <div
                key={key}
                className={
                  "eg-label flex flex-col items-center justify-center gap-0.5 overflow-hidden border border-border bg-white text-center " +
                  (oneUp ? "rounded-none" : "gap-1 rounded p-2")
                }
                // On thermal stock the element IS the label, at true physical size — so
                // what's on screen is what lands on the sticker.
                style={oneUp ? { width: `${spec.w}in`, height: `${spec.h}in`, padding: "0.06in" } : undefined}
              >
                {/* A 2×1 sticker is ~190px: a 60-character marketplace title cannot fit,
                    and truncating mid-word tells the picker nothing. Two clamped lines at
                    a size that stays readable on thermal, with the SKU underneath as the
                    thing that's actually scanned. */}
                <div className="line-clamp-2 w-full text-[8px] font-semibold leading-[1.15]">{l.name || l.sku}</div>
                {l.variant && <div className="line-clamp-1 w-full text-[7px] leading-tight text-muted-foreground">{prettyVariant(l.variant)}</div>}
                {/* fit → scales to the label. A long SKU otherwise renders ~450px wide
                    and spills across the card, printing a clipped, unscannable code. */}
                {content === "sku" ? (
                  // No code at all: the number becomes the label, at a size someone reads
                  // across a shelf rather than the 8px caption it is under a barcode.
                  <div className="flex w-full flex-1 items-center justify-center">
                    <span className="w-full break-all px-1 text-center font-mono text-[13px] font-semibold leading-tight tracking-tight">{l.sku}</span>
                  </div>
                ) : codeType === "qr" ? (
                  // Square, and centred in whatever slice the sticker allows. A QR has no
                  // useful non-square rendering — stretching one stops it decoding.
                  <div className={oneUp ? "flex min-h-0 w-full flex-1 items-center justify-center" : "mx-auto w-full max-w-[7rem]"}>
                    <QrCode value={l.sku} className="aspect-square h-full [&>svg]:size-full" />
                  </div>
                ) : oneUp ? (
                  // Fixed slice of the sticker so the code can never crowd out the text.
                  <div className="w-full flex-1 min-h-0">
                    <Barcode value={l.sku} height={40} displayValue={false} fit stretch className="block size-full" />
                  </div>
                ) : (
                  // JsBarcode stamps the number inside the svg on this path, so "code only"
                  // has to turn it off here rather than by hiding a caption.
                  <Barcode value={l.sku} height={46} displayValue={content === "both"} fit className="mx-auto block w-full max-w-full" />
                )}
                {/* On thermal stock the SKU is drawn HERE, not by JsBarcode: its text is
                    stamped inside the svg and scales down with it, so on a 2×1 the code
                    was legible and the number underneath was clipped mid-digit. */}
                {oneUp && content === "both" && (
                  <div className="w-full truncate font-mono text-[8px] leading-none tracking-tight">{l.sku}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      </div>
      </div>
    </div>,
    host
  )
}
