/**
 * THE ONE-WORD DISPLAY HEADING FOR A STEP, and the fallback when nothing is stored.
 *
 * Two surfaces set a step's word at 100px — the home page's acid block and /how-it-works —
 * so this lives in one file rather than as a copy in each (§5: private copies of shared logic
 * have been found in three separate files here already).
 *
 * `step.word` is the real answer and always wins. The fallback exists because stored content
 * written before the redesign has no `word` at all, and it used to take the title's FIRST
 * word blindly — which turned "We fulfill, hands-off" into a heading that read "WE". A
 * pronoun set in 100px condensed caps is worse than no heading, because it looks deliberate.
 *
 * So the fallback skips the words that can never be a heading — pronouns, articles,
 * auxiliaries — and takes the first one that carries meaning: "We fulfill, hands-off" gives
 * "Fulfill", "Connect your stores" gives "Connect". Punctuation comes off, because a stored
 * title is a sentence and a heading is not.
 */

/** Words that are never the point of a step. Order-insensitive; compared lower-case. */
const SKIP = new Set([
  "we", "you", "your", "our", "us", "it", "its", "the", "a", "an",
  "then", "and", "is", "are", "will", "well", "just", "so",
])

export function displayWord(step: { word?: string; title: string }): string {
  if (step.word?.trim()) return step.word.trim()

  const words = step.title
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)

  const pick = words.find((w) => !SKIP.has(w.toLowerCase())) ?? words[0] ?? ""
  // `.ploy-display` uppercases in CSS, so this only has to be the right WORD, not the right
  // case — but a capital keeps it correct anywhere the class is not applied.
  return pick ? pick[0].toUpperCase() + pick.slice(1) : ""
}
