import { getUser } from "@/lib/auth"

/**
 * THE MAILERS THIS FACTORY ACTUALLY USES.
 *
 * The parcel fields opened on 10 × 8 × 1 — a size nobody here stocks — so every label began
 * with the same three corrections, and the dim-weight hint underneath spent its time
 * objecting to a number that was only ever a placeholder. Naming the real stock instead
 * makes the common case one click and leaves the boxes free for the exception.
 *
 * These are POLY MAILERS, which is why height is 1: a soft pack under a shirt's worth of
 * weight is rated on weight, not size, so the third dimension is nearly nominal. A rigid box
 * belongs in "Custom", where its real height matters.
 *
 * The list is per-user and per-browser rather than a server setting, because a size is
 * something the person packing reaches for, not a policy the business sets — and getting it
 * wrong costs one dropdown, not money.
 */
/**
 * `tareOz` — WHAT THE EMPTY PACKAGING WEIGHS.
 *
 * A poly mailer is a fraction of an ounce and nobody would miss it; a rigid box is not. A
 * 12 × 12 × 6 carton runs 8–12oz empty, which on USPS Ground Advantage is a whole price
 * band on its own — so a parcel costed from its CONTENTS alone is under-declared by the
 * weight of the thing carrying them, every time, and the carrier bills the difference days
 * later.
 *
 * Optional, because the stock mailers genuinely round to nothing and asking for a number
 * that is always 0.4 is a field people learn to skip. It is the boxes that need it, which
 * is where the prompt appears.
 */
export type ParcelSize = { label: string; length: number; width: number; height: number; tareOz?: number }

/** Stock sizes. Ordered smallest first — the pick is usually "the smallest it fits in". */
export const STOCK_SIZES: ParcelSize[] = [
  { label: '10 × 13 poly mailer', length: 13, width: 10, height: 1 },
  { label: '12 × 15 poly mailer', length: 15, width: 12, height: 1 },
  { label: '14 × 19 poly mailer', length: 19, width: 14, height: 1 },
]

/** What a new label opens on: the one reached for most. */
export const DEFAULT_SIZE = STOCK_SIZES[0]

const KEY = "eg_parcel_sizes"
const storeKey = () => `${KEY}:${getUser()?.id ?? "anon"}`

/**
 * THE SHARED LIST — what the building actually stocks, set once in Settings › Platform.
 *
 * Sizes used to live ONLY in localStorage, keyed per user. So a box the admin added existed
 * in the admin's own browser, on the one machine they added it on, and the packer buying the
 * label never saw it: three people, three different ideas of what is on the shelf. A parcel
 * size is a fact about the warehouse, not a preference, and it belongs where the ship-from
 * address already is.
 *
 * Held in a module-level cache rather than fetched per render — every label dialog and the
 * rate calculator ask for it, and it changes about once a quarter. `loadSharedSizes()` is
 * called by the surfaces that need it; until it answers, the stock three are what shows, so
 * a slow settings call never leaves the dropdown empty.
 */
let shared: ParcelSize[] = []
export function sharedSizes(): ParcelSize[] { return shared }
export function setSharedSizes(list: ParcelSize[]) {
  shared = (Array.isArray(list) ? list : []).filter((s) => s && s.length > 0 && s.width > 0 && s.height > 0)
}

/**
 * Every size on offer, in the order the dropdown shows them: the stock three, then whatever
 * the warehouse added, then anything still stranded in this browser's localStorage.
 *
 * DE-DUPLICATED BY DIMENSIONS across all three sources. The migration below copies local
 * sizes up to the server, and until an admin saves, the same box would otherwise appear
 * twice — once from each side.
 */
export function allSizes(): ParcelSize[] {
  const out: ParcelSize[] = []
  const seen = new Set<string>()
  for (const s of [...STOCK_SIZES, ...shared, ...customSizes()]) {
    const k = sizeKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/** Sizes this person added themselves, in this browser. Kept only so nothing anyone typed is
 *  lost on the way to the shared list — see `allSizes`. Never throws. */
export function customSizes(): ParcelSize[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(storeKey())
    const list = raw ? (JSON.parse(raw) as ParcelSize[]) : []
    return Array.isArray(list) ? list.filter((s) => s && s.length > 0 && s.width > 0 && s.height > 0)
      .map((s) => ({ ...s, tareOz: Number(s.tareOz) > 0 ? Number(s.tareOz) : undefined })) : []
  } catch {
    return []
  }
}

/** Add one, de-duplicated by its dimensions rather than its name — the same box typed twice
 *  is the same box, and a list with "12x15" and "12 x 15" in it is a list nobody trusts. */
export function addCustomSize(s: ParcelSize): ParcelSize[] {
  const all = customSizes()
  const same = (a: ParcelSize, b: ParcelSize) => a.length === b.length && a.width === b.width && a.height === b.height
  if (STOCK_SIZES.some((x) => same(x, s)) || all.some((x) => same(x, s))) return all
  const next = [...all, s]
  try { localStorage.setItem(storeKey(), JSON.stringify(next)) } catch { /* not worth raising */ }
  return next
}

export function removeCustomSize(s: ParcelSize): ParcelSize[] {
  const next = customSizes().filter((x) => !(x.length === s.length && x.width === s.width && x.height === s.height))
  try { localStorage.setItem(storeKey(), JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

/** How a size reads in the dropdown, from its numbers alone. */
export const sizeLabel = (s: { length: number; width: number; height: number }) =>
  `${s.width} × ${s.length}${s.height > 1 ? ` × ${s.height}` : ""} in`

/** Does the current parcel match a known size? Drives which option the dropdown shows. */
export const sizeKey = (s: { length: number; width: number; height: number }) =>
  `${s.length}x${s.width}x${s.height}`
