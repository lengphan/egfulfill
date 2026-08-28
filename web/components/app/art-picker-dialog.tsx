"use client"

import { useLabelT } from "@/lib/i18n"
import { useMemo, useState } from "react"
import { ImageSquare, MagnifyingGlassPlus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchField } from "@/components/app/search-field"
import { Thumb } from "@/components/app/thumb"
import { useLightbox } from "@/components/app/image-lightbox"

export type ArtItem = {
  /** The value handed back on pick — the RAW url the canvas should place. */
  url: string
  /** What to DISPLAY, when that differs (buyer art has to come through the img proxy). */
  src?: string
  name?: string
  /** Order number, or whatever names the source. Shown as a caption, never over the art. */
  badge?: string
}

/**
 * Browse every image in one source, with a search box.
 *
 * The design maker's left rail used to render all of them — three hundred buyer uploads in a
 * 60px-wide column, each with the order number in a black chip ACROSS the picture. You could
 * not tell what any of them were, and the rail scrolled for a minute. The rail now shows the
 * newest handful and sends you here for the rest, which is the only place with room to show
 * a thumbnail big enough to recognise and put the order number underneath it instead of on
 * top of it.
 */
export function ArtPickerDialog({
  open,
  onOpenChange,
  title,
  items,
  onPick,
  emptyText = "Nothing here yet.",
  searchPlaceholder = "Search by order number or name…",
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  items: ArtItem[]
  onPick: (url: string) => void
  emptyText?: string
  searchPlaceholder?: string
}) {
  const tl = useLabelT()
  const [qy, setQy] = useState("")
  const zoom = useLightbox()

  const shown = useMemo(() => {
    const needle = qy.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (it) => `${it.badge ?? ""} ${it.name ?? ""}`.toLowerCase().includes(needle),
    )
  }, [items, qy])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {/* Portalled at z-[80], so it opens ABOVE this dialog rather than behind it. */}
        {zoom.node}
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        {/* Remounted with the dialog (key on `open`) rather than cleared by an effect, so a
            second visit never renders the previous search for a frame. */}
        <SearchField
          key={String(open)}
          value={qy}
          onChange={setQy}
          placeholder={searchPlaceholder}
          ariaLabel={searchPlaceholder}
        />

        <div className="max-h-[58vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              <ImageSquare size={22} weight="duotone" /> {emptyText}
            </div>
          ) : shown.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              Nothing matches &ldquo;{qy.trim()}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {shown.map((it, i) => (
                <button
                  key={it.url + i}
                  type="button"
                  onClick={() => { onPick(it.url); onOpenChange(false) }}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-primary hover:bg-accent"
                >
                  {/* object-CONTAIN, not cover: the whole artwork, uncropped, is the point of
                      opening this. The rail crops to fit its column; this does not.
                      Through Thumb, because `name` here is the marketplace listing title and
                      a refused hotlink would paint the whole of it in place of the picture. */}
                  <div className="group/well relative flex aspect-square items-center justify-center bg-muted p-2">
                    <Thumb src={it.src ?? it.url} alt={it.name || ""} fit="contain" className="max-h-full max-w-full bg-transparent" />
                    {/* Picking is the primary click; looking is a separate, smaller one. A
                        stopPropagation rather than a nested button, because this well IS
                        inside the pick button. */}
                    <span
                      role="button" tabIndex={0}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoom.open(it.src ?? it.url, it.name) }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); zoom.open(it.src ?? it.url, it.name) } }}
                      title={tl("artPicker", "View full size")}
                      className="absolute left-1.5 top-1.5 hidden size-6 cursor-zoom-in items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75 group-hover/well:flex"
                    >
                      <MagnifyingGlassPlus size={12} weight="bold" />
                    </span>
                  </div>
                  <div className="border-t border-border p-2">
                    {it.badge && <div className="text-2xs font-semibold text-primary">{it.badge}</div>}
                    <div className="truncate text-xs text-muted-foreground">{it.name || tl("artPicker", "Untitled")}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <p className="text-2xs text-muted-foreground">
            {shown.length === items.length
              ? `${items.length} image${items.length === 1 ? "" : "s"}`
              : `${shown.length} of ${items.length}`}
            {tl("artPicker", " · click one to place it on the design")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
