// Parse a pasted address block into fields.
//
// Extracted from the manual-order form so the label modal uses the SAME parser — two
// implementations would drift, and this is the path people actually use while Etsy
// withholds buyer addresses. Deliberately forgiving: a copied address is whatever the
// marketplace or the buyer's email happened to format, not a clean record.

export type ParsedAddress = { street: string; street2: string; city: string; state: string; zip: string }
export type ParsedBlock = { name: string; addr: ParsedAddress }

/**
 * US STATES BY NAME, because people type them.
 *
 * The old parser demanded exactly two letters, so "Livermore, California 94551" — which is
 * how a buyer writes it, how several marketplaces export it, and how it arrives in an email
 * — matched nothing at all. City, state and ZIP all came back empty, which made the address
 * INCOMPLETE, which silently disabled Get rates. That is the whole of "some addresses just
 * don't show any rates".
 */
const STATE_CODES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP','AA','AE','AP'])
const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR', 'virgin islands': 'VI', guam: 'GU',
}
/** A state code from either form, or "" if this is not a state. */
function stateCode(raw: string): string {
  const t = String(raw || '').trim().replace(/\.$/, '').toLowerCase()
  if (!t) return ''
  if (t.length === 2 && STATE_CODES.has(t.toUpperCase())) return t.toUpperCase()
  return STATE_NAMES[t] ?? ''
}

/**
 * The LAST line carries "City, ST 12345" — anchoring on the last line rather than counting
 * from the top is what makes a 2-line and a 4-line address both work.
 *
 * NOT ONE REGEX ANY MORE, and it could not be. A state may be one word or three ("New
 * Mexico", "District of Columbia"), so the only way to know where the city ends is to TRY:
 * take the ZIP off the end, then try the last one, two and three words as a state and keep
 * the first that resolves. A single pattern cannot backtrack on "is this actually a state",
 * which is why "New York, NY" and "Livermore, California" cannot both be matched by one.
 */
export function parseAddress(text: string): ParsedAddress {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const last = lines[lines.length - 1] ?? ''

  const zipM = last.match(/(\d{5}(?:-\d{4})?)\s*$/)
  const zip = zipM ? zipM[1] : ''
  let head = zipM ? last.slice(0, zipM.index).replace(/[,\s]+$/, '') : ''

  let state = ''
  if (zipM) {
    const words = head.split(/[\s,]+/).filter(Boolean)
    for (const n of [1, 2, 3]) {
      if (words.length <= n) break
      const tail = words.slice(-n)
      const code = stateCode(tail.join(' '))
      if (!code) continue
      state = code
      /* CUT THE ORIGINAL STRING, do not rebuild it from the words.
         Rejoining with spaces threw the COMMAS away — and the single-line branch below is
         keyed on a comma, so "792 El Rancho Drive, Livermore, California 94551" came back as
         city "792 El Rancho Drive Livermore" with no street and no way to find one. The
         separators are data here, not whitespace. */
      const esc = tail.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s,]+')
      head = head.replace(new RegExp('[\\s,]*' + esc + '\\s*$', 'i'), '').replace(/[,\s]+$/, '')
      break
    }
  }
  const matched = !!(zip && state)

  let city = matched ? head.replace(/,\s*$/, '').trim() : ''
  const streetLines = matched ? lines.slice(0, -1) : lines
  let street = streetLines[0] ?? ''
  let street2 = streetLines.slice(1).join(', ')

  /**
   * THE WHOLE ADDRESS ON ONE LINE, which is the other shape people paste:
   * "792 El Rancho Drive, Livermore, California 94551".
   *
   * There is then no line above the city line to be the street, so `street` came back empty
   * and the address was incomplete for a second reason. The city half still holds it, comma
   * separated, so the leading segments are split back out — but only when the first one
   * starts with a NUMBER. "San Jose" must not be torn into a street; "792 El Rancho Drive"
   * is unambiguous, and a street with no number is not one this can safely guess at.
   */
  if (matched && !street && city.includes(',')) {
    const parts = city.split(',').map((x) => x.trim()).filter(Boolean)
    if (parts.length > 1 && /^\d/.test(parts[0])) {
      street = parts[0]
      street2 = parts.slice(1, -1).join(', ')
      city = parts[parts.length - 1]
    }
  }

  return { street, street2, city, state, zip }
}

/**
 * A full block where the FIRST line is the recipient's name. A pasted address usually
 * leads with the name, and treating it as street is the most common way these come out
 * wrong.
 *
 * A country line is dropped when it trails the block — it's implied for domestic labels
 * and would otherwise be mistaken for the city/state line.
 */
export function parseBlock(text: string): ParsedBlock {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean)
  if (/^(united states|usa|u\.s\.a\.?|us)$/i.test(lines[lines.length - 1] ?? "")) lines.pop()
  const name = lines[0] ?? ""
  return { name, addr: parseAddress(lines.slice(1).join("\n")) }
}

/** Did we get enough to buy a label with? */
export function isComplete(a: ParsedAddress): boolean {
  return !!(a.street && a.city && a.state && a.zip)
}
