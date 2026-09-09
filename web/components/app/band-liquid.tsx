"use client"

/**
 * THE POOL — liquid chrome and lime, merging and pulling apart.
 *
 * HOW IT IS ACTUALLY LIQUID. Every blob is a plain rounded div; the parent carries an SVG
 * filter that blurs the group and then slams the alpha channel back to hard edges
 * (feGaussianBlur → feColorMatrix with a steep alpha ramp). Two shapes that come within a
 * blur-radius of each other stop having two outlines and start having one — the "gooey"
 * technique — so the merging is a real consequence of their positions, not a keyframe that
 * fakes it. Drive them on unequal periods and they pool, swallow one another and separate
 * without any of it being choreographed.
 *
 * WHY THIS AND NOT MORE OBJECTS. Five garments spread across a stripe read as five items and
 * a lot of gap, and no size or spacing fixed that — items at arm's length have no
 * relationship. A pool has the opposite property: it is one body, so there is one composition
 * and one motion, and "which of the five motions" stops being a question.
 *
 * THE TWO MATERIALS ARE THE BRAND, and they are the only colours here. Chrome is the
 * supplier-neutral metal already in the object family (obj-chrome); lime is ACID, which §4
 * allows as a fill ON THE PLATE and nowhere else — the band is the plate. They never blend
 * into a third colour: the filter merges SILHOUETTES, each blob keeps its own material, so
 * where they meet you get a chrome edge against a lime one, which is the whole point.
 */

const CHROME =
  "linear-gradient(135deg,#ffffff 0%,#d5d8e2 22%,#8d93a3 38%,#f4f5f9 52%,#9aa0af 68%,#e9ebf1 84%,#ffffff 100%)"
const LIME =
  "radial-gradient(circle at 32% 28%, #f2ffd6 0%, var(--mk-acid,#d4f897) 55%, #a8d857 100%)"

/** x/y are percentages of the BAND, size a percentage of its height; each drop moves on its
 *  own two clocks so the group never falls into a rhythm.
 *
 *  They start at 57% and run past the right edge on purpose: the pool has to be cut by the
 *  BAND, not by a box of its own, and a body of liquid that stops politely before the frame
 *  is a shape, not a pool. */
const DROPS: { m: "chrome" | "lime"; x: number; y: number; s: number; dx: number; dy: number; d: number }[] = [
  { m: "chrome", x: 56, y: 52, s: 108, dx: 13, dy: 9, d: -2 },
  { m: "lime", x: 64, y: 40, s: 84, dx: 9, dy: 11, d: -5 },
  { m: "chrome", x: 71, y: 62, s: 96, dx: 16, dy: 7.5, d: -1 },
  { m: "lime", x: 79, y: 44, s: 116, dx: 11, dy: 13, d: -7 },
  { m: "chrome", x: 87, y: 60, s: 90, dx: 8.5, dy: 10, d: -3 },
  { m: "lime", x: 94, y: 42, s: 104, dx: 14, dy: 8, d: -6 },
  { m: "chrome", x: 101, y: 58, s: 94, dx: 10.5, dy: 12, d: -4 },
]

export function BandLiquid() {
  return (
    <div aria-hidden className="eg-pool-wrap">
      {/* The filter lives with the thing it filters. One per band is fine — ids repeat across
          bands only in the lab, and a duplicate id resolves to the first, which is identical. */}
      <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
        <defs>
          <filter id="eg-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur" />
            {/* The alpha ramp is what turns a blur back into an edge: multiply alpha hard,
                then subtract, so mid-blur pixels fall off and only the merged core survives. */}
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"
              result="goo"
            />
          </filter>
        </defs>
      </svg>
      <div className="eg-pool">
        {DROPS.map((d, i) => (
          <span
            key={i}
            className="eg-pool-drop"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              height: `${d.s}%`,
              background: d.m === "chrome" ? CHROME : LIME,
              "--px": `${d.dx}s`,
              "--py": `${d.dy}s`,
              "--pd": `${d.d}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  )
}
