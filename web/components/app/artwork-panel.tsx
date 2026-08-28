"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, LinkSimpleBreak, MagnifyingGlassPlus, Trash, UploadSimple } from "@phosphor-icons/react"
import { Thumb } from "@/components/app/thumb"
import { TabBar } from "@/components/app/tab-bar"
import { ArtPickerDialog, type ArtItem } from "@/components/app/art-picker-dialog"
import { useLightbox } from "@/components/app/image-lightbox"
import { canvasReadableSrc } from "@/lib/thread-match"
import { proxiedImageSrc } from "@/lib/order-image"
import { orderRefLabel } from "@/lib/order-format"
import {
  getSellerImages, uploadSellerImage, deleteSellerImage,
  getDesignLibrary, getDesignLibraryItem, deleteDesignLibrary,
  getOrderUploads, getTemplates,
  type SellerImage, type OrderUpload, type LibraryDesign, type ProductTemplate,
} from "@/lib/api"

/**
 * WHERE A PICTURE COMES FROM — one panel, both editors.
 *
 * The Design Maker has had this since it was built: your uploads, your saved designs, the
 * artwork buyers sent with their orders, and your templates, four tabs and a grid. The order
 * dialog had none of it. Its only route to a picture was a popover behind a button marked
 * "Files", so on an empty face the entire window was a dashed box and two icons — you could
 * not see that you already owned the artwork you were about to go and find.
 *
 * Extracted rather than copied. `lib/` holds the pure logic in this codebase and a component
 * only one screen imports is a private copy waiting to be found in three files, which is a
 * mistake this repo has already made with the order readers and the DPI helpers.
 *
 * The HOST decides which sources it can honour, because they are not the same act: placing
 * a picture adds artwork, and applying a template REPLACES the blank, the stack and the
 * print area. A surface with one line and one garment has nowhere to put the second, so it
 * simply does not offer that tab.
 */

export type ArtworkSource = "yours" | "orders" | "templates"

/** How many each source shows before it defers to Browse. Six — two rows of three. It is a
 *  shortcut to the few you just used, not a file manager; rendering all 300 buyer uploads is
 *  what buried the rest of the panel the last time this was tried. */
const LIMIT = 6

type RailArt = {
  key: string
  url: string
  src?: string
  name?: string
  badge?: string
  title?: string
  measure?: boolean
  onPlace: () => void
  onDelete?: () => void
}

/**
 * ONE TILE. Moved here from design-maker.tsx unchanged — it takes props only, so it was
 * always shared code sitting in one screen's file.
 */
export function ImageThumb({ url, src, name, badge, title, measure = true, onPlace, onDelete, onZoom }: {
  url: string; src?: string; name?: string; badge?: string; title?: string; measure?: boolean
  onPlace: () => void; onDelete?: () => void; onZoom?: () => void
}) {
  const tl = useLabelT()
  /**
   * THE SIZE, MEASURED FROM THE PICTURE ITSELF.
   *
   * There was no way to tell a 4500px file from a 400px one before placing it — you found
   * out from the quality meter after it was on the garment, which is the wrong end of the
   * job. The image is being decoded to draw the thumbnail anyway, so onLoad already knows.
   */
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null)
  /** Under 1200px on its long edge is soft on anything bigger than a pocket print, which is
   *  worth saying HERE — the cheapest moment to pick a different file is before placing it. */
  const small = dim != null && Math.max(dim.w, dim.h) > 0 && Math.max(dim.w, dim.h) < 1200
  /**
   * THE FILE IS NOT THERE. Buyer art is held as a URL and never copied, and Etsy hands us
   * whatever the buyer typed into a listing variation — so a share page, an expired link or
   * a PDF arrives looking exactly like an image. It cannot be placed: a layer whose picture
   * never loads is an invisible object on the garment. So the tile stops being a button and
   * becomes the link to the original.
   */
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <a
        href={url} target="_blank" rel="noreferrer"
        title={[title || [badge, name].filter(Boolean).join(" · "), tl("designMaker", "Not an image we can load — opens the original")].filter(Boolean).join(" · ")}
        className="block w-full overflow-hidden rounded-md border border-border transition-colors hover:border-primary/50"
      >
        <Thumb className="aspect-square w-full" icon={<LinkSimpleBreak size={18} weight="duotone" />} note="" />
        <span className="block truncate border-t border-border bg-card px-1 py-0.5 text-2xs font-medium text-hold">
          {tl("designMaker", "Can’t load")}
        </span>
      </a>
    )
  }
  return (
    <div className="group/thumb relative">
      <button
        type="button" onClick={onPlace}
        title={[title || [badge, name].filter(Boolean).join(" · "), dim ? `${dim.w} × ${dim.h} px` : null].filter(Boolean).join(" · ") || tl("designMaker", "Place on the design")}
        className="block w-full overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary/50"
      >
        {/* A picture that fails must not paint its ALT — and the alt here is the marketplace
            listing title, so a refused buyer upload rendered a paragraph of "Custom
            Embroidered Apron with Name, Personalized Kitchen Apron, …" down the column. */}
        <Thumb
          src={src ?? url} alt={name || ""}
          onLoad={measure ? (e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }) : undefined}
          onBroken={() => setBroken(true)}
          className="aspect-square w-full"
        />
        {/* THE PIXELS, not a truncated id. What you need before dropping a file on a garment
            is how big it is. Amber when it is too small to print large. */}
        <span className={"block truncate border-t border-border bg-card px-1 py-0.5 text-2xs font-medium tabular-nums " +
          (small ? "text-hold" : "text-muted-foreground")}>
          {dim ? `${dim.w}×${dim.h}` : badge || (measure ? "…" : name || "")}
        </span>
      </button>
      {/* LOOKING IS NOT PLACING. The tile's click puts the artwork on the garment; at 130px
          two of a seller's logos are a smudge apart, so the magnifier is its own control. */}
      {onZoom && (
        <button
          type="button" onClick={onZoom} title={tl("designMaker", "View full size")}
          className="absolute left-1 top-1 hidden size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 group-hover/thumb:flex"
        >
          <MagnifyingGlassPlus size={11} weight="bold" />
        </button>
      )}
      {onDelete && (
        <button
          type="button" onClick={onDelete} title={tl("designMaker", "Remove from your library")}
          className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-alert group-hover/thumb:flex"
        >
          <Trash size={11} weight="bold" />
        </button>
      )}
    </div>
  )
}

export function ArtworkPanel({
  sources = ["yours", "orders"],
  onPlace,
  onApplyTemplate,
  columns = 3,
  className,
}: {
  /** Which tabs this host can honour. `templates` REPLACES the canvas, so a surface that
   *  cannot do that leaves it out rather than showing a control that half works. */
  sources?: ArtworkSource[]
  /** What the host does with a chosen picture. `url` is the RAW address to place; a display
   *  proxy is this panel's business and never leaves it. */
  onPlace: (url: string, name?: string | null) => void
  onApplyTemplate?: (t: ProductTemplate) => void
  columns?: 2 | 3
  className?: string
}) {
  const tl = useLabelT()
  const lightbox = useLightbox()
  const tabs = sources.filter((s) => s !== "templates" || !!onApplyTemplate)
  const [source, setSource] = useState<ArtworkSource>(tabs[0] ?? "yours")
  const [sellerImages, setSellerImages] = useState<SellerImage[]>([])
  const [savedDesigns, setSavedDesigns] = useState<LibraryDesign[]>([])
  const [orderUploads, setOrderUploads] = useState<OrderUpload[]>([])
  const [templates, setTemplates] = useState<ProductTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  /** null = closed. Which source the Browse-all dialog is showing. */
  const [browse, setBrowse] = useState<ArtworkSource | null>(null)

  /**
   * LOADED ONCE, ON MOUNT. Not per tab: switching sources is a filter over data already
   * here, and a fetch per tab press would refetch the same three lists all afternoon.
   *
   * Deliberately NOT an effect that watches anything the fetch can change — the lists it
   * writes are not in its condition (CLAUDE.md §2.8).
   */
  useEffect(() => {
    let live = true
    Promise.allSettled([getSellerImages(), getDesignLibrary(), getOrderUploads(), getTemplates()])
      .then(([si, dl, ou, tp]) => {
        if (!live) return
        if (si.status === "fulfilled") setSellerImages(si.value?.images ?? [])
        if (dl.status === "fulfilled") setSavedDesigns(dl.value ?? [])
        if (ou.status === "fulfilled") setOrderUploads(ou.value?.images ?? [])
        if (tp.status === "fulfilled") setTemplates(tp.value ?? [])
        // Every one failing is a signed-out or offline panel, and an empty grid would say
        // "you own nothing" — a different and untrue fact. §4: say which.
        if ([si, dl, ou, tp].every((r) => r.status === "rejected")) setErr(tl("designMaker", "Couldn’t load your artwork."))
        setLoading(false)
      })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The two "mine" stores merged and newest-first. `seller_images` (uploaded from a rail)
   *  and `design_library` (dropped on Design Lab › Artwork) are both "a flat picture of mine,
   *  kept to reuse" — different tables, and neither list could see the other. */
  const yoursRows = useMemo(
    () => [
      ...sellerImages.map((im) => ({ kind: "seller" as const, im, at: im.ts ?? 0 })),
      ...savedDesigns.map((d) => ({ kind: "library" as const, d, at: d.created_at ? Date.parse(d.created_at) || 0 : 0 })),
    ].sort((x, y) => y.at - x.at),
    [sellerImages, savedDesigns],
  )

  const placeLibraryDesign = useCallback(async (d: LibraryDesign) => {
    // The THUMB is what the tile draws; the full artwork is fetched on press.
    try {
      const full = await getDesignLibraryItem(d.id)
      if (full?.data) onPlace(full.data, d.name ?? null)
      else if (d.thumb) onPlace(d.thumb, d.name ?? null)
    } catch {
      setErr(tl("designMaker", "Couldn’t open that design."))
    }
  }, [onPlace, tl])

  const rows: RailArt[] =
    source === "yours"
      ? yoursRows.map((r) =>
        r.kind === "seller"
          ? {
            key: "s" + r.im.id, url: r.im.url, name: r.im.name,
            onPlace: () => onPlace(r.im.url, r.im.name),
            onDelete: () => { void deleteSellerImage(r.im.id); setSellerImages((p) => p.filter((x) => x.id !== r.im.id)) },
          }
          : {
            key: "l" + r.d.id, url: r.d.thumb ?? "", src: r.d.thumb ? proxiedImageSrc(r.d.thumb) : undefined,
            name: r.d.name ?? "", measure: false, badge: r.d.name ? undefined : `IMG-${r.d.id}`,
            onPlace: () => void placeLibraryDesign(r.d),
            onDelete: () => { void deleteDesignLibrary(r.d.id); setSavedDesigns((p) => p.filter((x) => x.id !== r.d.id)) },
          })
      : source === "orders"
        ? orderUploads.map((im, i) => ({
          key: im.url + i, url: im.url, src: canvasReadableSrc(im.url), name: im.name,
          badge: orderRefLabel(im.orderRef), title: [im.orderRef, im.name].filter(Boolean).join(" · "),
          onPlace: () => onPlace(im.url, im.name),
        }))
        : templates.map((t) => ({
          key: String(t.id), url: String(t.composite ?? ""), name: t.name ?? "Untitled template",
          badge: t.seq != null ? `TPL-${t.seq}` : undefined,
          title: [t.name, (t.data as { blank?: string } | null)?.blank].filter(Boolean).join(" · "),
          measure: false,
          onPlace: () => onApplyTemplate?.(t),
        }))

  /** Buyer art needs the proxy to DISPLAY but the raw url to PLACE — the same split the
   *  tiles make. Browsing "all" of something has to show all of it. */
  const browseItems: ArtItem[] = rows.map((r) => ({ url: r.url, src: r.src, name: r.name, badge: r.badge }))

  const takeUpload = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    for (const f of list) {
      const data = await new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result || ""))
        fr.onerror = () => rej(new Error("read failed"))
        fr.readAsDataURL(f)
      }).catch(() => "")
      if (!data) continue
      const r = await uploadSellerImage(data, f.name).catch(() => null)
      if (r?.image) setSellerImages((p) => [r.image as SellerImage, ...p])
      // Placed straight away: uploading a picture in an editor means "use this one", and
      // making the seller then find it in the grid they just added to is a second step for
      // a decision they already made.
      onPlace(r?.image?.url ?? data, f.name)
    }
  }

  const emptyLine =
    source === "yours" ? tl("designMaker", "Upload an image and it stays here to reuse.")
      : source === "orders" ? tl("designMaker", "Artwork buyers send with an order lands here on its own.")
        : tl("designMaker", "Save a design as a template to reopen it on any blank.")

  return (
    <div className={"flex min-w-0 flex-col gap-2 " + (className ?? "")}>
      {lightbox.node}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{tl("designMaker", "Artwork")}</div>
        <label className="flex cursor-pointer items-center gap-1 text-2xs font-medium text-primary hover:underline">
          <UploadSimple size={12} weight="bold" /> {tl("designMaker", "Upload")}
          <input
            type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { void takeUpload(e.target.files); e.target.value = "" }}
          />
        </label>
      </div>

      {/* The house treatment for "which one of these am I looking at" — a rule under the live
          word. Imported, never hand-rolled: that is how the underline rule got broken in
          fourteen places. Only drawn when there is more than one source to choose between. */}
      {tabs.length > 1 && (
        <TabBar
          size="sm" spacing="none" className="border-b-0" ariaLabel="Artwork source"
          value={source} onChange={(v) => setSource(v as ArtworkSource)}
          items={tabs.map((s) => ({
            id: s,
            label: s === "yours" ? tl("designMaker", "Yours")
              : s === "orders" ? tl("designMaker", "From orders")
                : tl("designMaker", "Templates"),
          }))}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-3"><CircleNotch size={16} className="animate-spin text-muted-foreground" /></div>
      ) : err ? (
        /* A refusal carries its reason — that is the answer, not a subtitle. */
        <p className="px-1 text-2xs text-destructive">{err}</p>
      ) : rows.length === 0 ? (
        /* An empty region may carry one sentence, because there is nothing else to read. */
        <p className="px-1 text-2xs text-muted-foreground">{emptyLine}</p>
      ) : (
        <>
          <div className={"grid gap-2 " + (columns === 2 ? "grid-cols-2" : "grid-cols-3")}>
            {rows.slice(0, LIMIT).map((it) => (
              <ImageThumb
                key={it.key} url={it.url} src={it.src} name={it.name} badge={it.badge} title={it.title}
                measure={it.measure} onPlace={it.onPlace} onDelete={it.onDelete}
                // The DISPLAY src, not the raw url: a buyer's hotlink only loads through the
                // proxy, and the lightbox is an <img> like any other.
                onZoom={() => lightbox.open(it.src ?? it.url, it.title || it.name)}
              />
            ))}
          </div>
          {rows.length > LIMIT && (
            <button
              type="button"
              onClick={() => setBrowse(source)}
              className="w-full text-left text-2xs font-medium text-primary hover:underline"
            >
              {tl("designMaker", "Browse all")} {rows.length}
            </button>
          )}
        </>
      )}

      <ArtPickerDialog
        open={browse !== null}
        onOpenChange={(v) => { if (!v) setBrowse(null) }}
        title={browse === "orders" ? tl("designMaker", "Artwork from your orders") : tl("designMaker", "Your uploads")}
        items={browseItems}
        onPick={(url) => {
          const hit = rows.find((r) => r.url === url)
          setBrowse(null)
          if (hit) hit.onPlace()
        }}
        emptyText={emptyLine}
      />
    </div>
  )
}
