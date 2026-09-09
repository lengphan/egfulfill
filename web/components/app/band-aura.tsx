"use client"

/**
 * THE AURA — light, not objects.
 *
 * The pool's chrome gave the lime something to sit against, but it also put a grey mass in
 * the header: a body with an outline, competing with the type for the eye. This is the same
 * idea with the body removed — only the emission left. Nothing here has an edge, so there is
 * nothing to read as a shape, and the band stops containing an object and starts being lit
 * from one side.
 *
 * THE BIG WASH IS THE SMALLEST ALPHA, not the largest. A wide, strong ambient layer is what
 * turns an aura into a film over the plate: it lifts every pixel in the region and the lights
 * stop having a source. The width carries the falloff; the brightness lives in the cores.
 *
 * AND THEN THE CORES CAME BACK DOWN, because additive light blows out to WHITE. At 0.9 the
 * lime and the periwinkle both pushed every channel to 1 and the band grew four white
 * headlights — the colour sat in the falloff and nowhere near the source, which is the exact
 * opposite of how a light looks. Around 0.45 each they keep their hue, and the brightness
 * comes from stacking on the wash instead.
 *
 * IT IS ADDITIVE. The layers blend with `screen`, so overlapping light gets BRIGHTER instead
 * of stacking alpha into a flat film. That is the whole difference between a glow and a
 * translucent green rectangle: light adds, paint covers.
 *
 * FOUR LAYERS, NOT ONE. A single soft blob reads as a smudge on the glass. A wide ambient
 * wash, a mid body, a tight core and one small hot spot give the falloff a structure — the
 * eye finds a source and a fade rather than an even fog, which is what makes it look like
 * something is glowing rather than like the pixels are tinted.
 *
 * TWO LIGHTS, LIME AND PERIWINKLE, FADING PAST EACH OTHER. Both are fills on the plate,
 * which is where §4 allows them and nowhere else — the band is the plate, and neither colour
 * appears as ink, a rule or a chip anywhere near it. They are interleaved rather than grouped
 * so the handover happens inside one body of light instead of splitting the band into a green
 * end and a violet end, and each fades on its own clock, so one leads, then the other, and
 * the exchange never lands on a beat.
 */

/** The two lights. Tokens rather than hexes, because `--mk-acid` is a ROLE that resolves to
 *  a different colour per skin — see globals.css where these are declared. */
const A = "var(--band-aura-a, #d4f897)"   // lime
const B = "var(--band-aura-b, #c0c4ff)"   // periwinkle

/**
 * x/y are percentages of the band; `r` is the radius as a percentage of the band's height, so
 * a layer keeps its proportions when the band does. Each drifts, swells and fades on its own
 * clocks, and the two hues are INTERLEAVED rather than grouped — a lime side and a violet
 * side would read as a two-tone gradient, whereas alternating them means the handover happens
 * inside the same body of light and you get the greens and violets passing through each other.
 */
const LAYERS: { c: string; x: number; y: number; r: number; a: number; dx: number; dy: number; d: number; min: number }[] = [
  { c: B, x: 88, y: 46, r: 300, a: 0.30, dx: 23, dy: 17, d: -3, min: 0.45 },
  { c: A, x: 70, y: 64, r: 240, a: 0.34, dx: 17, dy: 13, d: -8, min: 0.40 },
  { c: B, x: 96, y: 34, r: 230, a: 0.40, dx: 14, dy: 19, d: -2, min: 0.5 },
  { c: A, x: 79, y: 40, r: 200, a: 0.44, dx: 12.5, dy: 9.5, d: -6, min: 0.35 },
  { c: A, x: 90, y: 64, r: 130, a: 0.52, dx: 10, dy: 15, d: -11, min: 0.3 },
  { c: B, x: 72, y: 32, r: 115, a: 0.5, dx: 15.5, dy: 11, d: -5, min: 0.32 },
]

export function BandAura() {
  return (
    <div aria-hidden className="eg-aura-wrap">
      {LAYERS.map((l, i) => (
        <span
          key={i}
          className="eg-aura-layer"
          style={{
            left: `${l.x}%`,
            top: `${l.y}%`,
            height: `${l.r}%`,
            background: `radial-gradient(closest-side, color-mix(in oklab, ${l.c} ${Math.round(l.a * 100)}%, transparent), transparent 100%)`,
            "--ax": `${l.dx}s`,
            "--ay": `${l.dy}s`,
            "--ad": `${l.d}s`,
            "--o-min": l.min,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}
