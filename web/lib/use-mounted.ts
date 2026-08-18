"use client"

import { useSyncExternalStore } from "react"

const noop = () => () => {}

/**
 * False during SSR and the hydrating render, true afterwards.
 *
 * For anything the server cannot know: the signed-in user (localStorage), the visitor's
 * locale and timezone, the viewport. Rendering those directly is a hydration mismatch —
 * React re-renders the whole tree and logs an error, and the two versions can differ
 * visibly for a frame.
 *
 * useSyncExternalStore rather than useState + useEffect: React uses the SERVER snapshot for
 * hydration and swaps to the client one immediately after, which is exactly the handoff
 * this needs — and it never sets state from an effect, so it doesn't trip
 * `react-hooks/set-state-in-effect`.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false)
}
