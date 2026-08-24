/**
 * THE SHIP-TO, READ THE SAME WAY ON EVERY SURFACE — web AND phone.
 *
 * `orders.address` is jsonb and its writers do not agree on what the street is called.
 * Measured against the writers themselves, not guessed:
 *
 *   · etsy.js:317 · shopify.js:210 · tiktok.js:358   → `line1` / `line2`
 *   · etsy.js:971  (the CSV adopt path)              → `street` / `street2`
 *   · shipping.js:52 fillBlankAddressesFromShippo    → `street1` / `street`
 *
 * The first row is the MAJORITY of orders — every marketplace sync writes `line1`. So a
 * reader that misses that spelling misses most of the table, and it misses it silently:
 * the name, the city and the ZIP all still render, so the block looks like an address
 * right up until you notice the street is gone.
 *
 * That is exactly what happened. web/lib/order-format.ts grew a correct reader; mobile's
 * addressLines() read `street1 || street` only, so every Etsy, Shopify and TikTok order
 * showed a buyer's name and city with no street on the phone — and buy-label.tsx, seeding
 * its form from the same raw jsonb, decided those orders did not have "enough" address to
 * quote against. One order, two devices, opposite answers.
 *
 * So the reader lives HERE now, next to order-rules.ts and for the same reason: the copy
 * is what fails, and it fails quietly. web imports it as `@/shared/order-address`, mobile
 * as `@shared/order-address` (metro.config.js watches this folder).
 *
 * `masked` rides along because it is the same question. The server strips a marketplace
 * buyer's street and ZIP from the SELLER's copy and stamps this flag (maskBuyerPII in
 * server/src/routes/orders.js). A blank street WITH `masked` means "held by the factory";
 * a blank street WITHOUT it means we genuinely do not have one. Rendering those two the
 * same way is what CLAUDE.md §4 forbids, and it is the confusion Etsy's redacted
 * addresses already caused once.
 */

/** The stored jsonb, in every spelling its writers use. Every field optional: this is a
 *  column nobody validates on the way in, not a type anyone constructs. */
export type StoredAddress = {
  name?: string | null
  /** Four spellings of the street. See the writer table above. */
  street?: string | null; street1?: string | null; first_line?: string | null
  line1?: string | null; address1?: string | null
  street2?: string | null; second_line?: string | null
  line2?: string | null; address2?: string | null
  city?: string | null
  state?: string | null; province?: string | null
  zip?: string | null; postal_code?: string | null; postcode?: string | null
  country?: string | null; country_iso?: string | null
  phone?: string | null; email?: string | null
  /** Stamped by the server when it redacted this for a seller. Never enough to ship with. */
  masked?: boolean
  /** How we came to hold it — see addressSource() in web/lib/order-format.ts. */
  source?: string | null
  /** The buyer's own marketplace reference. Not contact data, so it survives masking. */
  ref?: string | null
}

/** The ship-to after normalising: one spelling, always present, never null. */
export type ShipTo = {
  name: string; line1: string; line2: string
  city: string; state: string; zip: string; country: string
  masked: boolean
}

/** The minimum an order has to look like to be read for an address. Structural on purpose
 *  so web's OrderRow and mobile's Order both satisfy it without either importing the
 *  other's API types. */
export type AddressableOrder = {
  address?: StoredAddress | Record<string, unknown> | null
  customer?: { name?: string | null } | null
}

const s = (v: unknown) => (v == null ? "" : String(v).trim())

/** Read an order's ship-to. THE one reader — never re-derive this chain at a call site. */
export function shipAddressOf(o: AddressableOrder): ShipTo {
  const a = (o?.address ?? {}) as StoredAddress
  return {
    name: s(o?.customer?.name) || s(a.name),
    // Order matters only when two spellings are populated at once, which the Shippo
    // backfill can do: it writes `street` onto an order that may already carry `line1`.
    // Either is the same address, so the first non-empty wins and the rest are ignored.
    line1: s(a.street) || s(a.street1) || s(a.first_line) || s(a.line1) || s(a.address1),
    line2: s(a.street2) || s(a.second_line) || s(a.line2) || s(a.address2),
    city: s(a.city),
    state: s(a.state) || s(a.province),
    zip: s(a.zip) || s(a.postal_code) || s(a.postcode),
    country: s(a.country) || s(a.country_iso),
    masked: !!a.masked,
  }
}

/** Is there a street at all? The one field whose absence stops a label being bought. */
export const hasStreet = (o: AddressableOrder) => !!shipAddressOf(o).line1

/**
 * Enough to buy a label with. Street AND ZIP — a masked address has neither and must
 * never reach a rate call, which is why `masked` fails it outright rather than by
 * happening to have blank fields.
 */
export const isShippable = (o: AddressableOrder) => {
  const a = shipAddressOf(o)
  return !a.masked && !!a.line1 && !!a.zip
}

/**
 * The address as LINES, in the order an envelope is read.
 *
 * An array rather than a joined string because both front-ends render it as a block, and
 * joining here would force every caller to split it again. An empty array means nothing
 * usable — a real state on a marketplace order behind a PII gate, and one the caller has
 * to tell apart from `masked` before it prints anything.
 */
export function addressLines(o: AddressableOrder): string[] {
  const a = shipAddressOf(o)
  return [
    a.name,
    a.line1,
    a.line2,
    [[a.city, a.state].filter(Boolean).join(", "), a.zip].filter(Boolean).join(" "),
    a.country,
  ].filter(Boolean)
}
