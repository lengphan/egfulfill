"use client"

import { useEffect, useState } from "react"
import { MagnifyingGlassPlus, Check } from "@phosphor-icons/react"

import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { ZOOM_LEVELS, DEFAULT_ZOOM, loadZoom, applyZoom, zoomLabel } from "@/lib/zoom"

/**
 * Content zoom, in the top bar beside the theme toggle.
 *
 * A menu of fixed levels rather than a −/+ stepper: the stepper needs three controls (out,
 * the current value, in) for a setting most people touch once, and the top bar is already a
 * row of single icons.
 *
 * The badge only appears when zoom is NOT 100%. A control that always shows a number reads
 * as a status readout you have to interpret; one that speaks up only when something is set
 * is how you notice you left the page at 150% yesterday.
 */
export function ZoomControl() {
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM)

  // Read AFTER mount. localStorage doesn't exist during SSR, and reading it in render would
  // hand the server and the client two different trees.
  useEffect(() => {
    const t = setTimeout(() => setZoom(applyZoom(loadZoom())), 0)
    return () => clearTimeout(t)
  }, [])

  const pick = (z: number) => setZoom(applyZoom(z))
  const on = zoom !== DEFAULT_ZOOM

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Content zoom (${zoomLabel(zoom)})`}
        title={`Content zoom — ${zoomLabel(zoom)}`}
        className={
          "eg-tap relative inline-flex size-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
          (on ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")
        }
      >
        <MagnifyingGlassPlus size={18} />
        {on && (
          <span className="absolute -bottom-0.5 -right-0.5 rounded bg-primary px-1 text-2xs font-bold leading-[1.4] text-primary-foreground">
            {Math.round(zoom * 100)}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 p-1">
        {/* Label INSIDE the Group — Base UI throws on a GroupLabel outside one, which blanks
            the page rather than misrendering a heading. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1 text-2xs text-muted-foreground">Content zoom</DropdownMenuLabel>
          {ZOOM_LEVELS.map((z) => (
            <DropdownMenuItem key={z} onClick={() => pick(z)} className="flex items-center gap-2 text-sm">
              <Check size={12} weight="bold" className={z === zoom ? "text-primary" : "opacity-0"} />
              <span>{zoomLabel(z)}</span>
              {z === DEFAULT_ZOOM && <span className="ml-auto text-2xs text-muted-foreground">default</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
