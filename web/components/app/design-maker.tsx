"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Storefront, UploadSimple, FolderOpen, TextT, Trash, Image as ImageIcon, CircleNotch, Export, FloppyDisk } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DesignStage, DEFAULT_POS, readImageFile, type Pos, type TextLayer } from "@/components/app/design-canvas"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { saveDesignLibrary, getCatalogProducts, type CatalogProduct } from "@/lib/api"
import { printZoneOf, BASE_PRINT_IN } from "@/lib/print-zone"
import { PublishProductDialog, type PublishPrefill } from "@/components/app/publish-product-dialog"

const mockupOf = (p: CatalogProduct) => p.img || p.image || p.hero || p.images?.[0] || (p.colorImages ? Object.values(p.colorImages).find(Boolean) || "" : "") || ""

// Composite the artwork + text layers onto a transparent square canvas → PNG data URL.
// (Only data-URL sources are drawn, so the canvas never taints.)
function composeDesign(designUrl: string, pos: Pos, texts: TextLayer[], size = 900): Promise<string> {
  return new Promise((resolve) => {
    const c = document.createElement("canvas"); c.width = size; c.height = size
    const ctx = c.getContext("2d")
    if (!ctx) { resolve(designUrl); return }
    const drawTexts = () => {
      for (const t of texts) {
        const px = (t.size / 100) * size
        ctx.save()
        ctx.translate((t.x / 100) * size, (t.y / 100) * size)
        ctx.rotate((t.r * Math.PI) / 180)
        ctx.font = `${t.bold ? 800 : 600} ${px}px Inter, system-ui, sans-serif`
        ctx.fillStyle = t.color
        ctx.textAlign = "center"; ctx.textBaseline = "middle"
        ctx.fillText(t.text || "", 0, 0)
        ctx.restore()
      }
      try { resolve(c.toDataURL("image/png")) } catch { resolve(designUrl) }
    }
    if (!designUrl) { drawTexts(); return }
    const img = new Image()
    img.onload = () => {
      const w = (pos.w / 100) * size
      const h = w * ((img.naturalHeight || 1) / (img.naturalWidth || 1))
      ctx.save()
      ctx.translate((pos.x / 100) * size, (pos.y / 100) * size)
      ctx.rotate((pos.r * Math.PI) / 180)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
      drawTexts()
    }
    img.onerror = () => drawTexts()
    img.src = designUrl
  })
}

const rid = () => "t" + Math.random().toString(36).slice(2, 8)

export function DesignMaker() {
  const router = useRouter()
  const productParam = useSearchParams().get("product")
  const [mockup, setMockup] = useState("")
  // Kept alongside the mockup so the printable zone can be resolved from the product's
  // own printAreas (falling back to its garment type).
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  const [paW, setPaW] = useState(String(BASE_PRINT_IN.w))
  const [paH, setPaH] = useState(String(BASE_PRINT_IN.h))
  const [dragOver, setDragOver] = useState(false)
  // Built when Publish opens: the composed design becomes the primary photo and the
  // blank already picked here carries over, so the dialog opens ready rather than blank.
  const [pubPrefill, setPubPrefill] = useState<PublishPrefill | null>(null)
  // The full catalog, so a product picked from the dialog (which hands back a flattened
  // shape) can be resolved to its catalog row for the print zone.
  const catalogRef = useRef<CatalogProduct[]>([])
  const [designUrl, setDesignUrl] = useState("")
  const [pos, setPos] = useState<Pos>(DEFAULT_POS)
  const [texts, setTexts] = useState<TextLayer[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [pubOpen, setPubOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null)

  // Load the catalog once. Opened from a product ("Start designing") → preload that
  // product's mockup as the blank.
  useEffect(() => {
    const id = setTimeout(() => {
      getCatalogProducts()
        .then((rows) => {
          catalogRef.current = rows ?? []
          if (!productParam) return
          const p = catalogRef.current.find((x) => String(x.id) === productParam || String(x.sku) === productParam)
          if (p) { setMockup(mockupOf(p)); setProduct(p) }
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [productParam])

  // The picker returns a flattened PickedProduct; the zone needs the catalog row, so
  // look it back up by SKU.
  const catalogFor = (sku: string): CatalogProduct | null =>
    catalogRef.current.find((x) => String(x.sku ?? "") === sku) ?? null

  const updateText = (id: string, patch: Partial<TextLayer>) =>
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const addText = () => {
    const t: TextLayer = { id: rid(), text: "Your text", x: 50, y: 70, size: 9, r: 0, color: "#111827", bold: true }
    setTexts((prev) => [...prev, t]); setSelected(t.id)
  }
  const removeText = (id: string) => { setTexts((prev) => prev.filter((t) => t.id !== id)); setSelected(null) }
  const selText = texts.find((t) => t.id === selected)

  const saveToLibrary = async () => {
    if (!designUrl && texts.length === 0) { setMsg({ tone: "err", text: "Add artwork or text first." }); return }
    setSaving(true); setMsg(null)
    try {
      const composed = await composeDesign(designUrl, pos, texts, 640)
      const r = await saveDesignLibrary({ name: name.trim() || "Untitled design", data: composed, thumb: composed })
      if (r.error) throw new Error(r.error)
      setMsg({ tone: "ok", text: "Saved to your library." })
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Couldn't save." })
    } finally { setSaving(false) }
  }

  return (
    <div className="flex h-[calc(100svh-7rem)] flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/design")} className="text-muted-foreground"><ArrowLeft size={16} weight="bold" /> Design Lab</Button>
        <h1 className="font-display text-xl font-semibold tracking-tight">Design maker</h1>
        {msg && <span className={"ml-2 text-sm " + (msg.tone === "ok" ? "text-emerald-600" : "text-destructive")}>{msg.text}</span>}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Left: sources + layers */}
        <aside className="hidden w-60 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-3 lg:flex">
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Blank</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setPickerOpen(true)}><Storefront size={15} weight="bold" /> {mockup ? "Change blank" : "Pick a blank"}</Button>
          </div>
          {/* Print area — the printable rectangle scales against a 12x16 base, matching
              what production actually trims to. */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Print area (in)</div>
            <div className="flex items-center gap-1.5">
              <Input value={paW} onChange={(e) => setPaW(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-8 text-xs" aria-label="Print area width in inches" />
              <span className="text-xs text-muted-foreground">x</span>
              <Input value={paH} onChange={(e) => setPaH(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-8 text-xs" aria-label="Print area height in inches" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Artwork</div>
            <label className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
              <UploadSimple size={15} weight="bold" /> Upload
              <input type="file" accept="image/*" className="hidden" onChange={(e) => readImageFile(e.target.files?.[0], (u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }, (m) => setMsg({ tone: "err", text: m }))} />
            </label>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setLibOpen(true)}><FolderOpen size={15} weight="bold" /> From library</Button>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Text</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={addText}><TextT size={15} weight="bold" /> Add text</Button>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Layers</div>
            {designUrl && (
              <button onClick={() => setSelected("image")} className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " + (selected === "image" ? "bg-primary/10 text-primary" : "hover:bg-accent")}><ImageIcon size={14} weight="duotone" /> Artwork</button>
            )}
            {texts.map((t) => (
              <button key={t.id} onClick={() => setSelected(t.id)} className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " + (selected === t.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
                <TextT size={14} /> <span className="truncate">{t.text || "Text"}</span>
              </button>
            ))}
            {!designUrl && texts.length === 0 && <div className="px-2 text-xs text-muted-foreground">Add artwork or text to start.</div>}
          </div>
        </aside>

        {/* Center: canvas */}
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-2xl border border-border bg-muted/20 p-4">
          <div className="w-full max-w-lg">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false)
                readImageFile(e.dataTransfer.files?.[0], (u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }, (m) => setMsg({ tone: "err", text: m }))
              }}
              className={"relative w-full rounded-xl transition-shadow " + (dragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "")}
            >
              <DesignStage
                mockup={mockup} designUrl={designUrl} pos={pos} setPos={setPos}
                onRemove={() => setDesignUrl("")} texts={texts} updateText={updateText}
                selected={selected} onSelect={setSelected}
                printZone={printZoneOf(product, "front", { w: Number(paW) || BASE_PRINT_IN.w, h: Number(paH) || BASE_PRINT_IN.h })}
                printLabel={`${Number(paW) || BASE_PRINT_IN.w}" x ${Number(paH) || BASE_PRINT_IN.h}" print area`}
              />
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/10 text-sm font-medium text-primary">
                  Drop artwork to place it
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: properties + actions */}
        <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-4 lg:flex">
          {selText ? (
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Text</div>
              <Input value={selText.text} onChange={(e) => updateText(selText.id, { text: e.target.value })} placeholder="Your text" />
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Size</span>
                <input type="range" min={3} max={24} value={selText.size} onChange={(e) => updateText(selText.id, { size: Number(e.target.value) })} className="flex-1" />
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">Color
                  <input type="color" value={selText.color} onChange={(e) => updateText(selText.id, { color: e.target.value })} className="size-7 rounded border border-border" />
                </label>
                <label className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input type="checkbox" checked={!!selText.bold} onChange={(e) => updateText(selText.id, { bold: e.target.checked })} /> Bold
                </label>
              </div>
              <Button variant="outline" size="sm" onClick={() => removeText(selText.id)} className="text-red-600 hover:text-red-700"><Trash size={14} weight="bold" /> Delete text</Button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Select a layer to edit it, or add artwork/text from the left.</div>
          )}

          <div className="mt-auto space-y-2 border-t border-border pt-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Design name" />
            <Button variant="outline" className="w-full" onClick={saveToLibrary} disabled={saving}>
              {saving ? <CircleNotch size={15} className="animate-spin" /> : <><FloppyDisk size={15} weight="bold" /> Save to library</>}
            </Button>
            <Button
              className="w-full"
              onClick={async () => {
                const composed = await composeDesign(designUrl, pos, texts, 1200)
                setPubPrefill({ title: name, images: composed ? [composed] : [], blank: product })
                setPubOpen(true)
              }}
              disabled={!designUrl && texts.length === 0}
            >
              <Export size={15} weight="bold" /> Publish product
            </Button>
          </div>
        </aside>
      </div>

      <ProductPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={(p: PickedProduct) => { setMockup(p.img || ""); setProduct(catalogFor(p.sku)) }} />
      <LibraryPickerDialog open={libOpen} onOpenChange={setLibOpen} onPick={(u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }} />
      <PublishProductDialog
        open={pubOpen}
        onOpenChange={setPubOpen}
        prefill={pubPrefill}
        title="Publish product"
      />
    </div>
  )
}
