"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { UploadSimple, ArrowsOutCardinal, ArrowClockwise, X, CircleNotch, Image as ImageIcon, FolderOpen, ArrowSquareOut } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { postOrderDesign, postOrderThreads, type DesignPos, type OrderItem, type CatalogProduct } from "@/lib/api"
import { resolveProduct, mockupFaces } from "@/lib/variant-resolve"
import { perceptualHash } from "@/lib/phash"
import { matchThreadColors, nearestThread, hexToRgb, matchQuality, matchThreadRegions, type Thread, type ThreadRegion } from "@/lib/thread-match"
import { loadThreadPalette } from "@/lib/thread-palette-load"
import { Eyedropper, MapPinSimple } from "@phosphor-icons/react"

export type Pos = { x: number; y: number; w: number; r: number }
export type TextLayer = { id: string; text: string; x: number; y: number; size: number; r: number; color: string; bold?: boolean }
export const DEFAULT_POS: Pos = { x: 50, y: 50, w: 45, r: 0 }
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

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
    img.src = designUrl
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
        apply(isText ? { size: clamp(wPct / 3, 2, 40) } : { w: clamp(wPct, 8, 100) })
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
            <span className="absolute -top-5 left-0 rounded bg-background/80 px-1 text-[10px] font-medium tracking-wide text-muted-foreground">
              {printLabel}
            </span>
          )}
        </div>
      )}

      {designUrl && (
        <div
          onPointerDown={picking ? undefined : startDrag("image", "move")}
          onClick={picking ? (e) => sampleAt(e, e.currentTarget) : undefined}
          onMouseMove={picking ? (e) => moveLoupe(e, e.currentTarget) : undefined}
          onMouseLeave={picking ? () => setLoupe(null) : undefined}
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%`, transform: `translate(-50%,-50%) rotate(${pos.r}deg)` }}
          className={"absolute touch-none " + (picking ? "cursor-crosshair" : "cursor-move")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={designUrl} alt="" className="pointer-events-none block w-full select-none" draggable={false} />
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
          <div className="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-foreground/90 px-1.5 py-0.5 text-[10px] font-medium text-background">
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

// Reads a File → data URL, guarding type/size. Returns via callback.
export function readImageFile(file: File | null | undefined, onData: (url: string) => void, onErr: (m: string) => void) {
  if (!file || !file.type.startsWith("image/")) { onErr("Please choose an image (PNG/JPG/SVG)."); return }
  if (file.size > 12 * 1024 * 1024) { onErr("Artwork is over 12MB — please compress it."); return }
  const reader = new FileReader()
  reader.onload = () => onData(String(reader.result || ""))
  reader.readAsDataURL(file)
}

// ─────────────────── Order customizer (place artwork on an order item) ───────────────────
export function DesignCanvasDialog({
  open, onOpenChange, orderId, item, initialDesign, initialPos, onSaved, catalog,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderId: string
  item: OrderItem
  initialDesign?: string
  initialPos?: DesignPos | null
  onSaved?: () => void
  catalog?: CatalogProduct[]
}) {
  const [designUrl, setDesignUrl] = useState(initialDesign ?? "")
  const [pos, setPos] = useState<Pos>(initialPos ? { x: initialPos.x, y: initialPos.y, w: initialPos.w, r: initialPos.r } : DEFAULT_POS)
  const [saving, setSaving] = useState(false)
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
  const isEmb = /emb/i.test(String(item.print_type || ""))
  const [threads, setThreads] = useState<Thread[]>([])
  const [picking, setPicking] = useState(false)
  // The thread MAP: which cone covers which part. Off by default (the chip row is the
  // at-a-glance answer); computed only when opened, and never persisted — the crops are
  // derived from artwork we already hold.
  const [mapOpen, setMapOpen] = useState(false)
  const [regions, setRegions] = useState<ThreadRegion[] | null>(null)
  // The cone chosen for each sampled colour, keyed by the ARTWORK hex. The auto-match
  // is only a suggestion — the nearest cone by maths is not always the one you want on
  // the garment — so this records the human's override and wins over region.thread.
  const [picks, setPicks] = useState<Record<string, string>>({})

  /** Swap the cone for one sampled colour, keeping the saved thread list in step. */
  const chooseThread = (r: ThreadRegion, code: string) => {
    const next = r.options.find((o) => o.code === code)
    if (!next) return
    const current = picks[r.srcHex] ?? r.thread.code
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
    if (!mapOpen || !designUrl) return
    let alive = true
    const id = setTimeout(() => {
      setRegions(null)
      matchThreadRegions(designUrl).then((r) => { if (alive) setRegions(r) }).catch(() => { if (alive) setRegions([]) })
    }, 0)
    return () => { alive = false; clearTimeout(id) }
  }, [mapOpen, designUrl])

  // What the eyedropper landed on, when nothing in stock is actually close. The cone is
  // still added — refusing to add one would leave the line with no thread at all — but
  // the sample is named so the difference is visible, and the fix (add that colour, or
  // choose a different cone) is stated.
  const [pickWarn, setPickWarn] = useState<{ hex: string; thread: string } | null>(null)

  const onPickColor = (hex: string) => {
    const { r, g, b } = hexToRgb(hex)
    const t = nearestThread(r, g, b)
    if (t) {
      setThreads((prev) => (prev.some((x) => x.code === t.code) ? prev : [...prev, t]))
      const { poor } = matchQuality(r, g, b, t)
      setPickWarn(poor ? { hex, thread: `${t.code} ${t.name}` } : null)
    }
    setPicking(false)
  }
  const [err, setErr] = useState<string | null>(null)
  const [libOpen, setLibOpen] = useState(false)

  const save = async () => {
    if (!designUrl || !item.sku) { setErr("Upload artwork first."); return }
    setSaving(true); setErr(null)
    try {
      // Fingerprint the artwork as it's saved, so the factory can later tell that this
      // design has already been digitised. Best-effort: a null phash costs us fuzzy
      // matching, never the save.
      const phash = await perceptualHash(designUrl).catch(() => null)
      const r = await postOrderDesign(orderId, { sku: item.sku, data: designUrl, name: item.name, pos: { x: pos.x, y: pos.y, w: pos.w, r: pos.r }, phash })
      if (r.error) throw new Error(r.error)
      // Persist the matched threads alongside the design so the factory loads the right
      // cones. Best-effort — a design still saves even if the thread write hiccups.
      if (isEmb && threads.length) await postOrderThreads(orderId, item.sku, threads).catch(() => {})
      onSaved?.(); onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the design.")
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Customize · {item.name || item.sku}</DialogTitle></DialogHeader>
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
        <div className="mx-auto w-full"><DesignStage className="w-full" mockup={activeMockup} designUrl={designUrl} pos={pos} setPos={setPos} onRemove={() => setDesignUrl("")} picking={picking} onPickColor={onPickColor} /></div>
        {/* Thread match — EMB only. Each chip is a dominant design colour mapped to the
            nearest in-stock cone; saved with the design so the floor loads the right threads. */}
        {isEmb && (
          <div className="rounded-lg border border-border bg-muted/30 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Thread match {threads.length ? `· ${threads.length} cone${threads.length === 1 ? "" : "s"}` : ""}
              </span>
              {designUrl && (
                <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMapOpen((v) => !v)}
                  title="Show which cone covers which part of the design"
                  className={"inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors " + (mapOpen ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}
                >
                  <MapPinSimple size={13} weight="bold" /> Map
                </button>
                <button
                  type="button"
                  onClick={() => setPicking((v) => !v)}
                  title="Eyedropper — then click the design to sample a colour and add its nearest thread"
                  className={"inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors " + (picking ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}
                >
                  <Eyedropper size={13} weight="bold" /> {picking ? "Click the design…" : "Pick"}
                </button>
                </div>
              )}
            </div>
            {threads.length === 0 ? (
              <div className="text-xs text-muted-foreground/70">
                {!designUrl ? "Upload artwork to match embroidery threads."
                  : threadErr ? "Couldn't read this artwork's colours — pick them with the eyedropper instead."
                  : "Reading colours…"}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {threads.map((t) => (
                  <span key={t.code} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-1 pr-2 text-xs">
                    <span className="size-4 shrink-0 rounded-full border border-black/15" style={{ background: t.hex }} />
                    <span className="font-medium">{t.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{t.code}</span>
                  </span>
                ))}
              </div>
            )}

            {/* The map. Each row is a crop of the artwork taken from where that colour
                actually sits — the half a digitiser was previously guessing at. */}
            {pickWarn && (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                <span className="mt-0.5 size-3 shrink-0 rounded-full border border-black/15" style={{ background: pickWarn.hex }} />
                <span>
                  You sampled <span className="font-mono font-medium">{pickWarn.hex}</span>, but the closest cone you stock is{" "}
                  <span className="font-medium">{pickWarn.thread}</span> — not a real match. Add this colour under
                  Settings → Platform → Embroidery threads, or pick a different cone.
                </span>
                <button onClick={() => setPickWarn(null)} className="ml-auto shrink-0 font-medium hover:underline">Dismiss</button>
              </div>
            )}
            {mapOpen && (
              <div className="mt-2 rounded-md border border-border bg-card">
                {regions === null ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">Reading the artwork…</div>
                ) : regions.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Couldn&apos;t read this artwork&apos;s colours — use the eyedropper instead.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {regions.map((r) => (
                      <div key={r.thread.code} className="flex items-center gap-2.5 px-2.5 py-2">
                        {r.swatch ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={r.swatch} alt={`Detail using ${r.thread.name}`} className="size-14 shrink-0 rounded border border-border object-cover" />
                        ) : (
                          <span className="size-14 shrink-0 rounded border border-border" style={{ background: r.srcHex }} />
                        )}
                        <div className="min-w-0 flex-1">
                          {/* The SAMPLED colour — what's actually in the artwork. */}
                          <div className="flex items-center gap-1.5">
                            <span className="size-3 shrink-0 rounded-full border border-black/15" style={{ background: r.srcHex }} />
                            <span className="font-mono text-[11px] font-medium">{r.srcHex}</span>
                            <span className="ml-auto text-[10px] font-medium text-muted-foreground">{r.pct}%</span>
                          </div>
                          {/* -> the cone. A dropdown, not a verdict: the nearest cone by
                              maths isn't always the one you want stitched, so every close
                              alternative is offered and the human decides. */}
                          {/* No cone you stock is close. Said plainly, because the
                              dropdown below still has to name SOMETHING — and a wrong
                              cone presented confidently is how the floor loads red as
                              white. */}
                          {r.poor && (
                            <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              No close match in your thread stock — pick one below, or add this colour in Settings.
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground">&rarr;</span>
                            <span
                              className="size-3 shrink-0 rounded-full border border-black/15"
                              style={{ background: (r.options.find((o) => o.code === (picks[r.srcHex] ?? r.thread.code)) ?? r.thread).hex }}
                            />
                            <select
                              value={picks[r.srcHex] ?? r.thread.code}
                              onChange={(e) => chooseThread(r, e.target.value)}
                              className="eg-select h-7 min-w-0 flex-1 rounded-md border border-border bg-card px-1.5 text-[11px]"
                              title="Choose the cone for this colour"
                            >
                              {r.options.map((o, i) => (
                                <option key={o.code} value={o.code}>
                                  {o.code} · {o.name}{i === 0 ? " (closest)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="relative size-8 shrink-0 self-start rounded border border-border bg-muted" title="Position in the design">
                          <span className="absolute rounded-[2px] bg-primary/70"
                            style={{ left: `${r.box.x}%`, top: `${r.box.y}%`, width: `${r.box.w}%`, height: `${r.box.h}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.design_src} alt="Customer file" className="size-14 shrink-0 rounded-md border border-border object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground">Customer&apos;s file</div>
              {item.personalization && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">“{item.personalization}”</div>}
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
              <UploadSimple size={15} weight="bold" /> {designUrl ? "Replace" : "Upload"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => readImageFile(e.target.files?.[0], (u) => { setErr(null); setDesignUrl(u); setPos(DEFAULT_POS) }, setErr)} />
            </label>
            <Button variant="outline" size="sm" onClick={() => setLibOpen(true)}>
              <FolderOpen size={15} weight="bold" /> From library
            </Button>
            {designUrl && <span className="text-xs text-muted-foreground">Drag · corner resizes · top rotates</span>}
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !designUrl}>{saving ? <CircleNotch size={15} className="animate-spin" /> : "Save design"}</Button>
          </div>
        </div>
        <LibraryPickerDialog open={libOpen} onOpenChange={setLibOpen} onPick={(u) => { setErr(null); setDesignUrl(u); setPos(DEFAULT_POS) }} />
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
