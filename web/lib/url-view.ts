"use client"

import { useEffect, useRef } from "react"

/**
 * A LIST REMEMBERS ITS VIEW IN THE ADDRESS (owner, 2026-09-26: "I go to check the order
 * detail and it jumps to the first page").
 *
 * The page, the tab, the search and the sort lived in component state, and component state
 * dies when you navigate to an order — so Back rebuilt the list from nothing: page 1, tab
 * All, search empty. Not a cache we were missing; the view simply had nowhere to live.
 *
 * The address is that place, and it is better than a cache on every count: Back returns to
 * it, a refresh keeps it, and a copied link opens the same page of the same filter.
 *
 * HOW IT STAYS HONEST
 *   · READ ONCE, AFTER MOUNT. The server renders the defaults; reading the address during the
 *     first render would make the client's first paint disagree with the server's.
 *   · WRITTEN WITH replaceState, never push — twelve page-flips are not twelve Back presses.
 *   · NOTHING IS WRITTEN UNTIL THE READ HAS HAPPENED. The mirror runs on the first render too,
 *     and writing the defaults then would wipe the very address it was about to restore.
 *   · Only its OWN keys are touched; anything else in the address (?view=…) is left alone.
 *   · It only mirrors state. Nothing here fetches (§2.8).
 */

export const readParams = () =>
  new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)

/** Set or clear keys in the address without adding a history entry. "" / null removes. */
export function writeParams(patch: Record<string, string | null | undefined>) {
  if (typeof window === "undefined") return
  const u = new URL(window.location.href)
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") u.searchParams.delete(k)
    else u.searchParams.set(k, v)
  }
  const next = u.pathname + u.search + u.hash
  const now = window.location.pathname + window.location.search + window.location.hash
  if (next !== now) window.history.replaceState(window.history.state, "", next)
}

/**
 * Restore a view from the address once, then keep the address in step with it.
 *
 * `encode` turns the current view into its keys (every key it owns, "" for a default, so a
 * cleared filter leaves the address too). `restore` receives the address once, after mount.
 * `deps` are the state that makes up the view.
 */
export function useUrlView(
  encode: () => Record<string, string | null | undefined>,
  restore: (p: URLSearchParams) => void,
  deps: unknown[],
) {
  const restored = useRef(false)
  const restoreRef = useRef(restore)
  const encodeRef = useRef(encode)
  useEffect(() => { restoreRef.current = restore; encodeRef.current = encode })

  useEffect(() => {
    /* Deferred a tick, the pattern this app uses for state set on mount (the
       set-state-in-effect rule). */
    const t = setTimeout(() => {
      restoreRef.current(readParams())
      restored.current = true
    }, 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!restored.current) return
    writeParams(encodeRef.current())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` IS the dependency list
  }, deps)
}
