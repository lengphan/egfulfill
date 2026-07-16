"use client"

import { useEffect, useRef } from "react"
import JsBarcode from "jsbarcode"

// A Code-128 barcode of the given value (usually a SKU), rendered to inline SVG.
export function Barcode({ value, height = 40, width = 1.5, fontSize = 11, displayValue = true, className }: {
  value: string
  height?: number
  width?: number
  fontSize?: number
  displayValue?: boolean
  className?: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, { format: "CODE128", height, width, fontSize, margin: 4, displayValue, lineColor: "#111827" })
    } catch { /* invalid value → leave empty */ }
  }, [value, height, width, fontSize, displayValue])
  return <svg ref={ref} className={className} />
}
