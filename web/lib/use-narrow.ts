"use client"

import { useSyncExternalStore } from "react"

/**
 * Is the viewport narrow enough to need a stacked layout?
 *
 * useSyncExternalStore rather than useState + useEffect: subscribing to matchMedia in an
 * effect and calling setState from it is exactly the `react-hooks/set-state-in-effect`
 * pattern this codebase avoids, and it renders one frame at the wrong width before
 * correcting — which on a table means a flash of a 1224px row on a phone.
 *
 * The server snapshot is `false` (desktop). It has to be a stable value, not a guess at the
 * device: returning anything derived from `window` here is a hydration mismatch.
 */
const QUERY = "(max-width: 767px)"   // Tailwind's md breakpoint, so CSS and JS agree

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
