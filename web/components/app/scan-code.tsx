"use client"

import { useEffect, useRef, useState } from "react"

/**
 * A QR code, for scanning a SKU off a SCREEN.
 *
 * Code-128 is right for a printed label and wrong for a phone screen. "47-BRA-TRA-BLK-
 * ADJUSTABLE" encodes to 310 Code-128 modules; in the 247px-wide enlarge overlay that is
 * 0.80px per bar, and a camera needs roughly 2px. It was not that the camera was broken —
 * the image was physically unreadable, and no amount of decoder work would have changed
 * that. The same SKU as a QR is 29 modules: 8.5px each in the same box.
 *
 * Rendered with @zxing/library's writer, which is already installed as a dependency of
 * @zxing/browser (the decoder), so this adds nothing to install and nothing to the CSP.
 * Loaded on demand — the writer is only needed when someone opens the enlarge overlay.
 */
export function ScanQr({ value, size = 260, className }: { value: string; size?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    const host = ref.current
    if (!host || !value) return
    ;(async () => {
      try {
        const { MultiFormatWriter, BarcodeFormat, EncodeHintType } = await import("@zxing/library")
        if (!alive) return
        const hints = new Map()
        // A quiet zone is part of the symbol, not padding — without it the finder
        // patterns run into whatever is behind them and decoding fails.
        hints.set(EncodeHintType.MARGIN, 2)
        const matrix = new MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0, hints)
        const side = matrix.getWidth()
        // Built as one SVG path of filled squares rather than an element each: a 29×29
        // grid is 841 nodes, and the browser paints one path far more cheaply.
        let d = ""
        for (let y = 0; y < side; y++) {
          for (let x = 0; x < side; x++) {
            if (matrix.get(x, y)) d += `M${x} ${y}h1v1h-1z`
          }
        }
        if (!alive) return
        host.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
          `width="${size}" height="${size}" shape-rendering="crispEdges" role="img" ` +
          `aria-label="QR code for ${value.replace(/[<>&"]/g, "")}">` +
          `<rect width="${side}" height="${side}" fill="#fff"/>` +
          `<path d="${d}" fill="#111827"/></svg>`
      } catch {
        if (alive) setErr(true)
      }
    })()
    return () => { alive = false }
  }, [value, size])

  if (err) return <p className="text-xs text-muted-foreground">Couldn&apos;t render a code for {value}.</p>
  return <div ref={ref} className={className} style={{ width: size, height: size }} />
}
