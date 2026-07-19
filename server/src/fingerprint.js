// Artwork fingerprinting — the basis for "we've already digitised this design".
//
// TWO hashes, deliberately:
//
//  - content_hash (sha256 of the decoded bytes) is computed HERE, server-side. It is
//    exact: same bytes → same hash, and no client can skip or forge it. This is what
//    proves "this is literally the same file we already made a .pes from".
//
//  - phash (a 64-bit difference hash) has to come from the CLIENT, because it needs the
//    image decoded to pixels and the API has no image library. It is fuzzy: a re-export,
//    a resize, or a recompress lands within a few bits of the original. This is what
//    catches "the seller re-uploaded the same art at a different size".
//
// The fuzzy one is advisory ONLY — it suggests, a human confirms. Acting on a phash match
// alone would eventually attach the wrong deliverable to someone's order.

import { createHash } from 'crypto';

/** sha256 of a data-URL's decoded bytes (or of a bare base64 string). */
export function hashOf(dataUrl) {
  try {
    const s = String(dataUrl || '');
    if (!s) return null;
    const b64 = s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : s;
    return createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
  } catch { return null; }
}

/** A 64-bit dHash as 16 hex chars — the shape the browser side produces. */
export function isPhash(v) {
  return typeof v === 'string' && /^[0-9a-f]{16}$/i.test(v);
}

/**
 * Hamming distance between two 64-bit hex hashes: how many bits differ.
 * Returns null when either side isn't a usable phash, so callers can't mistake
 * "couldn't compare" for "identical".
 */
export function phashDistance(a, b) {
  if (!isPhash(a) || !isPhash(b)) return null;
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

// Out of 64 bits. Tuned deliberately tight: at 10+ visually unrelated logos start
// colliding, and a false "you already made this" is far more expensive than a miss —
// it risks shipping the wrong artwork on someone's order.
export const PHASH_NEAR = 8;
