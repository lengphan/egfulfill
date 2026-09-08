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
 * the draft in the browser under a one-shot id and navigates to /publish?d=<id>. Which
 * store, and why it changed, is written where the store is (below).
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
 * WHERE IT ACTUALLY LIVES NOW: IndexedDB, with sessionStorage as the fallback.
 *
 * sessionStorage has a ~5MB per-origin quota and the draft is mostly pictures — the print
 * file plus one 1200px JPEG per mockup the seller ticked. Shrinking the composites bought
 * one more mockup and no more; four of them still overflowed, and "this design is too
 * large for the browser to hand over" kept coming back (owner, 2026-09-08). IndexedDB's
 * quota is a share of the disk, so the handover stops being the limit.
 *
 * What is lost is "dies with the tab": IndexedDB persists. So a draft carries its clock and
 * anything older than a day is swept on the next stash — a half-finished listing is not
 * something to inherit next week, but it IS worth surviving a refresh, which it still does.
 * The id in the URL stays per-navigation, so two tabs cannot overwrite each other.
 */
const DB = "eg_publish"
const STORE = "drafts"
const MAX_AGE_MS = 24 * 60 * 60 * 1000

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      t.onabort = () => resolve(null)
    } catch { resolve(null) }
  })
}

/** Old drafts go on the next write — one pass over the keys, never blocking the stash. */
async function sweep(db: IDBDatabase) {
  const keys = (await tx<IDBValidKey[]>(db, "readonly", (st) => st.getAllKeys())) ?? []
  const cutoff = Date.now() - MAX_AGE_MS
  for (const k of keys) {
    const row = await tx<{ at?: number } | undefined>(db, "readonly", (st) => st.get(k))
    if (row && typeof row.at === "number" && row.at < cutoff) await tx(db, "readwrite", (st) => st.delete(k))
  }
}

/**
 * Stash a draft and return its id, or null if it could not be stored ANYWHERE.
 *
 * NULL IS STILL A REAL ANSWER — a blocked store, a private window that refuses IndexedDB
 * and a sessionStorage over quota all end here — and the caller says "couldn't open the
 * publish page" rather than navigating to a page that will find nothing and look broken.
 */
export async function stashPublishDraft(draft: PublishDraft): Promise<string | null> {
  if (typeof window === "undefined") return null
  // Deterministic-ish and collision-proof enough for a per-tab store: the clock plus a
  // random tail. Not an identifier anything else relies on — it lives for one navigation.
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const db = await openDb()
  if (db) {
    const ok = await tx(db, "readwrite", (st) => st.put({ at: Date.now(), draft }, id))
    // put() resolves with the key; null means the transaction failed.
    if (ok != null) { void sweep(db).catch(() => {}); return id }
  }
  try {
    sessionStorage.setItem(idFor(id), JSON.stringify(draft))
    return id
  } catch {
    return null
  }
}

export async function readPublishDraft(id: string | null): Promise<PublishDraft | null> {
  if (!id || typeof window === "undefined") return null
  const db = await openDb()
  if (db) {
    const row = await tx<{ draft?: PublishDraft } | undefined>(db, "readonly", (st) => st.get(id))
    if (row?.draft) return row.draft
  }
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
 * the work it describes is done, and otherwise with the daily sweep.
 */
export function clearPublishDraft(id: string | null) {
  if (!id || typeof window === "undefined") return
  void openDb().then((db) => { if (db) return tx(db, "readwrite", (st) => st.delete(id)) }).catch(() => {})
  try { sessionStorage.removeItem(idFor(id)) } catch { /* ignore */ }
}
