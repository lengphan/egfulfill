import type { CatalogProduct } from "@/lib/api"

/** Printable rectangle, as 0–100 percentages of the mockup image. */
export type PrintZone = { x: number; y: number; w: number; h: number }

// Ported verbatim from design-maker.html's PRODUCT_ZONES (0–1 fractions there). The
// fallback printable area per garment type, used when a product carries no
// operator-defined printAreas.
const PRODUCT_ZONES: Record<string, [number, number, number, number]> = {
  tshirt: [0.34, 0.22, 0.30, 0.32],
  hoodie: [0.33, 0.28, 0.32, 0.28],
  sweatshirt: [0.34, 0.24, 0.30, 0.30],
  cap: [0.26, 0.15, 0.46, 0.52],
  tote: [0.22, 0.30, 0.54, 0.42],
  blanket: [0.14, 0.12, 0.70, 0.72],
  pants: [0.12, 0.36, 0.26, 0.28],
  mug: [0.24, 0.20, 0.50, 0.56],
  poster: [0.10, 0.08, 0.78, 0.84],
  phone: [0.16, 0.14, 0.66, 0.68],
}

/** The base print area the zone table is drawn for — inches. Scaling by the seller's
 *  chosen size is relative to this, exactly as the old maker did. */
export const BASE_PRINT_IN = { w: 12, h: 16 }

// Map a product's free-text type/name onto a zone key. The catalog types are loose
// ("Apparel", "Headwear", "T-Shirt"), so match on substrings rather than exact keys.
function zoneKey(p: CatalogProduct | null): string {
  const s = `${p?.type ?? ""} ${p?.name ?? ""}`.toLowerCase()
  if (/hoodie|hooded/.test(s)) return "hoodie"
  if (/sweat|crewneck/.test(s)) return "sweatshirt"
  if (/cap|hat|beanie|headwear/.test(s)) return "cap"
  if (/tote|bag/.test(s)) return "tote"
  if (/blanket|throw/.test(s)) return "blanket"
  if (/pant|jogger|short/.test(s)) return "pants"
  if (/mug|tumbler|drinkware/.test(s)) return "mug"
  if (/poster|print|canvas/.test(s)) return "poster"
  if (/phone|case/.test(s)) return "phone"
  return "tshirt"
}

/**
 * The printable rectangle for a product + side.
 *
 * Operator-defined `printAreas[side]` wins and is already stored as 0–100 percentages;
 * the PRODUCT_ZONES fallback is stored as 0–1 fractions, so it's normalized here. This
 * mismatch is the reason the old code normalized before computing pixels — keep it.
 */
export function printZoneOf(p: CatalogProduct | null, side = "front", inches?: { w: number; h: number }): PrintZone {
  const areas = (p as { printAreas?: Record<string, PrintZone> } | null)?.printAreas
  const op = areas?.[side]
  let x: number, y: number, w: number, h: number
  if (op && typeof op.w === "number") {
    ;({ x, y, w, h } = op)
  } else {
    const [fx, fy, fw, fh] = PRODUCT_ZONES[zoneKey(p)] ?? PRODUCT_ZONES.tshirt
    x = fx * 100; y = fy * 100; w = fw * 100; h = fh * 100
  }
  // Scale by the requested print size against the 12×16 base, keeping the box centred
  // and on-garment (the old maker's clamps: max 96% of the image, min 2% inset).
  if (inches && inches.w > 0 && inches.h > 0) {
    const cx = x + w / 2, cy = y + h / 2
    w = Math.min(96, w * (inches.w / BASE_PRINT_IN.w))
    h = Math.min(96, h * (inches.h / BASE_PRINT_IN.h))
    x = Math.max(2, cx - w / 2)
    y = Math.max(2, cy - h / 2)
  }
  return { x, y, w, h }
}
