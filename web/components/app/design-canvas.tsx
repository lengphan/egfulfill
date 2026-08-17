"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Copy, Lock, LockOpen, Trash, UploadSimple, DownloadSimple, ArrowClockwise, ArrowCounterClockwise, Eraser, X, CircleNotch, Image as ImageIcon, ArrowSquareOut, CaretDown, Check, CheckCircle, Warning } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { PushToPartnerDialog } from "@/components/app/push-to-partner-dialog"
import { designSrc } from "@/lib/order-image"
import { VariantPicker } from "@/components/app/variant-picker"
import { deleteOrderDesign, getOrderDesigns, designsBySide, sidesForLine, scopeDesignFile, getEmbPreview, getOrderDesignCards, cardForLine, createDesignCard, assignDesignCard, deleteDesignFile, type OrderDesignCard, uploadDesignFile, downloadDesignFile, filesForLine, postOrderDesign, postOrderThreads, setDesignTier, getDesignFees, getDesignFiles, type DesignPos, type DesignTier, type OrderItem, type CatalogProduct } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { resolveProduct, mockupFaces, isEmbroidery } from "@/lib/variant-resolve"
import { perceptualHash } from "@/lib/phash"
import { decodeEntities, usd } from "@/lib/order-format"
import { useArtworkSrc } from "@/lib/pdf-preview"
import { matchThreadColors, nearestThread, nearestThreads, matchQuality, hexToRgb, matchThreadRegions, canvasReadableSrc, type Thread, type ThreadRegion } from "@/lib/thread-match"
import { useBackgroundRemoval } from "@/lib/remove-background"
import { loadThreadPalette } from "@/lib/thread-palette-load"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
        <span className="shrink-0 font-mono text-3xs text-muted-foreground">{current.code}</span>
        <CaretDown size={11} weight="bold" className="ml-auto shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 min-w-56 overflow-y-auto">
        {options.map((o, i) => (
          <DropdownMenuItem key={o.code} onClick={() => onChange(o.code)} className="gap-1.5 text-xs">
            <span className="size-3.5 shrink-0 rounded-full border border-black/15" style={{ background: o.hex }} />
            <span className="truncate">{o.name}</span>
            {i === 0 && (
              <span className="shrink-0 rounded bg-muted px-1 py-px text-3xs font-medium text-muted-foreground">best match</span>
            )}
            <span className="ml-auto shrink-0 font-mono text-3xs text-muted-foreground">{o.code}</span>
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
  mockup, designUrl = "", pos = DEFAULT_POS, setPos, onRemove, onCopy, copyLabel, className,
  texts, updateText, images, updateImage, onEraseBg, eraseBusy, onUndoErase, selected, onSelect, picking, onPickColor,
  printZone, printLabel, emptyHint,
}: {
  mockup?: string
  /** The single artwork. Optional because a caller driving `images` has no single one —
   *  requiring it forced a placeholder that the stage would then draw beneath the stack. */
  designUrl?: string
  pos?: Pos
  setPos?: (fn: (p: Pos) => Pos) => void
  onRemove?: () => void
  /** Offered in the action strip when a caller has somewhere to copy TO — the design maker
   *  and the studio have no second face, so they simply don't pass it and the button is not
   *  drawn. A control that does nothing is worse than one that isn't there. */
  onCopy?: () => void
  copyLabel?: string
  /** Several image layers, drawn back-to-front in array order. Ignored when absent, which is
   *  every caller that places exactly one artwork. */
  images?: ImageLayer[]
  updateImage?: (id: string, patch: Partial<Pos>) => void
  /** Background removal, offered ON the layer rather than in a panel across the window — it
   *  changes the picture, so it belongs where the picture is. Absent ⇒ no button. */
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
   *  had — without it there's nothing showing where artwork may actually go. */
  printZone?: { x: number; y: number; w: number; h: number }
  printLabel?: string
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
  const stripBtn = "flex size-7 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
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
        className="absolute -top-11 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-md"
        // The strip is chrome, not canvas: a drag that starts here must never also start a
        // move on the layer underneath it.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {onCopy && (
          <button type="button" onClick={onCopy} title={copyLabel ?? "Copy to the other sides"} aria-label={copyLabel ?? "Copy to the other sides"} className={stripBtn}>
            <Copy size={14} weight="bold" />
          </button>
        )}
        <button
          onPointerDown={locked ? undefined : startDrag(target, "rotate")}
          disabled={locked}
          title={locked ? "Locked" : "Drag to rotate"} aria-label="Rotate"
          className={stripBtn + " touch-none " + (locked ? "" : "cursor-grab")}
        >
          <ArrowClockwise size={14} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => setLocked((v) => !v)}
          title={locked ? "Unlock — let it be moved again" : "Lock in place"}
          aria-label={locked ? "Unlock" : "Lock in place"}
          aria-pressed={locked}
          className={stripBtn + (locked ? " bg-primary/10 text-primary" : "")}
        >
          {locked ? <Lock size={14} weight="fill" /> : <LockOpen size={14} weight="bold" />}
        </button>
        {onEraseBg && (
          <button type="button" onClick={onEraseBg} disabled={eraseBusy}
            title="Remove the background — clears the backdrop connected to the edges, in your browser"
            aria-label="Remove background" className={stripBtn}>
            {eraseBusy ? <CircleNotch size={14} className="animate-spin" /> : <Eraser size={14} weight="bold" />}
          </button>
        )}
        {onUndoErase && (
          <button type="button" onClick={onUndoErase} title="Put the background back" aria-label="Undo background removal" className={stripBtn}>
            <ArrowCounterClockwise size={14} weight="bold" />
          </button>
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this layer" aria-label="Remove this layer" className={stripBtn + " hover:bg-destructive hover:text-destructive-foreground"}>
            <Trash size={14} weight="bold" />
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

      {mockup ? (
        // p-[6%] lets the garment fill more of the bed than a raw object-contain, which
        // left wide dead margins around a portrait mockup.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mockup} alt="" className="pointer-events-none absolute inset-0 size-full object-contain p-[5%] drop-shadow-[0_10px_28px_rgba(0,0,0,0.16)]" />
      ) : (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
          <ImageIcon size={38} weight="duotone" className="opacity-40" />
          {emptyHint ?? <span className="text-xs">Pick a blank to start designing.</span>}
        </div>
      )}

      {/* The printable area. Everything outside it is trimmed in production, so it has to
          be visible while placing artwork — the port had dropped this entirely. */}
      {printZone && mockup && (
        <div
          className="pointer-events-none absolute rounded-[2px] border border-dashed border-foreground/35"
          style={{ left: `${printZone.x}%`, top: `${printZone.y}%`, width: `${printZone.w}%`, height: `${printZone.h}%` }}
        >
          {printLabel && (
            <span className="absolute -top-5 left-0 rounded bg-background/80 px-1 text-3xs font-medium tracking-wide text-muted-foreground">
              {printLabel}
            </span>
          )}
        </div>
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
          <div className="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-foreground/90 px-1.5 py-0.5 text-3xs font-medium text-background">
            <span className="size-2.5 rounded-full border border-white/40" style={{ background: loupe.hex }} />
            <span className="font-mono">{loupe.hex}</span>
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
 *  for them — a .emb arrives as application/octet-stream or an empty string. */
const MACHINE_RE = /\.(emb|pes|dst|exp|jef|vp3|xxx|hus)$/i
/** The same list the regex tests, as an accept attribute. Derived from one source so the
 *  picker can't start offering a type the drop handler refuses (or the reverse). */
const MACHINE_EXT_LIST = ".emb,.pes,.dst,.exp,.jef,.vp3,.xxx,.hus"

/** The three tiers, in the factory's own words. Mirrors the mapping in
 *  server/src/routes/orders.js — tier → fee — so the label and the debit can't disagree. */
const TIER_LABEL: Record<DesignTier, string> = {
  standard: "Standard",
  complex: "Complex",
  supplied: "Their file",
}
const TIER_WHY: Record<DesignTier, string> = {
  standard: "We cut the machine file from their artwork — ordinary work",
  complex: "We cut it, but it's intricate. Quotes the seller and waits for them to accept",
  supplied: "They sent their own machine file — we only check it",
}
/** null while settings are still loading, so a price never renders as a confident $0. */
const feeFor = (t: DesignTier, fees: { standard: number; complex: number; check: number } | null) =>
  fees ? (t === "standard" ? fees.standard : t === "complex" ? fees.complex : fees.check) : null


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
         className={box + " grid place-items-center bg-muted text-3xs font-semibold text-muted-foreground hover:bg-accent"}>
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
   *  which is right for a surface that only ever holds one line. */
  siblings?: OrderItem[]
  /** What each ADDITIONAL printed face adds per unit (settings: method_side). Shown on the
   *  side pills so the cost is known BEFORE a second face is committed to, not discovered on
   *  the Summary afterwards. null/0 ⇒ extra sides are free and nothing is said. */
  sideFee?: number | null
  /** Every design on the order, keyed as the server keys them (line first, sku as fallback).
   *  Only used to count how many lines "use on every line" would OVERWRITE before it does. */
  designs?: Record<string, { data?: string } | undefined> | null
  /** Staff-only. Offered only when the line has artwork — there is nothing to digitise
   *  otherwise. Absent → not offered at all. */
  onSendToDesigner?: () => void
  /** Submitted order, seller side — the file is settled. Replace and Remove are shown but
   *  disabled: the seller asks the factory in chat rather than swapping a file underneath a
   *  job that may already be running. The server refuses it anyway; this stops the click
   *  that gets refused. */
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
  // Background removal, shared with the Design maker so the two behave identically.
  const bg = useBackgroundRemoval(designUrl, setDesignUrl)
  const [pos, setPos] = useState<Pos>(initialPos ? { x: initialPos.x, y: initialPos.y, w: initialPos.w, r: initialPos.r } : DEFAULT_POS)
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()
  // Resolve the REAL blank mockup from the catalog (per the chosen colour + its side
  // faces), not the raw order-line thumbnail. Falls back to item.img when the product
  // can't be resolved (e.g. an unmatched marketplace SKU).
  const faces = useMemo(() => {
    const product = resolveProduct(item, catalog ?? [])
    const f = mockupFaces(product, item.color)
    return f.length ? f : (item.img ? [{ side: "front", url: item.img }] : [])
  }, [item, catalog])
  const [side, setSide] = useState(0)
  const activeMockup = faces[side]?.url || item.img || ""
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
   *  colour? Only then is there anything for "Start over" to undo, and only then is it
   *  offered. Cleared whenever the matcher rebuilds the list from the artwork. */
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
  const [attached, setAttached] = useState<string | null>(null)
  /** A machine file was filed in THIS window — the one thing that legitimately makes step ②
   *  done before the server has been re-read. */
  const [justAttachedFile, setJustAttachedFile] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [over, setOver] = useState(false)
  /** The explicit machine-file picker. Dropping one already worked; there was no BUTTON,
   *  so a seller who had cut their own file and didn't think to drag it had no route. */
  const machineRef = useRef<HTMLInputElement | null>(null)
  /** The artwork picker, driven by the stage overlay rather than by a button of its own. */
  const uploadRef = useRef<HTMLInputElement | null>(null)

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
   *  shows a confident $0 next to a button that moves money. */
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
   *  this is the fact that a task exists on their board — not a guess from the lane. */
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
   *  asks for Pink's own fields (product type, design type, board) that mean nothing here. */
  const [pinkOpen, setPinkOpen] = useState(false)
  /** Re-read this line's board card. Exposed so a partner push can refresh the subtitle
   *  without a second copy of the query. */
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
  const sendToBoard = async () => {
    setSending(true); setErr(null)
    try {
      const card = await createDesignCard({
        title: item.name || item.sku || "Design",
        data: designUrl || undefined,
        sku: item.sku || undefined,
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

  const [dlBusy, setDlBusy] = useState(false)
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
          const mine = filesForLine(rows ?? [], { line_id: item.line_id, sku: item.sku })
            .filter((f) => f.kind === "emb" || f.kind === "pes")
          setHasFile(mine.length > 0)
          const newest = mine.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0]
          setLatestMachine(newest ? { designId: newest.designId, name: newest.name || "Machine file" } : null)
        })
        .catch(() => { setHasFile(false); setLatestMachine(null) })
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


  const [tier, setTier] = useState<DesignTier | null>((item.design_tier as DesignTier | null) ?? null)
  const [tierBusy, setTierBusy] = useState<DesignTier | null>(null)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const quote = item.design_quote_status ?? null

  /**
   * The tier we RECOMMEND, from the one signal that actually distinguishes them: who cut
   * the machine file.
   *
   *   a machine file is on the line  → 'supplied'  — they brought it, we only check it
   *   otherwise                      → 'standard'  — we cut it from their artwork
   *
   * 'complex' is deliberately NEVER suggested. It is the expensive tier AND it fires a
   * quote that blocks the line until the seller accepts, so proposing it automatically
   * would put a large charge and a stalled order behind nobody's judgement. Intricacy is
   * the one thing here a person has to look at the artwork to decide.
   *
   * This only HIGHLIGHTS. It must never call setDesignTier on its own: that route debits
   * the wallet, so an auto-applied suggestion would mean merely OPENING this window
   * charged the seller. Staff still click; the suggestion just makes the common case the
   * obvious one instead of a price list recalled from memory.
   */
  const suggested: DesignTier = hasMachineFile ? "supplied" : "standard"

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
      setAttached(`Embroidery file added — ${f.name}.`)
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

  /** Open this line's machine file. 402 is the paywall, not a fault — say which. */
  const downloadMachine = useCallback(async () => {
    if (!latestMachine) return
    setDlBusy(true); setDlErr(null)
    try {
      const r = await downloadDesignFile(latestMachine.designId)
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
      a.download = r.name || latestMachine.name || "design.emb"
      a.click()
      setTimeout(() => URL.revokeObjectURL(href), 10_000)
    } catch (e) {
      const m = e instanceof Error ? e.message : "Couldn't open that file."
      setDlErr(/402|purchase|paid/i.test(m) ? "Not purchased yet." : m)
    } finally { setDlBusy(false) }
  }, [latestMachine])

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
      setAttached(`${latestMachine.name} now applies to every item on this order.`)
      onSaved?.()
    } catch (e) {
      setDlErr(e instanceof Error ? e.message : "Couldn't apply that file to all items.")
    } finally { setFileBusy(false) }
  }, [latestMachine, confirm, onSaved, setFileBusy, setDlErr, setAttached])

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
    if (done > 0) { setAttached(`Applied to ${done} other line${done === 1 ? "" : "s"}.`); onSaved?.() }
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
  const removeArtwork = async () => {
    if (removing) return   // a second click would open a second confirm over the first
    const saved = !!artAtOpen && !!designUrl
    if (!saved) { setDesignUrl(""); setDesignName(null); setFaceArt((prev) => ({ ...(prev ?? {}), [sideName]: null })); return }
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
      setDesignUrl(""); setDesignName(null)
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
    setAttached(`Copied to the other ${faces.length - 1 === 1 ? "side" : `${faces.length - 1} sides`} — press Save to keep it.`)
  }

  /** `close` is false when saving as a STEP in something else (sending to a designer),
   *  where closing the window mid-flow would look like the action had finished.
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
        className="sm:max-w-2xl lg:max-w-[min(96vw,calc(min(70vh,50vw)+452px))]"
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
          if (MACHINE_RE.test(f.name)) {
            if (!isEmb) {
              setErr(`${f.name} is an embroidery file, and this line is ${item.print_type || "not embroidered"} — there is no machine to run it. Drop a PNG or JPG instead.`)
              return
            }
            void attachMachineFile(f); return
          }
          if (!/^image\//.test(f.type)) {
            setErr(`${f.name} isn't an image or a machine file, so there's nothing to do with it here.`)
            return
          }
          readImageFile(f, (u) => { setErr(null); setDesignUrl(u); setDesignName(f.name); setPos(DEFAULT_POS) }, setErr)
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
        </DialogHeader>
        {/* TWO COLUMNS from lg up: the garment on the left, every control on the right.
            Stacked, the stage alone ate the window and the steps, thread match and charge all
            sat below the fold — you had to scroll away from the artwork to act on it, which
            is backwards for a window whose whole job is judging placement.

            The left column is `sticky top-0`: the right column is the taller of the two, so
            when it does scroll the garment stays put instead of leaving the screen. Below lg
            it collapses back to the original single stack — two columns in a phone-width
            dialog would make both of them useless. */}
        <div className="grid gap-5 lg:grid-cols-[auto_380px] lg:items-start lg:gap-6">
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
        <div className="lg:sticky lg:top-2 lg:w-[min(70vh,50vw)] lg:self-start">
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
        {faces.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {faces.map((f, i) => {
              const has = facesWithArt[(f.side || "front").toLowerCase()]
              /**
               * THE PILL ITSELF CARRIES THE STATE — no dot.
               *
               * A dot is a second mark inside a control that could just BE the mark, and next
               * to a filled pill it read as a third state rather than as "this one has
               * something on it". Three appearances, one property:
               *
               *   solid    — the face you are on
               *   tinted   — has artwork, not selected
               *   plain    — empty
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
        <div className="relative w-full max-w-[min(100%,78vh)]">
          <DesignStage
            className="w-full" mockup={activeMockup}
            designUrl={showStitch && stitchPng ? `data:image/png;base64,${stitchPng}` : designUrl}
            pos={pos} setPos={setPos}
            onRemove={() => void removeArtwork()}
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
          {designUrl && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={bg.run}
                disabled={bg.busy}
                title="Clear a flat backdrop — no AI, nothing leaves your browser"
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2 py-1 text-2xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent disabled:opacity-60"
              >
                {bg.busy ? <CircleNotch size={12} className="animate-spin" /> : <Eraser size={12} weight="bold" />}
                {bg.busy ? "Working…" : "Remove background"}
              </button>
              {bg.canUndo && (
                <button
                  type="button"
                  onClick={bg.undo}
                  title="Put the background back"
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2 py-1 text-2xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent"
                >
                  <ArrowCounterClockwise size={12} weight="bold" /> Undo
                </button>
              )}
              {bg.msg && (
                <span className="pointer-events-auto rounded-lg bg-card/95 px-2 py-1 text-2xs text-muted-foreground shadow-sm backdrop-blur">{bg.msg}</span>
              )}
              {/* ON THE ARTWORK, like the background tools — it changes what the stage
                  draws, so it belongs where the stage is, not in the file card across the
                  window. */}
              {latestMachine && (
                <button
                  type="button"
                  onClick={() => void toggleStitch()}
                  disabled={stitchState === "loading" || stitchState === "none"}
                  title={stitchState === "none" ? "EWA can't read this file" : "Show the stitches instead of the image"}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2 py-1 text-2xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent disabled:opacity-60"
                >
                  {stitchState === "loading" ? <CircleNotch size={12} className="animate-spin" /> : <Eyedropper size={12} weight="bold" />}
                  {stitchState === "loading" ? "Rendering…"
                    : stitchState === "none" ? "No stitch preview"
                      : showStitch ? "Show image" : "Show stitches"}
                </button>
              )}
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
                <span className="text-3xs font-normal leading-tight opacity-80">
                  {isEmb ? "PNG or JPG — or a .EMB / .PES / .DST" : "PNG or JPG"}
                </span>
              </span>
            </button>
          )}
        </div>
        </div>
        {/* Right column — controls, in the order you work through them: what the buyer sent,
            the two upload steps, thread match, then the charge. */}
        {/* self-START. The two columns are one thing being worked on and the controls that
            act on it, so they have to begin on the same line — centring the shorter column
            floated the steps somewhere down the middle of the garment, and "1 Your design"
            no longer lined up with the top of the image it was talking about. The dead band
            it was avoiding only ever appeared on an empty line, and a gap below the last
            control reads as nothing at all; a first step that starts halfway down does not. */}
        <div className="flex flex-col gap-4 lg:min-w-0 lg:self-start">
        {/**
          * THE BLANK, PICKED HERE.
          *
          * Placing artwork and choosing what it goes ON are one decision, and they were two
          * screens: you opened this window, found the line had no blank, closed it, picked
          * the blank in the order table, and opened it again. The mockup behind this rail is
          * drawn FROM that choice, so the one place it obviously belongs is the one place it
          * wasn't.
          *
          * The real VariantPicker, not a private dropdown — it owns the resolution rules, the
          * post-submit refusal and the method list, and a second implementation would drift
          * from the row that shows the same four values (CLAUDE.md §5).
          */}
        {catalog && catalog.length > 0 && (
          <div className="rounded-lg border border-border p-2.5">
            <div className="mb-1.5 text-sm font-medium">Product</div>
            {/* dense: the rail is a fixed 380px column, and the picker's four-across layout
                turns on at the `sm` VIEWPORT — which is true here and wrong here, so Size and
                Method came out as "S.." and "E...". Two per row fits. */}
            <VariantPicker dense orderId={orderId} item={item} catalog={catalog} onSaved={() => onSaved?.()} />
          </div>
        )}
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
        {isEmb && designUrl && (
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
          <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            {item.design_src && <CustomerFileThumb src={item.design_src} />}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground">Customer&apos;s file</div>
              {/* NO decorative quotes around it. The buyer's text frequently contains its
                  own — this one is literally `"MRS. AUSTIN "` — and wrapping it produced
                  “"MRS. AUSTIN "”, which invites someone to stitch a quotation mark that
                  isn't theirs. Personalisation is a literal to reproduce, so it is shown
                  exactly, in mono, where a trailing space (this one has one) is visible
                  rather than invisibly trimmed by the eye. */}
              {item.personalization && (
                <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                  {decodeEntities(item.personalization)}
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {item.design_src && (
                  <button onClick={() => { setErr(null); setDesignUrl(item.design_src!); setPos(DEFAULT_POS) }}
                    className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">Use this</button>
                )}
                {item.design_src && (
                  <a href={item.design_src} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent">
                    Open <ArrowSquareOut size={11} weight="bold" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="space-y-3">
          {/* The artwork input the STAGE opens. An explicit Upload image / Replace button is
              always shown too: the empty stage alone wasn't discoverable, which left people
              staring at a greyed-out Save with no obvious way to add the image. */}
          <input ref={uploadRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; readImageFile(f, (u) => { setErr(null); setDesignUrl(u); setDesignName(f?.name ?? null); setPos(DEFAULT_POS) }, setErr); e.target.value = "" }} />
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
            <div className={cn("rounded-lg border px-2.5 py-2", designUrl ? "border-success/40 bg-success/5" : "border-dashed border-border bg-muted/20")}>
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="text-sm font-medium">Your design</span>
                {designUrl && designNo != null && (
                  <span className="truncate font-mono text-2xs font-medium text-muted-foreground">DSN-{designNo}</span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => uploadRef.current?.click()}>{designUrl ? "Replace" : "Upload image"}</Button>
                <Button variant="outline" size="sm" onClick={() => setLibOpen(true)}>Library</Button>
                {/* Remove background is NOT here — it acts on the artwork, so it lives on
                    the artwork (see the stage overlay). A control in this row described a
                    step; on the image it describes the thing under your cursor, and you can
                    see the result the moment it lands without looking away. */}
              </div>
            </div>
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
            <div className={cn("rounded-lg border px-2.5 py-2",
              hasMachineFile ? "border-success/40 bg-success/5"
              : sentToDesigner ? "border-primary/40 bg-primary/5"
              : "border-dashed border-border bg-muted/20")}>
              {/**
                * Same trim as the card above: the border carries the state, so the circle and
                * the sentence explaining it both go. What is KEPT is what a title cannot say —
                * the file's own name, and where the card sits once it is with a designer.
                * Staff get the lane and who claimed it (that is how they chase it); a seller
                * gets "with our team", because the lane names are our internal board.
                */}
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-sm font-medium">
                  Embroidery file{!isStaff && <span className="font-normal text-muted-foreground"> (optional)</span>}
                </span>
                <span className="truncate text-2xs text-muted-foreground" title={latestMachine?.name || undefined}>
                  {hasMachineFile ? (latestMachine?.name || "Added")
                    : boardCard ? (isStaff
                        ? `Sent · ${boardCard.lane_label || boardCard.col || "Incoming"}${boardCard.claimed_by ? ` · ${boardCard.claimed_by}` : ""}`
                        : "Sent — with our team")
                    : ""}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button
                  variant="outline" size="sm"
                  disabled={filesLocked}
                  title={filesLocked ? lockedWhy : undefined}
                  onClick={() => machineRef.current?.click()}
                >
                  {hasMachineFile ? "Replace file" : "Attach file"}
                </Button>
                {/* THE SECOND ROUTE TO THE SAME THING, standing beside the first.
                    ──────────────────────────────────────────────────────────────
                    There are exactly two ways this line ever gets a stitch file: someone
                    hands us one, or a designer cuts one from the image. They are
                    alternatives — the owner's word for it was "either or" — and they were
                    being shown in two different places, one as a button inside this step
                    and one as a strip floating below the whole section. Reading the panel
                    meant discovering that the orphan strip at the bottom answered the
                    question the step above had just asked.

                    Now they sit side by side, so the choice is visible as a choice, and the
                    whole panel is two rows that each read "or": the image comes from an
                    upload OR the library, the stitch file comes from a file OR a designer.

                    Hidden once a file exists (nothing left to cut) or once it is already
                    with a designer (the subtitle says so) — so this is never a third thing
                    to weigh, only ever the other half of one decision. */}
                {isStaff && !hasMachineFile && !boardCard && (
                  <Button
                    size="sm"
                    disabled={sending || !designUrl}
                    title={designUrl ? undefined : "Add an image first — a designer needs something to work from"}
                    onClick={() => void sendToBoard()}
                  >
                    {sending ? "Sending…" : "Send to Board"}
                  </Button>
                )}
                {/* DOWNLOAD. The file could be attached, named and confirmed here with no way
                    to actually get it — the only route to the bytes was the readiness chip in
                    the row behind this dialog, which is not where anyone looks for it.
                    Routed through downloadDesignFile (/api/design_files/:id) rather than a raw
                    URL, because that route is where the paywall and the seller/staff checks
                    live — a direct link would hand out bytes the caller may not have bought. */}
                {latestMachine && (
                  <>
                  <Button variant="outline" size="sm" disabled={dlBusy} onClick={() => void downloadMachine()}>
                    {dlBusy
                      ? <><CircleNotch size={13} className="animate-spin" /> Fetching…</>
                      : <><DownloadSimple size={13} weight="bold" /> Download</>}
                  </Button>
                  </>
                )}
                              {/* REMOVE. The artwork on the canvas has always had its X; the machine file
                    had Replace and Download and no way to say "not this one after all". A
                    wrong .emb had to be overwritten by another file, so a line could never
                    return to having none — and the readiness chip kept reading as ready.
                    Deletes the newest file for THIS line only; siblings keep theirs. */}
                {hasMachineFile && latestMachine && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={fileBusy || filesLocked}
                    title={filesLocked ? lockedWhy : undefined}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Remove ${latestMachine.name}?`,
                        body: "This line goes back to having no machine file. Other items on the order keep theirs.",
                        confirmLabel: "Remove file",
                        destructive: true,
                      })
                      if (!ok) return
                      setFileBusy(true); setErr(null)
                      try {
                        const r = await deleteDesignFile(latestMachine.designId)
                        if (r && r.error) throw new Error(r.error)
                        setHasFile(false); setLatestMachine(null); setJustAttachedFile(false)
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : "Couldn't remove the file.")
                      } finally { setFileBusy(false) }
                    }}
                  >
                    Remove
                  </Button>
                )}
</div>
              {dlErr && <div className="mt-1.5 text-2xs text-destructive">{dlErr}</div>}
            </div>
            )}
            {/* 2, THE OTHER HALF — print methods go to the PARTNER, not our board.
                Our designers digitise; DTG/DTF is print artwork and Pink Design does it.
                That split is already recorded on every card (`vendor` — "our designers do
                embroidery, so DTG/DTF goes out"); this is the button that acts on it.
                A DTG line used to get an embroidery step it had no use for, and once that
                was gated off it had no route to a designer at all.
                Staff only, like its embroidery counterpart: opening a partner task spends
                money, and the person being charged must not be the one who spends it. */}
            {!isEmb && isStaff && (
              <div className={"rounded-lg border p-2.5 " + (artworkChangedSinceSend
                ? "border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
                : sentToPartner
                  ? "border-success/40 bg-success/5"
                  : "border-dashed border-border bg-muted/20")}>
                <div className="flex items-start gap-2">
                  {/* SENT LOOKS LIKE DONE, the same way step 1 does. This step reported "On
                      the board · In progress" whether or not it had actually gone to the
                      partner, and still offered the send button underneath — so a card
                      already with Pink was one click from a SECOND task and a second charge,
                      with nothing on screen to say the first had worked. */}
                  {artworkChangedSinceSend ? (
                    // NOT a tick. The step is no longer done: they hold the old file.
                    <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
                  ) : sentToPartner ? (
                    <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-success" />
                  ) : (
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-2xs font-bold text-muted-foreground">2</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Print artwork</div>
                    <div className={"text-2xs " + (artworkChangedSinceSend ? "text-amber-700 dark:text-amber-500" : "truncate text-muted-foreground")}>
                      {artworkChangedSinceSend
                        ? `You replaced the image — Pink Design still has the old one${boardCard?.vendor_ref ? ` (ref ${boardCard.vendor_ref})` : ""}. Send it again or tell them, or they'll digitise the wrong artwork.`
                        : sentToPartner
                        ? `Sent to Pink Design${boardCard?.vendor_ref ? ` · ref ${boardCard.vendor_ref}` : ""}${boardCard?.lane_label || boardCard?.col ? ` · ${boardCard.lane_label || boardCard.col}` : ""}`
                        : boardCard
                          ? `On the board · ${boardCard.lane_label || boardCard.col || "Incoming"}${boardCard.claimed_by ? ` · ${boardCard.claimed_by}` : ""}`
                          : "Our designers do embroidery — print work goes to Pink Design"}
                    </div>
                  </div>
                </div>
                {/* No button once it has gone — re-sending is not an undo, it opens a second
                    task nobody asked for. UNLESS the artwork has changed since: then they
                    hold a file that is no longer the job, and sending again is the only way
                    to fix it. Labelled so it's clear that's what it does. */}
                {(!sentToPartner || artworkChangedSinceSend) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      disabled={!designUrl}
                      title={designUrl ? undefined : "Add an image first — the partner needs something to work from"}
                      onClick={() => setPinkOpen(true)}
                    >
                      {artworkChangedSinceSend ? "Send the new artwork" : "Send to Pink Design"}
                    </Button>
                  </div>
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
          {(designUrl || latestMachine) && !!siblings?.length && (
            <div className="flex flex-wrap gap-1.5">
              {designUrl && (
                <Button variant="outline" size="sm" disabled={applying} onClick={() => void applyToAll()}>
                  {applying ? "Applying…" : `Apply ${sideName} image to all items`}
                </Button>
              )}
              {latestMachine && (
                <Button variant="outline" size="sm" disabled={fileBusy} onClick={() => void applyFileToAll()}>
                  {fileBusy ? "Applying…" : "Apply file to all items"}
                </Button>
              )}
            </div>
          )}
          {/* WHERE THIS LINE IS ON THE BOARD. Named lane, not a generic "sent" — "sent to
              design" three days ago and "Approved" are very different answers, and the lane
              is the one the board itself shows. */}
          {err && <div className="text-sm text-destructive">{err}</div>}
          {/* A machine file was filed. Green, not red, and it says what it did AND what it
              deliberately didn't — the canvas is unchanged, which without a word reads as
              the drop having failed. */}
          {attached && <div className="text-sm text-emerald-700">{attached}</div>}
          {/* WHAT THE SELLER PAYS. Staff only — the person being charged must not be the
              one setting the charge. Collapsed by default so the seller-shaped window stays
              a design window; the summary line carries the answer, so staff only expand
              when they disagree with it. */}
          {isStaff && (
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setChargeOpen((v) => !v)}
                aria-expanded={chargeOpen}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium">Design charge</span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {tier
                      ? `${TIER_LABEL[tier]}${feeFor(tier, fees) !== null ? ` · ${usd(feeFor(tier, fees)!)}` : ""}${quote === "pending" ? " · awaiting the seller" : ""}`
                      : `Suggested: ${TIER_LABEL[suggested]}${feeFor(suggested, fees) !== null ? ` · ${usd(feeFor(suggested, fees)!)}` : ""} — not charged yet`}
                  </span>
                </span>
                <CaretDown size={14} weight="bold" className={"shrink-0 text-muted-foreground transition-transform " + (chargeOpen ? "rotate-180" : "")} />
              </button>

              {chargeOpen && (
                <div className="border-t border-border p-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["standard", "complex", "supplied"] as DesignTier[]).map((id) => {
                      const isSet = tier === id
                      // Highlighted, NOT applied. Nothing here has debited anything until
                      // someone clicks — see the note on `suggested`.
                      const isSuggested = !tier && id === suggested
                      const fee = feeFor(id, fees)
                      return (
                        <button
                          key={id}
                          type="button"
                          title={TIER_WHY[id]}
                          disabled={!!tierBusy || quote === "accepted"}
                          onClick={async () => {
                            setTierBusy(id); setErr(null)
                            try {
                              const r = await setDesignTier(orderId, {
                                tier: id, line_id: item.line_id, sku: item.line_id ? undefined : item.sku,
                              })
                              if (r?.error) throw new Error(r.error)
                              setTier(id)
                              setAttached(r.quoted
                                // Says what has NOT happened. "Marked complex" reads as done,
                                // and the money has not moved and may never.
                                ? "Quoted to the seller. Nothing is charged until they accept, and they may decline."
                                : r.charged?.charged
                                  ? `Charged ${usd(Number(r.charged.charged))} to the seller.`
                                  : r.charged?.reason === "already-charged"
                                    ? "Re-filed. This line was already charged, so nothing moved."
                                    // OUR OWN SHOP. A factory-owned order's seller_id is a
                                    // staff account, so charging it moves money from the
                                    // factory to the factory. That nets to zero, which
                                    // sounds harmless and isn't: it books revenue nobody
                                    // earned, so every margin figure reading design-work
                                    // rows counts our own costs as income.
                                    : r.charged?.reason === "factory-order"
                                      ? "Filed. This is our own shop's order, so nothing is charged — the tier is still recorded."
                                      : r.charged?.reason === "no-fee-set"
                                        ? "Filed. No fee is set for this tier, so nothing was charged."
                                        : "Filed.")
                              onSaved?.()
                            } catch (e) { setErr((e as Error).message) } finally { setTierBusy(null) }
                          }}
                          className={"relative rounded-lg border px-2 py-1.5 text-2xs font-medium transition-colors disabled:opacity-50 " +
                            (isSet ? "border-primary bg-primary/10 text-primary"
                              : isSuggested ? "border-primary/50 bg-primary/5 text-foreground"
                              : "border-border text-muted-foreground hover:bg-accent")}
                        >
                          {tierBusy === id ? <CircleNotch size={12} className="mx-auto animate-spin" /> : (
                            <>
                              <span className="block">{TIER_LABEL[id]}</span>
                              {/* The number, not just the word — Complex is several times
                                  Standard, and a charge chosen by someone who can't see the
                                  amount is a charge made blind. Only once fees load. */}
                              {fee !== null && (
                                <span className="block text-3xs font-normal tabular-nums opacity-70">{usd(fee)}</span>
                              )}
                            </>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* The paragraph that explained the suggestion is gone. It restated what the
                      chips already show (which tier is suggested, and that nothing is charged
                      until one is picked) in three lines of prose above the controls it was
                      describing. */}
                  {/* The quote's own state, in words. A "complex" chip alone can't tell
                      waiting-on-the-seller from already-paid from refused. */}
                  {quote === "pending" && <p className="mt-2 text-2xs text-amber-700">Waiting on the seller to accept — don&apos;t start work yet.</p>}
                  {quote === "declined" && <p className="mt-2 text-2xs text-rose-700">The seller declined. Cancel the line, or agree something else with them.</p>}
                  {quote === "accepted" && <p className="mt-2 text-2xs text-emerald-700">Accepted and paid — cleared to digitise. The tier is locked.</p>}

                  {/* The ALTERNATIVE to uploading, not a step after it. Offering both without
                      saying so is how a line ends up with a finished file AND an open card
                      nobody closes. */}
                  {/* NOT on an embroidered line: "Send to Board" is already in the Embroidery
                      file card above, next to Attach file, where the choice between the two
                      routes is actually made. Two buttons for one board, worded differently
                      and thirty lines apart, is how a line gets a finished file AND an open
                      card nobody closes. */}
                  {onSendToDesigner && !isEmb && (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="mb-1.5 text-2xs text-muted-foreground">Don&apos;t have the file yet?</p>
                      {/* SAVE FIRST, then send — and only send if the save actually landed.
                          This silently did nothing before: the board builds its card from
                          the SAVED designs map, so artwork dropped here but not yet saved
                          didn't exist as far as the push was concerned. It hit a guard that
                          returned without a word, and the designer's board stayed empty
                          with nothing on screen to say why. */}
                      <Button size="sm" variant="outline" disabled={!designUrl || saving} onClick={async () => {
                        if (!(await save(false))) return
                        onSendToDesigner()
                      }}>
                        {saving ? "Saving…" : "Send this line to a designer"}
                      </Button>
                      {!designUrl && <p className="mt-1 text-2xs text-muted-foreground">Needs artwork first — there&apos;s nothing to digitise.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SELLER view of the same thing the staff picker above decides — a plain-language
              estimate, never the fee controls (they're being charged; they don't set it):
                • their own machine file  → no design fee, just the check fee
                • artwork, few colours    → the standard fee, shown
                • artwork, many colours   → complex, so the fee is quoted, not fixed yet
              Only when there's something to say — an empty line shows nothing. */}
          {!isStaff && (hasMachineFile || designUrl) && (
            <div className="rounded-lg border border-border px-3 py-2.5 text-xs">
              {hasMachineFile ? (
                <span className="text-emerald-700">
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
        <div className="order-last space-y-2">
          {/* Say WHY Save is disabled. A machine file without an image is the common case —
              the stitch file is saved, but there's no picture to place on the mockup yet. */}
          {!designUrl && (
            <p className="text-xs text-muted-foreground">
              {hasMachineFile
                ? "Add an image so we can show where your file sits on the product."
                : "Add your design above, then save."}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
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
        <LibraryPickerDialog open={libOpen} onOpenChange={setLibOpen} onPick={(u) => { setErr(null); setDesignUrl(u); setPos(DEFAULT_POS) }} />
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
