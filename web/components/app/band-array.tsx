"use client"

/**
 * THE FIELD — a rim-lit array of soft modules, with a wave travelling through it.
 *
 * WHY AN ARRAY AND NOT MORE OBJECTS. Five garments spread across the stripe never stopped
 * reading as five loose things, and no amount of size, speed or spacing fixed it: items at
 * arm's length from each other have no relationship, so the eye reads the GAPS. An array has
 * the opposite problem to solve — it is one object made of many, and a wave through it is one
 * motion, not five. That is also why a wave answers "which motion": there is only one.
 *
 * IT IS DRAWN, NOT RENDERED. A 3D render of a grid can only loop a baked animation, at a
 * fixed size, as another megabyte in the app header. Twenty divs in a rotated plane cost
 * nothing, resize with the band, and let the wave be an actual animation whose speed, depth
 * and direction are numbers we can move. It is also the only version that can respond to
 * something real later — the row that carries today's work — without re-rendering an asset.
 *
 * THE LIGHT IS THE BRAND, AND IT IS THE ONLY COLOUR HERE. §4 reserves ACID for "a fill on
 * the plate, never on white" — the band IS the plate, so a lime edge-glow between modules is
 * exactly where that colour is allowed to live, and nowhere else on this surface. The modules
 * themselves stay neutral: white-through-grey, the colour of a blank.
 */

const COLS = 18
const ROWS = 3

export function BandArray() {
  const cells = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells.push(
        <span
          key={`${r}-${c}`}
          className="eg-field-cell"
          /* The wave is a DIAGONAL: the delay is the sum of the two coordinates, so it
             enters at the near corner and leaves at the far one. Delaying by column alone
             gives a curtain, by row alone a rolling shutter — the diagonal is the one that
             reads as something passing through a field rather than a UI transition. */
          style={{ "--d": `${(r + c) * 70}ms` } as React.CSSProperties}
        />,
      )
    }
  }
  return (
    <div aria-hidden className="eg-field-wrap">
      <div className="eg-field" style={{ "--cols": COLS, gridTemplateRows: `repeat(${ROWS}, 1fr)` } as React.CSSProperties}>
        {cells}
      </div>
    </div>
  )
}
