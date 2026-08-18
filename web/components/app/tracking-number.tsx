"use client"

import { useState } from "react"
import { Copy, Check, ArrowSquareOut } from "@phosphor-icons/react"
import { trackUrl } from "@/lib/order-format"

/**
 * A TRACKING NUMBER YOU CAN ACTUALLY TAKE WITH YOU.
 *
 * It was 22 characters of grey mono, selectable only by dragging across them without
 * catching the line above — and the one thing anyone does with a tracking number is put it
 * somewhere else: into a message to a buyer, into a carrier's own site, into a spreadsheet.
 *
 * Two actions, both one press: COPY the number, or OPEN the carrier's page for it. Nothing
 * is hidden behind a hover, because a number you cannot see the controls for is one you
 * drag-select anyway.
 *
 * The tick REPLACES the copy mark for a moment rather than appearing beside it — a
 * confirmation that adds an element makes the row jump, and a row that jumps under the
 * cursor is one you misclick.
 */
export function TrackingNumber({ carrier, tracking }: { carrier?: string | null; tracking?: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!tracking) return null
  const url = trackUrl(carrier, tracking)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tracking)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* A refused clipboard (an insecure origin, a locked-down browser) leaves the number
         on screen and selectable, which is the fallback that always worked. */
    }
  }

  return (
    <span className="mt-0.5 inline-flex items-center gap-1">
      {/* select-all so one click still selects the whole number for anyone who prefers to
          drag — the button is the shortcut, not the only way. */}
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied" : "Copy this tracking number"}
        className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span className="select-all">{tracking}</span>
        {copied
          ? <Check size={12} weight="bold" className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          : <Copy size={12} className="shrink-0 opacity-60" />}
      </button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Track this on ${carrier || "the carrier"}'s site`}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowSquareOut size={12} weight="bold" />
        </a>
      )}
    </span>
  )
}
