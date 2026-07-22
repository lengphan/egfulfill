"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"

/**
 * A QR of the given value, as inline SVG.
 *
 * Sits beside Barcode rather than replacing it, because the two are read by different
 * things. A scanner gun reads Code-128 off a printed sticker at speed and cannot read a
 * QR at all. A phone camera reads a QR from any angle, at a distance, half-lit — and
 * struggles with a 1D barcode unless it is held straight, close and flat, which is
 * exactly what someone holding a phone in one hand and a garment in the other cannot do.
 *
 * SVG, not canvas: these get printed, and a raster QR scaled onto a 2×1 sticker prints
 * soft edges that a decoder reads as noise.
 *
 * Error correction is deliberately LOW. QR carries redundancy so a damaged code still
 * decodes, but higher levels spend that on more modules — and on a small sticker more
 * modules means each one is physically tinier, which is the failure that actually
 * happens here. A SKU is short; the density is the constraint, not the durability.
 */
export function QrCode({ value, className, margin = 1 }: {
  value: string
  className?: string
  /** Quiet zone in modules. Zero looks tidy and stops some decoders finding the code at
   *  all, so 1 is the floor rather than the default. */
  margin?: number
}) {
  const [svg, setSvg] = useState<string | null>(null)
  // State, not a ref: whether generation failed is rendered, so it has to be able to
  // trigger a re-render. A ref read during render is stale by definition.
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    QRCode.toString(value || " ", {
      type: "svg",
      errorCorrectionLevel: "L",
      margin: Math.max(1, margin),
      // Colour comes from CSS below so the code inherits print/dark surfaces; QRCode's
      // own colour options would bake it in.
      color: { dark: "#000000", light: "#00000000" },
    })
      .then((s) => { if (live) { setFailed(false); setSvg(s) } })
      .catch(() => { if (live) { setFailed(true); setSvg(null) } })
    return () => { live = false }
  }, [value, margin])

  if (!svg) {
    // Never render an empty box that looks like a code. A blank square on a sticker gets
    // printed, stuck to a garment, and discovered at the scanner.
    return (
      <div className={"flex items-center justify-center text-[7px] text-muted-foreground " + (className ?? "")}>
        {failed ? "QR failed" : ""}
      </div>
    )
  }
  // eslint-disable-next-line react/no-danger -- the markup is produced by qrcode, not by user input
  return <div className={className} aria-label={`QR code for ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />
}
