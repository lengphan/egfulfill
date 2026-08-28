/**
 * ONE COLUMN MODEL FOR ANY TABLE.
 *
 * `order-columns.ts` grew two of these — one for the seller Orders table, one for the
 * factory queue — with the same shape, the same localStorage dance and the same heal-on-load
 * rule written twice. A third table wanting show/hide would have written it a third time.
 *
 * The definitions live here; the two existing registries stay where they are for now
 * (Orders' persistence is proven and is not worth re-proving to save an import). New tables
 * — Shipping's dispatch queue, Sourcing, the Finance ledger — build on this.
 *
 * The registry is also what an ARCHIVE is handed. A settled-records list must render from
 * the same registry as the live list it archives, or the two drift into different tables
 * answering the same question — which is exactly why Purchasing's Cart and its History do
 * not line up while Dispatch's To-scan and History do.
 */

export type ColumnDef<T extends string = string> = {
  id: T
  label: string
  /** Tailwind width class for the <th>. Omitted = the flexible column. */
  width?: string
  /**
   * The same width as a NUMBER, because a `table-fixed` table has to add them up.
   * Kept beside the class rather than derived from it: a Tailwind class must be a literal
   * for the JIT to emit it, so the class cannot be built from this — and parsing it back out
   * is the kind of cleverness that breaks the day someone writes `w-24`.
   */
  px?: number
  align?: "left" | "right"
  /** May not be hidden — without it a row is unidentifiable. */
  locked?: boolean
}

export type ColumnRegistry<T extends string = string> = Record<T, ColumnDef<T>>

/** Move `id` to `toIndex`. Returns the same array when the move is a no-op. */
export function reorderColumns<T extends string>(ids: T[], id: T, toIndex: number): T[] {
  const from = ids.indexOf(id)
  if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(toIndex, 0, id)
  return next
}

/**
 * A NEW COLUMN APPEARS WHERE IT BELONGS, not on the far right.
 *
 * Appending is fine only while every new column is an end-of-row one. On Orders, `cost`
 * belongs beside `total` — they are two halves of one question — and every saved layout
 * (which is everyone who has ever opened the Columns menu) would have received it after
 * Date, reading as though someone had put it in the wrong place. So a missing column follows
 * its canonical NEIGHBOUR wherever that neighbour now sits.
 */
export function healColumnOrder<T extends string>(saved: T[], defaults: readonly T[]): T[] {
  const healed = [...saved]
  for (const id of defaults) {
    if (healed.includes(id)) continue
    const canonical = defaults.indexOf(id)
    const after = healed.indexOf(defaults[canonical - 1])
    healed.splice(after >= 0 ? after + 1 : Math.min(canonical, healed.length), 0, id)
  }
  return healed
}

/** Read a persisted order, dropping ids the table no longer has and healing in new ones. */
export function loadColumnOrder<T extends string>(
  key: string, defaults: readonly T[], isId: (v: unknown) => v is T,
): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return [...defaults]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...defaults]
    return healColumnOrder(parsed.filter(isId), defaults)
  } catch {
    return [...defaults]
  }
}

export function loadHiddenColumns<T extends string>(
  key: string, fallback: readonly T[], isId: (v: unknown) => v is T,
): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return [...fallback]
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isId) : [...fallback]
  } catch {
    return [...fallback]
  }
}

/** Both writes swallow: a full or blocked storage must never break the table. */
export function saveColumnIds(key: string, ids: readonly string[]) {
  try { localStorage.setItem(key, JSON.stringify(ids)) } catch { /* layout is a convenience */ }
}
