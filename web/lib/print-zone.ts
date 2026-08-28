import type { CatalogProduct } from "@/lib/api"

/** Printable rectangle, as 0–100 percentages of the mockup image. */
export type PrintZone = { x: number; y: number; w: number; h: number }

/** What a side's print area MEASURES, in inches. Set per product+side by staff; the base
 *  is what the zone table was drawn for and what a product without one is assumed to be. */
export type PrintSize = { w: number; h: number }

/**
 * The print size for a product + side, in inches.
 *
 * ONE PLACE TO ASK. The designer used to hold this as two typed fields, so the number a
 * DPI check divided by was whatever the last person opened the window and left there —
 * and it was per-session, not per-product, so the same cap measured 12×16 one day and
 * 4×2.5 the next. It belongs to the garment.
 */
export function printSizeOf(p: CatalogProduct | null, side = "front"): PrintSize {
  const a = (p as { printAreas?: Record<string, { wIn?: number; hIn?: number }> } | null)?.printAreas?.[side]
  const w = Number(a?.wIn), h = Number(a?.hIn)
  return {
    w: Number.isFinite(w) && w > 0 ? w : BASE_PRINT_IN.w,
    h: Number.isFinite(h) && h > 0 ? h : BASE_PRINT_IN.h,
  }
}

// Ported verbatim from design-maker.html's PRODUCT_ZONES (0–1 fractions there). The
// fallback printable area per garment type, used when a product carries no
// operator-defined printAreas.
const PRODUCT_ZONES: Record<string, [number, number, number, number]> = {
  // CALIBRATED against the bundled flat (public/blanks/tshirt-front.png, 1152x928): its
  // body spans roughly 252-848px, so the centre is 550 and the old 0.34 start put the box
  // 18px right of it. Measured rather than inherited — the previous row was ported verbatim
  // from design-maker.html and drawn for no particular picture.
  tshirt: [0.322, 0.24, 0.311, 0.34],
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

/**
 * IS THE ARTWORK OUTSIDE WHAT WE CAN PRINT?
 *
 * Everything beyond the printable rectangle is trimmed in production, and until the zone was
 * drawn on the order dialog nothing on either surface said so — the default placement is 45%
 * of the stage wide against a tee zone of 31%, so artwork dropped and left alone has always
 * hung outside the print area by half its own width. That was invisible rather than absent.
 *
 * Measured on the ROTATED bounding box, because a square turned 45° is 1.41× as wide as its
 * own width and a check that ignores that passes designs the press will clip.
 *
 * `nat` is the artwork's natural pixel size, for its aspect ratio only. Null → not measured
 * yet, and the honest answer is "don't know", never "fine".
 */
export function outsideZone(
  pos: { x: number; y: number; w: number; r: number },
  zone: PrintZone,
  nat: { w: number; h: number } | null,
): boolean | null {
  if (!nat || !(nat.w > 0) || !(nat.h > 0)) return null
  // The stage is square, so a width given as a % of it and a height given as a % of it share
  // one scale — which is the whole reason that frame is held square.
  const hw = pos.w / 2
  const hh = (pos.w * (nat.h / nat.w)) / 2
  const t = (pos.r * Math.PI) / 180
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t))
  const bw = hw * c + hh * s
  const bh = hw * s + hh * c
  // A hair of tolerance: a design sized to exactly fill the area should not accuse itself.
  const e = 0.35
  return pos.x - bw < zone.x - e || pos.x + bw > zone.x + zone.w + e
    || pos.y - bh < zone.y - e || pos.y + bh > zone.y + zone.h + e
}

/**
 * THE LARGEST THIS ARTWORK GOES INSIDE THE PRINT AREA, centred in it.
 *
 * Offered as an action rather than applied on drop. Changing where artwork lands by default
 * would move nothing already saved, but it would quietly change what every future drop does,
 * and "it used to land bigger" is a worse surprise than a button that says what it will do.
 */
export function fitToZone(
  zone: PrintZone,
  nat: { w: number; h: number } | null,
  r = 0,
): { x: number; y: number; w: number; r: number } {
  const cx = zone.x + zone.w / 2
  const cy = zone.y + zone.h / 2
  // Unmeasured: assume square. A very tall image may want a second press once it has
  // loaded, which is honest — guessing its shape would not be.
  const ratio = nat && nat.w > 0 && nat.h > 0 ? nat.h / nat.w : 1
  // ROTATION IS KEPT. Somebody turned that artwork on purpose, and squaring it up to make
  // the arithmetic easier throws away a decision — the same loss as re-centring a template's
  // placement. So the fit solves for the rotated bounding box instead.
  const t = (r * Math.PI) / 180
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t))
  const w = Math.min(zone.w / (c + ratio * s), zone.h / (s + ratio * c))
  return { x: cx, y: cy, w, r }
}
