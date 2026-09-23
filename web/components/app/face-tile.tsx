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
export function FaceTile({ url, layers, label, active, extra, extraPending, onSelect }: {
  url: string
  layers: { src: string; pos: Pos }[]
  label: string
  active: boolean
  /**
   * WHAT THIS FACE COSTS — a figure, or the word that stands in for one.
   *
   * It used to be null on anything free, on the reasoning that "a price of nothing is noise
   * on every single-sided line". The rail then went silent on exactly the faces a seller is
   * deciding about: three empty tiles under a Front reading "+$2.00" say nothing about
   * whether printing them is free, and a charged face whose picture this window had not
   * loaded said nothing either. The caller answers for every face now.
   */
  extra?: string | null
  /**
   * THE FIGURE IS WHAT THIS FACE WILL COST, NOT WHAT IT HAS COST.
   *
   * A surface fee is priced from the TECHNIQUE, so it is knowable before any artwork exists
   * — which is the whole reason the rail can show it up front instead of producing it once a
   * file is dropped. But a face with no file is charged nothing until one lands, so printing
   * the figure in the same ink as a billed face would claim money that is not owed.
   *
   * Muted ink, same size, same number. When the file lands the figure does not move; only
   * its weight does.
   */
  extraPending?: boolean
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
        + (active ? "border-selected eg-selected" : "border-transparent hover:border-border hover:bg-accent/50")}
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-md bg-white ring-1 ring-inset ring-border">
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
        + (active ? "" : "text-muted-foreground")}>{label}</span>
      {/* MONEY IS A VALUE, A WORD IS A LABEL, and they are sized by what they ARE rather
          than by how small the tile is (CLAUDE.md §4). This was 9px — below the scale
          entirely — on the one thing in the rail somebody has to read a digit of. */}
      {extra && (
        <span className={"w-full text-center leading-tight "
          + (/\d/.test(extra)
            ? "truncate text-xs font-medium tabular-nums "
              + (extraPending ? "text-muted-foreground" : "text-foreground")
            /* A WORD WRAPS, a figure does not. "+ design fee" truncated to "+ design…" in a
               72px tile, which is the half that says nothing — the whole value of the line
               is the word "fee". Two short lines cost the empty tiles a few pixels of
               height and say the thing. */
            : "text-2xs text-muted-foreground")}>{extra}</span>
      )}
    </button>
  )
}
