"use client"

import { useState } from "react"
import { SupplierFlag } from "@/components/app/supplier-flag"
import { clickableProps } from "@/lib/a11y"
import { Heart, Plus, CheckCircle, CircleNotch, ShoppingCart, ArrowsClockwise } from "@phosphor-icons/react"
import { swatchBg } from "@/lib/color-swatch"
import { prettyColorName } from "@/lib/color-name"
import { cn } from "@/lib/utils"
import { CARD_ACTION_PRIMARY, CARD_ACTION_SECONDARY } from "@/lib/card-actions"

// One product card for BOTH suppliers (S&S + Otto) so they look identical: image, brand,
// title, price (range where applicable), clickable color chips that swap to that color's
// photo (loaded lazily), a heart, and an Add-to-catalog button pinned to the bottom.
export type SupplierCardData = {
  id: string
  title: string
  brand?: string | null
  subtitle?: string | null // category
  image?: string | null
  price?: number | string | null
  priceMax?: number | string | null
  // A colour is a bare name OR {name, swatch-image-url}. The card renders the real swatch
  // image when present, else falls back to the name→hex guess.
  colors?: (string | { name: string; swatch?: string | null })[] | null
  sizesCount?: number
  /** Actual size names (S, M, L…). Otto ships these on the list; S&S only on the style
   *  detail, so they arrive once loadDetail resolves. */
  sizes?: string[] | null
  /**
   * The supplier's size data is COMPLETE and shows no size dimension → one size (OSFM).
   *
   * This exists to break a genuine ambiguity: an empty `sizes` array means two opposite
   * things depending on the supplier. Otto returns every size on the list, so empty there
   * is "this product isn't sized" — a real fact. S&S returns sizes only on the style
   * detail, so empty there is "not loaded yet" — no fact at all. Only the caller knows
   * which, so only the caller sets this; the card must NOT infer "one size" from an empty
   * array, or it would label an unloaded S&S product as OSFM.
   */
  oneSize?: boolean
  favorited?: boolean
}

export function SupplierProductCard({
  data, added, adding, onAdd, onFavorite, loadColors, supplierLabel, onQuickOrder, onSync, onOpenDetail,
}: {
  data: SupplierCardData
  /**
   * How the product photo fills the square bed.
   *
   * "contain" is the right default and why the bed is square at all — S&S mixes lifestyle
   * and product shots, and cropping a lifestyle photo cuts the subject.
   *
   * SanMar needs "cover". EVERY SanMar image is 1200x1800 (2:3 portrait) with the product
   * centred inside generous white padding — measured across caps and apparel, detail, model
   * and flat variants alike. Contained in a square bed that letterboxes to 67% of the width
   * before the image's own padding is even counted, so the product reads as tiny beside
   * Otto's square shots. Because the shape and centring are uniform across their whole
   * catalogue, cropping to square removes padding rather than product.
   */
  added: boolean
  adding: boolean
  onAdd: () => void
  onFavorite?: (on: boolean) => void
  loadColors?: () => Promise<Record<string, string>> // color → photo (fetched on first chip click)
  supplierLabel?: string // e.g. "S&S" / "Otto" — shown as a badge when browsing both at once
  /** Open the full-detail window. Absent → the picture is inert, as before. */
  onOpenDetail?: () => void
  /** Order this straight from the browse grid, without importing it to the catalogue
   *  first. Separate from onAdd on purpose: adding to the CATALOGUE is about what we
   *  sell, ordering is about what we buy, and conflating them is how a blank ends up
   *  listed for sale because someone needed six of it. */
  onQuickOrder?: () => void
  /** Re-sync THIS product from the supplier. Passed only where a per-item sync exists —
   *  S&S, whose full sync-all takes hours; an Otto card has no live per-style fetch, so it
   *  gets no button rather than one that does nothing. Resolves when the sync completes so
   *  the card can show the outcome. */
  onSync?: () => Promise<void> | void
}) {
  const [img, setImg] = useState<string | null>(data.image ?? null)
  const [activeColor, setActiveColor] = useState<string | null>(null)
  const [colorImages, setColorImages] = useState<Record<string, string> | null>(null)
  const [loadingColor, setLoadingColor] = useState(false)
  const [fav, setFav] = useState(!!data.favorited)
  // "+9" used to be dead text. Clicking it now reveals every colour the product comes in.
  const [showAllColors, setShowAllColors] = useState(false)
  // Same expand affordance the colour row has, now that sizes are the card's only size UI.
  const [showAllSizes, setShowAllSizes] = useState(false)
  // Per-card sync state. `done` briefly confirms so a card that looked unchanged (already
  // fresh) doesn't read as a no-op, then clears.
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const runSync = async () => {
    if (!onSync || syncing) return
    setSyncing(true); setSynced(false)
    try { await onSync(); setSynced(true); setTimeout(() => setSynced(false), 1800) }
    finally { setSyncing(false) }
  }

  const price = data.price != null && data.price !== "" ? Number(data.price) : null
  const priceMax = data.priceMax != null && data.priceMax !== "" ? Number(data.priceMax) : null
  const priceLabel = price == null ? null
    : (priceMax != null && priceMax > price ? `$${price.toFixed(2)}–$${priceMax.toFixed(2)}` : `$${price.toFixed(2)}`)

  const pickColor = async (c: string) => {
    setActiveColor(c)
    let map = colorImages
    if (!map && loadColors) {
      setLoadingColor(true)
      try { map = await loadColors(); setColorImages(map) } catch { /* keep current image */ } finally { setLoadingColor(false) }
    }
    if (map?.[c]) setImg(map[c])
  }

  const toggleFav = () => { const next = !fav; setFav(next); onFavorite?.(next) }
  // Normalise both colour shapes (bare name | {name, swatch}) to one form the row renders.
  const colors = (data.colors ?? []).map((c) => (typeof c === "string" ? { name: c, swatch: null } : { name: c.name, swatch: c.swatch ?? null }))
  const sizeNames = (data.sizes ?? []).filter(Boolean)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* White image bed so S&S lifestyle shots sit on the same background as Otto's
          white product shots — product photography reads as white regardless of UI theme. */}
      {/* PORTRAIT BED, for every supplier — the fix this file's own note prescribed.
          A square bed suits Otto (square art) and punishes SanMar, whose photos are
          1200x1800 portrait: contain fits them to the HEIGHT and leaves a third of the
          width white, so a cap reads small beside an S&S model shot that happens to fill
          the frame. That unevenness is a bed-shape problem, not a per-supplier one.
          4:5 costs Otto's squares a thin band top and bottom and gives SanMar's portraits
          back most of that width — more even across the grid, which is the actual ask.
          Cropping remains off the table: a catalogue tile whose job is "is this the blank
          I want" has to show the whole product. */}
      {/* The picture is the way IN to the detail window — it is the thing the eye lands on
          and the thing that cannot answer "will this do". Not a <button>: the favourite
          control lives inside this frame, and a button inside a button is invalid. Same
          keyboard behaviour via the shared helper. */}
      <div
        {...(onOpenDetail ? clickableProps(onOpenDetail, `Open ${data.title ?? "this blank"}`) : {})}
        /**
         * A SHORTER BED, AND THE PRODUCT INSET IN IT.
         *
         * 4:5 made every tile 1.25× as tall as it is wide, so a grid of caps ran off the
         * screen vertically for no gain — a cap is a wide object and was being given a
         * portrait frame. Square is the shortest bed that still fits the portrait garment
         * shots without cropping, which is the constraint the notes below spent two attempts
         * arriving at: change the bed for everyone, never crop for one supplier.
         *
         * The p-[7%] is the "zoom out": contain fitted the product edge to edge, so a cap
         * touched the sides of its own tile and read as cropped even though nothing was cut.
         * The inset is on the IMAGE, not the well, so the white bed still reaches the card's
         * border and the tile keeps its shape.
         */
        className={"relative aspect-square shrink-0 overflow-hidden bg-white " + (onOpenDetail ? "cursor-zoom-in" : "")}
      >
        {img ? (
          // absolute inset-0 is load-bearing. As an in-flow child, `size-full` means
          // height:100% against a parent whose height comes from aspect-ratio — an
          // INDEFINITE height — so the percentage resolved to auto and the img fell
          // back to its INTRINSIC height. A portrait blank then stretched the square
          // box (measured: 190px tall in a 152px-wide box, +38px) and pushed the whole
          // card 38px taller, so titles/prices/swatches sat lower than the card beside
          // it. It looked per-supplier because S&S art is often portrait and Otto's is
          // square — but a square S&S image aligned fine, which is the tell.
          // Absolutely-positioned children don't contribute to the parent's height, so
          // the box is now exactly square regardless of the image's shape.
          //
          // CONTAIN, always. There is no per-supplier override any more: SanMar art was
          // switched to object-cover because it "rendered tiny", but the images are
          // 1200x1800 — portrait 2:3, measured off the live CDN — not small. In a square
          // bed, contain fits them to the height and leaves a third of the width white,
          // which reads as small beside S&S's square shots; cover instead fills the square
          // by cropping a third of the HEIGHT off, which is what cut the tops and bottoms
          // off caps and backpacks. A catalogue tile whose job is "is this the blank I
          // want" must show the whole product, so the whitespace stays and the crop goes.
          // If they still read small, the fix is the tile's aspect ratio for every
          // supplier, not a crop for one.
          // NO PER-SUPPLIER ZOOM. Measured against the live CDN, SanMar publish caps in
          // two shapes: 1200x1800 portraits (DT629, TM1MY393) and ~1212x1199 squares (the
          // "Flat" shots, e.g. CP95). In a 4:5 bed those fit along OPPOSITE axes — the
          // portrait fits to height and can absorb a zoom by eating its vertical white
          // margin, while the square fits to width and clips the moment scale passes 1.0.
          // One number cannot serve both, which is why only SanMar caps misbehaved.
          //
          // So the bed shape does the work and nothing is scaled. That is the same
          // conclusion this file reached the first time: fix the tile for every supplier,
          // never crop for one.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-[7%]" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/50">No image</div>
        )}
        {onFavorite && (
          <button onClick={toggleFav} title={fav ? "Unfavorite" : "Favorite"}
            className={"absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border transition-colors " + (fav ? "border-rose-200 bg-rose-50 text-rose-500" : "border-border bg-background/80 text-muted-foreground hover:text-rose-500")}>
            <Heart size={14} weight={fav ? "fill" : "regular"} />
          </button>
        )}
        {supplierLabel && <SupplierFlag label={supplierLabel} className="absolute left-2 top-2" />}
        {/* Per-card sync, bottom-left — the empty image corner (flag top-left, heart
            top-right). Offered only where onSync is wired (S&S), so a click always does
            something. This is the answer to "sync-all takes hours": refresh the one style
            whose data didn't load, not the whole catalogue. */}
        {onSync && (
          <button onClick={runSync} disabled={syncing}
            title={synced ? "Synced" : "Re-sync this style from the supplier"}
            aria-label="Re-sync this product"
            className={"absolute bottom-2 left-2 flex size-7 items-center justify-center rounded-full border transition-colors " +
              (synced ? "border-emerald-200 bg-emerald-50 text-success"
                : "border-border bg-background/80 text-muted-foreground hover:text-primary disabled:opacity-60")}>
            {syncing ? <CircleNotch size={14} className="animate-spin" />
              : synced ? <CheckCircle size={14} weight="fill" />
              : <ArrowsClockwise size={14} weight="bold" />}
          </button>
        )}
        {loadingColor && <div className="absolute inset-0 flex items-center justify-center bg-background/40"><CircleNotch size={18} className="animate-spin text-muted-foreground" /></div>}
      </div>

      <div className="flex flex-1 flex-col p-2.5">
        {/* Fixed-height brand + 2-line title so titles align across every card (S&S + Otto). */}
        <div className="h-4 truncate text-3xs font-semibold uppercase tracking-wide text-muted-foreground">{data.brand || ""}</div>
        <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug">{data.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.subtitle && <span className="truncate">{data.subtitle}</span>}
          {priceLabel && <span className="ml-auto shrink-0 font-semibold text-foreground">{priceLabel}</span>}
        </div>

        {/* Colors — round swatches (split for two-tone), fixed-height row so cards align */}
        <div className={"mt-2 flex items-center gap-1.5 " + (showAllColors ? "flex-wrap" : "h-6 overflow-hidden")}>
          {colors.length === 0 ? (
            <span className="text-3xs text-muted-foreground/60">—</span>
          ) : (
            <>
              {(showAllColors ? colors : colors.slice(0, 7)).map((c) => {
                const bg = swatchBg(c.name)
                const ring = activeColor === c.name ? "ring-2 ring-primary ring-offset-1 " : ""
                // Real supplier swatch image wins; then a name→hex guess; then a "?" chip.
                if (c.swatch) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={c.name} src={c.swatch} alt={prettyColorName(c.name)} title={prettyColorName(c.name)} loading="lazy" onClick={() => pickColor(c.name)}
                      className={"size-5 shrink-0 cursor-pointer rounded-full border border-black/15 object-cover transition-transform hover:scale-110 " + ring} />
                  )
                }
                return (
                  <button key={c.name} onClick={() => pickColor(c.name)} title={prettyColorName(c.name)} style={bg ? { background: bg } : undefined}
                    className={"size-5 shrink-0 rounded-full border transition-transform hover:scale-110 " + ring + (bg ? "border-black/15" : "flex items-center justify-center border-dashed border-border bg-muted text-3xs text-muted-foreground")}>
                    {!bg && "?"}
                  </button>
                )
              })}
              {colors.length > 7 && (
                <button
                  onClick={() => setShowAllColors((v) => !v)}
                  title={showAllColors ? "Show fewer colours" : `Show all ${colors.length} colours`}
                  className="shrink-0 rounded px-1 text-3xs font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  {showAllColors ? "Show less" : `+${colors.length - 7}`}
                </button>
              )}
            </>
          )}
        </div>
        {/* The picked colour's real name (codes stripped), or nothing. */}
        <div className="mt-1 h-3.5 truncate text-3xs text-muted-foreground">{activeColor ? prettyColorName(activeColor) : ""}</div>

        {/* Sizes by NAME, not a count — "2 sizes" doesn't tell you whether it's S/M or
            3XL/4XL. This is now the ONLY size display on the card: the "Edit colours &
            sizes" link that used to sit below it was removed because it called the exact
            same handler as Add to Products (onEditVariants === onAdd in every caller), so
            it was a second button for the one action, worded as if it did something else.
            With it gone, the full size set expands here rather than hiding behind it. */}
        <div className={"mt-1 flex items-center gap-1 " + (showAllSizes ? "flex-wrap" : "h-5 overflow-hidden")}>
          {sizeNames.length === 0 ? (
            // Three DIFFERENT empty states, said apart. "One size" is a fact the supplier
            // gave us (OSFM); a bare count is names-missing; "—" is genuinely unknown, which
            // for S&S means the sizes just haven't loaded — never dressed up as one-size.
            data.oneSize ? (
              <span className="rounded border border-border px-1 py-0.5 text-3xs font-medium text-muted-foreground" title="One size fits most — this product isn't broken out by size">
                One size
              </span>
            ) : (
              <span className="text-3xs text-muted-foreground/60">{(data.sizesCount ?? 0) > 0 ? `${data.sizesCount} sizes` : "—"}</span>
            )
          ) : (
            <>
              {(showAllSizes ? sizeNames : sizeNames.slice(0, 6)).map((sz) => (
                <span key={sz} className="shrink-0 rounded border border-border px-1 py-0.5 text-3xs font-medium text-muted-foreground">{sz}</span>
              ))}
              {sizeNames.length > 6 && (
                <button
                  onClick={() => setShowAllSizes((v) => !v)}
                  title={showAllSizes ? "Show fewer sizes" : `Show all ${sizeNames.length} sizes`}
                  className="shrink-0 rounded px-0.5 text-3xs font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  {showAllSizes ? "less" : `+${sizeNames.length - 6}`}
                </button>
              )}
            </>
          )}
        </div>

        {/* Order and Add to Products share the width EVENLY — both flex-1 — so neither
            reads as the lesser action. When Order isn't offered (favourites, some grids),
            Add to Products is the only child and takes the whole row on its own. */}
        <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
          {onQuickOrder && (
            <button onClick={onQuickOrder} title="Order this — quantities and prices per size"
              className={cn(CARD_ACTION_SECONDARY, "w-full")}>
              <ShoppingCart size={13} weight="bold" /> Order
            </button>
          )}
          <button onClick={onAdd} disabled={added || adding}
            className={cn(
              added
                ? CARD_ACTION_SECONDARY + " border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : CARD_ACTION_PRIMARY,
              "w-full", !onQuickOrder && "col-span-2",
            )}>
            {adding ? <CircleNotch size={13} className="animate-spin" /> : added ? <><CheckCircle size={13} weight="fill" /> Added</> : <><Plus size={13} weight="bold" /> Add to Products</>}
          </button>
        </div>
      </div>
    </div>
  )
}
