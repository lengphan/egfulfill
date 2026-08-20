import type { EtsyListing, CatalogProduct } from "@/lib/api"

/**
 * Everything a source can prefill. Whatever it can't fill stays empty and editable.
 *
 * It lives HERE rather than beside the page component because it is the shape of the
 * handoff — what a board promises to hand over — and the page is only its first reader.
 */
export type PublishPrefill = {
  title?: string
  description?: string
  price?: number | string | null
  tags?: string[]
  images?: string[]
  /** LOOK-AT-ONLY photos — the competitor's own shots behind a SpyDeck listing. Shown so a
   *  seller can see what they're making; NEVER published. Kept out of `images` on purpose:
   *  anything in `images` goes to the marketplace, and a set you can see but that silently
   *  doesn't ship is the most misleading arrangement of the three. */
  referenceImages?: string[]
  /** WHY there are so few of them, when there are. A failed detail lookup used to be
   *  indistinguishable from a competitor who genuinely posted one photo: the page just
   *  showed the cover. This carries the reason across the navigation so the Photos panel
   *  can say which it is. Absent means the set is complete. */
  referenceNote?: string
  /** Catalog product to produce this on. Sets the cost side of the margin. */
  blank?: CatalogProduct | null
  /** The variant axes as they were PICKED last time, so reopening a published listing
   *  restores its variants instead of asking for them again. */
  colors?: string[]
  sizes?: string[]
  /** The ARTWORK, not the composite in `images`. This is what gets attached to the order
   *  when one arrives, and what makes the line sendable to the Design board. */
  designUrl?: string
  designPos?: unknown
  designId?: string | number
}

/**
 * HOW A LISTING GETS FROM A BOARD TO THE PUBLISH PAGE.
 *
 * Publishing used to happen in a dialog, so its prefill was simply a prop: the caller had
 * the competitor listing, the composed artwork and the resolved blank in hand and passed
 * the object down. A page is a navigation, and none of that survives one.
 *
 * The URL cannot carry it. The prefill holds a composed design as a data: URL — hundreds of
 * kilobytes, sometimes megabytes — plus the competitor's photo list. So the caller stashes
 * the draft in sessionStorage under a one-shot id and navigates to /publish?d=<id>.
 *
 * sessionStorage, not localStorage, and deliberately:
 *   - it dies with the tab, and a half-finished listing is not something to inherit next
 *     time this browser opens;
 *   - it survives a refresh, so reloading the publish page doesn't lose the work;
 *   - it is per-tab, so two listings drafted in two tabs cannot overwrite each other.
 *
 * `returnTo` is what the Back button uses. It is stored rather than inferred from history,
 * because the page can also be reached by refresh or by a link, where there is no history
 * entry to go back to and `router.back()` would leave the app.
 */
const KEY = "eg_publish_draft"

/** What the board hands over. `source` exists only for SpyDeck: it's the competitor listing
 *  the Uploaded card is recorded against, which the page can no longer read from SpyDeck's
 *  state once it is its own route. */
export type PublishDraft = {
  prefill: PublishPrefill
  /** Where Back goes. A stored path, never history — see above. */
  returnTo: string
  /** What the Back button says, so it names the place rather than "Back". */
  returnLabel: string
  /** Heading for the page — "Publish product" or "Edit listing". */
  title?: string
  /** SpyDeck's source listing, when this came from a competitor card. */
  source?: EtsyListing | null
}

const idFor = (id: string) => `${KEY}:${id}`

/**
 * Stash a draft and return its id, or null if it could not be stored.
 *
 * NULL IS A REAL ANSWER. sessionStorage has a per-origin quota (~5MB in every browser we
 * target) and a composed design can be large, so a write CAN fail. The caller has to be
 * able to say "couldn't open the publish page" rather than navigate to a page that will
 * find nothing and look broken.
 */
export function stashPublishDraft(draft: PublishDraft): string | null {
  if (typeof window === "undefined") return null
  // Deterministic-ish and collision-proof enough for a per-tab store: the clock plus a
  // random tail. Not an identifier anything else relies on — it lives for one navigation.
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  try {
    sessionStorage.setItem(idFor(id), JSON.stringify(draft))
    return id
  } catch {
    // Quota, or a blocked store. Either way there is nothing to navigate to.
    return null
  }
}

export function readPublishDraft(id: string | null): PublishDraft | null {
  if (!id || typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(idFor(id))
    return raw ? (JSON.parse(raw) as PublishDraft) : null
  } catch {
    return null
  }
}

/**
 * Drop a draft once its listing is published.
 *
 * Not called when the page merely closes: leaving it lets Back-then-forward return to the
 * same half-filled form, which is what a browser's history is supposed to do. It goes when
 * the work it describes is done, and otherwise when the tab does.
 */
export function clearPublishDraft(id: string | null) {
  if (!id || typeof window === "undefined") return
  try { sessionStorage.removeItem(idFor(id)) } catch { /* ignore */ }
}
