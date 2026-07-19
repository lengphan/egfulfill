// Parse a pasted address block into fields.
//
// Extracted from the manual-order form so the label modal uses the SAME parser — two
// implementations would drift, and this is the path people actually use while Etsy
// withholds buyer addresses. Deliberately forgiving: a copied address is whatever the
// marketplace or the buyer's email happened to format, not a clean record.

export type ParsedAddress = { street: string; street2: string; city: string; state: string; zip: string }
export type ParsedBlock = { name: string; addr: ParsedAddress }

/**
 * The LAST line carries "City, ST 12345" (or "City ST 12345-6789"); everything above it
 * is street. Anchoring on the last line rather than counting lines from the top is what
 * makes a 2-line and a 4-line address both work.
 */
export function parseAddress(text: string): ParsedAddress {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  const m = last.match(/^(.*?)[,\s]+([A-Za-z]{2})[,\s]+(\d{5}(?:-\d{4})?)\s*$/)
  const city = m ? m[1].replace(/,\s*$/, "").trim() : ""
  const state = m ? m[2].toUpperCase() : ""
  const zip = m ? m[3] : ""
  const streetLines = m ? lines.slice(0, -1) : lines
  return {
    street: streetLines[0] ?? "",
    street2: streetLines.slice(1).join(", "),
    city, state, zip,
  }
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
