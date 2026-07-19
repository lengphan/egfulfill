"use client"

import { useState } from "react"
import { UploadSimple, Storefront, CircleNotch } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DesignStage, DEFAULT_POS, readImageFile, type Pos } from "@/components/app/design-canvas"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { saveDesignLibrary } from "@/lib/api"

// Downscale a data-URL image to a small JPEG thumbnail (data URLs never taint the canvas).
function downscale(dataUrl: string, max = 320): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
      if (!w || !h) { resolve(dataUrl); return }
      const scale = Math.min(1, max / Math.max(w, h))
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale))
      const c = document.createElement("canvas"); c.width = cw; c.height = ch
      const ctx = c.getContext("2d")
      if (!ctx) { resolve(dataUrl); return }
      ctx.drawImage(img, 0, 0, cw, ch)
      try { resolve(c.toDataURL("image/jpeg", 0.82)) } catch { resolve(dataUrl) }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// Create a reusable design: choose a blank mockup, place artwork, save to the library.
export function DesignStudioDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved?: () => void }) {
  const [mockup, setMockup] = useState("")
  const [designUrl, setDesignUrl] = useState("")
  const [pos, setPos] = useState<Pos>(DEFAULT_POS)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reset = () => { setMockup(""); setDesignUrl(""); setPos(DEFAULT_POS); setName(""); setErr(null) }

  const save = async () => {
    if (!designUrl) { setErr("Upload your artwork first."); return }
    setSaving(true); setErr(null)
    try {
      const thumb = await downscale(designUrl, 320)
      const r = await saveDesignLibrary({ name: name.trim() || "Untitled design", data: designUrl, thumb })
      if (r.error) throw new Error(r.error)
      reset(); onSaved?.(); onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the design.")
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New design</DialogTitle></DialogHeader>

        <div className="mx-auto w-full max-w-sm">
          <DesignStage className="w-full" mockup={mockup} designUrl={designUrl} pos={pos} setPos={setPos} onRemove={() => setDesignUrl("")} />
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <Storefront size={14} weight="bold" /> {mockup ? "Change blank" : "Pick a blank"}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
              <UploadSimple size={15} weight="bold" /> {designUrl ? "Replace artwork" : "Upload artwork"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => readImageFile(e.target.files?.[0], (u) => { setErr(null); setDesignUrl(u); setPos(DEFAULT_POS) }, setErr)} />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Design name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retro Sunset" />
          </label>

          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !designUrl}>{saving ? <CircleNotch size={15} className="animate-spin" /> : "Save to library"}</Button>
          </div>
        </div>

        <ProductPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={(p: PickedProduct) => setMockup(p.img || "")}
        />
      </DialogContent>
    </Dialog>
  )
}
