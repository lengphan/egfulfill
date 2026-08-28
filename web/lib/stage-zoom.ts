"use client"

import { useCallback, useState } from "react"

/**
 * ZOOM THE VIEW, NEVER THE ARTWORK.
 *
 * This is a `scale()` on a wrapper AROUND the stage and it must stay that way. The artwork's
 * placement is stored as percentages of the stage, so anything that reached `pos` to make
 * the picture bigger would silently resize what gets PRINTED — a person zooming in to check
 * a seam would come away with a larger print and no sign it happened. Scaling the wrapper
 * cannot do that: the percentages are unchanged, and the stage's own drag maths reads
 * `getBoundingClientRect`, which reports the scaled box, so a layer dragged at 200% still
 * lands under the pointer.
 *
 * Lifted out of design-maker.tsx, where it already worked. The order designer had no zoom at
 * all — the one gesture every editor answers did nothing on the surface where placement
 * actually gets judged.
 */
export function useStageZoom(enabled = true) {
  const [zoom, setZoom] = useState(1)

  /**
   * A CALLBACK REF, not `useRef` + an effect.
   *
   * The order designer lives inside a portalled Dialog, so on the render that mounts this
   * hook the stage is not in the document yet — an effect reading `ref.current` finds null,
   * returns early, and never runs again because nothing it depends on changed. The gesture
   * silently did nothing, and only on that surface: the Maker is not portalled, which is
   * exactly why this worked there and had to be proved here rather than assumed.
   *
   * React calls a callback ref with the node the moment it lands, and calls the returned
   * cleanup when it leaves or when this callback's identity changes — which is what makes
   * `enabled` safe to close over.
   */
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || !enabled) return
    /**
     * Attached by hand rather than through React's `onWheel`: React registers wheel at the
     * root as PASSIVE, so `preventDefault` there is ignored and the page scrolls behind the
     * zoom — the gesture appears to do both things at once.
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Exponential, so one notch feels the same at 40% as it does at 300%.
      setZoom((z) => Math.min(3, Math.max(0.4, z * Math.pow(0.9985, e.deltaY))))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [enabled])

  const reset = useCallback(() => setZoom(1), [])
  return {
    zoom,
    reset,
    ref,
    /** Undefined at 1 rather than `scale(1)`: an identity transform still creates a
     *  containing block, which re-anchors any `fixed` descendant to this element. */
    style: zoom === 1 ? undefined : ({ transform: `scale(${zoom})` } as const),
  }
}
