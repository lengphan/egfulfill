"use client"

import { useState } from "react"
import { Heart, Plus, CheckCircle, CircleNotch } from "@phosphor-icons/react"
import { swatchBg } from "@/lib/color-swatch"

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
  colors?: string[] | null
  sizesCount?: number
  favorited?: boolean
}

export function SupplierProductCard({
  data, added, adding, onAdd, onFavorite, loadColors, supplierLabel,
}: {
  data: SupplierCardData
  added: boolean
  adding: boolean
  onAdd: () => void
  onFavorite?: (on: boolean) => void
  loadColors?: () => Promise<Record<string, string>> // color → photo (fetched on first chip click)
  supplierLabel?: string // e.g. "S&S" / "Otto" — shown as a badge when browsing both at once
}) {
  const [img, setImg] = useState<string | null>(data.image ?? null)
  const [activeColor, setActiveColor] = useState<string | null>(null)
  const [colorImages, setColorImages] = useState<Record<string, string> | null>(null)
  const [loadingColor, setLoadingColor] = useState(false)
  const [fav, setFav] = useState(!!data.favorited)

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
  const colors = data.colors ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-square shrink-0 overflow-hidden bg-muted">
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
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" loading="lazy" className="absolute inset-0 size-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/50">No image</div>
        )}
        {onFavorite && (
          <button onClick={toggleFav} title={fav ? "Unfavorite" : "Favorite"}
            className={"absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border transition-colors " + (fav ? "border-rose-200 bg-rose-50 text-rose-500" : "border-border bg-background/80 text-muted-foreground hover:text-rose-500")}>
            <Heart size={14} weight={fav ? "fill" : "regular"} />
          </button>
        )}
        {supplierLabel && (
          <span className="absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-semibold text-background backdrop-blur">{supplierLabel}</span>
        )}
        {loadingColor && <div className="absolute inset-0 flex items-center justify-center bg-background/40"><CircleNotch size={18} className="animate-spin text-muted-foreground" /></div>}
      </div>

      <div className="flex flex-1 flex-col p-2.5">
        {/* Fixed-height brand + 2-line title so titles align across every card (S&S + Otto). */}
        <div className="h-4 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{data.brand || ""}</div>
        <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug">{data.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.subtitle && <span className="truncate">{data.subtitle}</span>}
          {priceLabel && <span className="ml-auto shrink-0 font-semibold text-foreground">{priceLabel}</span>}
        </div>

        {/* Colors — round swatches (split for two-tone), fixed-height row so cards align */}
        <div className="mt-2 flex h-6 items-center gap-1.5 overflow-hidden">
          {colors.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/60">—</span>
          ) : (
            <>
              {colors.slice(0, 7).map((c) => {
                const bg = swatchBg(c)
                return (
                  <button key={c} onClick={() => pickColor(c)} title={c} style={bg ? { background: bg } : undefined}
                    className={"size-5 shrink-0 rounded-full border transition-transform hover:scale-110 " + (activeColor === c ? "ring-2 ring-primary ring-offset-1 " : "") + (bg ? "border-black/15" : "flex items-center justify-center border-dashed border-border bg-muted text-[8px] text-muted-foreground")}>
                    {!bg && "?"}
                  </button>
                )
              })}
              {colors.length > 7 && <span className="shrink-0 text-[10px] font-medium text-muted-foreground">+{colors.length - 7}</span>}
            </>
          )}
        </div>
        <div className="mt-1 h-3.5 truncate text-[10px] text-muted-foreground">{activeColor || ((data.sizesCount ?? 0) > 0 ? `${data.sizesCount} sizes` : "")}</div>

        <div className="mt-auto pt-3">
          <button onClick={onAdd} disabled={added || adding}
            className={"flex w-full items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold transition-colors " + (added ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground")}>
            {adding ? <CircleNotch size={13} className="animate-spin" /> : added ? <><CheckCircle size={13} weight="fill" /> Added</> : <><Plus size={13} weight="bold" /> Add to catalog</>}
          </button>
        </div>
      </div>
    </div>
  )
}
