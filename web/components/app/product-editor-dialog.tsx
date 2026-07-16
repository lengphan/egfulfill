"use client"

import { useEffect, useState } from "react"
import { UploadSimple, Image as ImageIcon, X } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readImageFile } from "@/components/app/design-canvas"
import { type CatalogProduct } from "@/lib/api"

const METHODS = ["DTG", "Embroidery", "Screen Print", "Sublimation", "Vinyl"]
const TYPES = ["Apparel", "Headwear", "Bags", "Drinkware", "Accessories", "Other"]
const imageOf = (p: CatalogProduct) => p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages).find(Boolean) || "" : "") || ""

const genId = (seed: number) => "PROD-" + seed.toString(36).toUpperCase()

// Create/edit one catalog product, including its mockup image (feeds the Design Maker's blanks).
export function ProductEditorDialog({
  open, onOpenChange, product, onSave, newIdSeed,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  product: CatalogProduct | null
  onSave: (p: CatalogProduct) => void
  newIdSeed: number
}) {
  const [name, setName] = useState("")
  const [type, setType] = useState("Apparel")
  const [method, setMethod] = useState("DTG")
  const [price, setPrice] = useState("")
  const [basePrice, setBasePrice] = useState("")
  const [sizes, setSizes] = useState("")
  const [colors, setColors] = useState("")
  const [status, setStatus] = useState("Active")
  const [img, setImg] = useState("")
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const p = product
    const id = setTimeout(() => {
      setName(p?.name ?? "")
      setType(p?.type ?? "Apparel")
      setMethod(p?.method ?? "DTG")
      setPrice(p?.price != null ? String(p.price) : "")
      setBasePrice(p?.basePrice != null ? String(p.basePrice) : p?.base_price != null ? String(p.base_price) : "")
      setSizes((p?.sizes ?? []).join(", "))
      setColors((p?.colorImages ? Object.keys(p.colorImages) : p?.mainColor ? [p.mainColor] : []).join(", "))
      setStatus(p?.status ?? "Active")
      setImg(p ? imageOf(p) : "")
      setErr(null)
    }, 0)
    return () => clearTimeout(id)
  }, [open, product])

  const save = () => {
    if (!name.trim()) { setErr("Give the product a name."); return }
    const sizeArr = sizes.split(",").map((s) => s.trim()).filter(Boolean)
    const colorArr = colors.split(",").map((s) => s.trim()).filter(Boolean)
    const colorImages: Record<string, string> = {}
    for (const c of colorArr) colorImages[c] = (product?.colorImages?.[c] as string) || ""
    const next: CatalogProduct = {
      ...(product ?? {}),
      id: product?.id ?? genId(newIdSeed),
      name: name.trim(),
      type, method, status,
      price: Number(price) || 0,
      basePrice: Number(basePrice) || Number(price) || 0,
      sizes: sizeArr,
      colorImages,
      mainColor: colorArr[0] || product?.mainColor,
      img, // the mockup — read first by the maker's blank picker
    }
    onSave(next)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-4">
            {/* Mockup image */}
            <label className="group relative flex size-28 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 hover:bg-accent">
              {img ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" className="size-full object-contain" />
                  <button type="button" onClick={(e) => { e.preventDefault(); setImg("") }} className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground/70 text-background"><X size={11} weight="bold" /></button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground"><ImageIcon size={22} weight="duotone" /><span className="text-[10px]">Mockup</span></div>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => readImageFile(e.target.files?.[0], setImg, setErr)} />
            </label>
            <div className="flex-1 space-y-2">
              <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Name</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Heavyweight Hoodie" className="h-9" /></label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <UploadSimple size={13} /> Click the box to upload a mockup image — it becomes the blank in the Design Maker.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Retail price ($)</span><Input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="42.00" className="h-9" inputMode="decimal" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Base cost ($)</span><Input value={basePrice} onChange={(e) => setBasePrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="18.00" className="h-9" inputMode="decimal" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Sizes (comma-sep)</span><Input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="S, M, L, XL, 2XL" className="h-9" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Colors (comma-sep)</span><Input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="Black, Navy, Sand" className="h-9" /></label>
          </div>

          <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"><option>Active</option><option>Draft</option><option>Archived</option></select>
          </label>

          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save}>{product ? "Save changes" : "Add product"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
