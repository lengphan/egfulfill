"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Copy, Lock, LockOpen, Trash, UploadSimple, DownloadSimple, ArrowClockwise, ArrowCounterClockwise, Eraser, X, CircleNotch, Image as ImageIcon, ArrowSquareOut, CaretDown, Check, CheckCircle, Warning, FolderOpen, BookmarkSimple, ImageSquare, PaperPlaneTilt, Needle} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { Dropzone, FileRow, fileNameFrom } from "@/components/app/dropzone"
import { EmptyState } from "@/components/app/empty-state"
import { TabBar } from "@/components/app/tab-bar"
import { PushToPartnerDialog } from "@/components/app/push-to-partner-dialog"
import { designSrc } from "@/lib/order-image"
import { VariantPicker } from "@/components/app/variant-picker"
import { deleteOrderDesign, getOrderDesigns, designsBySide, sidesForLine, scopeDesignFile, getEmbPreview, getOrderDesignCards, cardForLine, createDesignCard, assignDesignCard, deleteDesignFile, type OrderDesignCard, uploadDesignFile, downloadDesignFile, filesForLine, postOrderDesign, postOrderThreads, setDesignTier, getDesignFees, saveTemplate, setItemMockup, uploadChatAttachment, getDesignFiles, type DesignPos, type DesignTier, type OrderItem, type CatalogProduct } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { resolveProduct, mockupFaces, isEmbroidery } from "@/lib/variant-resolve"
import { TIER_LABEL, TIER_WHY, feeFor } from "@/lib/design-fee"
import { fileToUploadUrl } from "@/lib/chat-upload"
import { perceptualHash } from "@/lib/phash"
import { decodeEntities, usd } from "@/lib/order-format"
import { useArtworkSrc } from "@/lib/pdf-preview"
import { matchThreadColors, nearestThread, nearestThreads, matchQuality, hexToRgb, matchThreadRegions, canvasReadableSrc, type Thread, type ThreadRegion } from "@/lib/thread-match"
import { useBackgroundRemoval } from "@/lib/remove-background"
import { loadThreadPalette } from "@/lib/thread-palette-load"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Eyedropper } from "@phosphor-icons/react"

export type Pos = { x: number; y: number; w: number; r: number }
export type TextLayer = { id: string; text: string; x: number; y: number; size: number; r: number; color: string; bold?: boolean }
export const DEFAULT_POS: Pos = { x: 50, y: 50, w: 45, r: 0 }

/**
 * ONE PICTURE ON THE STAGE, when there is more than one.
 *
 * The stage has always drawn a single `designUrl`. The Design Lab needs several — a logo and
 * a name and a badge are three layers of one print — so it takes a LIST instead, and each
 * entry carries its own placement exactly as a text layer does.
 *
 * `designUrl` is untouched and still the path the mini designer uses: an order line holds one
 * artwork per face, and giving it a list to hold one item would be a worse model, not a more
 * general one.
 */
export type ImageLayer = { id: string; src: string; pos: Pos; name?: string | null }
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * The colour picker for one part of a design — a dropdown that SHOWS the colours.
 *
 * A native `<select>` cannot, which is the whole reason the swatches used to live in a
 * separate chip row above: "Orange 434342 · Black 000000" sat in one place and
 * "434342 · Orange (closest)" in another, and the reader had to pair them up by eye to
 * learn anything. One list, with the swatch on the button and on every option, says the
 * same thing once. Module-level, not defined inside the panel: `react-hooks/static-components`.
 *
 * `options` arrives nearest-first from the matcher, so index 0 is the suggestion and the
 * rest are the alternatives — labelled "best match" rather than "(closest)", which read as
 * a measurement a seller was expected to trust rather than a suggestion they can overrule.
 */
function ThreadSelect({ value, options, onChange }: {
 value: string
 options: Thread[]
 onChange: (code: string) => void
}) {
 const current = options.find((o) => o.code === value) ?? options[0]
 if (!current) return null
 return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <span className="size-3.5 shrink-0 rounded-full border border-black/15" style={{ background: current.hex }} />
        <span className="truncate font-medium">{current.name}</span>
        <span className="shrink-0 tabular-nums text-2xs text-muted-foreground">{current.code}</span>
        <CaretDown size={11} weight="bold" className="ml-auto shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 min-w-56 overflow-y-auto">
        {options.map((o, i) => (
          <DropdownMenuItem key={o.code} onClick={() => onChange(o.code)} className="gap-1.5 text-xs">
            <span className="size-3.5 shrink-0 rounded-full border border-black/15" style={{ background: o.hex }} />
            <span className="truncate">{o.name}</span>
            {i === 0 && (
              <span className="shrink-0 rounded bg-muted px-1 py-px text-2xs font-medium text-muted-foreground">best match</span>
            )}
            <span className="ml-auto shrink-0 tabular-nums text-2xs text-muted-foreground">{o.code}</span>
            {o.code === value && <Check size={12} weight="bold" className="shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Reusable place/size/rotate surface — used by the order customizer, the studio, and the
// full maker. Renders a mockup + a draggable image layer + optional draggable text layers.
export function DesignStage({
 mockup, mockupFill, designUrl = "", pos = DEFAULT_POS, setPos, onRemove, onCopy, copyLabel, className,
 texts, updateText, images, updateImage, onEraseBg, eraseBusy, onUndoErase, selected, onSelect, picking, onPickColor,
 printZone, emptyHint,
}: {
 mockup?: string
  /** True when `mockup` is the SELLER'S own photo rather than our catalogue blank — see the
   * note on the <img>. It changes how the picture is fitted, not which picture it is. */
 mockupFill?: boolean
  /** The single artwork. Optional because a caller driving `images` has no single one —
   * requiring it forced a placeholder that the stage would then draw beneath the stack. */
 designUrl?: string
 pos?: Pos
 setPos?: (fn: (p: Pos) => Pos) => void
 onRemove?: () => void
  /** Offered in the action strip when a caller has somewhere to copy TO — the design maker
   * and the studio have no second face, so they simply don't pass it and the button is not
   * drawn. A control that does nothing is worse than one that isn't there. */
 onCopy?: () => void
 copyLabel?: string
  /** Several image layers, drawn back-to-front in array order. Ignored when absent, which is
   * every caller that places exactly one artwork. */
 images?: ImageLayer[]
 updateImage?: (id: string, patch: Partial<Pos>) => void
  /** Background removal, offered ON the layer rather than in a panel across the window — it
   * changes the picture, so it belongs where the picture is. Absent ⇒ no button. */
 onEraseBg?: () => void
 eraseBusy?: boolean
 onUndoErase?: () => void
 className?: string
 texts?: TextLayer[]
 updateText?: (id: string, patch: Partial<TextLayer>) => void
 selected?: string | null
 onSelect?: (sel: string | null) => void
 picking?: boolean // eyedropper active — clicking the design samples a pixel colour
 onPickColor?: (hex: string) => void
  /** Printable rectangle (0–100% of the stage). Drawn as the dashed guide the old maker
   * had — without it there's nothing showing where artwork may actually go. */
 printZone?: { x: number; y: number; w: number; h: number }
  /** Shown instead of a bare icon when there's no blank yet. */
 emptyHint?: React.ReactNode
}) {
 const stageRef = useRef<HTMLDivElement>(null)
  /**
   * The artwork's natural width ÷ height, learned when it loads.
   *
   * The stage is aspect-square, so a design placed at `pos.w` percent of its width renders
   * `pos.w / aspect` percent TALL. That is what decides whether it fits: a landscape image
   * (aspect > 1) is always shorter than it is wide and can never overflow, while a portrait
   * one (aspect < 1) overflows as soon as pos.w passes 100 × aspect.
   *
   * 1 until the image loads, which is the safe assumption — it caps at 100 and the real
   * ratio only ever tightens it.
   */
  // Stored WITH the url it was measured from, so swapping the artwork can't leave the
  // previous image's ratio gating the new one — and so no effect is needed to reset it,
  // which would be a setState-in-effect this codebase's lint rule rejects.
 const [ar, setAr] = useState<{ url: string; a: number } | null>(null)
  // Whether the artwork actually fetched. A failed <img> is invisible rather than obviously
  // broken here, because only its width is constrained.
  // No reset effect: swapping the artwork triggers a fresh load, and onLoad/onError below
  // set this either way. An effect here would also trip react-hooks/set-state-in-effect.
 const [imgBroken, setImgBroken] = useState(false)
  /**
   * PLACEMENT FROZEN, on purpose.
   *
   * The whole image is the move target, so a finished placement is one stray drag away from
   * being wrong — and the only defence until now was not touching it. Local to the stage: it
   * protects the CURRENT session's fiddling, and nothing about a lock belongs in the saved
   * design (reopening a job and finding it immovable would be its own puzzle).
   */
 const [lockedIds, setLockedIds] = useState<Record<string, boolean>>({})
  /**
   * WHICH LAYER IS SELECTED — locally, when nobody else is holding it.
   *
   * The design maker owns selection (it has text layers to switch between); the mini designer
   * passes neither prop, so `selected` was permanently undefined there — and the image's
   * handles rendered on `selected == null`, i.e. ALWAYS. The outline, the strip and the eight
   * grips sat on the artwork whether or not you were working on it, and there was no way to
   * put them away and simply look at the mockup you came to judge.
   *
   * Selection is a real state either way now: the caller's when it manages one, this when it
   * doesn't. Clicking the stage clears it; clicking a layer picks it up again.
   */
 const [selfSel, setSelfSel] = useState<string | null>(null)
 const managed = !!onSelect
 const sel = managed ? selected ?? null : selfSel
 const select = (id: string | null) => { if (managed) onSelect?.(id); else setSelfSel(id) }
 const aspect = ar && ar.url === designUrl ? ar.a : 1
 const setAspect = (a: number) => setAr({ url: designUrl || "", a })
  // The widest this artwork may be drawn before its own height would run off the bed. A
  // small floor keeps a very tall, thin design from being clamped to something unusable.
 const maxW = aspect >= 1 ? 100 : Math.max(15, Math.round(100 * aspect))
  /**
   * The width actually DRAWN, capped at what fits.
   *
   * Clamping the resize handle alone isn't enough: artwork arrives at DEFAULT_POS.w (45%),
   * and a tall enough image is already over the bed before anyone touches a handle — which
   * is how a portrait design ended up hanging off the top and bottom of the frame the
   * moment it was added.
   *
   * Capped at render rather than by writing pos back in an effect. Correcting state on load
   * means a component that edits its own props on mount (the set-state-in-effect rule this
   * codebase enforces), and it would silently rewrite a saved placement the first time
   * someone merely OPENED an order. This changes what is drawn and nothing else.
   */
 const drawW = Math.min(pos.w, maxW)
  // Hidden canvas holding the design at natural resolution, so the eyedropper can read a
  // pixel. Redrawn whenever the artwork changes.
 const sampleRef = useRef<{ canvas: HTMLCanvasElement; w: number; h: number } | null>(null)
 useEffect(() => {
 if (!designUrl) { sampleRef.current = null; return }
 let live = true
 const img = new Image()
 img.crossOrigin = "anonymous"
 img.onload = () => {
 if (!live) return
 const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight
 const ctx = c.getContext("2d", { willReadFrequently: true })
 if (!ctx) return
 try { ctx.drawImage(img, 0, 0); sampleRef.current = { canvas: c, w: img.naturalWidth, h: img.naturalHeight } } catch { sampleRef.current = null }
    }
    // Through the proxy. This sets crossOrigin="anonymous" above, which makes the fetch a
    // CORS request — a host that sends no Access-Control-Allow-Origin then fails the LOAD
    // outright, so onload never fires and the sampler stays empty. That is the "couldn't
    // read this artwork's colours" message, and it isn't a colour problem at all.
    // canvasReadableSrc returns an unproxyable host unchanged, so nothing that works today
    // changes. (Same rule as the rest of the canvas work — see lib/thread-match.)
 img.src = canvasReadableSrc(designUrl)
 return () => { live = false }
  }, [designUrl])

  // Sample the pixel under a click on the placed design. The design is scaled + ROTATED,
  // so we map the click into the design's own unrotated frame (inverse-rotate around its
  // centre) before reading natural coords — otherwise a rotated design samples the wrong
  // pixel. Off-image clicks are ignored.
 const LOUPE = 104, LOUPE_ZOOM = 9
 const loupeRef = useRef<HTMLCanvasElement>(null)
 const [loupe, setLoupe] = useState<{ x: number; y: number; hex: string } | null>(null)

  /** Click/hover point -> the design's own natural pixel coords, or null if outside. */
 const designPixelAt = (clientX: number, clientY: number, imgEl: HTMLElement) => {
 const s = sampleRef.current, stage = stageRef.current
 if (!s || !stage) return null
 const box = imgEl.getBoundingClientRect()             // centre is rotation-invariant
 const cx = box.left + box.width / 2, cy = box.top + box.height / 2
 const stageW = stage.getBoundingClientRect().width
 const renderedW = (pos.w / 100) * stageW
 const renderedH = renderedW * (s.h / s.w)
 const rad = (-(pos.r || 0) * Math.PI) / 180
 const dx = clientX - cx, dy = clientY - cy
 const ux = dx * Math.cos(rad) - dy * Math.sin(rad)    // into the unrotated frame
 const uy = dx * Math.sin(rad) + dy * Math.cos(rad)
 const fx = ux / renderedW + 0.5, fy = uy / renderedH + 0.5
 if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
 return { s, px: Math.floor(fx * s.w), py: Math.floor(fy * s.h) }
  }

 const hexAt = (px: number, py: number, s: { canvas: HTMLCanvasElement }) => {
 const ctx = s.canvas.getContext("2d", { willReadFrequently: true })
 if (!ctx) return null
 const d = ctx.getImageData(px, py, 1, 1).data
 const hx = (v: number) => ("0" + v.toString(16)).slice(-2)
 return ("#" + hx(d[0]) + hx(d[1]) + hx(d[2])).toUpperCase()
  }

 const sampleAt = (e: React.MouseEvent, imgEl: HTMLElement) => {
 const hit = designPixelAt(e.clientX, e.clientY, imgEl)
 if (!hit) return
 const hex = hexAt(hit.px, hit.py, hit.s)
 if (hex) onPickColor?.(hex)
  }

  /**
   * Magnifier loupe. A bare crosshair asks you to hit a specific pixel of a design
   * rendered at maybe 300px wide - on a thin outline or small detail that is a guess.
   * The loupe draws surrounding pixels at LOUPE_ZOOM with smoothing OFF, so you can
   * see the individual pixels you are choosing between, plus the exact hex a click
   * would take. Shares designPixelAt with the click, so what it shows is what you get.
   */
 const moveLoupe = (e: React.MouseEvent, imgEl: HTMLElement) => {
 const hit = designPixelAt(e.clientX, e.clientY, imgEl)
 if (!hit) { setLoupe(null); return }
 const hex = hexAt(hit.px, hit.py, hit.s)
 if (!hex) { setLoupe(null); return }
 const sb = stageRef.current?.getBoundingClientRect()
 setLoupe({ x: e.clientX - (sb?.left ?? 0), y: e.clientY - (sb?.top ?? 0), hex })

 const cv = loupeRef.current
 const ctx = cv?.getContext("2d")
 if (!cv || !ctx) return
 const span = LOUPE / LOUPE_ZOOM                       // source pixels across the loupe
 ctx.imageSmoothingEnabled = false                     // show PIXELS, not a blur
 ctx.clearRect(0, 0, LOUPE, LOUPE)
 ctx.drawImage(hit.s.canvas, hit.px - span / 2, hit.py - span / 2, span, span, 0, 0, LOUPE, LOUPE)
    // Centre reticle - the pixel that will actually be taken.
 const c = LOUPE / 2, z = LOUPE_ZOOM
 ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 1
 ctx.strokeRect(c - z / 2 - 0.5, c - z / 2 - 0.5, z + 1, z + 1)
 ctx.strokeStyle = "rgba(255,255,255,0.9)"
 ctx.strokeRect(c - z / 2 - 1.5, c - z / 2 - 1.5, z + 3, z + 3)
  }

  /**
   * The eight grips, as unit directions in the LAYER'S OWN frame.
   *
   * Every one of them scales about the centre — which is what `pos.x`/`pos.y` mean, so
   * there is no opposite corner to pin and no re-centring to undo. A grip's direction is
   * all that changes between them: which way is "outwards" for this one.
   */
  // `cls` anchors the grip to its point on the box; every one is then pulled back by half
  // its own size, so the MARK sits centred on the corner or edge rather than beside it.
 const GRIPS = [
    { k: "nw", ux: -1, uy: -1, cls: "left-0 top-0", cur: "cursor-nwse-resize" },
    { k: "n", ux: 0, uy: -1, cls: "left-1/2 top-0", cur: "cursor-ns-resize" },
    { k: "ne", ux: 1, uy: -1, cls: "left-full top-0", cur: "cursor-nesw-resize" },
    { k: "e", ux: 1, uy: 0, cls: "left-full top-1/2", cur: "cursor-ew-resize" },
    { k: "se", ux: 1, uy: 1, cls: "left-full top-full", cur: "cursor-nwse-resize" },
    { k: "s", ux: 0, uy: 1, cls: "left-1/2 top-full", cur: "cursor-ns-resize" },
    { k: "sw", ux: -1, uy: 1, cls: "left-0 top-full", cur: "cursor-nesw-resize" },
    { k: "w", ux: -1, uy: 0, cls: "left-0 top-1/2", cur: "cursor-ew-resize" },
  ] as const

  // target: "image" or a text-layer id. mode: move | resize | rotate.
  // `grip` — which of the eight was grabbed. Only read when mode is "resize".
 const startDrag = (target: string, mode: "move" | "resize" | "rotate", grip?: { ux: number; uy: number }) => (e: React.PointerEvent) => {
 if (!stageRef.current) return
 e.preventDefault(); e.stopPropagation()
 select(target)
 const rect = stageRef.current.getBoundingClientRect()
    // THREE kinds of layer now: the single artwork ("image"), a text, or one of several
    // image layers. Resolved once, here, so everything below reads the same three numbers.
 const imgLayer = images?.find((i) => i.id === target)
 const isText = target !== "image" && !imgLayer
 const layer = isText ? texts?.find((t) => t.id === target) : null
 const startX = imgLayer ? imgLayer.pos.x : isText ? (layer?.x ?? 50) : pos.x
 const startY = imgLayer ? imgLayer.pos.y : isText ? (layer?.y ?? 50) : pos.y
 const startR = imgLayer ? imgLayer.pos.r : isText ? (layer?.r ?? 0) : pos.r
 const px = e.clientX, py = e.clientY
 const cx = rect.left + (startX / 100) * rect.width
 const cy = rect.top + (startY / 100) * rect.height
    /**
     * THE LAYER'S OWN HALF-EXTENTS, measured once at grab time.
     *
     * offsetWidth/Height, not getBoundingClientRect: the layer is rotated, and the rect of
     * a rotated box is its axis-aligned bounding box — bigger than the box, and bigger by a
     * different amount at every angle. The offsets are the untransformed CSS size, which is
     * the frame the grip directions are expressed in.
     *
     * The grips are rendered INSIDE the layer, so the button's parent is that layer.
     */
 const layerEl = (e.currentTarget as HTMLElement).parentElement
 const halfX = ((layerEl?.offsetWidth ?? 0) / 2 / rect.width) * 100
 const halfY = ((layerEl?.offsetHeight ?? 0) / 2 / rect.height) * 100
 const startSize = isText ? (layer?.size ?? 8) : pos.w
 function apply(patch: { x?: number; y?: number; w?: number; size?: number; r?: number }) {
 if (imgLayer) updateImage?.(target, { ...(patch.x != null ? { x: patch.x } : {}), ...(patch.y != null ? { y: patch.y } : {}), ...(patch.w != null ? { w: patch.w } : {}), ...(patch.r != null ? { r: patch.r } : {}) })
 else if (isText && layer) updateText?.(target, { x: patch.x, y: patch.y, size: patch.w ?? patch.size, r: patch.r } as Partial<TextLayer>)
 else setPos?.((p) => ({ ...p, ...(patch.x != null ? { x: patch.x } : {}), ...(patch.y != null ? { y: patch.y } : {}), ...(patch.w != null ? { w: patch.w } : {}), ...(patch.r != null ? { r: patch.r } : {}) }))
    }
 function move(ev: PointerEvent) {
 if (mode === "move") {
 const dx = ((ev.clientX - px) / rect.width) * 100
 const dy = ((ev.clientY - py) / rect.height) * 100
 apply({ x: clamp(startX + dx, 0, 100), y: clamp(startY + dy, 0, 100) })
      } else if (mode === "resize") {
        /**
         * ONE SCALE FACTOR, WHICHEVER GRIP YOU GRABBED.
         *
         * The pointer is rotated back into the layer's own frame, then compared with where
         * that grip STARTED. The ratio is how much bigger the layer should be — so the grip
         * stays under the finger, and a corner keeps the aspect instead of stretching, which
         * is what an aspect-locked drag means.
         *
         * Three cases, because a grip only measures along the axes it actually moves on:
         * a side grip that read both would resize when you slid along its own edge, which
         * feels like the artwork fighting you.
         */
 const vx = ev.clientX - cx, vy = ev.clientY - cy
 const rad = (-startR * Math.PI) / 180
 const localX = (vx * Math.cos(rad) - vy * Math.sin(rad)) / rect.width * 100
 const localY = (vx * Math.sin(rad) + vy * Math.cos(rad)) / rect.height * 100
 const gx = (grip?.ux ?? 1) * halfX, gy = (grip?.uy ?? 1) * halfY
 const den = gx * gx + gy * gy
        // den > 0 is also the guard for a layer that has not laid out yet (an image still
        // loading measures 0 tall): every half-extent a branch below divides by is one of
        // the terms in den, so a zero can only reach here as den === 0.
 const scale = den <= 0 ? 1
 : grip && grip.ux === 0 ? Math.abs(localY) / halfY            // top / bottom
 : grip && grip.uy === 0 ? Math.abs(localX) / halfX          // left / right
 : (localX * gx + localY * gy) / den                       // a corner
        // maxW, not a flat 100: the ceiling is whatever keeps the artwork's own height
        // inside the bed, so dragging a grip stops at the edge instead of past it.
 const next = startSize * Math.max(scale, 0)
 apply(isText ? { size: clamp(next, 2, 40) } : { w: clamp(next, 8, imgLayer ? 100 : maxW) })
      } else {
 const ang = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
 apply({ r: Math.round(ang) })
      }
    }
 function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
 window.addEventListener("pointermove", move)
 window.addEventListener("pointerup", up)
  }

  /**
   * EIGHT GRIPS, NOT ONE.
   *
   * There used to be a single resize button on the bottom-right corner, and it carried the
   * move icon — so the one control that changed the SIZE looked like the one that changed
   * the position, and the other seven places a person reaches for did nothing. Dragging a
   * dropped image bigger read as impossible.
   *
   * Corners are round, edges are bars: the shape says which axis a grip works on before you
   * touch it. Both are 12px of visible mark with a 24px hit area padded around them, so a
   * grip is easy to grab on a trackpad and possible to grab on a phone without the marks
   * crowding a small design.
   */
  /**
   * ONE STRIP OF ACTIONS, above the selection.
   *
   * Rotate was a lone button on the top edge and Remove was a black ✕ floating off the
   * top-right corner — two controls, two places, two visual languages, and between them they
   * covered the artwork you were trying to look at. Everything you do TO the layer now sits
   * in one bar in one place: copy, rotate, lock, remove.
   *
   * LOCK is the one that is new, and it is the reason the others are worth grouping. Placed
   * artwork is easy to nudge by accident — the whole image is the move target — and until now
   * the only way to protect a finished placement was not to touch it.
   *
   * Rotate stays a POINTER-DRAG rather than a click: it is a continuous gesture, and a button
   * that rotates by a fixed step is a different, worse control.
   */
  /**
   * SIZED TO BE AIMED AT. These were 28px boxes holding 14px marks — fine for a toolbar you
   * read, small for one you USE, and this strip is the whole control surface of the
   * designer: it is what rotates, locks, cleans and deletes the thing under your cursor.
   * 36px with 18px marks is the same scale the rest of the app gives a real action, and it
   * clears the 44px touch guidance on a trackpad-and-finger machine.
   *
   * One constant, one strip, both designers — the maker renders this same DesignStage.
   */
 const stripBtn = "flex size-9 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
 const stripIcon = 18
 const handles = (target: string) => {
    // Per LAYER. The design maker puts text on this same stage, and a single flag would
    // freeze the lettering because somebody pinned the picture.
 const locked = !!lockedIds[target]
 const setLocked = (fn: (v: boolean) => boolean) =>
 setLockedIds((m) => ({ ...m, [target]: fn(!!m[target]) }))
 return (
    <>
      <div className="pointer-events-none absolute inset-0 rounded-sm outline outline-2 -outline-offset-1 outline-primary/70" />
      <div
 className="absolute -top-14 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-md"
        // The strip is chrome, not canvas: a drag that starts here must never also start a
        // move on the layer underneath it.
 onPointerDown={(e) => e.stopPropagation()}
      >
        {onCopy && (
          <button type="button" onClick={onCopy} title={copyLabel ?? "Copy to the other sides"} aria-label={copyLabel ?? "Copy to the other sides"} className={stripBtn}>
            <Copy size={stripIcon} weight="bold" />
          </button>
        )}
        <button
 onPointerDown={locked ? undefined : startDrag(target, "rotate")}
 disabled={locked}
 title={locked ? "Locked" : "Drag to rotate"} aria-label="Rotate"
 className={stripBtn + " touch-none " + (locked ? "" : "cursor-grab")}
        >
          <ArrowClockwise size={stripIcon} weight="bold" />
        </button>
        <button
 type="button"
 onClick={() => setLocked((v) => !v)}
 title={locked ? "Unlock — let it be moved again" : "Lock in place"}
 aria-label={locked ? "Unlock" : "Lock in place"}
 aria-pressed={locked}
 className={stripBtn + (locked ? " bg-primary/10 text-primary" : "")}
        >
          {locked ? <Lock size={stripIcon} weight="fill" /> : <LockOpen size={stripIcon} weight="bold" />}
        </button>
        {onEraseBg && (
          <button type="button" onClick={onEraseBg} disabled={eraseBusy}
 title="Remove the background — clears the backdrop connected to the edges, in your browser"
 aria-label="Remove background" className={stripBtn}>
            {eraseBusy ? <CircleNotch size={stripIcon} className="animate-spin" /> : <Eraser size={stripIcon} weight="bold" />}
          </button>
        )}
        {onUndoErase && (
          <button type="button" onClick={onUndoErase} title="Put the background back" aria-label="Undo background removal" className={stripBtn}>
            <ArrowCounterClockwise size={stripIcon} weight="bold" />
          </button>
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this layer" aria-label="Remove this layer" className={stripBtn + " hover:bg-destructive hover:text-destructive-foreground"}>
            <Trash size={stripIcon} weight="bold" />
          </button>
        )}
      </div>
      {/* Locked: the grips go entirely. Greying eight marks that still look grabbable is a
 worse answer than not offering them — the strip says why, and one click undoes it. */}
      {!locked && GRIPS.map((g) => (
        <button
 key={g.k}
 onPointerDown={startDrag(target, "resize", g)}
          // The BUTTON is the hit area and is deliberately bigger than the mark inside it —
          // a 12px target is a miss on a touchscreen, and eight misses is worse than one.
 className={`absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center touch-none ${g.cur} ${g.cls}`}
 aria-label={`Resize ${g.k}`}
        >
          <span
 className={
              "block bg-background shadow-sm ring-1 ring-primary " +
              (g.ux === 0 ? "h-1.5 w-4 rounded-full"          // top / bottom: a horizontal bar
 : g.uy === 0 ? "h-4 w-1.5 rounded-full"        // left / right: a vertical bar
 : "size-3 rounded-full")                     // corners
            }
          />
        </button>
      ))}
    </>
    )
  }

 return (
    // The stage is TRANSPARENT. The grid used to be painted here, so it stopped where the
    // square stopped and left bare panel around it — the thing that kept looking wrong.
    // The backdrop now belongs to the surrounding panel (see .eg-studio-bed), which fills
    // the whole column, while this element stays square purely so the design's %-coords
    // and the print zone keep a stable frame to measure against.
    <div ref={stageRef} onPointerDown={() => select(null)} style={{ containerType: "size" }} className={"relative aspect-square select-none " + (className ?? "w-full")}>

      {/**
        * OURS IS CONTAINED; THEIRS FILLS.
        *
        * A catalogue blank is a product shot on white — it wants the 5% margin and the
        * drop shadow, or it sits edge to edge like a scan. A seller's OWN photograph is a
        * BACKDROP: they uploaded it to be the background, and containing it inside a 5%
        * inset left our white showing round the outside, which is the opposite of
        * replacing the background and is what "it doesn't replace the full background"
        * means.
        *
        * object-cover crops rather than letterboxes, which is the right trade for a
        * backdrop: the artwork is positioned as a PERCENTAGE of the stage, so a
        * letterboxed photo would put the placement somewhere other than where it looks.
        */}
      {mockup ? (
        // p-[6%] lets the garment fill more of the bed than a raw object-contain, which
        // left wide dead margins around a portrait mockup.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mockup} alt="" className={"pointer-events-none absolute inset-0 size-full " +
          (mockupFill ? "object-cover" : "object-contain p-[1%] drop-shadow-[0_10px_28px_rgba(0,0,0,0.16)]")} />
      ) : (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
          <ImageIcon size={38} weight="duotone" className="opacity-40" />
          {emptyHint ?? <span className="text-xs">Pick a blank to start designing.</span>}
        </div>
      )}

      {/* The printable area. Everything outside it is trimmed in production, so it has to
 be visible while placing artwork — the port had dropped this entirely.
          THE RECTANGLE, WITHOUT A CAPTION. It used to carry a `12" x 16" print area` chip
 floating above its top-left corner, which sat over the garment, moved with the box
 and repeated a number the Print area fields already show. The dashed outline says
          "this is the printable area" on its own. */}
      {printZone && mockup && (
        <div
 className="pointer-events-none absolute rounded-[2px] border border-dashed border-foreground/35"
 style={{ left: `${printZone.x}%`, top: `${printZone.y}%`, width: `${printZone.w}%`, height: `${printZone.h}%` }}
        />
      )}

      {/**
        * SEVERAL IMAGE LAYERS, in array order — first is furthest back, which is the order a
        * layer list reads top-down when reversed. Each is its own draggable, lockable,
        * selectable thing, exactly like a text layer; nothing here is special-cased for
        * "the artwork" because with a list there is no such single thing.
        */}
      {(images ?? []).map((im) => (
        <div
 key={im.id}
 onPointerDown={picking ? undefined
 : lockedIds[im.id]
              ? (e) => { e.stopPropagation(); select(im.id) }
 : startDrag(im.id, "move")}
 style={{ left: `${im.pos.x}%`, top: `${im.pos.y}%`, width: `${im.pos.w}%`, transform: `translate(-50%,-50%) rotate(${im.pos.r}deg)` }}
 className={"absolute touch-none " + (picking ? "cursor-crosshair" : lockedIds[im.id] ? "cursor-default" : "cursor-move")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={canvasReadableSrc(im.src)} alt="" className="pointer-events-none block w-full select-none" draggable={false} />
          {!picking && sel === im.id && handles(im.id)}
        </div>
      ))}

      {designUrl && imgBroken && (
        /* An image that cannot be fetched renders as nothing here, so say so. Silence was
 indistinguishable from "the upload didn't work", which is what it got reported as. */
        <div className="absolute inset-x-2 top-2 z-10 rounded-md bg-destructive/90 px-2 py-1 text-center text-2xs font-medium text-background">
          This artwork couldn&apos;t be loaded — replace it, or remove it and upload again.
        </div>
      )}
      {designUrl && (
        <div
 onPointerDown={picking ? undefined
 : lockedIds.image
              // Locked: pick it up, don't move it. Without this the strip holding Unlock
              // could not be reached, and the lock would be a one-way door.
              ? (e) => { e.stopPropagation(); select("image") }
 : startDrag("image", "move")}
 onClick={picking ? (e) => sampleAt(e, e.currentTarget) : undefined}
 onMouseMove={picking ? (e) => moveLoupe(e, e.currentTarget) : undefined}
 onMouseLeave={picking ? () => setLoupe(null) : undefined}
 style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${drawW}%`, transform: `translate(-50%,-50%) rotate(${pos.r}deg)` }}
 className={"absolute touch-none " + (picking ? "cursor-crosshair" : lockedIds.image ? "cursor-default" : "cursor-move")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            // Proxied for the same reason as the sampler: a remote host that refuses the
            // request leaves an <img> whose only set dimension is width, so it collapses to
            // ZERO HEIGHT — the artwork disappears and the placement handles are left
            // wrapped around a bare line, which reads as "the upload didn't work".
 src={canvasReadableSrc(designUrl)}
 alt=""
 className="pointer-events-none block w-full select-none"
 draggable={false}
            // Say it out loud when the picture genuinely cannot be fetched, instead of
            // rendering an invisible box. onRemove is the way back out.
 onError={() => setImgBroken(true)}
            // The artwork's HEIGHT was never bounded. Only width is set (pos.w% of the
            // stage) and the image keeps its own ratio, so a PORTRAIT design rendered at
            // w × (naturalH / naturalW) — a 2:3 photo at the default 45% came out 67% tall,
            // and anything taller spilled past the top and bottom of the bed entirely.
            // Learning the ratio here lets the resize clamp below cap the width at the
            // point where the height would reach the edge, so the drag simply stops instead
            // of the design escaping the frame.
 onLoad={(e) => {
 setImgBroken(false)
 const el = e.currentTarget
 if (el.naturalWidth > 0 && el.naturalHeight > 0) setAspect(el.naturalWidth / el.naturalHeight)
            }}
          />
          {/* ONLY WHEN SELECTED — and the outline lives inside handles(), so the box goes with
 the controls. This read `selected == null || selected === "image"`, which on a
 caller that manages no selection is true forever: the reason none of it ever
 went away. */}
          {!picking && sel === "image" && handles("image")}
          {/* The floating ✕ is gone. Remove is in the action strip with everything else that
 acts on the layer — a black circle hanging off the corner was a second visual
 language for the same kind of verb, and it sat where the north-east grip is. */}
        </div>
      )}

      {/* Loupe. Rendered last so it is above every layer, and pointer-events-none so
 it can never intercept the click it exists to help you aim. */}
      {picking && loupe && (
        <div
 className="pointer-events-none absolute z-50"
 style={{ left: loupe.x, top: loupe.y, transform: `translate(-50%, -100%) translateY(-14px)` }}
        >
          <canvas
 ref={loupeRef}
 width={LOUPE}
 height={LOUPE}
 className="block rounded-full border-2 border-white shadow-lg ring-1 ring-black/20"
 style={{ width: LOUPE, height: LOUPE }}
          />
          <div className="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-foreground/90 px-1.5 py-0.5 text-2xs font-medium text-background">
            <span className="size-2.5 rounded-full border border-white/40" style={{ background: loupe.hex }} />
            <span className="tabular-nums">{loupe.hex}</span>
          </div>
        </div>
      )}

      {(texts ?? []).map((t) => (
        <div
 key={t.id}
 onPointerDown={lockedIds[t.id]
            ? (e) => { e.stopPropagation(); select(t.id) }
 : startDrag(t.id, "move")}
 style={{ left: `${t.x}%`, top: `${t.y}%`, transform: `translate(-50%,-50%) rotate(${t.r}deg)`, color: t.color, fontSize: `${t.size}cqw`, fontWeight: t.bold ? 800 : 600, whiteSpace: "nowrap", lineHeight: 1.1 }}
 className={"absolute touch-none " + (lockedIds[t.id] ? "cursor-default" : "cursor-move")}
        >
          {t.text || "Text"}
          {sel === t.id && handles(t.id)}
        </div>
      ))}
    </div>
  )
}

/**
 * The real ceiling on artwork, and where it comes from.
 *
 * The file is sent as a base64 data URL, which inflates it by exactly 4/3, and the API's
 * body limit is 60MB. Measured: a 44MB file lands at 58.7MB on the wire — it fits, with
 * 1.3MB to spare, which is not headroom. And the box running the API has 1GB of RAM that
 * has to hold the parsed body while it works.
 *
 * 32MB goes over at 42.7MB, leaving ~17MB of margin. That is the number this is set to.
 *
 * 12MB was well under what the pipeline takes, and it refused ordinary print work: a
 * 4500×5400 PNG at 300dpi is a normal front print and routinely lands between 15 and 25MB.
 * Worse, it told people to COMPRESS — which for a file that is about to be printed is
 * advice that quietly costs them quality to solve a problem we invented.
 *
 * The honest long-term fix is a presigned upload straight to object storage, so artwork
 * never travels through the API at all — the same reason api.egful.store exists for print
 * files. Until then this is the true limit, stated as such.
 */
const MAX_ARTWORK_MB = 32

// Reads a File → data URL, guarding type/size. Returns via callback.
export function readImageFile(file: File | null | undefined, onData: (url: string) => void, onErr: (m: string) => void) {
 if (!file || !file.type.startsWith("image/")) { onErr("Please choose an image (PNG/JPG/SVG)."); return }
 if (file.size > MAX_ARTWORK_MB * 1024 * 1024) {
    // Says the size, the limit, and what to do that ISN'T "lose quality on a print file".
 onErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB and the limit is ${MAX_ARTWORK_MB}MB. If it's a photo, saving as JPEG instead of PNG usually cuts it by most of that with no visible loss. If it's flat artwork, flattening layers or dropping to 8-bit colour will do it — don't reduce the resolution, we need it for print.`)
 return
  }
 const reader = new FileReader()
 reader.onload = () => onData(String(reader.result || ""))
 reader.readAsDataURL(file)
}

// ─────────────────── Order customizer (place artwork on an order item) ───────────────────
/** Machine-file extensions, matched on NAME because browsers report no useful mime type
 * for them — a .emb arrives as application/octet-stream or an empty string. */
const MACHINE_RE = /\.(emb|pes|dst|exp|jef|vp3|xxx|hus)$/i
/** The same list the regex tests, as an accept attribute. Derived from one source so the
 * picker can't start offering a type the drop handler refuses (or the reverse). */
const MACHINE_EXT_LIST = ".emb,.pes,.dst,.exp,.jef,.vp3,.xxx,.hus"
/** The three kinds of thing that can land on a line. Module-level so the array identity
 *  is stable across renders and the bar does not remount under the cursor. */
const FILE_TABS = [
  { id: "image" as const, label: "Image" },
  { id: "templates" as const, label: "Templates" },
  { id: "machine" as const, label: "Machine files" },
]


/**
 * The buyer's uploaded file, as a picture — whatever kind of file it is.
 *
 * A personalisation upload is often a PDF, and an <img> pointed at one renders nothing, so
 * a perfectly good file showed as a broken thumbnail. useArtworkSrc renders page one for a
 * PDF and passes an image straight through; a file that genuinely cannot be read says PDF
 * rather than pretending to be a broken image, because those need different actions from
 * whoever is looking.
 */
function CustomerFileThumb({ src }: { src: string }) {
 const art = useArtworkSrc(src)
 const box = "size-14 shrink-0 rounded-md border border-border"
 if (art.loading) {
 return <div className={box + " grid place-items-center bg-muted"}><CircleNotch size={14} className="animate-spin text-muted-foreground" /></div>
  }
 if (!art.src) {
 return (
      <a href={canvasReadableSrc(src)} target="_blank" rel="noreferrer"
 title="We can't render this file here — open it to view"
 className={box + " grid place-items-center bg-muted text-2xs font-semibold text-muted-foreground hover:bg-accent"}>
        {art.pdf ? "PDF" : "FILE"}
      </a>
    )
  }
  // Etsy blocks direct hotlinking, so the buyer's file must load through the same-origin
  // proxy (not just for canvas reads — for display too). A rendered PDF is already a data
  // URL and passes through canvasReadableSrc untouched.
  // eslint-disable-next-line @next/next/no-img-element
 return <img src={canvasReadableSrc(art.src)} alt="Customer file" className={box + " object-cover"} />
}

export function DesignCanvasDialog({
 open, onOpenChange, orderId, item, initialDesign, initialPos, onSaved, catalog,
 siblings, designs, onSendToDesigner, filesLocked, sideFee,
}: {
 open: boolean
 onOpenChange: (v: boolean) => void
 orderId: string
 item: OrderItem
 initialDesign?: string
 initialPos?: DesignPos | null
 onSaved?: () => void
 catalog?: CatalogProduct[]
  /** The order's OTHER lines, for "use on every line". Absent → the control isn't offered,
   * which is right for a surface that only ever holds one line. */
 siblings?: OrderItem[]
  /** What each ADDITIONAL printed face adds per unit (settings: method_side). Shown on the
   * side pills so the cost is known BEFORE a second face is committed to, not discovered on
   * the Summary afterwards. null/0 ⇒ extra sides are free and nothing is said. */
 sideFee?: number | null
  /** Every design on the order, keyed as the server keys them (line first, sku as fallback).
   *  Only used to count how many lines "use on every line" would OVERWRITE before it does. */
 designs?: Record<string, { data?: string } | undefined> | null
  /** Staff-only. Offered only when the line has artwork — there is nothing to digitise
   * otherwise. Absent → not offered at all. */
 onSendToDesigner?: () => void
  /** Submitted order, seller side — the file is settled. Replace and Remove are shown but
   * disabled: the seller asks the factory in chat rather than swapping a file underneath a
   * job that may already be running. The server refuses it anyway; this stops the click
   * that gets refused. */
 filesLocked?: boolean
}) {
 const [designUrl, setDesignUrl] = useState(initialDesign ?? "")
  /**
   * THE FILE'S OWN NAME, kept so the row that appears afterwards can say which file it is.
   *
   * The save wrote `name: item.name` — the ITEM's name — so every design on an order was
   * recorded under the garment it sat on, and the Design files card had nothing to print but
   * "Gildan Unisex Heavy Cotton T-Shirt" for a file actually called "love-bug.png".
   *
   * null when the artwork didn't come from a file the person picked (the library, or the
   * line's existing design), in which case the item name is still the honest label.
   */
 const [designName, setDesignName] = useState<string | null>(null)
  /**
   * AND ITS SIZE — so the row underneath can say the file ARRIVED, not just name it.
   *
   * Only a dropped or picked File knows this; the library and templates hand back a data:
   * url with no File behind it. So it is null far more often than the name is, and the row
   * treats it as an extra rather than as something it needs.
   */
  const [designSize, setDesignSize] = useState<number | null>(null)
  // Background removal, shared with the Design maker so the two behave identically.
 const bg = useBackgroundRemoval(designUrl, setDesignUrl)
 const [pos, setPos] = useState<Pos>(initialPos ? { x: initialPos.x, y: initialPos.y, w: initialPos.w, r: initialPos.r } : DEFAULT_POS)
 const [saving, setSaving] = useState(false)
 const confirm = useConfirm()
  // Resolve the REAL blank mockup from the catalog (per the chosen colour + its side
  // faces), not the raw order-line thumbnail. Falls back to item.img when the product
  // can't be resolved (e.g. an unmatched marketplace SKU).
  /** One size for every mark on the rail — the same 36px target the selection strip uses,
   * so the two toolbars on this stage are one visual language rather than two. */
  /**
   * EVERY TOOL SAYS WHAT IT IS.
   *
   * The rail was four glyphs in a column — an arrow, a folder, a bookmark and a picture —
   * and between them they name four things you can do to artwork, none of which a person
   * can tell apart at 18px. A tooltip does not help: it appears after you have already
   * guessed and hovered, which is the thing being got wrong. Icon over a word, both small,
   * so the rail is still a rail and not a menu.
   */
 const railBtn = "flex w-14 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
 const railWord = "text-[10px] font-medium leading-none"
  /** Which kind of file the Files panel is offering. A TAB, not five buttons: the three
   *  differ only in what they accept, which is a property of the drop target, not five
   *  separate errands. */
  const [fileTab, setFileTab] = useState<"image" | "templates" | "machine">("image")
 const [tplBusy, setTplBusy] = useState(false)
  /** null = the box is closed. A string is what is being typed into it. */
 const [tplName, setTplName] = useState<string | null>(null)
  /**
   * THE SUGGESTED NAME, and it is NOT the item's name.
   *
   * A marketplace title is a keyword list — "Custom Apron with Embroidered Name, Heavy Duty
   * Cotton Canvas Apron with Pocket, Adjustable Barista Apron, Personalized Apron, Gift For
   * Mom" — and offering that as the default made every template share a 120-character name
   * that says nothing about the placement, which is the only thing a template holds. The
   * blank and the side do say something, and they fit in a field.
   */
 const defaultTplName = [item.blank || item.sku || "Placement", item.color].filter(Boolean).join(" · ")

 const faces = useMemo(() => {
 const product = resolveProduct(item, catalog ?? [])
 const f = mockupFaces(product, item.color)
 return f.length ? f : (item.img ? [{ side: "front", url: item.img }] : [])
  }, [item, catalog])
 const [side, setSide] = useState(0)
  /**
   * WHOSE PHOTO THE STAGE DRAWS.
   *
   * The seller's own comes first when they have set one for this side: most of them already
   * have product photography, and placing artwork on OUR blank photo means the picture they
   * list with and the picture the floor works from are two different images of one job.
   * Ours is the fallback, and clearing theirs returns to it.
   *
   * A BACKDROP ONLY. Nothing below reads this as artwork — `designUrl` is still what gets
   * placed, saved and printed, and a line with a mockup and no design is still a line with
   * no design, on this screen and at the ship gate alike.
   */
 const [ownMockups, setOwnMockups] = useState<Record<string, string>>(
    (item.mockups as Record<string, string> | null | undefined) ?? {})
 const sideKey = (faces[side]?.side || "front").toLowerCase()
 const activeMockup = ownMockups[sideKey] || faces[side]?.url || item.img || ""
 const [mockBusy, setMockBusy] = useState(false)

 const sideName = (faces[side]?.side || "front").toLowerCase()

  /**
   * ONE ARTWORK PER FACE, held here while the window is open.
   *
   * The stage shows ONE design at a time — whichever face you are on — so switching tabs has
   * to put the current face's work away and bring the next one out. Without this the face
   * tabs only changed the mockup underneath: the same picture followed you round the
   * garment, and saving on the back overwrote the front.
   *
   * Keyed by side name, seeded from the server on open. `null` for a face means "nothing on
   * it", which is different from "not loaded yet" — the latter is `faceArt === null`.
   */
 type FaceArt = { data: string; pos: Pos; name: string | null }
 const [faceArt, setFaceArt] = useState<Record<string, FaceArt | null> | null>(null)
  /** What the SERVER holds for each face, so Save only sends what actually changed. */
 const [savedFaces, setSavedFaces] = useState<Record<string, { data: string; pos: Pos }>>({})
  /** Stash what is on screen back into the face it belongs to, before leaving it. */
 const stashCurrentFace = useCallback(() => {
 setFaceArt((prev) => ({
      ...(prev ?? {}),
 [sideName]: designUrl ? { data: designUrl, pos, name: designName } : null,
    }))
  }, [sideName, designUrl, pos, designName])
  /** Move to a face: put this one away, bring that one out. */
 const goToSide = (i: number) => {
 if (i === side) return
 stashCurrentFace()
 const next = (faces[i]?.side || "front").toLowerCase()
 const art = (faceArt ?? {})[next]
 setSide(i)
 setDesignUrl(art?.data ?? "")
 setDesignName(art?.name ?? null)
 setDesignSize(null)
 setPos(art?.pos ?? DEFAULT_POS)
 setErr(null)
  }
  /** True when ANY face has artwork — what Save is actually able to act on. */
  /** Which faces carry artwork, for the tabs — counting what is on screen for the live one. */
 const facesWithArt = useMemo(() => {
 const out: Record<string, boolean> = {}
 for (const [k, v] of Object.entries(faceArt ?? {})) out[k] = !!v?.data
 out[sideName] = !!designUrl
 return out
  }, [faceArt, sideName, designUrl])
 const anyFaceHasArt = Object.values(facesWithArt).some(Boolean)
  /**
   * The faces that are ADDING to the price: every printed face except the first.
   *
   * Ordered by the garment's own face list, so the answer is stable — "the first" is front
   * on anything that has one, not whichever row the server happened to return first.
   */
 const costingFaces = useMemo(() => {
 const out: Record<string, boolean> = {}
 let seen = 0
 for (const f of faces) {
 const k = (f.side || "front").toLowerCase()
 if (facesWithArt[k]) { seen += 1; out[k] = seen > 1 }
    }
 return out
  }, [faces, facesWithArt])

  // Thread match (EMB only): sample the artwork's dominant colours → nearest in-stock
  // threads, so the factory knows which cones to load. Re-runs when the design changes.
  // One shared rule (lib/variant-resolve) — the thread module and the machine-file step
  // below both read it, so they cannot drift apart again.
 const isEmb = isEmbroidery(item.print_type)
 const [threads, setThreads] = useState<Thread[]>([])
 const [picking, setPicking] = useState(false)
  // The thread MAP: which colour covers which part. ALWAYS on now — it was behind a "Map"
  // toggle next to a row of colour chips, which is two ways of saying the same thing where
  // only one of them (the crop + the dropdown) can actually be acted on. The chips were the
  // toggle's whole justification and they are gone, so there is nothing left to switch
  // between. Still never persisted — the crops derive from artwork we already hold.
 const [regions, setRegions] = useState<ThreadRegion[] | null>(null)
  // The cone chosen for each sampled colour, keyed by the ARTWORK hex. The auto-match
  // is only a suggestion — the nearest cone by maths is not always the one you want on
  // the garment — so this records the human's override and wins over region.thread.
 const [picks, setPicks] = useState<Record<string, string>>({})
  /** Has anyone edited this list by hand — removed a row, overridden a cone, sampled a
   * colour? Only then is there anything for "Start over" to undo, and only then is it
   * offered. Cleared whenever the matcher rebuilds the list from the artwork. */
 const [touched, setTouched] = useState(false)

  /** Swap the cone for one sampled colour, keeping the saved thread list in step. */
 const chooseThread = (r: ThreadRegion, code: string) => {
 const next = r.options.find((o) => o.code === code)
 if (!next) return
 const current = picks[r.srcHex] ?? r.thread.code
 setTouched(true)
 setPicks((p) => ({ ...p, [r.srcHex]: code }))
 setThreads((prev) => {
      // Drop the cone this colour used to claim, then add the new one — but only if no
      // OTHER sampled colour still resolves to it, or picking would silently unload a
      // cone another part of the design needs.
 const stillUsed = (regions ?? []).some((o) => o.srcHex !== r.srcHex && (picks[o.srcHex] ?? o.thread.code) === current)
 const without = stillUsed ? prev : prev.filter((t) => t.code !== current)
 return without.some((t) => t.code === next.code) ? without : [...without, next]
    })
  }

  /**
   * Drop one colour off the design.
   *
   * The matcher finds colours; it doesn't know which of them matter. A stray anti-aliased
   * edge, a background the artwork was exported on, or a second shade the digitiser intends
   * to stitch in the first one's cone — all of them arrive as rows, and until now the only
   * way to deal with one was to leave it there and hope the floor ignored it. The list is
   * what the factory loads, so a row nobody wants stitched has to be removable.
   *
   * Removes the CONE too, unless another remaining colour still resolves to it — the same
   * rule chooseThread uses, and for the same reason: unloading a cone another part of the
   * design needs would be a silent change to what gets made.
   */
 const dropRegion = (r: ThreadRegion) => {
 const code = picks[r.srcHex] ?? r.thread.code
 const rest = (regions ?? []).filter((o) => o.srcHex !== r.srcHex)
 setTouched(true)
 setRegions(rest)
 setPicks((p) => { const n = { ...p }; delete n[r.srcHex]; return n })
 const stillUsed = rest.some((o) => (picks[o.srcHex] ?? o.thread.code) === code)
 if (!stillUsed) setThreads((prev) => prev.filter((t) => t.code !== code))
  }

  /**
   * Put the auto-match back.
   *
   * Removing rows and picking cones are both destructive to a read-out that was DERIVED —
   * the artwork still says what it says. Without this, undoing a mistaken removal meant
   * re-uploading the design, because nothing else re-runs the matcher. Rebuilds the rows
   * from the artwork and drops every override, which is exactly "how it arrived".
   */
 const [rematching, setRematching] = useState(false)
 const rematch = () => {
 if (!designUrl) return
 setRematching(true)
 setPicks({})
 setTouched(false)
 loadThreadPalette()
      .then(() => Promise.all([matchThreadRegions(designUrl), matchThreadColors(designUrl)]))
      .then(([rs, ts]) => { setRegions(rs); setThreads(ts); setThreadErr(ts.length === 0) })
      .catch(() => { setRegions([]); setThreadErr(true) })
      .finally(() => setRematching(false))
  }
  // null = not attempted, [] = attempted and found nothing (which is a real outcome worth
  // saying out loud — it previously looked identical to "no artwork yet").
 const [threadErr, setThreadErr] = useState(false)
 useEffect(() => {
 let live = true
    // Deferred: setting state synchronously inside an effect cascades a second render
    // before paint, which the lint rule flags and which this doesn't need.
 const id = setTimeout(() => {
 if (!live) return
 if (!isEmb || !designUrl) { setThreads([]); setThreadErr(false); return }
 setThreadErr(false)
      // Load the factory's real cone stock BEFORE matching. Matching against the
      // built-in starter set first would show cones nobody has on a shelf, and the
      // loader is memoised so this is one fetch per session, not per design.
 loadThreadPalette().then(() => matchThreadColors(designUrl)).then((t) => {
 if (!live) return
 setThreads(t)
 setThreadErr(t.length === 0)
      }).catch(() => { if (live) setThreadErr(true) })
    }, 0)
 return () => { live = false; clearTimeout(id) }
  }, [designUrl, isEmb])
  // Eyedropper: a sampled pixel → its nearest in-stock thread, appended (deduped) so the
  // operator can add a colour the auto-match missed. One pick, then the tool turns off.
 useEffect(() => {
 let alive = true
    // Deferred, like the cone list above: a synchronous setState in an effect body
    // cascades a render before paint (react-hooks/set-state-in-effect).
 const id = setTimeout(() => {
 if (!alive) return
 setRegions(null)
 setTouched(false)
 if (!isEmb || !designUrl) return
      // Same order as the cone list above: the factory's real stock first, or the rows
      // would offer colours nobody has on a shelf and then quietly re-match under them.
 loadThreadPalette()
        .then(() => matchThreadRegions(designUrl))
        .then((r) => { if (alive) setRegions(r) })
        .catch(() => { if (alive) setRegions([]) })
    }, 0)
 return () => { alive = false; clearTimeout(id) }
  }, [isEmb, designUrl])

  // The eyedropper adds the nearest cone and says nothing about how near it is.
  //
  // It used to raise a "not a real match" banner when matchQuality called the sample poor,
  // but that verdict is measured against DEFAULT_THREAD_PALETTE — 16 colours, which is not
  // the stock actually on the floor. A cone we hold but the palette has never heard of came
  // back as "no close match", so the warning fired on colours that were fine. A judgement
  // that wrong that often is worse than no judgement: the crop shows the real colour and the
  // dropdown offers every alternative, so the human decides.
 const onPickColor = (hex: string) => {
 const { r, g, b } = hexToRgb(hex)
 const t = nearestThread(r, g, b)
 if (t) setThreads((prev) => (prev.some((x) => x.code === t.code) ? prev : [...prev, t]))
    // AND a row for it. The chip row used to be the only place a picked colour appeared;
    // with the chips gone, a pick that only bumped a counter would look like nothing had
    // happened — and it would be unchangeable, since the dropdowns are per row. No crop
    // (we sampled one pixel, not a region), so the row shows a solid block of the colour,
    // which the renderer already falls back to.
 if (t) {
 setTouched(true)
 const opts = nearestThreads(r, g, b, 6)
 setRegions((prev) => {
 const rows = prev ?? []
 if (rows.some((o) => o.srcHex.toLowerCase() === hex.toLowerCase())) return rows
 return [...rows, {
 thread: t,
 options: opts.some((o) => o.code === t.code) ? opts : [t, ...opts],
 srcHex: hex, pct: 0, box: { x: 0, y: 0, w: 0, h: 0 }, swatch: "",
          ...matchQuality(r, g, b, t),
        }]
      })
    }
 setPicking(false)
  }
 const [err, setErr] = useState<string | null>(null)
  // The green line under the steps: something worked. Separate from `err` because it is a
  // success, and the seller needs telling that something happened — the canvas cannot show
  // a .emb, so without a word the window looks identical to a dropped file being lost.
  //
  // IT IS A MESSAGE, NOT A STATE. Four different actions write to it (a machine file
  // filed, a file widened to the order, artwork copied to the other lines, a tier charged),
  // and step ② read `!!attached` as "this line has a machine file" — so pressing "Apply
  // image to all items" ticked the EMBROIDERY FILE step green and captioned it "ready to
  // stitch" for a line with no file at all. It also flipped the suggested design tier to
  // 'supplied' (the cheap check fee, for a file the seller never sent). The fact lives in
  // `justAttachedFile` now; this string only ever speaks.
  /**
   * THE CONFIRMATION LINE — renamed from `attached`, and now actually on screen.
   *
   * Five separate actions wrote to it: a file widened to the whole order, artwork copied to
   * the sibling lines, a photo made the backdrop, a template saved, artwork copied to the
   * other faces. Every one of them a thing that changes data you cannot see from this
   * window. It was rendered NOWHERE — the lint had been warning that `attached` was never
   * read for as long as the variable existed — so all five ran in complete silence and the
   * only way to learn whether "Apply to all items" had done anything was to close the window
   * and count.
   *
   * The name was the problem: called `attached`, it read as a fact about a file (and one
   * earlier bug came from exactly that — step ② read `!!attached` as "this line has a
   * machine file"). It is a MESSAGE. `justAttachedFile` holds the fact.
   */
 const [notice, setNotice] = useState<string | null>(null)
  /** A machine file was filed in THIS window — the one thing that legitimately makes step ②
   * done before the server has been re-read. */
 const [justAttachedFile, setJustAttachedFile] = useState(false)
 const [libOpen, setLibOpen] = useState(false)
  /** Which tab the library lands on. Pressing Template must not drop you on Designs. */
 const [libSource, setLibSource] = useState<"designs" | "templates">("designs")
  /**
   * WHERE THIS FACE'S ARTWORK CAME FROM — three states, per side.
   *
   * A template is a placement recipe, and picking one used to throw its identity away the
   * moment the pieces landed on the canvas: the submitted order carried the RESULT of TPL-12
   * with no memory that TPL-12 existed, so the factory could not ask what else had been cut
   * from the same one.
   *
   * absent  — this session has not changed where the artwork came from. The save omits the
   *           field and the server keeps whatever is already recorded.
   * ""      — replaced from somewhere that is NOT a template (an upload, a library image, a
   *           customer's reference photo). The save clears it: attributing a new picture to
   *           a recipe it was never cut from is worse than recording nothing.
   * "TPL-…" — picked from that template.
   */
 const [tplBySide, setTplBySide] = useState<Record<string, string>>({})
 const noteArtSource = useCallback((side: string, tpl: string) => setTplBySide((m) => ({ ...m, [side]: tpl })), [])
 const [over, setOver] = useState(false)
  /** The explicit machine-file picker. Dropping one already worked; there was no BUTTON,
   * so a seller who had cut their own file and didn't think to drag it had no route. */
 const machineRef = useRef<HTMLInputElement | null>(null)
  /** The artwork picker, driven by the stage overlay rather than by a button of its own. */
 const uploadRef = useRef<HTMLInputElement | null>(null)
  /** Separate from the artwork input on purpose: two files, two meanings, and one picker
   * that changed meaning by mode would be the exact confusion this control has to avoid. */
 const mockupRef = useRef<HTMLInputElement | null>(null)

  /**
   * Whether the VIEWER is factory staff.
   *
   * Two things below are staff-only and the reason is the same for both: the design charge
   * decides what the SELLER pays, so the person being charged must not be the one setting
   * it; and sending a line to a designer spends factory time. Read from the session rather
   * than passed in — a caller that forgot the prop would silently expose both, and that
   * failure looks exactly like a working screen. The server gates these routes too; this is
   * only the UI half.
   */
 const [isStaff, setIsStaff] = useState(false)
 useEffect(() => {
 const t = setTimeout(() => {
 const role = getUser()?.role
 setIsStaff(role === "admin" || role === "operator" || role === "warehouse" || role === "designer")
    }, 0)
 return () => clearTimeout(t)
  }, [])

  /** What each tier costs the seller. Rendered only once loaded, so a slow fetch never
   * shows a confident $0 next to a button that moves money. */
 const [fees, setFees] = useState<{ standard: number; complex: number; check: number } | null>(null)
 useEffect(() => {
 if (!open) return
    // Seller-safe fees read (just the design/check fees, no margin policy), so BOTH the
    // staff charge picker and the seller's fee estimate can show the real number.
 const t = setTimeout(() => {
 getDesignFees()
        .then((f) => setFees({ standard: f.standard || 0, complex: f.complex || 0, check: f.check || 0 }))
        .catch(() => setFees(null))
    }, 0)
 return () => clearTimeout(t)
  }, [open])

  /**
   * Does THIS LINE already have a machine file? The only honest input to the suggestion
   * below, and it has to be asked of the server — an order item carries no such field, so
   * inferring it from anything on `item` would be a guess dressed as a fact.
   *
   * Filtered by sku AND by kind: an image on the line is artwork, not a deliverable, and
   * counting it would recommend the check fee for a file nobody supplied. `attached` ORs
   * in so a file filed moments ago in this window counts without a refetch.
   */
 const [hasFile, setHasFile] = useState(false)
  /** Every file on this line, whatever kind — the list under the stage. Carries the id
   *  because a row you cannot open is a row that only tells you something is missing. */
 const [lineFiles, setLineFiles] = useState<{ designId: string; kind: string; name: string }[]>([])
  // The NEWEST machine file for this line, by name — so slot ② can show which fixed file is
  // current after a revision, instead of a bare "added".
 const [latestMachine, setLatestMachine] = useState<{ designId: string; name: string } | null>(null)
  // The stitch preview of this line's machine file, and whether the stage is showing it.
  // Fetched once, on the first switch — a render costs a Wilcom call, and the server keeps
  // the result against the file's hash, so switching back and forth is free after that.
  // Which side of submit the lock is on — the two are opposite and the tooltip must say
  // which one applies to the person reading it.
 const lockedWhy = getUser()?.role === "seller"
    ? "The order is submitted — ask the factory in chat to change this file"
 : "Not submitted yet — this is still the seller's draft"
 const [stitchPng, setStitchPng] = useState<string | null>(null)
 const [stitchState, setStitchState] = useState<"idle" | "loading" | "none">("idle")
 const [showStitch, setShowStitch] = useState(false)
  // Fetching the bytes. Per-file busy/error so a paywalled or missing file says so HERE
  // rather than failing silently under the cursor.
  /**
   * Has THIS line been sent to the design board, and where has it got to?
   *
   * The readiness chip on the order row answers that for the whole order, which is not the
   * question you are asking with one item open in front of you — on a two-line order it said
   * "on the board" for the line that was still untouched. Staff only; the route is gated, so
   * a seller simply gets nothing here rather than a factory lane name.
   */
 const [boardCard, setBoardCard] = useState<OrderDesignCard | null>(null)
  /** Already with an outside partner. `vendor` is only ever set by a successful push, so
   * this is the fact that a task exists on their board — not a guess from the lane. */
 const sentToPartner = !!boardCard?.vendor
  /**
   * THE ARTWORK THE PARTNER ACTUALLY HAS.
   *
   * Captured when the dialog opens, then compared against what's on screen. Replacing the
   * image left step 2 sitting there green and saying "Sent to Pink Design" — for a file
   * they were never given. A finished tick over stale artwork is the worst kind of wrong:
   * it reads as "handled", so nobody re-sends, and the partner returns a digitised version
   * of the picture you replaced.
   *
   * State with a once-evaluated initialiser, not a ref: it holds the value as of open
   * without being read during render, which the refs lint rule forbids — and rightly, a
   * ref read while rendering is a value React can't promise is current.
   */
  /**
   * THE DESIGN'S OWN NUMBER — DSN-1042.
   *
   * Seeded from the line (the order list carries it) and refreshed from whatever a save
   * hands back, because a replaced image is different artwork and therefore a different
   * number. Shown so a design can be referred to at all: most carry no name, and "the
   * octopus one" is not something you can type into a search box.
   */
 const [designNo, setDesignNo] = useState<number | null>(item.design_no ?? null)
 const [artAtOpen] = useState<string>(initialDesign ?? "")
  /**
   * LOAD EVERY FACE, once, on open.
   *
   * The page hands us `initialDesign` — one image, the front — because that is all its map
   * holds (indexDesigns is deliberately singular). The back and the sleeves are only in the
   * order's design rows, so they are read here. The face you opened on keeps what is already
   * on screen: it is the same row, and replacing it would discard an edit made in the gap.
   */
 useEffect(() => {
 if (!open || !orderId) return
 let live = true
 const t = setTimeout(() => {
 getOrderDesigns(orderId)
        .then((r) => {
 if (!live) return
 const list = Array.isArray(r) ? r : (r?.designs ?? [])
 const mine = sidesForLine(designsBySide(list), { line_id: item.line_id, sku: item.sku })
 const seeded: Record<string, FaceArt | null> = {}
 for (const [sd, d] of Object.entries(mine)) {
 const src = designSrc(d.data)
 seeded[sd] = src ? { data: src, pos: d.pos ? { x: d.pos.x, y: d.pos.y, w: d.pos.w, r: d.pos.r ?? 0 } : DEFAULT_POS, name: d.name ?? null } : null
          }
 setFaceArt(seeded)
 const conf: Record<string, { data: string; pos: Pos }> = {}
 for (const [sd, a] of Object.entries(seeded)) if (a?.data) conf[sd] = { data: a.data, pos: a.pos }
 setSavedFaces(conf)
        })
        .catch(() => { if (live) setFaceArt({}) })
    }, 0)
 return () => { live = false; clearTimeout(t) }
  }, [open, orderId, item.line_id, item.sku])
 const artworkChangedSinceSend = sentToPartner && designUrl !== artAtOpen
  /** The partner send, for print methods. A dialog rather than an inline form because it
   * asks for Pink's own fields (product type, design type, board) that mean nothing here. */
 const [pinkOpen, setPinkOpen] = useState(false)
  /** Re-read this line's board card. Exposed so a partner push can refresh the subtitle
   * without a second copy of the query. */
 const loadCards = useCallback(() => {
 if (!isStaff) return
 getOrderDesignCards(orderId)
      .then((cards) => setBoardCard(cardForLine(cards ?? [], { line_id: item.line_id, sku: item.sku }) ?? null))
      .catch(() => setBoardCard(null))
  }, [isStaff, orderId, item.line_id, item.sku])
 useEffect(() => {
 if (!open) return
 const t = setTimeout(loadCards, 0)
 return () => clearTimeout(t)
  }, [open, loadCards])

  // Put THIS line on the design board. Reuses createDesignCard + assignDesignCard, the same
  // pair the digitizer uses — the card carries the line's own artwork and sku so it lands
  // attached to the item rather than as a loose card someone has to match up by hand.
 const [sending, setSending] = useState(false)
  /**
   * ASK FIRST, AND SHOW WHAT IS GOING.
   *
   * "Send to Board" fired on the click — no confirmation, nothing shown, and the only sign
   * it had worked was the button disappearing. Sending artwork to another person's queue is
   * not an undoable UI action: they see it, they may start on it, and taking it back means
   * explaining. It is worth one look at the picture that is about to leave.
   */
 const [confirmSend, setConfirmSend] = useState(false)
 const sendToBoard = async () => {
 setConfirmSend(false)
 setSending(true); setErr(null)
 try {
 const card = await createDesignCard({
 title: item.name || item.sku || "Design",
 data: designUrl || undefined,
 sku: item.sku || undefined,
        /**
         * INCOMING. Owner's call, and it reverses what this used to do.
         *
         * It filed as `inprogress` on the reasoning that a card handed straight over is not
         * waiting to be picked up, and sitting in Incoming it reads as unclaimed to the
         * people whose queue that is. The counter-argument is the stronger one: Incoming is
         * where a designer LOOKS for new work, and a card that skips it starts in a lane
         * nobody is watching — arriving already "in progress" with nobody progressing it.
         *
         * Kept as a note rather than deleted, because both readings are reasonable and the
         * next person to wonder should see that it was decided rather than defaulted.
         */
 col: "incoming",
      })
 if (card.error) throw new Error(card.error)
      // Assign separately: creating and attaching are two calls, and a card that exists but
      // is attached to nothing is worse than no card — it shows on the board with no order.
 if (card.id) {
 const a = await assignDesignCard(String(card.id), {
 orderId, sku: item.sku || "", lineId: item.line_id || undefined,
        })
 if (a && (a as { error?: string }).error) throw new Error((a as { error?: string }).error as string)
      }
 const cards = await getOrderDesignCards(orderId).catch(() => null)
 if (cards) setBoardCard(cardForLine(cards, { line_id: item.line_id, sku: item.sku }) ?? null)
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't send this line to the design board.")
    } finally { setSending(false) }
  }

  /** The designId currently being fetched, so the spinner sits on the row you pressed
   *  rather than on all of them. */
 const [dlBusy, setDlBusy] = useState<string | null>(null)
 const [fileBusy, setFileBusy] = useState(false)
 const [dlErr, setDlErr] = useState<string | null>(null)
 useEffect(() => {
 if (!open) return   // read for sellers too — it drives their "you uploaded your file" status
 const t = setTimeout(() => {
 getDesignFiles(orderId)
        .then((rows) => {
          // filesForLine, not a sku match. Keying on sku alone meant a file filed against
          // ONE line showed on every sibling of the same SKU — and on a marketplace line,
          // where the variant (and so the sku) is unset, it matched every unset line on the
          // order. That is the bug: nothing was being "applied to all", the lines were never
          // distinguishable. Line beats order-wide; order-wide still shows when the line has
          // nothing of its own.
 const forLine = filesForLine(rows ?? [], { line_id: item.line_id, sku: item.sku })
          /*
           * KEEP THE WHOLE LINE'S LIST, not just the machine files.
           *
           * The fee tier only cares whether a MACHINE file exists, which is why this used to
           * narrow immediately. But "what has the seller actually sent us" is a different
           * question with a different answer — a line can carry two reference photos and no
           * machine file — and nothing on this screen could answer it once the summary strip
           * came off. The rail badge answers it; the tier still reads `hasFile`.
           */
 setLineFiles(forLine.map((f) => ({ designId: f.designId, kind: String(f.kind || ""), name: f.name || "" })))
 const mine = forLine.filter((f) => f.kind === "emb" || f.kind === "pes")
 setHasFile(mine.length > 0)
 const newest = mine.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0]
 setLatestMachine(newest ? { designId: newest.designId, name: newest.name || "Machine file" } : null)
        })
        .catch(() => { setHasFile(false); setLatestMachine(null); setLineFiles([]) })
    }, 0)
 return () => clearTimeout(t)
  }, [open, orderId, item.sku, item.line_id])
 const hasMachineFile = hasFile || justAttachedFile
  /**
   * SENT IS NOT DONE, AND NOT NOTHING.
   *
   * The embroidery step had two looks — a dashed "2" and a green tick — so a line already
   * WITH a designer rendered identically to one nobody had touched: same grey, same
   * numbered bullet, only a subtitle to tell them apart. There was no sign it had been
   * sent, which is how a second one gets sent.
   */
 const sentToDesigner = !!boardCard && !hasMachineFile


  /* The tier STATE went with the picker (design-charge.tsx, in the order's Summary). What
 is left is `applying`, which belongs to "apply this image to every line" and never had
 anything to do with the charge. */
 const [applying, setApplying] = useState(false)
  /**
   * THE EMBROIDERY APPARATUS, CLOSED BY DEFAULT.
   *
   * A stitch file and a thread list are two panels of real substance, and on an embroidered
   * line they were always open — under a window whose whole job is a picture on a garment.
   * A DTG line never had them and reads as just the image; an EMB one should too, until the
   * moment somebody is doing stitch work.
   *
   * One flag for both, not one each: they are halves of the same subject, and two separate
   * disclosures on one short column is more chrome than the panels save.
   */

  /**
   * THE SUGGESTION IS GONE, deliberately, and this note is what is left of it.
   *
   * A tier was recommended from one signal — a machine file on the line meant 'supplied',
   * otherwise 'standard' — and shown as a highlighted chip with a fee beside it. It never
   * charged anything, which was the care taken at the time, and it still sat in the place a
   * real charge goes on the window where someone decides what to bill. Read at a glance,
   * a guess in that position is indistinguishable from the amount.
   *
   * `hasMachineFile` is still read elsewhere on this card; only the recommendation went.
   * Bringing it back means answering how it reads as advice rather than as the figure.
   */

  /**
   * File a MACHINE file against this line.
   *
   * One implementation for both routes into it — the drop anywhere in the window, and the
   * explicit button. They were about to be two copies of the same twenty lines, and the
   * copy that drifts is always the one that stops setting `sku`, which silently files the
   * deliverable against the order instead of the line.
   *
   * The canvas is deliberately NOT touched: a stitch file has nothing to position. Saying
   * so is the whole point of `attached` — without a word, a window that looks identical
   * before and after reads as the upload having failed.
   */
 const attachMachineFile = useCallback(async (f: File) => {
    // 50MB: the API body limit is 60MB and base64 inflates by about a third, so anything
    // larger comes back as a confusing server rejection rather than this sentence.
 if (f.size > 50 * 1024 * 1024) { setErr(`${f.name} is too large — 50 MB is the limit.`); return }
 const designId = `EMB-${item.line_id ?? item.sku ?? "line"}-${f.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`
 try {
 const data = await new Promise<string>((res, rej) => {
 const r = new FileReader()
 r.onload = () => res(String(r.result))
 r.onerror = () => rej(new Error("couldn't be read"))
 r.readAsDataURL(f)
      })
 const r = await uploadDesignFile({
 designId, orderId, sku: item.sku ?? undefined,
        // THIS line only. "Apply file to all items" below is the deliberate way to widen it.
 lineId: item.line_id ?? undefined,
 name: f.name, mime: f.type || undefined, data,
      })
 if (r?.error) throw new Error(r.error)
 setErr(null)
      // Keep it SHORT — just confirm the file. Staff keep the one actionable nudge (add an
      // image so the stitch file has somewhere to sit on the mockup); the seller sees a plain
      // success line, no fee explainer.
 setJustAttachedFile(true)
      // ONE LINE, AND IT ONLY CONFIRMS. Staff used to get "…Add an image too so it shows on
      // the mockup" tacked on: an instruction, in the same green as the success, for a
      // second upload nobody had asked about — and it appeared every single time a file
      // was filed, whether or not the line already had artwork. The confirmation stays,
      // because the canvas cannot render a .emb and a window that looks identical before
      // and after reads as the drop having failed.
      /**
       * AND PUT IT IN THE LIST, which is the only place the name is actually printed.
       *
       * The list is loaded once when the dialog opens and this path never touched it, so a
       * file attached during the session appeared nowhere until the window was closed and
       * reopened — the comment above claimed the name was "rendered inside the box as the
       * file's label", and `attached` was in fact read by nothing at all. Optimistic, and
       * de-duplicated on designId so re-dropping the same file does not double the row.
       */
 setLineFiles((prev) => prev.some((x) => x.designId === designId)
        ? prev
 : [...prev, { designId, kind: "machine", name: f.name }])
    } catch (e) { setErr(`Couldn't attach ${f.name}: ${(e as Error).message}`) }
  }, [orderId, item.line_id, item.sku])

  /**
   * Put THIS line's artwork on every other line of the order.
   *
   * One row PER LINE, never one write against the sku: order_designs is keyed on
   * (order_id, coalesce(line_id, sku), kind), so a single sku-keyed write would collapse
   * identical-sku siblings into one row and undo the exact thing that key exists for.
   *
   * Counts what it would OVERWRITE and says so first. This is one click and it can replace
   * artwork on lines nobody is currently looking at.
   */
  /** Swap the stage between the artwork and the stitch preview of the attached file. */
 const toggleStitch = useCallback(async () => {
 if (showStitch) { setShowStitch(false); return }
 if (stitchPng) { setShowStitch(true); return }
 if (!latestMachine) return
 setStitchState("loading")
 const r = await getEmbPreview({ designId: latestMachine.designId }).catch(() => null)
 if (r?.ok && r.png) { setStitchPng(r.png); setShowStitch(true); setStitchState("idle") }
 else setStitchState("none")
  }, [showStitch, stitchPng, latestMachine])

  /** Open ONE of this line's files, by id. 402 is the paywall, not a fault — say which.
   *  It took no argument and always fetched `latestMachine`, which is fine for a button that
   *  means "the machine file" and useless for a list where every row is a different file. */
 const downloadFile = useCallback(async (designId: string, fallbackName?: string) => {
 setDlBusy(designId); setDlErr(null)
 try {
 const r = await downloadDesignFile(designId)
 const src = r.data || r.url
 if (!src) throw new Error("No file came back.")
      // SAVED WITH ITS NAME. window.open() on a data: URL hands Chrome a file called
      // "download" with no extension — 124 KB of EMB that no embroidery program will open
      // because nothing tells it what it is. `download` is ignored cross-origin, so a
      // storage URL is fetched to a blob first and saved from this origin.
 const blob = src.startsWith("data:") ? await (await fetch(src)).blob() : await (await fetch(src)).blob()
 const href = URL.createObjectURL(blob)
 const a = document.createElement("a")
 a.href = href
 a.download = r.name || fallbackName || "design.emb"
 a.click()
 setTimeout(() => URL.revokeObjectURL(href), 10_000)
    } catch (e) {
 const m = e instanceof Error ? e.message : "Couldn't open that file."
 setDlErr(/402|purchase|paid/i.test(m) ? "Not purchased yet." : m)
    } finally { setDlBusy(null) }
  }, [])

  /**
   * Widen THIS line's machine file to the whole order.
   *
   * Re-files the same row with line_id null rather than copying it once per line: one file,
   * one row, and the drop zone can then label it "Whole order" instead of listing the same
   * name N times. The upsert deliberately does not coalesce line_id, which is what makes
   * this able to widen a file that started life pinned to a line.
   *
   * Only widens. It never narrows an order-wide file back onto one line — that would silently
   * remove it from every other item, which is not what a button called "apply to all" should
   * be capable of.
   */
 const applyFileToAll = useCallback(async () => {
 if (!latestMachine) return
 const ok = await confirm({
 title: "Use this machine file on every item?",
 body: `${latestMachine.name} will apply to all items on this order, including any added later. Items with their own file keep it.`,
 confirmLabel: "Apply to all",
 destructive: false,
    })
 if (!ok) return
 setFileBusy(true); setDlErr(null)
 try {
      // Metadata, not bytes: the file already lives on the order, so widening it is one
      // column. Round-tripping it through download+upload cost a seller their own click —
      // they cannot download an .emb — and moved the whole file to change a scope.
 const up = await scopeDesignFile(latestMachine.designId, null)
 if (up?.error) throw new Error(up.error)
 setNotice(`${latestMachine.name} now applies to every item on this order.`)
 onSaved?.()
    } catch (e) {
 setDlErr(e instanceof Error ? e.message : "Couldn't apply that file to all items.")
    } finally { setFileBusy(false) }
  }, [latestMachine, confirm, onSaved, setFileBusy, setDlErr, setNotice])

 const applyToAll = useCallback(async () => {
 const others = siblings ?? []
 if (!designUrl || !others.length) return
 const willReplace = others.filter((it) => !!designs?.[(it.line_id ?? it.sku) as string]?.data).length
 const ok = await confirm({
 title: `Put this ${sideName} artwork on all ${others.length} other line${others.length === 1 ? "" : "s"}?`,
 body: willReplace ? `${willReplace} of them already ${willReplace === 1 ? "has artwork and it" : "have artwork and they"} will be replaced.` : undefined,
 confirmLabel: "Apply to all",
 destructive: false,
    })
 if (!ok) return
 setApplying(true); setErr(null)
 const failed: string[] = []
 for (const it of others) {
 try {
 const r = await postOrderDesign(orderId, {
 sku: it.sku ?? "", line_id: it.line_id ?? undefined,
          // ONTO THE SAME FACE. Without this every copy landed on the front, so applying a
          // BACK design to nine sizes printed nine fronts — and left each of those lines'
          // real front artwork overwritten. It copies the face you are standing on, which is
          // the one shown in the confirm.
 side: sideName, data: designUrl,
          // The same file, so the same NAME on every line it lands on — copying the source
          // line's item name onto five other garments labelled them all as that garment.
 name: designName || item.name || undefined, pos: { x: pos.x, y: pos.y, w: pos.w, r: pos.r },
        })
 if (r?.error) throw new Error(r.error)
      } catch (e) { failed.push(`${it.sku ?? "line"}${e instanceof Error ? ` (${e.message})` : ""}`) }
    }
 setApplying(false)
 if (failed.length) setErr(`Couldn't apply to: ${failed.join(", ")}`)
 const done = others.length - failed.length
 if (done > 0) { setNotice(`Applied to ${done} other line${done === 1 ? "" : "s"}.`); onSaved?.() }
  }, [designUrl, designName, sideName, siblings, designs, orderId, item.name, pos, onSaved, confirm])

  /**
   * TAKE IT OFF, for real.
   *
   * The ✕ used to call setDesignUrl("") and stop there. That clears the canvas and nothing
   * else: save() refuses an empty design ("Upload artwork first"), so the row survived and
   * reopening the window brought the artwork straight back. Anyone who pressed it and closed
   * the window believed the line was blank when it was not — which on the floor is a garment
   * printed with a design somebody thought they had removed.
   *
   * Artwork that was never saved (picked a moment ago, not yet committed) has nothing to
   * delete, so that case stays local and instant.
   */
 const [removing, setRemoving] = useState(false)
  /** Upload a photo and hang it behind THIS side. Same downsize-then-store path the chat
   * composer uses, so one place decides what we accept and what gets re-encoded. */
 const setOwnMockup = async (file: File | undefined) => {
 if (!file) return
 setMockBusy(true); setErr(null)
 try {
 const up = await uploadChatAttachment(await fileToUploadUrl(file), file.name)
 if (up.error || !up.url) throw new Error(up.error || "Upload failed")
 const r = await setItemMockup(orderId, { line_id: item.line_id, sku: item.line_id ? undefined : item.sku, side: sideKey, url: up.url })
 if (r.error) throw new Error(r.error)
      // FUNCTIONAL UPDATE, not a read of the state it is writing. Closing over `ownMockups`
      // here made this function depend on a value it also sets, which is both a stale-read
      // hazard across an await and enough to stop the compiler preserving the memoization
      // of every callback in the component.
 setOwnMockups((m) => r.mockups ?? { ...m, [sideKey]: up.url as string })
 setNotice("Your photo is the backdrop for this side. It is not the print file — the design still is.")
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't use that photo as the mockup.")
    } finally { setMockBusy(false) }
  }

 const clearOwnMockup = async () => {
 setMockBusy(true); setErr(null)
 try {
 const r = await setItemMockup(orderId, { line_id: item.line_id, sku: item.line_id ? undefined : item.sku, side: sideKey, url: null })
 if (r.error) throw new Error(r.error)
 setOwnMockups(r.mockups ?? {})
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't put our photo back.")
    } finally { setMockBusy(false) }
  }

  /**
   * SAVE THIS PLACEMENT AS A TEMPLATE — the missing half of the library.
   *
   * LibraryPickerDialog has always been able to hand a template back and apply BOTH the
   * artwork and where it sits ("a template brings its placement"), and there was no way to
   * make one from here — so a placement worked out once on a garment had to be redone by
   * eye on the next order.
   *
   * Written in the shape the picker reads: `layers.images[]` with each src and its pos. The
   * blank is deliberately NOT stored — the picker refuses to apply one anyway, because this
   * canvas belongs to a line whose garment is already decided.
   */
 const saveAsTemplate = async (name: string) => {
 if (!designUrl) return
 setTplBusy(true); setErr(null)
 try {
 const r = await saveTemplate({
 id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
 name: name.trim() || defaultTplName,
        // The shape LibraryPickerDialog reads back — and it reads the SAME /api/templates
        // this writes, so a template saved here is in the list the rail's library button
        // opens, on this order and on every other one.
 layers: { images: [{ src: designUrl, pos }] },
      })
 if (r?.error) throw new Error(r.error)
 setTplName(null)
 setNotice("Saved as a template — it is in the library for any order.")
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't save that template.")
    } finally { setTplBusy(false) }
  }

  /**
   * ONE INTAKE FOR ONE WINDOW — dropped or browsed, the same rules.
   *
   * A STITCH FILE ONLY FITS AN EMBROIDERED LINE. On a DTG or laser line there is no machine
   * to run it and no check to perform, so filing one there is not a near-miss — it is a fee
   * raised for a file nothing can use. This refusal used to live only in the drop handler,
   * so the file picker beside it would happily accept what the drop refused.
   */
 const takeFile = (f: File | undefined) => {
 if (!f) return
 if (MACHINE_RE.test(f.name)) {
 if (!isEmb) {
 setErr(`${f.name} is an embroidery file, and this line is ${item.print_type || "not embroidered"} — there is no machine to run it. Use a PNG or JPG instead.`)
 return
      }
 void attachMachineFile(f); return
    }
 if (!/^image\//.test(f.type)) {
 setErr(`${f.name} isn't an image or a machine file, so there's nothing to do with it here.`)
 return
    }
 readImageFile(f, (u) => { setErr(null); setDesignUrl(u); setDesignName(f.name); setDesignSize(f.size); setPos(DEFAULT_POS); noteArtSource(sideName, "") }, setErr)
  }

 const removeArtwork = async () => {
 if (removing) return   // a second click would open a second confirm over the first
 const saved = !!artAtOpen && !!designUrl
 if (!saved) { setDesignUrl(""); setDesignName(null); setDesignSize(null); setFaceArt((prev) => ({ ...(prev ?? {}), [sideName]: null })); return }
 if (!(await confirm({
 title: "Take this artwork off the item?",
 body: "It comes off this line. Any design charge already made stays — ask us if it needs reversing.",
 confirmLabel: "Remove artwork",
 destructive: true,
    }))) return
 setRemoving(true); setErr(null)
 try {
      // THIS FACE ONLY. Removing the front must not take the back off with it.
 const r = await deleteOrderDesign(orderId, { line_id: item.line_id ?? undefined, sku: item.sku ?? undefined, side: sideName })
 if (r?.error) throw new Error(r.error)
 setDesignUrl(""); setDesignName(null); setDesignSize(null)
 setFaceArt((prev) => ({ ...(prev ?? {}), [sideName]: null }))
 setSavedFaces((prev) => { const n = { ...prev }; delete n[sideName]; return n })
 onSaved?.()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't remove the artwork.")
    } finally { setRemoving(false) }
  }

  /**
   * COPY THIS FACE ONTO THE OTHERS.
   *
   * Front and back carrying the same design is the ordinary case, and doing it by hand meant
   * uploading the same file once per face and placing it again each time. Copies the artwork
   * AND its position, because "the same design" means in the same spot — a copy that lands
   * centred when the original sits high on the chest is not the thing that was asked for.
   *
   * Staged, not saved: it fills the other faces in this window and Save writes them, so it is
   * undoable by closing without saving, like every other edit here.
   */
 const copyToOtherFaces = () => {
 if (!designUrl || faces.length < 2) return
 stashCurrentFace()
 setFaceArt((prev) => {
 const next = { ...(prev ?? {}) }
 for (const f of faces) {
 const k = (f.side || "front").toLowerCase()
 if (k === sideName) continue
 next[k] = { data: designUrl, pos: { ...pos }, name: designName }
      }
 return next
    })
 setNotice(`Copied to the other ${faces.length - 1 === 1 ? "side" : `${faces.length - 1} sides`} — press Save to keep it.`)
  }

  /** `close` is false when saving as a STEP in something else (sending to a designer),
   * where closing the window mid-flow would look like the action had finished.
   *  Returns whether it persisted, so a caller can stop rather than carry on regardless. */
  /**
   * SAVE MEANS EVERY FACE, not the one you happen to be looking at.
   *
   * Each face holds its own artwork, and only the visible one was ever written — so placing
   * on the front, switching to the back, placing there and pressing Save wrote the BACK and
   * silently dropped the front. The work was in `faceArt` the whole time; nothing sent it.
   *
   * Only what CHANGED is sent. `savedFaces` is what the server last confirmed, so reopening
   * a finished job and pressing Save doesn't re-upload three unchanged images — which on a
   * multi-face garment is megabytes of base64 for no edit.
   */
 const save = async (close = true): Promise<boolean> => {
    // Everything on screen belongs to the face it is on before anything is compared.
 const pending: Record<string, FaceArt | null> = {
      ...(faceArt ?? {}),
 [sideName]: designUrl ? { data: designUrl, pos, name: designName } : null,
    }
 const samePos = (a: Pos, b?: Pos | null) => !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.r === b.r
 const changed = Object.entries(pending).filter(([sd, art]) => {
 if (!art?.data) return false
 const was = savedFaces[sd]
 return !was || was.data !== art.data || !samePos(art.pos, was.pos)
    })
 if (!changed.length && !designUrl) { setErr("Upload artwork first."); return false }
    // Artwork attaches to a LINE, keyed line-first (server: coalesce('L:'||line_id,'S:'||sku)).
    // A marketplace line arrives with its variant — and thus SKU — unset, but always carries a
    // line_id. Requiring a SKU here mislabelled a present design as "no artwork" on exactly
    // those lines; require a line identity instead.
 if (!item.sku && !item.line_id) { setErr("This line needs a variant chosen before artwork can be saved."); return false }
 setSaving(true); setErr(null)
 try {
      // Fingerprint the artwork as it's saved, so the factory can later tell that this
      // design has already been digitised. Best-effort: a null phash costs us fuzzy
      // matching, never the save.
 const done: Record<string, { data: string; pos: Pos }> = { ...savedFaces }
 for (const [sd, art] of changed) {
 if (!art?.data) continue
 const phash = await perceptualHash(art.data).catch(() => null)
 const r = await postOrderDesign(orderId, {
 sku: item.sku ?? "", line_id: item.line_id, side: sd, data: art.data,
 name: art.name || item.name, pos: { x: art.pos.x, y: art.pos.y, w: art.pos.w, r: art.pos.r }, phash,
          // OMITTED unless this session changed where the artwork came from — the server
          // reads an absent field as "keep what you have" and "" as "clear it".
          ...(sd in tplBySide ? { template_id: tplBySide[sd] } : {}),
        })
 if (r.error) throw new Error(r.error)
 done[sd] = { data: art.data, pos: art.pos }
        // The number the save minted (or reused, if these exact bytes have been seen
        // before). Taken from the face on screen — that is the one the rail is describing.
 if (sd === sideName && r.design_no != null) setDesignNo(r.design_no)
      }
 setSavedFaces(done)
 setFaceArt(pending)
      // Persist the matched threads alongside the design so the factory loads the right
      // cones. Best-effort — a design still saves even if the thread write hiccups. Keyed by
      // sku, so skip when the line has none yet (it can be re-matched after variant setup).
 if (isEmb && threads.length && item.sku) await postOrderThreads(orderId, item.sku, threads).catch(() => {})
 onSaved?.()
 if (close) onOpenChange(false)
 return true
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't save the design.")
 return false
    } finally { setSaving(false) }
  }

 return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Wide enough for two real columns. Capped against the VIEWPORT as well as a pixel
        // ceiling so it can't outgrow a small laptop: 1180px is about the point where the
        // stage stops growing (bounded by 78vh) and extra width would only add dead space.
        // Sized to its CONTENT, not to a number. A fixed 1180px gave the control rail far more
        // width than it uses and the remainder showed up as blank around the window. With both
        // grid tracks content-sized, the dialog is exactly garment + gap + rail.
        // Width is the SUM of what's inside, not a round number: the garment's own cap, the
        // 380px rail, the 24px gap and the 48px of padding. A fixed 1180px gave the rail far
        // more room than it uses and the surplus read as blank around the window. max-w-fit
        // does not work here — it under-measures the grid and clips the rail off the edge.
        /**
         * A PLAIN CAP, now that the grid can shrink.
         *
         * This computed its width from the stage's — garment + gap + rail + padding — while
         * the stage track was `auto`, which sizes to its content's MAX width rather than to
         * the room available. So on any window narrower than the sum, the two tracks
         * insisted on 924px inside a 791px dialog: the rail ran off the right edge and the
         * whole thing scrolled sideways. The track is minmax(0,1fr) now, so the stage gives
         * way and this only has to say how wide the window may get.
         *
         * 620px, DOWN from 940. It was sized for two columns and kept that width after one
         * of them went, so a 418px garment sat in the middle of a window nearly a metre of
         * pixels wide with air on both sides — which reads as a big window that forgot to
         * fill itself, not as a focused one. The dialog is now roughly the stage plus its
         * rail, which is all there is to show.
         */
        /* A ceiling AND its own scrollbar — belt and braces. The sizes above are meant to fit
 without either, but an embroidered line carrying threads and a machine file has more
 under the stage than a DTG one, and it should scroll INSIDE the window rather than
 pushing the action bar off the screen. Plain block comment: this is an attribute
 list, where a JSX-style comment is a syntax error. */
 /* pb-0: the action bar at the foot of this dialog is `sticky bottom-0`, and sticky is
 clamped to its containing block. With the popup's own 24px of bottom padding in the
 way the bar pinned ABOVE the padding and the thread list scrolled on underneath it,
 visible below the button — which reads as a bar that has come loose. Nothing is short
 of padding: the bar carries its own. */
 className="max-h-[92vh] overflow-y-auto pb-0 sm:max-w-md lg:max-w-[min(94vw,600px)]"
        // Drop ANYWHERE in the designer, not just onto a button. This dialog already had
        // Upload and From library but no drop target at all, so a dragged file had nowhere
        // to land and the only route was a file picker. The point of putting it here is
        // that this is the window already open when someone has a file in hand — no
        // second window to invent.
 onDragOver={(e) => { e.preventDefault(); setOver(true) }}
 onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false) }}
 onDrop={(e) => {
 e.preventDefault(); setOver(false)
 const f = Array.from(e.dataTransfer?.files ?? [])[0]
 if (!f) return
          // A MACHINE FILE dropped here gets ATTACHED, not refused.
          //
          // This designer positions artwork on a mockup and a .pes has nothing to position,
          // so it can't be placed — but refusing it sent the seller to "the artwork panel",
          // which sellers cannot reach at all. The message was a dead end pointing at a
          // door that isn't there for them, and a seller who has cut their own file had no
          // way to give it to us.
          //
          // The intent is unambiguous: they have a machine file and dropped it on the
          // window that was open. So take it, file it against this line, and say which of
          // the two things happened.
          /**
            * A STITCH FILE ONLY FITS AN EMBROIDERED LINE.
            *
            * On a DTG or a laser line there is no machine to run it and no check to perform,
            * so filing one there is not a near-miss — it is a fee raised for a file nothing
            * can use. The seller card has always refused this; this window took the drop and
            * attached it, which is the same mistake with fewer words.
            */
 takeFile(f)
        }}
      >
        {/* Dropping anywhere in the window still works — but it no longer outlines the WHOLE
 window in dashed purple while it does. That fired at the same time as the drop
 box on the stage, so a drag lit up two competing dashed rectangles and a floating
 caption, and the window read as an error state. The stage box alone is the
 feedback now: one target, one highlight. */}
        {/* pr-10 clears the close button, line-clamp-2 stops a marketplace title from
 becoming a three-line headline. Etsy names run 130+ characters, so unclamped
 this pushed the stage most of the way down the window and ran the last word
 underneath the ✕. */}
        <DialogHeader>
          <DialogTitle className="line-clamp-2 pr-10 leading-snug">{item.name || item.sku}</DialogTitle>
          {/* THE VARIANT, READ-ONLY. What is being printed on is a thing this window has to
 state and does not need to own: the picker is on the order's item row, and two
 controls for one fact is how the two disagree. A line of text answers "what am
              I placing this on" without being a second place to change it. */}
          {[item.color, item.size, item.print_type].some(Boolean) && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {[item.blank || item.sku, item.color, item.size, item.print_type].filter(Boolean).join(" · ")}
            </div>
          )}
        </DialogHeader>
        {/* TWO COLUMNS from lg up: the garment on the left, every control on the right.
            Stacked, the stage alone ate the window and the steps, thread match and charge all
 sat below the fold — you had to scroll away from the artwork to act on it, which
 is backwards for a window whose whole job is judging placement.

            The left column is `sticky top-0`: the right column is the taller of the two, so
 when it does scroll the garment stays put instead of leaving the screen. Below lg
 it collapses back to the original single stack — two columns in a phone-width
 dialog would make both of them useless. */}
        {/**
          * ONE COLUMN, IMAGE FIRST.
          *
          * This was `1fr | 380px` — a fixed rail beside the garment — and the rail is what
          * kept the stage at min(54vh, 460px): a picture SMALLER than the library dialog
          * that opens on top of it. With the steps and the charge gone the rail held one
          * repeated fact (the variant, already on the order row) and a card only embroidery
          * uses, so it was 380px of column earning almost nothing and costing the one thing
          * this window is for.
          */}
        <div className="flex flex-col gap-5">
        {/* The left column is sized to the stage itself rather than to half the dialog. An
 even 50/50 split gave the controls far more width than their cards use and stranded
 the remainder as dead space beside them; letting the garment take what it needs and
 the controls take the rest removes that gap and makes the garment bigger at once. */}
        {/* Both terms are viewport units on purpose. `min(100%,78vh)` collapsed the column to
 zero: the column is `auto`, so its width comes from its content, and the content
 asked for a percentage OF that column — a circular reference resolving to nothing. */}
        {/* top-2, not top-0. Sticking at 0 pinned the column against the scroll container's
 very edge, and the dialog's rounded corner and padding cut the top off the side
 pills — the row that was clipped in half. Two units of clearance is enough to
 keep them whole and still holds the garment in view while the rail scrolls. */}
        {/**
          * NO WIDTH OF ITS OWN. It carried `lg:w-[min(70vh,50vw)]` — 630px on a 900-tall
          * window — while the track beside it is a fixed 380px rail. 630 + 380 + gap +
          * padding exceeds the dialog's cap, so the rail hung off the right edge and the
          * window scrolled sideways. Capping the STAGE did nothing about it, because the
          * column was never asking the stage how wide to be.
          *
          * The track is minmax(0,1fr), so w-full is the column taking what it is given and
          * the stage's own max-width decides how big the garment gets. One thing setting the
          * width instead of three disagreeing about it.
          */}
        {/* NOT STICKY. It was `lg:sticky lg:top-2` — correct when this dialog was two
            columns and the garment had a taller rail beside it to stay level with. The rail
            is gone and the window is ONE column now, so there is nothing beside the stage to
            hold still for: sticking it pins the picture to the top of the scroll box while
            the sides, the embroidery card and the action bar travel under it. That is the
            "the image floats over everything when I scroll" report, and it had survived the
            layout change that removed its only reason to exist. */}
        <div className="min-w-0 lg:w-full">
        {/* Side tabs — only when the blank has more than one face to place art on. */}
        {/**
          * A SIDE LIST, not just a mockup switcher.
          *
          * These tabs used to change only the picture underneath — the artwork followed you
          * round the garment, and saving on the back wrote over the front. Each face now
          * holds its own design, and each tab says whether that face has one by how it is
          * PAINTED, so "what is still empty" is answered without clicking through every face.
          *
          * A side is one print — one hooping, one platen pass — which is also how the
          * surcharge bills it, so the list is the job as the floor will run it.
          */}
        {/* THE STAGE IS THE DROP TARGET.
            Empty, it was a mockup doing nothing while a separate Upload button did the
 work — so the biggest, most obvious surface in the window was the one thing you
 couldn't click. The dashed box sits at DEFAULT_POS, the exact spot and size the
 artwork will land at, so the empty state teaches placement before there is
 anything to place. Once art is on, the overlay is gone entirely and the stage
 goes back to being a stage. */}
        {/* The stage is aspect-square, so its WIDTH sets its height. It fills the left column
 and is bounded only by viewport height — 78vh leaves room for the header and the
 dialog's own padding without the garment ever running off a short screen. At the
 old 42vh a 620px-tall window drew it about 258px across, too small to judge
 placement on, which is the one thing this window exists for. */}
        {/**
          * AND A CEILING IN PIXELS, because vh alone has no idea what is beside it.
          *
          * 78vh on a tall window drew the garment about 780px across while the rail next to
          * it is 380px wide and its content runs to roughly 430px tall — so the window was
          * sized by the picture and the whole lower half of the right-hand column was empty.
          * The dead space was not a gap to fill; it was the stage being bigger than the job.
          *
          * 520px is still far more than judging placement needs (the old failure was 258px,
          * which genuinely was too small) and it lets the two columns end near each other,
          * which is what stops a dialog reading as half-empty.
          */}
        {/**
          * SIZED SO THE WINDOW NEVER SCROLLS.
          *
          * The cap was a WIDTH, and a garment mockup is portrait — so 72vh wide made the
          * picture about 72vh tall, and with a header, the sides, the cards and an action bar
          * under it the dialog ran off the bottom of the screen. Save was below the fold. A
          * window you have to scroll to save in is worse than a smaller picture, every time.
          *
          * 44vh is the height that leaves room for everything else at a laptop's 800px, and
          * the width follows from it. Bigger than it looks: the stage is the whole width of
          * the dialog now, where it used to share it with a 380px column.
          */}
        {/* NO FIXED PIXEL CAP. It was 520px inside a 720px window, so the garment stopped
 short of the title above it and the action bar below — a picture floating in a
 box, when the picture IS the window. It takes the full content width now, and the
 only limit left is a HEIGHT one, because the stage is square and this dialog must
 never scroll: 62vh is what still leaves room for the header, the embroidery line
 and the action bar on a laptop's 800px. On a taller screen it simply fills. */}
        {/**
          * THE STAGE GIVES WAY WHEN THE DRAWER OPENS.
          *
          * 62vh fits — with the drawer SHUT, which is the only state that was ever measured
          * and is why "it doesn't scroll" was said and then found to be false. Opening
          * Embroidery adds the file card, the Send row and a thread list, and the window went
          * 139px past the viewport: exactly the scrolling this window was cut down to avoid.
          *
          * The garment yields rather than the panel, because the panel is what was just
          * asked for. It comes back to full size the moment the drawer closes.
          */}
        {/**
          * THE GARMENT KEEPS ITS SIZE. All of it, drawer open or shut.
          *
          * Opening Embroidery used to shrink it to 38vh to make room, which fixed the
          * scrolling by taking it out of the one thing this window exists to show. The panel
          * is what should give way, not the picture: the thread list has its own ceiling and
          * its own scrollbar now, so a design with fourteen cones is read inside the list
          * rather than by shrinking the garment or pushing Save off the screen.
          *
          * Sticky as well, so on a short screen the garment stays put while the list moves.
          */}
        {/* And the SECOND one, nested inside the first — `md:sticky md:top-2` on the stage
            itself. Two sticky boxes for one picture, from two different sessions, and below
            `lg` only this one applied: on a tablet the garment pinned and the whole rest of
            the window scrolled beneath it. */}
        <div className="relative mx-auto w-full max-w-[min(100%,62vh)]">
          <DesignStage
 className="w-full" mockup={activeMockup} mockupFill={!!ownMockups[sideKey]}
 designUrl={showStitch && stitchPng ? `data:image/png;base64,${stitchPng}` : designUrl}
 pos={pos} setPos={setPos}
 onRemove={() => void removeArtwork()}
            /* ON THE LAYER, WITH THE REST. This was a labelled button parked in the corner of
 the stage while rotate, lock and delete sat in one strip above the selection —
 so the one tool that changes the ARTWORK was the only one not with the artwork
 tools. The strip has always been able to carry it; nothing passed it. */
 onEraseBg={bg.run}
 eraseBusy={bg.busy}
 onUndoErase={bg.canUndo ? bg.undo : undefined}
            // Only when there IS another face to copy to — a one-sided blank gets no button.
 onCopy={faces.length > 1 && designUrl ? copyToOtherFaces : undefined}
 copyLabel={`Copy to the other ${faces.length - 1 === 1 ? "side" : "sides"}`}
 picking={picking} onPickColor={onPickColor}
            // Suppress the stage's OWN "Pick a blank to start designing" placeholder: the
            // overlay below is already the empty state, and rendering both stacked two
            // different sentences on top of each other in the same 40px. An empty fragment
            // rather than null — the stage falls back on nullish, so null would restore it.
 emptyHint={<></>}
          />
          {/* THE BACKGROUND TOOLS, ON THE ARTWORK.
              Buyer artwork arrives on a white or grey plate more often than not, and this
 is where someone is looking when they notice. What it produces is a data: url,
 so `save` persists the CUT-OUT and the removal travels with the design
 afterwards; leave it alone and the artwork saves exactly as it arrived.

              Bottom-left, over the stage: the top corners hold the stage's own remove and
 the artwork usually sits centred, so this is the one corner it doesn't cover. */}
          {/**
            * THE TOOL RAIL — on the artboard, the way a design tool puts it.
            *
            * These lived in the right-hand column as a NUMBERED STEP ("1 · Your design →
            * Upload image · Library"), which framed placing artwork as a form to complete
            * rather than something you do to a picture. The step told you where you were in
            * a process; the rail tells you what you can do to the thing under your cursor,
            * and it does it without your eye leaving the garment.
            *
            * Left edge, vertical, one column of marks: it is the edge with nothing on it —
            * the selection strip floats above the artwork, the sides sit under the stage,
            * and artwork lands centred — so the rail costs no view of what is being made.
            */}
          {/* MIDDLE-LEFT, not top-left. Pinned to the top it sat level with the garment's
 collar and the eye had to travel up to reach it; centred, it is where the
 cursor already is when it is on the artwork. */}
          <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
            {/**
              * ONE DOOR FOR FILES, not three beside each other.
              *
              * Upload, Library and Template were separate rail entries doing one job between
              * them: put a file on this line. Which of the three you needed depended on where
              * the file already was — on your disk, in the library, or inside a template —
              * which is a fact about US, not a question anybody has while looking at a
              * garment. Three narrow words also left no room to say the one thing the rail
              * could not: whether this line has any files at all.
              *
              * So: one entry, a count on it, and the three routes inside — with the FILES
              * THEMSELVES listed underneath. A panel that offers four ways to add a file and
              * never names the ones already added is the same defect as a drop target that
              * looks identical before and after the drop (see the RECEIPT note in
              * dropzone.tsx); every row here can be downloaded, which is the reason to print
              * a file name in the first place.
              */}
            <Popover>
              <PopoverTrigger
                title="Files on this line — add one, or take a copy"
                aria-label="Files on this line"
                className={railBtn + " relative"}
              >
                <UploadSimple size={18} weight="bold" />
                <span className={railWord}>Files</span>
                {/* GENUINELY ROUND, which is what a count badge is allowed to be (CLAUDE.md
                    §4). It is the only thing on this rail that reports state rather than
                    offering an action. */}
                {lineFiles.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold tabular-nums text-primary-foreground">
                    {lineFiles.length}
                  </span>
                )}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-3">
                {/* A DROP TARGET WITH A TAB BAR, not a menu of errands. The three routes take
                    the same gesture and differ only in WHAT they accept, which is a property
                    of the target — so the target stays put and the tab says what it eats.
                    Five stacked text buttons made one act look like five decisions. */}
                <TabBar
                  ariaLabel="What to add"
                  size="sm"
                  items={FILE_TABS}
                  value={fileTab}
                  onChange={setFileTab}
                  className="mb-3"
                />
                {fileTab === "image" && (
                  <Dropzone
                    icon={ImageIcon}
                    accept="image/*"
                    label="Drop an image, or click to browse"
                    hint="PNG or JPG"
                    onFiles={(f) => takeFile(f[0])}
                    action={
                      <Button size="sm" variant="outline" onClick={() => { setLibSource("designs"); setLibOpen(true) }}>
                        Pick from your library
                      </Button>
                    }
                  />
                )}
                {fileTab === "templates" && (
                  /* NOT A DROP TARGET. A template is not a file you have — it is one you
                     saved, so the region offers the two things you can actually do with one:
                     start from it, and (only with artwork on the line) make one. */
                  <EmptyState
                    icon={BookmarkSimple}
                    size="sm"
                    title="Start from a saved template"
                    note="A template carries the artwork and where it sits."
                    action={
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setLibSource("templates"); setLibOpen(true) }}>
                          Browse templates
                        </Button>
                        {/* PEERS, SO THEY LOOK LIKE PEERS. Browse and Save are the two things
                            you can do with a template, and one was `outline` beside the
                            other's `ghost` — a hierarchy where there is none, which reads as
                            two unrelated controls rather than a pair. The variants are a
                            hierarchy, not a palette (CLAUDE.md §4). */}
                        {designUrl && (
                          <Button size="sm" variant="outline" disabled={tplBusy}
                            onClick={() => setTplName((v) => (v === null ? defaultTplName : null))}>
                            Save this placement
                          </Button>
                        )}
                      </div>
                    }
                  />
                )}
                {fileTab === "machine" && (
                  <Dropzone
                    icon={Needle}
                    accept={MACHINE_EXT_LIST}
                    label={isEmb ? "Drop a stitch file, or click to browse" : "Embroidered lines only"}
                    hint={isEmb ? ".EMB .PES .DST .EXP .JEF" : "There is no machine to run a stitch file on this line"}
                    disabled={!isEmb}
                    onFiles={(f) => { const x = f[0]; if (x) void attachMachineFile(x) }}
                  />
                )}
              </PopoverContent>
            </Popover>
            {/**
              * YOUR OWN PHOTO BEHIND THE ARTWORK — and it is a BACKDROP, which the title says
              * in as many words because it is the one thing about this control that can be
              * misread. Most sellers already have product photography; placing on our blank
              * photo means the picture they list with and the picture the floor works from
              * are two different images of one job.
              *
              * It does NOT replace the print file. The design is still what is placed, saved
              * and printed, and a line with a photo and no design cannot ship — the gate
              * reads order_designs, and this is stored somewhere else on purpose.
              */}
            <button
 type="button"
 onClick={() => (ownMockups[sideKey] ? void clearOwnMockup() : mockupRef.current?.click())}
 disabled={mockBusy}
 title={ownMockups[sideKey]
                ? "Put our product photo back"
 : "Use your own product photo as the backdrop — the design file is still needed"}
 aria-label={ownMockups[sideKey] ? "Use our product photo" : "Use my own product photo"}
 className={railBtn + (ownMockups[sideKey] ? " bg-primary/10 text-primary" : "")}
            >
              {mockBusy ? <CircleNotch size={18} className="animate-spin" /> : <ImageSquare size={18} weight="bold" />}
              <span className={railWord}>{ownMockups[sideKey] ? "Our photo" : "Mockup"}</span>
            </button>
            {/**
              * SEND, on the rail with the rest.
              *
              * It was three rows under the stage — a question ("Don't have the file yet?"), a
              * button, and a line explaining why the button was disabled — for one action,
              * on a window being cut down to the picture. It is a thing you DO to this
              * line's artwork, which is what the rail is.
              *
              * SAVE FIRST, then send, and only if the save landed. The board builds its card
              * from the SAVED designs map, so artwork dropped here and not yet saved does
              * not exist as far as the push is concerned — it used to hit a guard that
              * returned without a word, leaving the designer's board empty and nothing on
              * screen to say why.
              */}
            {onSendToDesigner && !isEmb && (
              <button
 type="button"
 onClick={async () => { if (await save(false)) onSendToDesigner() }}
 disabled={!designUrl || saving}
 title={designUrl ? "Save this line and put it on the designers' board" : "Needs artwork first — there is nothing to digitise"}
 aria-label="Send this line to a designer"
 className={railBtn}
              >
                {saving ? <CircleNotch size={18} className="animate-spin" /> : <PaperPlaneTilt size={18} weight="bold" />}
                <span className={railWord}>Send</span>
              </button>
            )}
          </div>

          {/**
            * OUR OWN BOX, not the browser's.
            *
            * This was window.prompt, which is the one dialog we cannot style, cannot place,
            * and cannot stop from arriving pre-filled with whatever string it was handed —
            * so naming a template meant a system alert at the top of the screen, over the
            * artwork, carrying a 120-character marketplace title. It also blocks the page
            * outright, which for a control this small is a lot of ceremony to type six
            * words.
            *
            * Beside the rail, so the name is typed next to the button that asked for it and
            * the garment stays in view. Enter saves, Escape closes — the two keys a
            * one-field form should answer to.
            */}
          {/* CENTRED, not tucked against the rail. Pinned to the top-left it overlapped the
 artwork it was naming and read as a tooltip that had come loose; in the middle it
 is plainly a small form, and the field is wide enough to show the end of a name
 rather than scrolling it out of sight while you type. */}
          {tplName !== null && (
            <div className="absolute left-1/2 top-1/2 z-30 w-72 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-3 shadow-xl">
              <label className="block text-2xs font-medium text-muted-foreground">Save as template</label>
              <input
 autoFocus
 value={tplName}
 onChange={(e) => setTplName(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter") { e.preventDefault(); void saveAsTemplate(tplName) }
 if (e.key === "Escape") { e.preventDefault(); setTplName(null) }
                }}
 placeholder={defaultTplName}
 aria-label="Template name"
 className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              <div className="mt-1.5 flex items-center justify-end gap-1.5">
                <button type="button" onClick={() => setTplName(null)}
 className="rounded-lg px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent">
                  Cancel
                </button>
                <button type="button" onClick={() => void saveAsTemplate(tplName)} disabled={tplBusy}
 className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-2xs font-semibold text-primary-foreground transition-opacity disabled:opacity-60">
                  {tplBusy && <CircleNotch size={11} className="animate-spin" />}
                  Save
                </button>
              </div>
              {/* WHERE IT GOES, said once. A template that saves silently to a list you have
 not opened is indistinguishable from one that did not save. */}
              <p className="mt-1 text-2xs text-muted-foreground">Into your library, for any order.</p>
            </div>
          )}
          {designUrl && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-1.5">
              {/* The background BUTTONS moved onto the selection strip (see the stage props
                  above). What stays here is what the strip cannot say: the sentence the
                  eraser leaves behind when it finds nothing flat to cut. */}
              {bg.msg && (
                <span className="pointer-events-auto rounded-lg bg-card/95 px-2 py-1 text-2xs text-muted-foreground shadow-sm backdrop-blur">{bg.msg}</span>
              )}
              {/* THE STITCH TOGGLE MOVED into the Embroidery drawer. It is stitch
 apparatus — it only exists when there is a machine file — and it was
 sitting on the garment next to the side pills, where the two read as one
 confused row of chips that did unrelated things. */}
            </div>
          )}
          {!designUrl && (
            <button
 type="button"
 onClick={() => uploadRef.current?.click()}
 aria-label="Add artwork — drop a file here or click to browse"
 className="absolute inset-0 grid place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {/* Same %-geometry the artwork itself uses, so this is a preview of the
 placement rather than a decorative box that happens to be centred. */}
              <span
 className={"pointer-events-none absolute flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 text-center transition-colors " +
                  (over ? "border-primary bg-primary/10 text-foreground" : "border-muted-foreground/35 bg-background/60 text-muted-foreground")}
 style={{
 left: `${DEFAULT_POS.x}%`, top: `${DEFAULT_POS.y}%`,
 width: `${DEFAULT_POS.w}%`, aspectRatio: "1",
 transform: "translate(-50%,-50%)",
                }}
              >
                <UploadSimple size={20} weight="duotone" />
                {/* SAY WHAT TO DROP, and say it differently for a line that can take a stitch
 file. "Drop artwork" is true and useless: an embroidered line accepts a
                    PNG we digitise OR a machine file we only check, and which one you have
 decides both the fee and the wait. A DTG line has no such choice, so it
 is not offered one. */}
                <span className="text-xs font-medium leading-tight">Drop a file<br />or click to browse</span>
                <span className="text-2xs font-normal leading-tight opacity-80">
                  {isEmb ? "PNG or JPG — or a .EMB / .PES / .DST" : "PNG or JPG"}
                </span>
              </span>
            </button>
          )}
        </div>
        {/* THE SIDES, UNDER THE GARMENT.
            They sat above it, which is where a page puts NAVIGATION — and these are not
 navigation, they are the placement: which face of the shirt this artwork goes on,
 what each face already carries, and what a second face costs. Under the stage
 they read as controls for the thing above them, in the same place every design
 tool puts its artboard row. */}
        {faces.length > 1 && (
          /* CENTRED ON THE STAGE, ALWAYS. Left-aligned they hung off one edge of a garment
 that is itself centred, so the row moved every time the canvas resized while the
 thing it belongs to did not. Centring ties them to the artboard above rather
 than to the panel's left margin. */
          <div className="flex flex-wrap justify-center gap-1.5">
            {faces.map((f, i) => {
 const has = facesWithArt[(f.side || "front").toLowerCase()]
              /**
               * THE PILL ITSELF CARRIES THE STATE — no dot.
               *
               * A dot is a second mark inside a control that could just BE the mark, and next
               * to a filled pill it read as a third state rather than as "this one has
               * something on it". Three appearances, one property:
               *
               * solid    — the face you are on
               * tinted   — has artwork, not selected
               * plain    — empty
               *
               * Primary, not a status colour: emerald/amber/red are spoken for on the floor
               * (shipped, hold, alert) and a designer tab is not a floor status.
               */
 return (
                <button key={f.side} onClick={() => goToSide(i)}
 title={has ? `${f.side} — has artwork` : `${f.side} — empty`}
 className={"flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors "
                    + (i === side ? "bg-primary text-primary-foreground"
 : has ? "bg-primary/10 text-primary hover:bg-primary/15"
 : "bg-muted text-muted-foreground hover:bg-accent")}>
                  {f.side}
                  {/**
                    * WHAT THIS FACE COSTS, before it is chosen.
                    *
                    * The surcharge is per ADDITIONAL face, so the first one printed is
                    * included and every one after adds this per unit. A seller found that
                    * out on the Summary AFTER placing the artwork; the pill is where the
                    * decision is actually made.
                    *
                    * Shown on a face that already costs, and on an empty one that WOULD —
                    * which is only true once something else is printed. Nothing at all when
                    * the rate is 0: an empty "+$0.00" is noise.
                    */}
                  {!!sideFee && sideFee > 0 && (has ? costingFaces[(f.side || "front").toLowerCase()] : anyFaceHasArt) && (
                    <span className={"tabular-nums " + (i === side ? "text-primary-foreground/80" : "text-muted-foreground/80")}>
                      +{sideFee.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {/**
          * WHAT IS ACTUALLY ON THIS FACE — the receipt for the drop.
          *
          * `designName` has been captured and SAVED since the day the save started recording
          * the real filename instead of the garment's, and it was never once put on screen.
          * So dropping a file changed the picture and nothing else: no name, no size, no
          * confirmation that a file rather than a link had been accepted, which is exactly
          * the report ("no file names, no occurrence, or any indication that the files have
          * been uploaded"). The artwork was there; the evidence was not.
          *
          * FileRow, not a private row — the same one the Dropzone prints, so the receipt for
          * a file dropped on the garment and one dropped on a panel cannot drift.
          *
          * It says SAVED or NOT SAVED, because those are different facts and this window can
          * be closed on either. `savedFaces` is what the server last confirmed.
          */}
        {designUrl && (
          <div className="mx-auto w-full max-w-[min(100%,62vh)]">
            <FileRow
              file={{
                name: designName || fileNameFrom(designUrl) || "Untitled artwork",
                size: designSize,
                thumb: designUrl,
                status: saving ? "uploading" : "done",
                note: savedFaces[sideName] ? "Saved to this line" : "Not saved yet",
                error: null,
                onRemove: () => void removeArtwork(),
              }}
            />
          </div>
        )}
        </div>
        {/* Right column — controls, in the order you work through them: what the buyer sent,
 the two upload steps, thread match, then the charge. */}
        {/* self-START. The two columns are one thing being worked on and the controls that
 act on it, so they have to begin on the same line — centring the shorter column
 floated the steps somewhere down the middle of the garment, and "1 Your design"
 no longer lined up with the top of the image it was talking about. The dead band
 it was avoiding only ever appeared on an empty line, and a gap below the last
 control reads as nothing at all; a first step that starts halfway down does not. */}
        {/* w-full, and NO self-start. This was the right-hand column of a grid, where
            `self-start` meant "don't stretch to the tallest row". The parent is a flex
            COLUMN now, so self-start became a CROSS-axis rule — it shrank every one of these
 blocks to its own content width and pinned them to the left edge, beside the
 garment instead of under it. */}
        <div className="mx-auto flex w-full max-w-[min(100%,560px)] flex-col gap-4">
        {/* THE VARIANT IS NOT PICKED HERE ANY MORE.
            It is on the order's item row, four fields wide, and this window repeated the
 same picker on the same line — two places to change one fact, and the second one
 reachable only by opening a dialog. What this window needs from it is not a
 control but a sentence, and that is in the header above. */}
        {/* THE "EMBROIDERY · NO MACHINE FILE" STRIP IS GONE.
            ────────────────────────────────────────────────────────────────────────────
            It was a disclosure header whose whole summary was an absence. "No machine file"
 is not news on a screen whose Upload button is the way to attach one — it reported
 that you had not yet done the thing the control above it exists to do, and it
 reported it in a closed drawer, so the actual controls behind it were a click away
 for no reason.

            What was BEHIND it is kept and now simply shown: the thread read-out, Show
 stitches, Send to Board and Apply-to-all-lines. None of those are about a file we
 already hold — they are the routes a person still has to take — and hiding them
 behind a line that said "no machine file" is what made them hard to find. */}
        {/* Thread match — EMB only. Each chip is a dominant design colour mapped to the
 nearest in-stock cone; saved with the design so the floor loads the right threads.
            `order-last` rather than moving the block: it sits first in the markup for historical
 reasons, but it is a RESULT, not an instruction. Above the numbered steps it told a
 seller to "upload artwork to match threads" before showing them the upload button,
 and it competed with the two things they must actually do. Last is where a derived
 read-out belongs. */}
        {/**
          * ONLY ONCE THERE IS SOMETHING TO SHOW.
          *
          * The card used to open on every embroidered line and, with no artwork yet, hold a
          * title over "Add your image above and we'll pick the thread colours for it" — an
          * instruction, in the panel that exists to REPORT a result, sitting under the two
          * controls that already say what to do.
          *
          * Hiding it is honest here rather than evasive: this is a DERIVED read-out, and a
          * derivation with no input has nothing to be wrong about. The moment artwork lands
          * the card appears with the colours in it, which is the answer it was promising.
          */}
        {/* WHAT HAS ACTUALLY BEEN SENT US — BY NAME.
            ────────────────────────────────────────────────────────────────────────────
            Nothing in this window could answer "which files are on this line". The file
            rows went on the reasoning that the drawer summary carried the name and the
            order's Design files panel carried the controls; the drawer then went too, and
            the name went with it. Two removals, each correct on its own, each assuming the
            other surface was still holding the fact.

            A COUNT WOULD NOT FIX IT. `lineFiles` was kept for a rail badge, and a badge
            answers "how many" — the question being asked here is "which", and a number
            cannot answer it. It is also the treatment the house style reserves: a pill
            carries meaning, never a count.

            So: the names, newest first, each one openable. Same list-in-a-card shape as the
            thread panel below it, because they are the same kind of thing — a read-out of
            what is attached to this line, not a form. Hidden entirely when the line has
            nothing, which is honest: an empty frame here would read as a list that failed
            to load rather than as a line nobody has sent a file for. */}
        {lineFiles.length > 0 && (
          <div className="order-last rounded-lg border border-border bg-muted/30 p-2.5">
            <div className="mb-1.5 text-xs font-medium text-foreground">Files</div>
            <div className="rounded-md border border-border bg-card">
              <div className="divide-y divide-border">
                {lineFiles.map((f) => (
                  <button
                    key={f.designId}
                    type="button"
                    onClick={() => void downloadFile(f.designId, f.name)}
                    disabled={dlBusy === f.designId}
                    title={`Open ${f.name || "this file"}`}
                    className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{f.name || "Untitled file"}</span>
                    {/* The kind, not a pill. It is a fact about the row, and boxing every one
                        of them is exactly the chrome the app was counted for. */}
                    {f.kind && <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">{f.kind}</span>}
                    {dlBusy === f.designId
                      ? <CircleNotch size={14} className="shrink-0 animate-spin text-muted-foreground" />
                      : <DownloadSimple size={14} className="shrink-0 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </div>
            {/* THE ONE PLACE A FILE ERROR IS SAID. It used to sit inside the `isEmb` block,
                so a failed open on a DTG line set the message and nothing rendered it. */}
            {dlErr && <div className="mt-1.5 text-2xs text-destructive">{dlErr}</div>}
          </div>
        )}
        {isEmb && designUrl && (
          /* NO CEILING, AND NO SECOND SCROLLBAR.
             This was `max-h-[17vh] overflow-y-auto` — a fraction of the VIEWPORT, not of the
             dialog, so the height it gives the list has nothing to do with the room the list
             is in. On a short window 17vh is about 80px: the header, one cone, and the top of
             the next one sliced through, behind a scrollbar most people never notice is there
             because the dialog around it is already scrolling. Two scrollbars for one list.
             The cap existed to keep Save on screen. The action bar is pinned to the bottom of
             the dialog now, so that is no longer this panel's problem and the list can be as
             long as the design needs. */
          <div className="order-last rounded-lg border border-border bg-muted/30 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                {/* Count the ROWS, not the saved cone list. They are not the same number:
 the cone list keeps the background colour the region pass discards, so
 the header read "· 4" over three rows — a count of something the reader
 cannot see is worse than no count. */}
                <div className="text-xs font-medium text-foreground">
                  Thread colours {regions?.length ? `· ${regions.length}` : ""}
                </div>
                {/* The sentence under the title is gone: a list of thread colours beside the
 parts of the design they belong to already says what it is, and it said so
 on every render including the ones where there was nothing to describe. */}
              </div>
              {designUrl && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Offered only once it would CHANGE something — after a removal or an
 override. On an untouched list it is a button that does nothing, and a
 button that does nothing is one you learn to distrust. */}
                  {touched && (
                    <button
 type="button"
 onClick={rematch}
 disabled={rematching}
 title="Read the colours off your design again, undoing anything removed or changed here"
 className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <ArrowClockwise size={13} weight="bold" className={rematching ? "animate-spin" : ""} />
                      {rematching ? "Reading…" : "Start over"}
                    </button>
                  )}
                  <button
 type="button"
 onClick={() => setPicking((v) => !v)}
 title="Click this, then click anywhere on your design to add that colour"
 className={"inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors " + (picking ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}
                  >
                    <Eyedropper size={13} weight="bold" /> {picking ? "Click your design…" : "Add a colour"}
                  </button>
                </div>
              )}
            </div>

            {/* The map, always on. Each row is a crop of the artwork taken from where that
 colour actually sits — the half a digitiser was previously guessing at — beside
 the dropdown that changes it. */}
            {/* The eyedropper's "not a real match" banner is gone too, for the same reason as
 the per-row warning: it judged the sample against a 16-colour palette that does
 not describe the cones actually on the floor, so it cried wolf about colours we
 stock. The colour is added and shown; the human picks a different one if it is
 wrong. */}
            {regions === null ? (
              <div className="rounded-md border border-border bg-card px-3 py-4 text-center text-xs text-muted-foreground">Reading the colours in your image…</div>
            ) : regions.length === 0 ? (
              <div className="rounded-md border border-border bg-card px-3 py-4 text-center text-xs text-muted-foreground">
                {/* Which of the two it is, not one message for both: "we couldn't open it"
 is a different problem for the seller than "we opened it and found
 nothing". */}
                {threadErr
                  ? "We couldn't open this image to read its colours — use “Add a colour” to pick them yourself."
 : "We didn't find any solid colours in this image — use “Add a colour” to pick them yourself."}
              </div>
            ) : (
              <div className="rounded-md border border-border bg-card">
                <div className="divide-y divide-border">
                  {/* Keyed on the ARTWORK colour, not the cone: two colours can be sent to
 the same cone by an override, and keying on the cone made them collide
 into one row. srcHex is what `picks` is keyed on too. */}
                  {regions.map((r) => (
                    <div key={r.srcHex} className="flex items-center gap-2.5 px-2.5 py-2">
                      {r.swatch ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={r.swatch} alt={`The part of your design in ${r.thread.name}`} className="size-14 shrink-0 rounded border border-border object-cover" />
                      ) : (
                        <span className="size-14 shrink-0 rounded border border-border" style={{ background: r.srcHex }} />
                      )}
                      <div className="min-w-0 flex-1">
                        {/* THE CROP AND THE COLOUR, nothing else.
                            The hex, the sampled percentage and the "no close match" warning
 have all gone. Every one of them was a claim about a 16-cone
 palette that does not describe the stock actually on the floor — a
 colour we hold but the palette has never heard of was reported as
                            "no close match", which is worse than saying nothing. The crop on
 the left already shows the colour truthfully, straight from the
 artwork, and the dropdown is where the human decides.
                            The swatch that used to sit in a chip row above now rides INSIDE
 the dropdown — on its button and on every option — so the colour
 is beside the choice it belongs to instead of in a separate list
 the reader has to pair up by eye. */}
                        <ThreadSelect
 value={picks[r.srcHex] ?? r.thread.code}
 options={r.options}
 onChange={(code) => chooseThread(r, code)}
                        />
                      </div>
                      {/* The SAME X the artwork and the machine file use. A colour the
 matcher found but nobody wants stitched — an anti-aliased edge, the
 background it was exported on — was previously permanent: this list
 is what the floor loads, so a row you can't remove is a cone you
 can't stop them loading. */}
                      <button
 type="button"
 onClick={() => dropRegion(r)}
 title={`Remove ${r.thread.name} — we won't stitch this colour`}
 aria-label={`Remove ${r.thread.name}`}
 className="eg-tap shrink-0 rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X size={12} weight="bold" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* The BUYER's uploaded file (marketplace orders). Was invisible in React — the
 floor couldn't see what the customer actually sent. Shows the file + their
 personalization note, with one click to adopt it as the design to place. */}
        {(item.design_src || item.personalization) && (
          /**
           * THE NOTE FIRST, THEN THE FILE.
           *
           * This led with the buyer's uploaded picture and put their words underneath it,
           * which is the wrong way round for the person reading it: the note is the
           * INSTRUCTION — the text that gets stitched — and the file is one of the things
           * you might use to carry it out. Leading with a thumbnail also meant the sentence
           * that decides the job sat below a picture, in the smallest type in the column.
           *
           * Same card treatment as the two panels under it, so the column reads as one
           * column. It keeps its tint because whose it is IS the fact about it.
           */
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <div className="text-xs font-semibold text-foreground">
              {item.personalization ? "Customer\u2019s note" : "Customer\u2019s file"}
            </div>
            {/* NO decorative quotes around it. The buyer's text frequently contains its
                own — this one is literally `"MRS. AUSTIN "` — and wrapping it produced
                “"MRS. AUSTIN "”, which invites someone to stitch a quotation mark that
                isn't theirs. Personalisation is a literal to reproduce, so it is shown
                exactly, where a trailing space (this one has one) is visible rather than
                invisibly trimmed by the eye. */}
            {item.personalization && (
              <div className="mt-1 whitespace-pre-wrap break-words tabular-nums text-xs text-foreground">
                {decodeEntities(item.personalization)}
              </div>
            )}
            {item.design_src && (
              <div className="mt-2 flex items-start gap-3 border-t border-primary/20 pt-2">
                <CustomerFileThumb src={item.design_src} />
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                  <button onClick={() => {
                    setErr(null); setDesignUrl(item.design_src!); setPos(DEFAULT_POS); noteArtSource(sideName, "")
                    /* NAME IT. These three routes in — the buyer's file, the library and a
                       template — all set the artwork and left `designName` holding whatever
                       the PREVIOUS file was called, so the save recorded the wrong name and
                       the row under the stage would have shown it. */
                    setDesignName(fileNameFrom(item.design_src!) ?? "Customer's file"); setDesignSize(null)
                  }}
                    className="h-7 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:opacity-90">Use this</button>
                  <a href={item.design_src} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium hover:bg-accent">
                    Open <ArrowSquareOut size={11} weight="bold" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="space-y-3">
          {/* The artwork input the STAGE opens. An explicit Upload image / Replace button is
 always shown too: the empty stage alone wasn't discoverable, which left people
 staring at a greyed-out Save with no obvious way to add the image. */}
          {/* IT TAKES A MACHINE FILE TOO. The picker accepted image/* while the DROP handler
 on the same window took a .pes and filed it — so the same file was accepted by
 dragging and refused by browsing, from one control. Both routes now run the
 same intake, which is also where the "a stitch file only fits an embroidered
 line" refusal lives. */}
          <input ref={uploadRef} type="file" accept={"image/*," + MACHINE_EXT_LIST} className="hidden"
 onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = "" }} />
        <input ref={mockupRef} type="file" accept="image/*" className="hidden"
 onChange={(e) => { void setOwnMockup(e.target.files?.[0]); e.target.value = "" }} />
          <input ref={machineRef} type="file" accept={MACHINE_EXT_LIST} className="hidden"
 onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachMachineFile(f); e.target.value = "" }} />

          {/* TWO things make a print-ready line, and people kept giving only one. So show
 them as two numbered slots — the image (what shows on the mockup) and the
 machine file (the stitch file) — each with its own state, so it reads as a
 two-item checklist instead of a row of same-looking buttons. */}
          {/* STACKED, not side by side: a tall narrow rail sits beside a big square garment
 with no dead band, where a short wide row left one.

              NOT NUMBERED. They were "1" and "2", which asserts an order of work that is not
 true for most lines — a DTG line has no second step at all, and an embroidered
 one where the seller sent their own stitch file has no first one in the sense
 the number implied. Two cards that each say what they are, and tick when they
 are done, carry the same information without instructing anybody. The marker is
 a dot until then: the card is a state, not a task list. */}
          <div className="flex flex-col gap-2">
            {/* 1 — Design image */}
            {/* ONE GREEN. This step hand-picked emerald-300/50 while step 2 below used the
 success token, so two adjacent "done" states were two different colours — and
 emerald is separately spoken for as the SHIPPED status. Both use success. */}
            {/**
              * THE CARD IS THE STATE — no tick, no dot, no sentence.
              *
              * It carried a status circle AND a coloured border AND a line of prose saying
              * the same thing three ways ("Added — drag it on the preview to move it", next
              * to a green tick, inside a green card, above the artwork it is describing). The
              * border already says done; the design number is the only fact the title cannot
              * carry, so that is what stays beside it.
              */}
            {/**
              * SECTIONS, NOT A STACK OF CARDS.
              *
              * Three bordered, tinted boxes stood one on top of another inside a dialog that
              * is itself a card — the artwork, the route, the charge — each shouting its own
              * state in its own colour. Only one of them is ever the thing you came to do,
              * and the boxes made all three look equally urgent.
              *
              * Hairlines between sections instead. The STATE still reads, on the dot beside
              * the title where a glance already goes, rather than by flooding a whole panel
              * with green.
              */}
            {/**
              * THE STEPS ARE GONE — "1 · Your design", "2 · Print artwork", and the charge
              * that sat under them.
              *
              * They described a form to fill in, and the artwork does not arrive that way any
              * more: it is dropped onto the garment, moved with a cursor and saved. A column
              * of numbered states beside that is a second account of the same thing, written
              * in the grammar of a wizard — and it was reporting on work already visible on
              * the stage two hundred pixels to its left.
              *
              * WHAT WENT WHERE, so none of it is merely missing:
              *   · upload / replace / library / template  → the rail on the artboard
              *   · remove background                      → the selection strip
              *   · send to the print partner              → the ⋯ menu on the order's item
              * row (ItemDesignActions), which is where it also lives for a line nobody
              * has opened
              *   · the design charge                      → the order's Summary, beside the
              * total, where every other number about money is, and editable there
              */}
            {/* 2 — Machine file (the seller's own-file route, now discoverable).
                EMBROIDERY ONLY. Every part of this step is stitch apparatus: the formats it
 accepts (.emb/.pes/.dst), the words "ready to stitch", the EMB- id it files
 under, and a "Send to a designer" that puts the card on the digitising board.
                On a DTG line none of it applies — the image in step 1 IS the print file —
 and showing it sent print artwork to an embroidery designer. Same rule as the
 thread module above, from the same place, so the two can't drift. */}
            {/* One green, from the success token — this step hand-picked emerald while the
 partner step beside it used success, so two "done" states were two colours.
                The middle state is the brand tone, not green: it is under way, not finished. */}
            {isEmb && (
            <div className="border-t border-border pt-2.5">
              {/**
                * Same trim as the card above: the border carries the state, so the circle and
                * the sentence explaining it both go. What is KEPT is what a title cannot say —
                * the file's own name, and where the card sits once it is with a designer.
                * Staff get the lane and who claimed it (that is how they chase it); a seller
                * gets "with our team", because the lane names are our internal board.
                */}
              {/* NO SECOND HEADING. The drawer's own row says "Embroidery · no machine file ·
                  2 threads" two inches above, so "Embroidery file" under it was the same word
 twice and a status line restating a status line. What is left is what the
 summary cannot do: the button, and the stitch toggle when there is one. */}
              <div className="flex min-w-0 items-baseline gap-2">
                {/**
                  * SHOW STITCHES — and NOTHING when there are none to show.
                  *
                  * This was a chip on the garment reading "No stitch preview", disabled,
                  * beside the side pills — so the row under the stage held a dead control
                  * saying what the product could NOT do, next to four live ones that change
                  * which face you are looking at. A disabled button that names an absent
                  * feature is worse than no button: it is read as something broken.
                  *
                  * It renders only when a file exists AND EWA could read it. When it cannot,
                  * there is simply nothing here — the file card above already says the file
                  * is attached, which is the fact that matters.
                  */}
                {latestMachine && stitchState !== "none" && (
                  <button
 type="button"
 onClick={() => void toggleStitch()}
 disabled={stitchState === "loading"}
 title="Show the stitches instead of the image"
 className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-2xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {stitchState === "loading" ? <CircleNotch size={12} className="animate-spin" /> : <Eyedropper size={12} weight="bold" />}
                    {stitchState === "loading" ? "Rendering…" : showStitch ? "Show image" : "Show stitches"}
                  </button>
                )}
                {/* WHERE THE CARD WENT, and only that. The file's own name went with the
 heading — the drawer summary carries it — but "Sent · Incoming · Hai Anh"
 is a fact about somebody else's queue that nothing else on this screen
 reports, and it is the answer to "did that button do anything". */}
                {!hasMachineFile && boardCard && (
                  <span className="truncate text-2xs text-muted-foreground">
                    {isStaff
                      ? `Sent · ${boardCard.lane_label || boardCard.col || "Incoming"}${boardCard.claimed_by ? ` · ${boardCard.claimed_by}` : ""}`
 : "Sent — with our team"}
                  </span>
                )}
              </div>
              {/* THE FILE ROWS ARE GONE — "Embroidery file · pant.EMB" over [Replace file]
 [Download] [Remove].
                  ────────────────────────────────────────────────────────────────────────
                  Attaching one is the rail's Upload now, which takes a PNG, a JPG or a
 machine file through one intake, so the window has ONE place a file goes in
 rather than a general one on the artboard and a special one buried in a
 drawer. Downloading or removing it is the order's Design files panel, which
 lists every file on the order with the same two controls on every row —
 this was a second, differently-worded copy of that for one file.
                  What stays here is the ROUTE that is not about a file we already hold: a
 designer cutting one from the image. */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {/* SENT IS A STATE, NOT AN ABSENCE. The button used to disappear once a
 card existed, so the only difference between "I sent it" and "the button
 was never there" was memory. It stays, disabled, saying what happened. */}
                {isStaff && !hasMachineFile && (
                  <Button
 size="sm"
 variant={boardCard ? "outline" : "default"}
 disabled={sending || !designUrl || !!boardCard}
 title={boardCard ? "Already on the design board" : designUrl ? undefined : "Add an image first — a designer needs something to work from"}
 onClick={() => setConfirmSend(true)}
                  >
                    {boardCard ? "Sent" : sending ? "Sending…" : "Send to Board"}
                  </Button>
                )}
</div>
              {/* BESIDE THE FILE IT COPIES. This was in the action bar next to "Apply All",
 two buttons inches apart doing different things to different objects, in
 the row read last before Save. Only when there IS another line to copy to. */}
              {latestMachine && !!siblings?.length && (
                <Button variant="outline" size="sm" className="mt-2" disabled={fileBusy} onClick={() => void applyFileToAll()}
 title="Put this machine file on every other line of this order">
                  {fileBusy ? "Applying…" : "Apply file to all lines"}
                </Button>
              )}
            </div>
            )}
          </div>
          {/* LAST, because it is a shortcut rather than a decision: "do this line" is the
 question, "and the other nine" is the follow-up.

              Ten shirts, one file — only when there IS another line to apply to. Two separate
 buttons because they are two separate things: the image is what the mockup shows,
 the machine file is what the machine stitches, and an order can legitimately want
 one shared and the other per-item. */}
          {/* THE SHORTCUT MOVED to the action bar at the bottom, with Save — it is an action,
 and actions belong in one row rather than scattered up a column. */}
          {/* WHERE THIS LINE IS ON THE BOARD. Named lane, not a generic "sent" — "sent to
 design" three days ago and "Approved" are very different answers, and the lane
 is the one the board itself shows. */}
          {err && <div className="text-sm text-destructive">{err}</div>}
          {/* THE FIVE SILENT ACTIONS, given a voice. See `notice` above: applying a file to
              every item, copying artwork to the sibling lines, making a photo the backdrop,
              saving a template and copying to the other faces all changed something outside
              this window and said nothing at all. Dismissible, because a confirmation you
              cannot clear becomes chrome by the third time you read it. */}
          {notice && !err && (
            <div className="flex items-start gap-2 rounded-lg border border-shipped/25 bg-shipped/[0.07] px-2.5 py-2 text-sm text-foreground">
              <CheckCircle size={15} weight="bold" className="mt-0.5 shrink-0 text-shipped" />
              <span className="min-w-0 flex-1">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"
 className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <X size={11} weight="bold" />
              </button>
            </div>
          )}
          {/* NO STANDALONE "Embroidery file added — x.EMB" LINE. It said what the box two
 rows up was already showing — the file's own name — and it said it as an
 extra row with its own top margin, so filing a file grew the dialog by a
 line of blank space and a sentence. The box carries the name; the name is
 the confirmation. */}
          {/* WHAT THE SELLER PAYS. Staff only — the person being charged must not be the
 one setting the charge. Collapsed by default so the seller-shaped window stays
 a design window; the summary line carries the answer, so staff only expand
 when they disagree with it. */}
          {/**
            * THE CHARGE HAS LEFT THIS WINDOW.
            *
            * It is in the order's Summary now, beside the total and editable there
            * (design-charge.tsx). A tier is a decision about money, and it was sitting on a
            * screen about placing pictures, reachable only by opening a line — so the number
            * a seller is billed lived somewhere other than every other number about money.
            *
            * What stayed is the ROUTE, because a route is not a charge: this is how a print
            * line reaches OUR OWN designers, and the ⋯ menu on the order row only offers the
            * outside partner.
            */}
        {/* The three rows that were here — a question, a button and a note explaining why
 the button was disabled — are one tool on the rail now. See "SEND, on the rail". */}

          {/* SELLER view of the same thing the staff picker above decides — a plain-language
 estimate, never the fee controls (they're being charged; they don't set it):
                • their own machine file  → no design fee, just the check fee
                • artwork, few colours    → the standard fee, shown
                • artwork, many colours   → complex, so the fee is quoted, not fixed yet
              Only when there's something to say — an empty line shows nothing. */}
          {!isStaff && (hasMachineFile || designUrl) && (
            <div className="rounded-lg border border-border px-3 py-2.5 text-xs">
              {hasMachineFile ? (
                <span className="text-shipped">
                  <span className="font-medium">You uploaded your file.</span> No design fee{fees?.check ? ` — just a ${usd(fees.check)} check fee.` : " — just a check fee."}
                </span>
              ) : threads.length >= 6 ? (
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">Design fee being calculated…</span> Your design has a lot of detail ({threads.length} colours), so we&apos;ll send you the price to approve before anything is charged.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {/* Explicit {" "}: the leading space of the next text node was being eaten,
 printing "design fee— we'll". */}
                  <span className="font-medium text-foreground">Standard design fee{fees?.standard ? ` · ${usd(fees.standard)}` : ""}</span>{" "}
                  — we&apos;ll prepare your design for the machine.
                </span>
              )}
            </div>
          )}

        </div>
        {/* The reason sits ABOVE the buttons, not beside them. Inline in a 380px rail it
 pushed Cancel and Save onto separate lines, which read as two unrelated controls
 rather than one choice. */}
        {/* order-last, and AFTER the thread panel in the markup so it lands after it: two
 children carrying the same order value keep document order. Save used to sit
 mid-column with the thread panel below it — survivable when that panel was one
 row of chips, plainly wrong now it is a list of rows you can change. Nothing is
 below the button that ends the job. */}
        {/* PINNED, because it is the thing that ends the job.
            It scrolled away with everything else, so a line with a long thread list put Save
            below the fold of a window that was already scrolling — and the fix that had been
            reached for was capping the panel above it, which traded a lost button for a list
            you could only read a cone and a half of. The bar holds the bottom edge of the
            dialog instead: -mx-6 bleeds it through the popup's side padding so nothing scrolls
            past it at the edges, the popup drops its own pb-6 so the bar can reach the bottom,
            the bottom corners keep the popup's radius, and what passes behind it stays legible
            under the blur. Same shape the site-content panel uses. */}
        <div className="order-last sticky bottom-0 z-10 -mx-6 space-y-2 rounded-b-[min(var(--radius-4xl),24px)] border-t border-border bg-popover/95 px-6 py-4 backdrop-blur">
          {/* Say WHY Save is disabled. A machine file without an image is the common case —
 the stitch file is saved, but there's no picture to place on the mockup yet. */}
          {!designUrl && (
            <p className="text-xs text-muted-foreground">
              {hasMachineFile
                ? "Add an image so we can show where your file sits on the product."
 : "Add your design above, then save."}
            </p>
          )}
          {/* ONE ACTION BAR. Apply-to-all sat halfway up a column while Save sat at the
 bottom, so the two things you press at the END of the job were in different
 places. The shortcut goes LEFT, away from Save: "and the other nine" is a
 different decision from "keep this", and they should not be neighbours you can
 hit by accident.

              "Apply All", not "Apply front image to all items" — the button sits under the
 garment it applies, on the face you are looking at, next to the file it would
 copy. The sentence was describing its own context back to itself. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(designUrl || latestMachine) && !!siblings?.length && (
              <div className="mr-auto flex flex-wrap gap-1.5">
                {designUrl && (
                  <Button variant="outline" size="sm" disabled={applying} onClick={() => void applyToAll()}
 title={`Put this ${sideName} image on every other line of this order`}>
                    {applying ? "Applying…" : "Apply All"}
                  </Button>
                )}
                {/* THE FILE'S COPY-TO-ALL MOVED into the Embroidery drawer, beside the file
 it copies. Two buttons here, "Apply All" and "Apply file to all", sat
 inches apart doing different things to different objects — and the row
 they sat in was already the last thing read before Save. One Apply in the
 bar; the machine file's version is with the machine file. */}
              </div>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {/* "Save", not "Save design" — it saves the item: every face's artwork at once,
 and the threads with it. And enabled whenever ANY face carries artwork, not
 just the visible one: standing on an empty back with a finished front is not
 a reason to grey out Save. */}
            <Button onClick={() => void save()} disabled={saving || !anyFaceHasArt}>{saving ? <CircleNotch size={15} className="animate-spin" /> : "Save"}</Button>
          </div>
        </div>
        </div>
        </div>
        <LibraryPickerDialog
 open={libOpen} onOpenChange={setLibOpen}
 initialSource={libSource}
 onPick={(u, d) => {
            setErr(null); setDesignUrl(u); setPos(DEFAULT_POS); noteArtSource(sideName, "")
            setDesignName(d?.name || "From library"); setDesignSize(null)
          }}
          /* A TEMPLATE BRINGS ITS PLACEMENT. Taking only the picture and centring it is what
 the sheet import used to do, and it is the same loss here: somebody positioned
 that artwork on that garment, and re-centring it throws the decision away. The
 blank is NOT applied — this canvas belongs to an order line whose garment is
 already decided. */
 onPickTemplate={(t) => {
 const l = (t.layers ?? {}) as { images?: { src?: string; pos?: Pos }[]; designUrl?: string; pos?: Pos }
 const first = Array.isArray(l.images) ? l.images.find((im) => im?.src) : null
 const art = String(first?.src ?? l.designUrl ?? "")
 if (!art) { setErr("That template has no artwork saved on it."); return }
 setErr(null)
 setDesignUrl(art)
 setDesignName(t.name ? `${t.name} · template` : "From a template"); setDesignSize(null)
 setPos(first?.pos ?? l.pos ?? DEFAULT_POS)
            // The recipe's identity, kept. See tplBySide.
 noteArtSource(sideName, String(t.id))
          }}
        />
        {/* The partner route for print methods. Anchored to the LINE (orderId + sku), which
 pushToPink accepts directly — no board card has to exist first, so this is one
 click rather than "create a card, then push the card". */}
        <PushToPartnerDialog
 open={pinkOpen}
 onOpenChange={setPinkOpen}
 orderId={orderId}
 sku={item.sku || undefined}
 itemName={item.name}
 qty={item.qty}
 printType={item.print_type}
 artworkUrl={designUrl || undefined}
 onPushed={() => { setPinkOpen(false); void loadCards() }}
        />

        {/* WHAT IS ABOUT TO LEAVE, before it leaves. Sending artwork into someone else's
 queue is not an undoable UI action — they see it and may start on it — so the
 picture, the line it belongs to and the lane it lands in are all shown once. */}
        <Dialog open={confirmSend} onOpenChange={(v) => { if (!v) setConfirmSend(false) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Send this to the design board?</DialogTitle></DialogHeader>
            <div className="flex gap-3">
              {designUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={designUrl} alt="" className="size-24 shrink-0 rounded-lg border border-border bg-muted object-contain" />
              )}
              <div className="min-w-0 space-y-1 text-sm">
                <div className="font-medium">{item.name || item.sku || "This line"}</div>
                <p className="text-muted-foreground">
                  It lands in <span className="font-medium text-foreground">In progress</span> as
 work already under way — not in Incoming, which is where designers pick up
 new jobs of their own.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmSend(false)}>Cancel</Button>
              <Button size="sm" disabled={sending} onClick={() => void sendToBoard()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

// Read-only preview: render a saved design at its %-position over a mockup.
export function DesignPreview({ mockup, designUrl, pos, className }: { mockup?: string; designUrl?: string; pos?: DesignPos | null; className?: string }) {
 return (
    <div className={"relative aspect-square overflow-hidden rounded-lg bg-muted " + (className ?? "")}>
      {mockup && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mockup} alt="" className="absolute inset-0 size-full object-contain" />
      )}
      {designUrl && pos && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={designUrl} alt="" style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%`, transform: `translate(-50%,-50%) rotate(${pos.r}deg)` }} className="absolute block" />
      )}
    </div>
  )
}
