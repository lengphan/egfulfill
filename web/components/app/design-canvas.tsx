"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { UploadSimple, ArrowsOutCardinal, ArrowClockwise, X, CircleNotch, Image as ImageIcon, FolderOpen, ArrowSquareOut } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { postOrderDesign, postOrderThreads, type DesignPos, type OrderItem, type CatalogProduct } from "@/lib/api"
import { resolveProduct, mockupFaces } from "@/lib/variant-resolve"
import { perceptualHash } from "@/lib/phash"
import { matchThreadColors, nearestThread, hexToRgb, type Thread } from "@/lib/thread-match"
import { Eyedropper } from "@phosphor-icons/react"

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
  const sampleAt = (e: React.MouseEvent, imgEl: HTMLElement) => {
    const s = sampleRef.current, stage = stageRef.current
    if (!s || !stage) return
    const box = imgEl.getBoundingClientRect()             // centre is rotation-invariant
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2
    const stageW = stage.getBoundingClientRect().width
    const renderedW = (pos.w / 100) * stageW
    const renderedH = renderedW * (s.h / s.w)
    const rad = (-(pos.r || 0) * Math.PI) / 180
    const dx = e.clientX - cx, dy = e.clientY - cy
    const ux = dx * Math.cos(rad) - dy * Math.sin(rad)    // into the unrotated frame
    const uy = dx * Math.sin(rad) + dy * Math.cos(rad)
    const fx = ux / renderedW + 0.5, fy = uy / renderedH + 0.5
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return
    const ctx = s.canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    const px = ctx.getImageData(Math.floor(fx * s.w), Math.floor(fy * s.h), 1, 1).data
    const hx = (v: number) => ("0" + v.toString(16)).slice(-2)
    onPickColor?.(("#" + hx(px[0]) + hx(px[1]) + hx(px[2])).toUpperCase())
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
    <div ref={stageRef} onPointerDown={() => onSelect?.(null)} style={{ containerType: "size" }} className={"relative aspect-square select-none overflow-hidden rounded-xl border border-border bg-muted " + (className ?? "w-full")}>
      {/* Studio backdrop, on THEME tokens rather than the hardcoded beige it used to be.
          A white garment no longer needs a warm bed to read against — the drop-shadow
          under the mockup does that job — so the bed can just be `bg-muted` and match
          every other surface. The dot texture is gone; only the graph-paper ruling stays,
          as the technical-flat cue. Both layers sit behind the mockup, pointer-transparent. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.55),transparent_62%)] dark:bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.06),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.45] bg-[linear-gradient(to_right,rgba(0,0,0,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.05)_1px,transparent_1px)] [background-size:32px_32px] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)]" />

      {mockup ? (
        // p-[6%] lets the garment fill more of the bed than a raw object-contain, which
        // left wide dead margins around a portrait mockup.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mockup} alt="" className="pointer-events-none absolute inset-0 size-full object-contain p-[3%] drop-shadow-[0_10px_28px_rgba(0,0,0,0.16)]" />
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
  useEffect(() => {
    if (!isEmb || !designUrl) { setThreads([]); return }
    let live = true
    matchThreadColors(designUrl).then((t) => { if (live) setThreads(t) })
    return () => { live = false }
  }, [designUrl, isEmb])
  // Eyedropper: a sampled pixel → its nearest in-stock thread, appended (deduped) so the
  // operator can add a colour the auto-match missed. One pick, then the tool turns off.
  const onPickColor = (hex: string) => {
    const { r, g, b } = hexToRgb(hex)
    const t = nearestThread(r, g, b)
    if (t) setThreads((prev) => (prev.some((x) => x.code === t.code) ? prev : [...prev, t]))
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
                <button
                  type="button"
                  onClick={() => setPicking((v) => !v)}
                  title="Eyedropper — then click the design to sample a colour and add its nearest thread"
                  className={"inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors " + (picking ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}
                >
                  <Eyedropper size={13} weight="bold" /> {picking ? "Click the design…" : "Pick"}
                </button>
              )}
            </div>
            {threads.length === 0 ? (
              <div className="text-xs text-muted-foreground/70">{designUrl ? "Reading colours…" : "Upload artwork to match embroidery threads."}</div>
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
