"use client"

import { canvasReadableSrc } from "@/lib/thread-match"
import type { Pos } from "@/components/app/design-canvas"

/**
 * ONE FACE, DRAWN AS ITSELF.
 *
 * The sides were two words in a pill row — "Front" and "Back", with a dot on the ones
 * carrying work — so the only way to learn whether the back had anything on it was to press
 * it and look. On a four-face blank that is three round trips to answer "is this finished",
 * which is the question both editors are open to answer. Both had the same pill row and the
 * same note admitting the dot was the only signal; now they have the same tile.
 *
 * The tile is the garment with its own artwork on it, at the placement it is actually saved
 * at. Nothing here is interactive except the tile itself: it is a picture of a state, and a
 * handle on it.
 *
 * A LIST of layers, not one picture. An order line holds a single artwork per face and the
 * Maker holds a stack, and a tile that could only draw the bottom layer would quietly
 * misreport a two-layer design as a one-layer one. The caller with a single artwork passes a
 * list of one, which costs it nothing.
 *
 * Same %-frame as the stage — square, `pos` in percentages — so what a 64px tile shows is
 * what the 500px stage shows.
 */
export function FaceTile({ url, layers, label, active, extra, onSelect }: {
  url: string
  layers: { src: string; pos: Pos }[]
  label: string
  active: boolean
  /** What this face ADDS per unit, when it is not the first printed one. Null → free, and
   *  nothing is said: a price of nothing is noise on every single-sided line. */
  extra?: string | null
  onSelect: () => void
}) {
  const has = layers.length > 0
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      title={has ? `${label} — has artwork` : `${label} — empty`}
      className={"group flex w-full flex-col items-center gap-1 rounded-lg border p-1 transition-colors "
        + (active ? "border-primary bg-primary/5" : "border-transparent hover:border-border hover:bg-accent/50")}
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-md bg-muted/40">
        {url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt="" className="absolute inset-0 size-full object-contain p-[4%]" />
        )}
        {layers.map((l, i) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={i}
            src={canvasReadableSrc(l.src)} alt=""
            className="absolute block"
            style={{
              left: `${l.pos.x}%`, top: `${l.pos.y}%`, width: `${l.pos.w}%`,
              transform: `translate(-50%,-50%) rotate(${l.pos.r}deg)`,
            }}
          />
        ))}
      </span>
      <span className={"w-full truncate text-center text-[10px] font-medium capitalize leading-none "
        + (active ? "text-primary" : "text-muted-foreground")}>{label}</span>
      {extra && (
        <span className="text-[9px] leading-none tabular-nums text-muted-foreground">{extra}</span>
      )}
    </button>
  )
}
