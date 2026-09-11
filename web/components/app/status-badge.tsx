import { STATUS_TONE } from "@/lib/status-tone"

/**
 * A status is a WORD, in one of three weight registers. See lib/status-tone.ts for why.
 *
 * This used to be a tinted capsule per state under a comment calling itself "Universal
 * status → colour map. One source of truth for stage colours across pages." It was neither
 * universal nor a source of truth: it mixed reserved --status-* tokens with stock Tailwind
 * shades, and the stock ones were measured against the app's own 0.150 OKLab floor in
 * September 2026 —
 *
 *   packed      = pink-700     0.111 from `alert`, and 0.314 from --status-packed
 *   new         = blue-100/700 0.141 from `pending`
 *   queued/paused/draft = neutral-600  0.087 from `draft`
 *
 * So a PACKED box — one that is finished and ready to go — was drawn in the colour the
 * floor is trained to stop for, and the same word rendered two different colours depending
 * on which component happened to draw the row. None of it was careless: there was no shared
 * thing to import, so every page that needed a status wrote its own table.
 *
 * The map below is now KEYS TO MEANING, not keys to colour. Adding a state means deciding
 * whether it is moving, finished, or stuck — a question with a right answer — rather than
 * picking a hue nobody owns.
 */
const tones: Record<string, string> = {
  // Moving, or waiting on us.
  new: STATUS_TONE.live,
  production: STATUS_TONE.live,
  printing: STATUS_TONE.live,
  qc: STATUS_TONE.live,
  review: STATUS_TONE.live,
  // Finished, or not started — either way there is nothing to do about it.
  queued: STATUS_TONE.settled,
  packed: STATUS_TONE.settled,
  shipped: STATUS_TONE.settled,
  fulfilled: STATUS_TONE.settled,
  active: STATUS_TONE.settled,
  paused: STATUS_TONE.settled,
  draft: STATUS_TONE.settled,
}

export function StatusBadge({ status }: { status: string }) {
  // An unknown status reads as settled rather than vanishing — the word is still the whole
  // of the information, and the weight is the only thing being guessed at.
  const cls = tones[status.toLowerCase()] ?? STATUS_TONE.settled
  // NOT <Badge>. The capsule was the thing being retired; wrapping a weight-only word in one
  // keeps the chrome and loses only the colour, which is the half that was carrying meaning.
  return <span className={"whitespace-nowrap text-sm " + cls}>{status}</span>
}
