/**
 * NUMBERS FOLLOW THE UI LANGUAGE, NOT THE DEVICE.
 *
 * Every figure in this app went through a bare `toLocaleString()`, which takes the PHONE's
 * locale. On a Vietnamese handset that prints a dot as the thousands separator, so the app
 * was showing `$1.000` for one thousand dollars and `1.095 orders need you` for 1,095 —
 * and the second of those is the first line on the first screen. A dollar amount does not
 * change its punctuation because of the reader's keyboard, and a count of orders is not
 * ambiguous in one country and clear in another.
 *
 * So: one locale for every number this app DRAWS. `en-US`, because the UI is English.
 *
 * DATES ARE THE EXCEPTION AND STAY ON THE DEVICE. "When did this arrive" genuinely should
 * read the way the reader expects, and a date has no ambiguity of the kind above — 16 Sep
 * is 16 Sep in either convention, while 1.095 is two different numbers.
 */
const LOCALE = "en-US"

/** A plain count — 1,095. */
export const num = (n: number): string => Math.round(Number(n) || 0).toLocaleString(LOCALE)

/** Whole dollars — $1,000. For a figure nobody needs cents on: a preset, a balance tile. */
export const usd0 = (n: number): string => `$${num(n)}`

/** Dollars and cents — $1,000.00. For money that settles: a ledger row, a total. */
export const usd2 = (n: number): string =>
  isFinite(n) ? `$${Number(n).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00"

/** Đồng — 13,500,000 ₫. Same separator as the dollars beside it: two numbering systems in
 *  one sentence is harder to read than either one alone, and this figure only ever appears
 *  next to its USD source. */
export const vnd0 = (n: number): string => `${num(n)} ₫`
