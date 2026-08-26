/**
 * FLAT GARMENT OUTLINES — drawn, not photographed, and not generated.
 *
 * These are diagrams of a shape, used wherever the app needs to say WHICH KIND of thing a
 * product is: the blank picker, a type filter, an empty stage. They are deliberately not
 * product photography — a photo says "this particular hoodie", an outline says "hoodies",
 * and those are different questions.
 *
 * ONE 200x240 BOX for every type, so anything positioned as a percentage — a print zone,
 * a badge — lands in the same place on all of them.
 *
 * STROKE ONLY, currentColor, no fill: they inherit the text colour of wherever they sit,
 * so they work on a light row, a dark tile and a selected state without three variants.
 */
const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
}

/** Every shape is ONE closed path walked in a single direction — neck, shoulder, sleeve,
 *  armpit, side, hem, and back up. Drawn as separate strokes a garment shows its seams
 *  wherever two ends meet and never quite closes. */
const PATHS: Record<string, string[]> = {
  tshirt: ["M80 40 L56 48 L34 68 L48 96 L62 86 L58 204 Q58 210 64 210 L136 210 Q142 210 142 204 L138 86 L152 96 L166 68 L144 48 L120 40 Q100 58 80 40 Z"],
  // The hood is the silhouette's HIGHEST point, so it belongs to the outer path. Drawn as a
  // curve inside the chest it reads as a collar seam on a tee.
  hoodie: [
    "M76 64 C76 22 124 22 124 64 L150 72 L172 96 L156 122 L142 110 L146 206 Q146 212 140 212 L60 212 Q54 212 54 206 L58 110 L44 122 L28 96 L50 72 Z",
    "M82 66 C86 92 114 92 118 66",
    "M90 84 L88 106 M110 84 L112 106",
    "M72 148 L128 148 L133 182 L67 182 Z",
  ],
  sweatshirt: [
    "M80 44 L56 52 L34 74 L48 102 L62 92 L58 206 Q58 212 64 212 L136 212 Q142 212 142 206 L138 92 L152 102 L166 74 L144 52 L120 44 Q100 64 80 44 Z",
    "M80 44 Q100 60 120 44",
  ],
  cap: [
    "M36 152 Q36 74 100 74 Q164 74 164 152 Z",
    "M36 152 Q22 154 22 166 Q22 176 36 176 L150 176 Q164 176 164 164 L164 152 Z",
    "M100 74 L100 152",
    "M66 84 Q56 116 58 152 M134 84 Q144 116 142 152",
  ],
  tote: [
    "M50 78 L150 78 L154 210 Q154 216 148 216 L52 216 Q46 216 46 210 Z",
    "M74 78 L74 54 Q74 30 100 30 Q126 30 126 54 L126 78",
  ],
  mug: [
    "M48 76 L136 76 L131 202 Q131 208 125 208 L59 208 Q53 208 53 202 Z",
    "M136 98 Q168 98 168 134 Q168 170 136 170",
  ],
  poster: ["M48 32 L152 32 L152 214 L48 214 Z"],
  blanket: [
    "M34 62 L166 62 L166 200 Q166 206 160 206 L40 206 Q34 206 34 200 Z",
    "M34 84 L166 84",
  ],
  pants: [
    "M62 40 L138 40 L146 206 Q146 212 140 212 L112 212 Q106 212 105 206 L100 128 L95 206 Q94 212 88 212 L60 212 Q54 212 54 206 Z",
    "M62 62 L138 62",
  ],
  phone: [
    "M64 26 L136 26 Q144 26 144 34 L144 206 Q144 214 136 214 L64 214 Q56 214 56 206 L56 34 Q56 26 64 26 Z",
    "M88 38 L112 38",
  ],
}

/** Whether a type has an outline at all — callers fall back to a word when it does not. */
export function hasBlankOutline(type?: string | null): boolean {
  return !!type && !!PATHS[String(type).toLowerCase()]
}

export function BlankOutline({ type, className }: { type?: string | null; className?: string }) {
  const paths = PATHS[String(type ?? "").toLowerCase()]
  if (!paths) return null
  return (
    <svg viewBox="0 0 200 240" className={className} aria-hidden focusable="false">
      {paths.map((d, i) => (
        <path key={i} d={d} {...S} />
      ))}
    </svg>
  )
}
