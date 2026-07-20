// Loads the factory's cone stock into the matcher's active palette.
//
// Kept OUT of thread-match.ts on purpose: that module is pure canvas + colour maths
// with no network, which is what makes it testable by driving it directly. This is the
// thin seam that connects it to the API.
import { getThreadPalette } from "@/lib/api"
import { setActivePalette } from "@/lib/thread-match"

let inflight: Promise<void> | null = null

/**
 * Idempotent — several surfaces thread-match (mini designer, order board, thread map)
 * and each wants the real palette, but the fetch should happen once per session.
 * Failure is deliberately silent: matching still works against the starter palette, so
 * a blip degrades quality rather than breaking the feature.
 */
export function loadThreadPalette(): Promise<void> {
  if (inflight) return inflight
  inflight = getThreadPalette()
    .then((p) => { setActivePalette(p) })
    .catch(() => { /* keep the built-in starter palette */ })
  return inflight
}

/** Call after an admin/warehouse edit so open boards pick up the new stock. */
export function refreshThreadPalette(): Promise<void> {
  inflight = null
  return loadThreadPalette()
}
