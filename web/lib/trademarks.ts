// Static trademark/brand detector (NO AI) — flags SpyDeck listings whose title or tags
// mention a widely-known brand/franchise that's a common print-on-demand infringement
// risk. This is a HEURISTIC WARNING, not legal advice: it can false-positive (a real
// word that's also a brand) and can miss anything not on the list. Purely a heads-up.

// Curated, lower-cased. Multi-word phrases match as a phrase; single words match on a
// word boundary. Grouped loosely by owner for readability.
const TRADEMARKS: string[] = [
  // Disney / Pixar
  "disney", "mickey mouse", "minnie mouse", "winnie the pooh", "pixar", "toy story",
  "frozen elsa", "moana", "encanto", "stitch", "lilo & stitch", "cinderella",
  // Marvel / DC / Star Wars
  "marvel", "avengers", "spider-man", "spiderman", "iron man", "captain america",
  "black panther", "deadpool", "batman", "superman", "wonder woman", "harley quinn",
  "star wars", "baby yoda", "grogu", "mandalorian", "darth vader",
  // Nintendo / gaming
  "pokemon", "pikachu", "nintendo", "super mario", "mario bros", "zelda", "kirby",
  "sonic the hedgehog", "minecraft", "fortnite",
  // Harry Potter / franchises
  "harry potter", "hogwarts", "gryffindor", "wizarding world",
  // Kids / cartoons
  "bluey", "peppa pig", "spongebob", "paw patrol", "sesame street", "hello kitty",
  "sanrio", "my little pony", "cocomelon", "the grinch", "dr seuss", "dr. seuss",
  // Music / celebs / tours
  "taylor swift", "eras tour", "swiftie", "beyonce", "bad bunny", "olivia rodrigo",
  "travis scott", "drake", "kpop bts", "blackpink",
  // Fashion / consumer brands
  "nike", "adidas", "gucci", "louis vuitton", "chanel", "prada", "supreme",
  "lululemon", "stanley cup", "starbucks", "coca-cola", "coca cola", "in-n-out",
  // Sports leagues
  "nfl", "nba", "mlb", "nhl", "super bowl", "wwe", "formula 1", "premier league",
  // TV / streaming
  "stranger things", "friends tv", "the office", "squid game", "wednesday addams",
  "barbie movie", "barbie",
]

// Build matchers once. Phrases (contain a space or hyphen/&) → substring; single tokens
// → word-boundary regex to avoid matching inside other words.
const PHRASES = TRADEMARKS.filter((t) => /[\s&-]/.test(t))
const WORDS = TRADEMARKS.filter((t) => !/[\s&-]/.test(t))
const WORD_RE = new RegExp("\\b(" + WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i")

// Return the distinct brand terms found in the given text (title + tags), title-cased-ish.
export function detectTrademarks(text: string): string[] {
  const hay = ` ${(text || "").toLowerCase()} `
  const hits = new Set<string>()
  for (const p of PHRASES) if (hay.includes(p)) hits.add(p)
  const m = hay.match(new RegExp(WORD_RE, "gi"))
  if (m) for (const w of m) hits.add(w.toLowerCase().trim())
  // Prettify for display (capitalize each word).
  return Array.from(hits).map((h) => h.replace(/\b\w/g, (c) => c.toUpperCase()))
}
