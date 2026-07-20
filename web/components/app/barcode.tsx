"use client"

import { useEffect, useRef } from "react"
import JsBarcode from "jsbarcode"

// A Code-128 barcode of the given value (usually a SKU), rendered to inline SVG.
//
// `fit`: JsBarcode stamps a FIXED pixel width on the <svg> and gives it no viewBox,
// so a long SKU (47-BRA-TRA-BLK-ADJUSTABLE ≈ 450px) simply overflows its container —
// on the label sheet the bars ran across the card borders and the printed code was
// clipped, i.e. unscannable. With `fit` we copy the natural size into a viewBox and
// let CSS size it, so it scales down to the label. It stays vector (print is crisp)
// and uniform scaling preserves the bar RATIOS, which is what a scanner reads.
export function Barcode({ value, height = 40, width = 1.5, fontSize = 11, displayValue = true, fit = false, stretch = false, className }: {
  value: string
  height?: number
  width?: number
  fontSize?: number
  displayValue?: boolean
  fit?: boolean
  /** Fill the parent's height instead of deriving it from the aspect ratio. Bars scale
   *  uniformly in X (relative widths preserved, so it still scans) while Y is free —
   *  which is what a fixed-height sticker needs. Without it a wide code renders tall
   *  enough to push everything else off the label. */
  stretch?: boolean
  className?: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const svg = ref.current
    if (!svg || !value) return
    try {
      JsBarcode(svg, value, { format: "CODE128", height, width, fontSize, margin: 4, displayValue, lineColor: "#111827" })
      if (fit) {
        const w = svg.getAttribute("width")
        const h = svg.getAttribute("height")
        if (w && h) {
          svg.setAttribute("viewBox", `0 0 ${w} ${h}`)
          svg.setAttribute("preserveAspectRatio", stretch ? "none" : "xMidYMid meet")
          svg.removeAttribute("width")
          svg.removeAttribute("height")
          svg.style.width = "100%"
          svg.style.height = stretch ? "100%" : "auto"
        }
      }
    } catch { /* invalid value → leave empty */ }
  }, [value, height, width, fontSize, displayValue, fit, stretch])
  return <svg ref={ref} className={className} />
}
