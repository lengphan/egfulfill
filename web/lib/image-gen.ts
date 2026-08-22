/**
 * WHAT THE IMAGE MODEL CANNOT DO, said before the money moves.
 *
 * Google's image surface accepts exactly one output mime — `image/jpeg`. PNG is rejected
 * outright ("Supported values: 'image/jpeg'"), verified against the live API and recorded in
 * server/src/gemini.js. JPEG has no alpha channel, so a transparent background is not a
 * feature we have switched off; it is not representable in the only format the API returns.
 *
 * That produces a failure that looks like a success. Asked to "remove the background", the
 * model does the only thing it can with an opaque canvas: it PAINTS a checkerboard, because a
 * grey-and-white check is what transparency looks like in every screenshot it has ever seen.
 * The render comes back, it is charged for, and it is unusable — and the next prompt ("remove
 * the grid background") asks the model to remove something it drew on purpose, which is how
 * that turns into a run of paid renders that cannot converge.
 *
 * So the check is on the PROMPT, before Generate, not on the result afterwards.
 */
/*
 * `remove … background` allows words in between, because that is how people actually write
 * it: "remove grid background", "remove the checkered background", "remove that grey
 * background" — the literal `remove background` spelling is the rare one. The gap is bounded
 * so it cannot reach across a sentence and match "remove the stray thread" … "background".
 */
const TRANSPARENCY = /\b(transparent|transparency|no background|(remove|delete|erase|strip|get rid of)\s+(\w+\s+){0,3}background|png\b|alpha channel|cut\s?out|isolate[d]?\s+on\s+(white|transparent))\b/i

/** Cheap intent check. Returns a sentence to show, or null when nothing is wrong. */
export function promptWarning(prompt: string): string | null {
  if (TRANSPARENCY.test(prompt || "")) {
    return "Renders come back as JPEG, which has no transparency — asking for a removed or transparent background makes the model paint a grey checkerboard instead. Set Backdrop to a cut-out-ready sweep in the Generate panel, then press Remove background on the render: that gives you a real PNG, free."
  }
  return null
}
