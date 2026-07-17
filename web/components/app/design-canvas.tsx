"use client"

import { useMemo, useRef, useState } from "react"
import { UploadSimple, ArrowsOutCardinal, ArrowClockwise, X, CircleNotch, Image as ImageIcon, FolderOpen } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { postOrderDesign, type DesignPos, type OrderItem, type CatalogProduct } from "@/lib/api"
import { resolveProduct, mockupFaces } from "@/lib/variant-resolve"

export type Pos = { x: number; y: number; w: number; r: number }
export type TextLayer = { id: string; text: string; x: number; y: number; size: number; r: number; color: string; bold?: boolean }
export const DEFAULT_POS: Pos = { x: 50, y: 50, w: 45, r: 0 }
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Reusable place/size/rotate surface — used by the order customizer, the studio, and the
// full maker. Renders a mockup + a draggable image layer + optional draggable text layers.
export function DesignStage({
  mockup, designUrl, pos, setPos, onRemove, className,
  texts, updateText, selected, onSelect,
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
}) {
  const stageRef = useRef<HTMLDivElement>(null)

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
    <div ref={stageRef} onPointerDown={() => onSelect?.(null)} style={{ containerType: "size" }} className={"relative aspect-square w-full select-none overflow-hidden rounded-xl border border-border bg-[#e8e4db] dark:bg-[#221f1c] " + (className ?? "")}>
      {/* Studio backdrop: a warm-neutral bed (so a WHITE garment reads instead of
          vanishing into a white box), a soft top-centre spotlight the garment sits in,
          and a faint dot grid for the dithered texture the design system leans on. All
          behind the mockup + pointer-transparent. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.6),transparent_62%)] dark:bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.07),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.5] bg-[radial-gradient(rgba(0,0,0,0.07)_1px,transparent_1.4px)] [background-size:15px_15px] dark:bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1.4px)]" />
      {mockup ? (
        // p-[6%] lets the garment fill more of the bed than a raw object-contain, which
        // left wide dead margins around a portrait mockup.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mockup} alt="" className="pointer-events-none absolute inset-0 size-full object-contain p-[6%] drop-shadow-[0_8px_24px_rgba(0,0,0,0.12)]" />
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground/40"><ImageIcon size={40} weight="duotone" /></div>
      )}

      {designUrl && (
        <div onPointerDown={startDrag("image", "move")} style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%`, transform: `translate(-50%,-50%) rotate(${pos.r}deg)` }} className="absolute cursor-move touch-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={designUrl} alt="" className="pointer-events-none block w-full select-none" draggable={false} />
          {(selected == null || selected === "image") && handles("image")}
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
  const [err, setErr] = useState<string | null>(null)
  const [libOpen, setLibOpen] = useState(false)

  const save = async () => {
    if (!designUrl || !item.sku) { setErr("Upload artwork first."); return }
    setSaving(true); setErr(null)
    try {
      const r = await postOrderDesign(orderId, { sku: item.sku, data: designUrl, name: item.name, pos: { x: pos.x, y: pos.y, w: pos.w, r: pos.r } })
      if (r.error) throw new Error(r.error)
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
        <div className="mx-auto w-full"><DesignStage mockup={activeMockup} designUrl={designUrl} pos={pos} setPos={setPos} onRemove={() => setDesignUrl("")} /></div>
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
