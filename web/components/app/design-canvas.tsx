"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { UploadSimple, DownloadSimple, ArrowsOutCardinal, ArrowClockwise, ArrowCounterClockwise, Eraser, X, CircleNotch, Image as ImageIcon, ArrowSquareOut, CaretDown, Check, CheckCircle, Warning } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/app/confirm-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { PushToPartnerDialog } from "@/components/app/push-to-partner-dialog"
import { getOrderDesignCards, cardForLine, createDesignCard, assignDesignCard, deleteDesignFile, type OrderDesignCard, uploadDesignFile, downloadDesignFile, filesForLine, postOrderDesign, postOrderThreads, setDesignTier, getDesignFees, getDesignFiles, type DesignPos, type DesignTier, type OrderItem, type CatalogProduct } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { resolveProduct, mockupFaces, isEmbroidery } from "@/lib/variant-resolve"
import { perceptualHash } from "@/lib/phash"
import { decodeEntities, usd } from "@/lib/order-format"
import { matchThreadColors, nearestThread, nearestThreads, matchQuality, hexToRgb, matchThreadRegions, canvasReadableSrc, type Thread, type ThreadRegion } from "@/lib/thread-match"
import { useBackgroundRemoval } from "@/lib/remove-background"
import { loadThreadPalette } from "@/lib/thread-palette-load"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Eyedropper } from "@phosphor-icons/react"

export type Pos = { x: number; y: number; w: number; r: number }
export type TextLayer = { id: string; text: string; x: number; y: number; size: number; r: number; color: string; bold?: boolean }
export const DEFAULT_POS: Pos = { x: 50, y: 50, w: 45, r: 0 }
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
  mockup, designUrl, pos, setPos, onRemove, className,
  texts, updateText, selected, onSelect, picking, onPickColor,
  printZone, printLabel, emptyHint,
}: {
  mockup?: string
  designUrl: string
  pos: Pos
  setPos: (fn: (p: Pos) => Pos) => void
  onRemove?: () => void
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

  // target: "image" or a text-layer id. mode: move | resize | rotate.
  const startDrag = (target: string, mode: "move" | "resize" | "rotate") => (e: React.PointerEvent) => {
    if (!stageRef.current) return
    e.preventDefault(); e.stopPropagation()
    onSelect?.(target)
    const rect = stageRef.current.getBoundingClientRect()
    const isText = target !== "image"
    const layer = isText ? texts?.find((t) => t.id === target) : null
    const startX = isText ? (layer?.x ?? 50) : pos.x
    const startY = isText ? (layer?.y ?? 50) : pos.y
    const startR = isText ? (layer?.r ?? 0) : pos.r
    const px = e.clientX, py = e.clientY
    const cx = rect.left + (startX / 100) * rect.width
    const cy = rect.top + (startY / 100) * rect.height
    function apply(patch: { x?: number; y?: number; w?: number; size?: number; r?: number }) {
      if (isText && layer) updateText?.(target, { x: patch.x, y: patch.y, size: patch.w ?? patch.size, r: patch.r } as Partial<TextLayer>)
      else setPos((p) => ({ ...p, ...(patch.x != null ? { x: patch.x } : {}), ...(patch.y != null ? { y: patch.y } : {}), ...(patch.w != null ? { w: patch.w } : {}), ...(patch.r != null ? { r: patch.r } : {}) }))
    }
    function move(ev: PointerEvent) {
      if (mode === "move") {
        const dx = ((ev.clientX - px) / rect.width) * 100
        const dy = ((ev.clientY - py) / rect.height) * 100
        apply({ x: clamp(startX + dx, 0, 100), y: clamp(startY + dy, 0, 100) })
      } else if (mode === "resize") {
        const vx = ev.clientX - cx, vy = ev.clientY - cy
        const rad = (-startR * Math.PI) / 180
        const localX = vx * Math.cos(rad) - vy * Math.sin(rad)
        const wPct = (2 * Math.abs(localX) / rect.width) * 100
        // maxW, not a flat 100: the ceiling is whatever keeps the artwork's own height
        // inside the bed, so dragging the handle stops at the edge instead of past it.
        apply(isText ? { size: clamp(wPct / 3, 2, 40) } : { w: clamp(wPct, 8, maxW) })
      } else {
        const ang = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
        apply({ r: Math.round(ang) })
      }
    }
    function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const handles = (target: string) => (
    <>
      <div className="pointer-events-none absolute inset-0 rounded-sm outline outline-2 -outline-offset-1 outline-primary/70" />
      <button onPointerDown={startDrag(target, "rotate")} className="absolute -top-7 left-1/2 flex size-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full bg-primary text-primary-foreground shadow touch-none" aria-label="Rotate"><ArrowClockwise size={13} weight="bold" /></button>
      <button onPointerDown={startDrag(target, "resize")} className="absolute -bottom-2.5 -right-2.5 flex size-6 cursor-nwse-resize items-center justify-center rounded-full bg-primary text-primary-foreground shadow touch-none" aria-label="Resize"><ArrowsOutCardinal size={12} weight="bold" /></button>
    </>
  )

  return (
    // The stage is TRANSPARENT. The grid used to be painted here, so it stopped where the
    // square stopped and left bare panel around it — the thing that kept looking wrong.
    // The backdrop now belongs to the surrounding panel (see .eg-studio-bed), which fills
    // the whole column, while this element stays square purely so the design's %-coords
    // and the print zone keep a stable frame to measure against.
    <div ref={stageRef} onPointerDown={() => onSelect?.(null)} style={{ containerType: "size" }} className={"relative aspect-square select-none " + (className ?? "w-full")}>

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

      {designUrl && imgBroken && (
        /* An image that cannot be fetched renders as nothing here, so say so. Silence was
           indistinguishable from "the upload didn't work", which is what it got reported as. */
        <div className="absolute inset-x-2 top-2 z-10 rounded-md bg-destructive/90 px-2 py-1 text-center text-2xs font-medium text-background">
          This artwork couldn&apos;t be loaded — replace it, or remove it and upload again.
        </div>
      )}
      {designUrl && (
        <div
          onPointerDown={picking ? undefined : startDrag("image", "move")}
          onClick={picking ? (e) => sampleAt(e, e.currentTarget) : undefined}
          onMouseMove={picking ? (e) => moveLoupe(e, e.currentTarget) : undefined}
          onMouseLeave={picking ? () => setLoupe(null) : undefined}
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${drawW}%`, transform: `translate(-50%,-50%) rotate(${pos.r}deg)` }}
          className={"absolute touch-none " + (picking ? "cursor-crosshair" : "cursor-move")}
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
          {!picking && (selected == null || selected === "image") && handles("image")}
          {onRemove && (selected == null || selected === "image") && (
            <button onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} className="absolute -right-2.5 -top-2.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow" aria-label="Remove artwork"><X size={12} weight="bold" /></button>
          )}
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
          onPointerDown={startDrag(t.id, "move")}
          style={{ left: `${t.x}%`, top: `${t.y}%`, transform: `translate(-50%,-50%) rotate(${t.r}deg)`, color: t.color, fontSize: `${t.size}cqw`, fontWeight: t.bold ? 800 : 600, whiteSpace: "nowrap", lineHeight: 1.1 }}
          className="absolute cursor-move touch-none"
        >
          {t.text || "Text"}
          {selected === t.id && handles(t.id)}
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

export function DesignCanvasDialog({
  open, onOpenChange, orderId, item, initialDesign, initialPos, onSaved, catalog,
  siblings, designs, onSendToDesigner,
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
  /** Every design on the order, keyed as the server keys them (line first, sku as fallback).
   *  Only used to count how many lines "use on every line" would OVERWRITE before it does. */
  designs?: Record<string, { data?: string } | undefined> | null
  /** Staff-only. Offered only when the line has artwork — there is nothing to digitise
   *  otherwise. Absent → not offered at all. */
  onSendToDesigner?: () => void
}) {
  const [designUrl, setDesignUrl] = useState(initialDesign ?? "")
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
  // A machine file that was ATTACHED rather than placed. Separate from `err` because it is
  // a success, and the seller needs telling that something happened — the canvas cannot
  // show a .emb, so without a word the window looks identical to a dropped file being lost.
  const [attached, setAttached] = useState<string | null>(null)
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
  const hasMachineFile = hasFile || !!attached

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
      setAttached(isStaff
        ? `${f.name} filed as the machine file. Add an image too so it shows on the mockup.`
        : `Embroidery file added — ${f.name}.`)
    } catch (e) { setErr(`Couldn't attach ${f.name}: ${(e as Error).message}`) }
  }, [orderId, item.line_id, item.sku, isStaff])

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
  /** Open this line's machine file. 402 is the paywall, not a fault — say which. */
  const downloadMachine = useCallback(async () => {
    if (!latestMachine) return
    setDlBusy(true); setDlErr(null)
    try {
      const r = await downloadDesignFile(latestMachine.designId)
      const url = r.url || r.data
      if (!url) throw new Error("No file came back.")
      window.open(url, "_blank", "noopener")
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
      const r = await downloadDesignFile(latestMachine.designId)
      const data = r.data || r.url
      if (!data) throw new Error("Couldn't read the file back to re-file it.")
      const up = await uploadDesignFile({
        designId: latestMachine.designId, orderId,
        // null, not undefined — the whole point is to CLEAR the line and go order-wide.
        lineId: null, name: latestMachine.name, data,
      })
      if (up?.error) throw new Error(up.error)
      setAttached(`${latestMachine.name} now applies to every item on this order.`)
      onSaved?.()
    } catch (e) {
      setDlErr(e instanceof Error ? e.message : "Couldn't apply that file to all items.")
    } finally { setFileBusy(false) }
  }, [latestMachine, orderId, confirm, onSaved])

  const applyToAll = useCallback(async () => {
    const others = siblings ?? []
    if (!designUrl || !others.length) return
    const willReplace = others.filter((it) => !!designs?.[(it.line_id ?? it.sku) as string]?.data).length
    const ok = await confirm({
      title: `Use this artwork on all ${others.length} other line${others.length === 1 ? "" : "s"}?`,
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
          sku: it.sku ?? "", line_id: it.line_id ?? undefined, data: designUrl,
          name: item.name ?? undefined, pos: { x: pos.x, y: pos.y, w: pos.w, r: pos.r },
        })
        if (r?.error) throw new Error(r.error)
      } catch (e) { failed.push(`${it.sku ?? "line"}${e instanceof Error ? ` (${e.message})` : ""}`) }
    }
    setApplying(false)
    if (failed.length) setErr(`Couldn't apply to: ${failed.join(", ")}`)
    const done = others.length - failed.length
    if (done > 0) { setAttached(`Applied to ${done} other line${done === 1 ? "" : "s"}.`); onSaved?.() }
  }, [designUrl, siblings, designs, orderId, item.name, pos, onSaved, confirm])

  /** `close` is false when saving as a STEP in something else (sending to a designer),
   *  where closing the window mid-flow would look like the action had finished.
   *  Returns whether it persisted, so a caller can stop rather than carry on regardless. */
  const save = async (close = true): Promise<boolean> => {
    if (!designUrl) { setErr("Upload artwork first."); return false }
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
      const phash = await perceptualHash(designUrl).catch(() => null)
      const r = await postOrderDesign(orderId, { sku: item.sku ?? "", line_id: item.line_id, data: designUrl, name: item.name, pos: { x: pos.x, y: pos.y, w: pos.w, r: pos.r }, phash })
      if (r.error) throw new Error(r.error)
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
        className="sm:max-w-2xl lg:max-w-[min(96vw,calc(min(62vh,46vw)+452px))]"
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
          if (MACHINE_RE.test(f.name)) { void attachMachineFile(f); return }
          if (!/^image\//.test(f.type)) {
            setErr(`${f.name} isn't an image or a machine file, so there's nothing to do with it here.`)
            return
          }
          readImageFile(f, (u) => { setErr(null); setDesignUrl(u); setPos(DEFAULT_POS) }, setErr)
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
        <div className="lg:sticky lg:top-0 lg:w-[min(62vh,46vw)] lg:self-start">
        {/* Side tabs — only when the blank has more than one face to place art on. */}
        {faces.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {faces.map((f, i) => (
              <button key={f.side} onClick={() => setSide(i)}
                className={"rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors " + (i === side ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent")}>
                {f.side}
              </button>
            ))}
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
            className="w-full" mockup={activeMockup} designUrl={designUrl} pos={pos} setPos={setPos}
            onRemove={() => setDesignUrl("")} picking={picking} onPickColor={onPickColor}
            // Suppress the stage's OWN "Pick a blank to start designing" placeholder: the
            // overlay below is already the empty state, and rendering both stacked two
            // different sentences on top of each other in the same 40px. An empty fragment
            // rather than null — the stage falls back on nullish, so null would restore it.
            emptyHint={<></>}
          />
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
                <span className="text-xs font-medium leading-tight">Drop artwork<br />or click to browse</span>
              </span>
            </button>
          )}
        </div>
        </div>
        {/* Right column — controls, in the order you work through them: what the buyer sent,
            the two upload steps, thread match, then the charge. */}
        {/* self-center, not start: on a line with little to configure (no artwork yet, no
            buyer file) these controls are much shorter than the garment beside them, and
            top-aligning them left a tall band of dead space under the column. Centring only
            has an effect in that case — once the column is the taller of the two it behaves
            exactly like start. */}
        <div className="flex flex-col gap-4 lg:min-w-0 lg:self-center">
        {/* Thread match — EMB only. Each chip is a dominant design colour mapped to the
            nearest in-stock cone; saved with the design so the floor loads the right threads.
            `order-last` rather than moving the block: it sits first in the markup for historical
            reasons, but it is a RESULT, not an instruction. Above the numbered steps it told a
            seller to "upload artwork to match threads" before showing them the upload button,
            and it competed with the two things they must actually do. Last is where a derived
            read-out belongs. */}
        {isEmb && (
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
                {/* Says what the seller is looking at and what it is FOR, in their words.
                    "Thread match · 2 cones" was a factory read-out: a cone is a spool on our
                    machine, not something they bought. */}
                <div className="text-3xs text-muted-foreground">
                  We embroider your design in these colours — change any that look wrong.
                </div>
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
            {!designUrl ? (
              <div className="text-xs text-muted-foreground/70">Add your image above and we&apos;ll pick the thread colours for it.</div>
            ) : regions === null ? (
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
            {item.design_src && (
              // Etsy blocks direct hotlinking, so the buyer's file must load through the
              // same-origin proxy (not just for canvas reads — for display too).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={canvasReadableSrc(item.design_src)} alt="Customer file" className="size-14 shrink-0 rounded-md border border-border object-cover" />
            )}
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
            onChange={(e) => { readImageFile(e.target.files?.[0], (u) => { setErr(null); setDesignUrl(u); setPos(DEFAULT_POS) }, setErr); e.target.value = "" }} />
          <input ref={machineRef} type="file" accept={MACHINE_EXT_LIST} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachMachineFile(f); e.target.value = "" }} />

          {/* TWO things make a print-ready line, and people kept giving only one. So show
              them as two numbered slots — the image (what shows on the mockup) and the
              machine file (the stitch file) — each with its own state, so it reads as a
              two-item checklist instead of a row of same-looking buttons. */}
          {/* STACKED, not side by side. Two cards in a row are read as a pair of options;
              stacked and numbered they are read as an order of work, which is what they are.
              It also fixes the window: a tall narrow rail sits beside a big square garment
              with no dead band, where a short wide row left one. */}
          <div className="flex flex-col gap-2">
            {/* 1 — Design image */}
            <div className={cn("rounded-lg border p-2.5", designUrl ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20" : "border-dashed border-border bg-muted/20")}>
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold", designUrl ? "bg-emerald-600 text-white" : "border border-border bg-background text-muted-foreground")}>
                  {designUrl ? <Check size={12} weight="bold" /> : "1"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Your design</div>
                  {/* Plain words, seller's point of view. "The artwork we print / embroider"
                      described OUR job; a seller is deciding what goes on the product. */}
                  <div className="text-2xs text-muted-foreground">{designUrl ? "Added — drag it on the preview to move it" : "The picture that goes on the product"}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => uploadRef.current?.click()}>{designUrl ? "Replace" : "Upload image"}</Button>
                <Button variant="outline" size="sm" onClick={() => setLibOpen(true)}>Library</Button>
                {/* RIGHT HERE, not only in the Design maker. Buyer artwork arrives on a white
                    or grey plate more often than not, and this dialog is where someone is
                    looking when they notice — sending them to another page to fix it is how
                    it gets printed with the plate still on. Same hook, same behaviour.

                    What it produces is a data: url, so `save` below persists the CUT-OUT and
                    the removal travels with the design everywhere afterwards. Leave it alone
                    and the artwork is saved exactly as it arrived. */}
                {designUrl && (
                  <Button variant="outline" size="sm" onClick={bg.run} disabled={bg.busy} title="Clear a flat backdrop — no AI, nothing leaves your browser">
                    {bg.busy ? <CircleNotch size={14} className="animate-spin" /> : <Eraser size={14} weight="bold" />}
                    {bg.busy ? "Working…" : "Remove background"}
                  </Button>
                )}
                {bg.canUndo && (
                  <Button variant="ghost" size="sm" onClick={bg.undo} title="Put the background back">
                    <ArrowCounterClockwise size={14} weight="bold" /> Undo
                  </Button>
                )}
              </div>
              {bg.msg && <p className="mt-1.5 text-2xs text-muted-foreground">{bg.msg}</p>}
            </div>
            {/* 2 — Machine file (the seller's own-file route, now discoverable).
                EMBROIDERY ONLY. Every part of this step is stitch apparatus: the formats it
                accepts (.emb/.pes/.dst), the words "ready to stitch", the EMB- id it files
                under, and a "Send to a designer" that puts the card on the digitising board.
                On a DTG line none of it applies — the image in step 1 IS the print file —
                and showing it sent print artwork to an embroidery designer. Same rule as the
                thread module above, from the same place, so the two can't drift. */}
            {isEmb && (
            <div className={cn("rounded-lg border p-2.5", hasMachineFile ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20" : "border-dashed border-border bg-muted/20")}>
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold", hasMachineFile ? "bg-emerald-600 text-white" : "border border-border bg-background text-muted-foreground")}>
                  {hasMachineFile ? <Check size={12} weight="bold" /> : "2"}
                </span>
                <div className="min-w-0 flex-1">
                  {/* "Machine file" is our word for it. Every format this step accepts is an
                      embroidery format (MACHINE_EXT_LIST), so naming it that is both plainer
                      and more accurate. */}
                  {/* Optional for a SELLER — we cut it for them — but not for staff, who
                      cannot make the line without it. So the word only appears for the
                      reader it is true for. */}
                  <div className="text-sm font-medium">
                    Embroidery file{!isStaff && <span className="font-normal text-muted-foreground"> (optional)</span>}
                  </div>
                  {/* This one line carries the whole state of the step, including "a
                      designer has it" — which is why there is no longer a separate board
                      strip underneath competing to say the same thing.
                      Two audiences read it. Staff need the lane and who claimed it, because
                      that is how they chase the card; a seller needs to know it is being
                      handled and nothing more — the lane names are our internal board, and
                      a designer's name is not theirs to be given. */}
                  <div className="truncate text-2xs text-muted-foreground" title={latestMachine?.name || undefined}>
                    {hasMachineFile
                      ? (latestMachine ? `${latestMachine.name} — ready to stitch` : "Added — ready to stitch")
                      : boardCard ? (isStaff
                          ? `With a designer · ${boardCard.lane_label || boardCard.col || "Incoming"}${boardCard.claimed_by ? ` · ${boardCard.claimed_by}` : ""}`
                          : "Our design team is preparing it")
                      : designUrl ? "We make this for you — or attach your own"
                      : "Only if you already have one (.emb, .pes, .dst…)"}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => machineRef.current?.click()}>{hasMachineFile ? "Replace file" : "Attach file"}</Button>
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
                  <Button variant="outline" size="sm" disabled={dlBusy} onClick={() => void downloadMachine()}>
                    {dlBusy
                      ? <><CircleNotch size={13} className="animate-spin" /> Fetching…</>
                      : <><DownloadSimple size={13} weight="bold" /> Download</>}
                  </Button>
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
                    disabled={fileBusy}
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
                        setHasFile(false); setLatestMachine(null)
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
              <div className={"rounded-lg border p-2.5 " + (sentToPartner
                ? "border-success/40 bg-success/5"
                : "border-dashed border-border bg-muted/20")}>
                <div className="flex items-start gap-2">
                  {/* SENT LOOKS LIKE DONE, the same way step 1 does. This step reported "On
                      the board · In progress" whether or not it had actually gone to the
                      partner, and still offered the send button underneath — so a card
                      already with Pink was one click from a SECOND task and a second charge,
                      with nothing on screen to say the first had worked. */}
                  {sentToPartner ? (
                    <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-success" />
                  ) : (
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-2xs font-bold text-muted-foreground">2</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Print artwork</div>
                    <div className="truncate text-2xs text-muted-foreground">
                      {sentToPartner
                        ? `Sent to Pink Design${boardCard?.vendor_ref ? ` · ref ${boardCard.vendor_ref}` : ""}${boardCard?.lane_label || boardCard?.col ? ` · ${boardCard.lane_label || boardCard.col}` : ""}`
                        : boardCard
                          ? `On the board · ${boardCard.lane_label || boardCard.col || "Incoming"}${boardCard.claimed_by ? ` · ${boardCard.claimed_by}` : ""}`
                          : "Our designers do embroidery — print work goes to Pink Design"}
                    </div>
                  </div>
                </div>
                {/* No button once it has gone. Re-sending is not an undo — it opens a second
                    task on their board that nobody asked for. */}
                {!sentToPartner && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      disabled={!designUrl}
                      title={designUrl ? undefined : "Add an image first — the partner needs something to work from"}
                      onClick={() => setPinkOpen(true)}
                    >
                      Send to Pink Design
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
                  {applying ? "Applying…" : "Apply image to all items"}
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

                  {!tier && (
                    <p className="mt-2 text-2xs text-muted-foreground">
                      {hasMachineFile
                        ? "A machine file is already on this line, so they supplied it — we only check it."
                        : "No machine file on this line, so we cut it from their artwork."}
                      {" "}Suggested, not applied — nothing is charged until you pick one.
                    </p>
                  )}
                  {/* The quote's own state, in words. A "complex" chip alone can't tell
                      waiting-on-the-seller from already-paid from refused. */}
                  {quote === "pending" && <p className="mt-2 text-2xs text-amber-700">Waiting on the seller to accept — don&apos;t start work yet.</p>}
                  {quote === "declined" && <p className="mt-2 text-2xs text-rose-700">The seller declined. Cancel the line, or agree something else with them.</p>}
                  {quote === "accepted" && <p className="mt-2 text-2xs text-emerald-700">Accepted and paid — cleared to digitise. The tier is locked.</p>}

                  {/* The ALTERNATIVE to uploading, not a step after it. Offering both without
                      saying so is how a line ends up with a finished file AND an open card
                      nobody closes. */}
                  {onSendToDesigner && (
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
            <Button onClick={() => void save()} disabled={saving || !designUrl}>{saving ? <CircleNotch size={15} className="animate-spin" /> : "Save design"}</Button>
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
