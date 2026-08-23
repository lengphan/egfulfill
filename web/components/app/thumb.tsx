"use client"

import { useState, type ReactNode } from "react"
import NextImage from "next/image"
import { ImageBroken } from "@phosphor-icons/react"

/**
 * ONE IMAGE TILE — and the single guarantee it makes:
 *
 *   A PICTURE THAT CANNOT LOAD NEVER BECOMES A PARAGRAPH.
 *
 * A bare `<img>` whose src fails is replaced by its ALT TEXT, and alt text on these
 * surfaces is the marketplace listing title — "Custom Embroidered Apron with Name,
 * Personalized Kitchen Apron, Cafe Barista Soft Uniform, …". Rendered into a 130px
 * column that is a wall of words six hundred pixels tall where a thumbnail should be,
 * shoving everything below it off the panel. `aspect-square` does NOT save you: once the
 * element stops being replaced content its min-content height wins over the ratio, so the
 * tile grows anyway. Only not-rendering-the-alt saves you.
 *
 * This was already known and already fixed FIVE separate times — design-canvas,
 * designer-board, digitizer-studio, stores-manager, purchase-view each grew their own
 * `useState` + `onError` — against 107 `<img>` sites, ~23 of which carry a name-bearing
 * alt. So it kept coming back everywhere nobody had been bitten yet. CLAUDE.md §4: a rule
 * with no component is a wish.
 *
 * WHY THE PICTURES BREAK, so the fallback is honest about it: buyer artwork is stored as a
 * URL and never copied (`order_items.design_src`). Etsy's sync accepts ANY `https://…`
 * value out of a listing variation, so that URL is as often a Dropbox share page, a
 * WeTransfer link or a PDF as it is an image — hosts that aren't on the img-proxy's
 * marketplace allowlist, so they are hotlinked raw and refused. There is nothing to render.
 * The tile says so; the caller offers the way out.
 */
export function Thumb({ src, alt = "", fit = "cover", className = "", icon, note, onBroken, ...rest }: {
  src?: string | null
  /** Still read by screen readers on a tile that loads. Never painted. */
  alt?: string
  fit?: "cover" | "contain"
  /** Size + shape — applied to the picture AND to the fallback, so neither can resize the row. */
  className?: string
  /** The glyph in the fallback tile. Defaults to a torn-picture mark. */
  icon?: ReactNode
  /** Hover text on the fallback. Defaults to naming the two states apart. */
  note?: string
  /** Fired once when the picture is refused, for a caller that has to say more than a
   *  grey tile can — a caption, a disabled action, a link to the original. */
  onBroken?: () => void
} & Pick<React.ImgHTMLAttributes<HTMLImageElement>, "onLoad" | "loading" | "draggable">) {
  /**
   * The FAILED URL, not a boolean. A boolean survives a src change, so swapping a broken
   * tile for a good one left the fallback showing — and the fix for that is normally a
   * reset effect, which renders stale for a frame (CLAUDE.md §5). Comparing to the current
   * src has no such window.
   */
  const [badSrc, setBadSrc] = useState<string | null>(null)

  if (!src || badSrc === src) {
    return (
      <span
        className={"flex items-center justify-center bg-muted text-muted-foreground/40 " + className}
        title={note ?? (src ? "This image couldn't be loaded" : "No image")}
        aria-label={alt || undefined}
        role={alt ? "img" : undefined}
      >
        {icon ?? <ImageBroken size={20} weight="duotone" />}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      src={src}
      alt={alt}
      onError={() => { setBadSrc(src); onBroken?.() }}
      className={"block " + (fit === "contain" ? "object-contain" : "object-cover") + " " + className}
    />
  )
}

/**
 * The same guarantee, over `next/image`.
 *
 * next/image has the identical defect — a refused src falls back to painting the alt — and
 * no fallback of its own, so the swap has to be ours. Kept beside Thumb rather than in each
 * caller because there are five SpyDeck grids alone whose alt is a competitor's Etsy listing
 * title, on hotlinked etsystatic URLs we do not control.
 *
 * `fill` only. Every caller of this shape sizes the picture with an aspect box around it,
 * which is also what keeps the fallback exactly the same size as the picture would have been.
 */
export function ThumbFill({ src, alt = "", fit = "cover", sizes, className = "", icon, note }: {
  src?: string | null
  alt?: string
  fit?: "cover" | "contain"
  sizes?: string
  className?: string
  icon?: ReactNode
  note?: string
}) {
  const [badSrc, setBadSrc] = useState<string | null>(null)

  if (!src || badSrc === src) {
    return (
      <span
        className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground/40"
        title={note ?? (src ? "This image couldn't be loaded" : "No image")}
        aria-label={alt || undefined}
        role={alt ? "img" : undefined}
      >
        {icon ?? <ImageBroken size={20} weight="duotone" />}
      </span>
    )
  }
  return (
    <NextImage
      src={src} alt={alt} fill sizes={sizes} unoptimized
      onError={() => setBadSrc(src)}
      className={(fit === "contain" ? "object-contain " : "object-cover ") + className}
    />
  )
}
