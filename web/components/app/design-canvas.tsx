"use client"

import { useRef, useState } from "react"
import { UploadSimple, ArrowsOutCardinal, ArrowClockwise, X, CircleNotch, Image as ImageIcon } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { postOrderDesign, type DesignPos, type OrderItem } from "@/lib/api"

type Pos = { x: number; y: number; w: number; r: number }
const DEFAULT_POS: Pos = { x: 50, y: 50, w: 45, r: 0 }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function DesignCanvasDialog({
  open,
  onOpenChange,
  orderId,
  item,
  initialDesign,
  initialPos,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderId: string
  item: OrderItem
  initialDesign?: string
  initialPos?: DesignPos | null
  onSaved?: () => void
}) {
  const [designUrl, setDesignUrl] = useState(initialDesign ?? "")
  const [pos, setPos] = useState<Pos>(initialPos ? { x: initialPos.x, y: initialPos.y, w: initialPos.w, r: initialPos.r } : DEFAULT_POS)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // Each drag session defines its own move/up handlers (locally scoped so add + remove
  // reference the exact same instances, and no self-referencing hook to trip the linter).
  const startDrag = (mode: "move" | "resize" | "rotate") => (e: React.PointerEvent) => {
    if (!stageRef.current) return
    e.preventDefault(); e.stopPropagation()
    const rect = stageRef.current.getBoundingClientRect()
    const start = { ...pos }
    const px = e.clientX, py = e.clientY
    const cx = rect.left + (start.x / 100) * rect.width
    const cy = rect.top + (start.y / 100) * rect.height
    function move(ev: PointerEvent) {
      if (mode === "move") {
        const dx = ((ev.clientX - px) / rect.width) * 100
        const dy = ((ev.clientY - py) / rect.height) * 100
        setPos((p) => ({ ...p, x: clamp(start.x + dx, 0, 100), y: clamp(start.y + dy, 0, 100) }))
      } else if (mode === "resize") {
        // Width from the pointer's distance to centre, un-rotated into the design's frame.
        const vx = ev.clientX - cx, vy = ev.clientY - cy
        const rad = (-start.r * Math.PI) / 180
        const localX = vx * Math.cos(rad) - vy * Math.sin(rad)
        setPos((p) => ({ ...p, w: clamp((2 * Math.abs(localX) / rect.width) * 100, 8, 100) }))
      } else {
        const ang = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
        setPos((p) => ({ ...p, r: Math.round(ang) }))
      }
    }
    function up() {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const takeFile = (file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) { setErr("Please choose an image (PNG/JPG/SVG)."); return }
    if (file.size > 12 * 1024 * 1024) { setErr("Artwork is over 12MB — please compress it."); return }
    const reader = new FileReader()
    reader.onload = () => { setErr(null); setDesignUrl(String(reader.result || "")); setPos(DEFAULT_POS) }
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!designUrl || !item.sku) { setErr("Upload artwork first."); return }
    setSaving(true); setErr(null)
    try {
      const r = await postOrderDesign(orderId, { sku: item.sku, data: designUrl, name: item.name, pos: { x: pos.x, y: pos.y, w: pos.w, r: pos.r } })
      if (r.error) throw new Error(r.error)
      onSaved?.()
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the design.")
    } finally {
      setSaving(false)
    }
  }

  const mockup = item.img || ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customize · {item.name || item.sku}</DialogTitle>
        </DialogHeader>

        {/* Stage */}
        <div
          ref={stageRef}
          className="relative mx-auto aspect-square w-full max-w-sm select-none overflow-hidden rounded-xl border border-border bg-muted/40"
        >
          {mockup ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mockup} alt="" className="pointer-events-none absolute inset-0 size-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40"><ImageIcon size={40} weight="duotone" /></div>
          )}

          {designUrl && (
            <div
              onPointerDown={startDrag("move")}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%`, transform: `translate(-50%,-50%) rotate(${pos.r}deg)` }}
              className="group absolute cursor-move touch-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={designUrl} alt="" className="pointer-events-none block w-full select-none" draggable={false} />
              {/* selection outline */}
              <div className="pointer-events-none absolute inset-0 rounded-sm outline outline-2 -outline-offset-1 outline-primary/70" />
              {/* rotate handle */}
              <button
                onPointerDown={startDrag("rotate")}
                className="absolute -top-7 left-1/2 flex size-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full bg-primary text-primary-foreground shadow touch-none"
                aria-label="Rotate"
              >
                <ArrowClockwise size={13} weight="bold" />
              </button>
              {/* resize handle (bottom-right) */}
              <button
                onPointerDown={startDrag("resize")}
                className="absolute -bottom-2.5 -right-2.5 flex size-6 cursor-nwse-resize items-center justify-center rounded-full bg-primary text-primary-foreground shadow touch-none"
                aria-label="Resize"
              >
                <ArrowsOutCardinal size={12} weight="bold" />
              </button>
              {/* remove */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setDesignUrl("")}
                className="absolute -right-2.5 -top-2.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow"
                aria-label="Remove artwork"
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
              <UploadSimple size={15} weight="bold" /> {designUrl ? "Replace artwork" : "Upload artwork"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => takeFile(e.target.files?.[0])} />
            </label>
            {designUrl && (
              <span className="text-xs text-muted-foreground">Drag to move · corner to resize · top handle to rotate</span>
            )}
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !designUrl}>
              {saving ? <CircleNotch size={15} className="animate-spin" /> : "Save design"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Read-only preview: render a saved design at its %-position over a mockup (any square box).
export function DesignPreview({ mockup, designUrl, pos, className }: { mockup?: string; designUrl?: string; pos?: DesignPos | null; className?: string }) {
  return (
    <div className={"relative aspect-square overflow-hidden rounded-lg bg-muted " + (className ?? "")}>
      {mockup && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mockup} alt="" className="absolute inset-0 size-full object-contain" />
      )}
      {designUrl && pos && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={designUrl}
          alt=""
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%`, transform: `translate(-50%,-50%) rotate(${pos.r}deg)` }}
          className="absolute block"
        />
      )}
    </div>
  )
}
