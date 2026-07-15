// Order id + display-number — ported VERBATIM from egfulfill-store.js.
// The technical id is namespaced by account so two sellers never mint the same PK
// (the old un-tagged scheme collided → 403 → silent loss). The seller sees `seq`.
import { getUser } from "./auth"

// _hashTag: short, stable per-account tag (full 32-bit entropy).
function hashTag(s: string): string {
  let h = 0
  s = String(s)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) || "x"
}

function acctTag(): string {
  const u = getUser()
  const raw = (u && (u.id || (u as { sub?: string }).sub || u.email || u.name)) || ""
  return raw ? hashTag(String(raw)) : "anon"
}

/** FF-<acctTag>-<ms base36>-<rand> — globally unique, no server coordination. */
export function nextOrderId(): string {
  const rand = Math.floor(Math.random() * 1e8).toString(36)
  return "FF-" + acctTag() + "-" + Date.now().toString(36) + "-" + rand
}

/** _nextSellerSeq: friendly #N — max over THIS seller's own (non-etsy) orders + 1. */
export function nextSellerSeq(orders: Array<{ id?: string; seq?: number | null }>): number {
  let max = 0
  for (const o of orders || []) {
    if (o && String(o.id || "").indexOf("etsy-") !== 0 && typeof o.seq === "number" && o.seq > max) max = o.seq
  }
  return max + 1
}
