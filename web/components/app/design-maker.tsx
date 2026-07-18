"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Storefront, UploadSimple, FolderOpen, TextT, Trash, Image as ImageIcon, CircleNotch, Export, FloppyDisk } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DesignStage, DEFAULT_POS, readImageFile, type Pos, type TextLayer } from "@/components/app/design-canvas"
import { ProductPickerDialog, type PickedProduct } from "@/components/app/product-picker-dialog"
import { LibraryPickerDialog } from "@/components/app/library-picker-dialog"
import { saveDesignLibrary, publishEtsy, getSpydeckTrending, getCatalogProducts, type CatalogProduct } from "@/lib/api"

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

  // Opened from a product ("Design this") → preload that product's mockup as the blank.
  useEffect(() => {
    if (!productParam) return
    const id = setTimeout(() => {
      getCatalogProducts()
        .then((rows) => {
          const p = (rows ?? []).find((x) => String(x.id) === productParam || String(x.sku) === productParam)
          if (p) setMockup(mockupOf(p))
        })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [productParam])

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
            <DesignStage mockup={mockup} designUrl={designUrl} pos={pos} setPos={setPos} onRemove={() => setDesignUrl("")} texts={texts} updateText={updateText} selected={selected} onSelect={setSelected} />
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
            <Button className="w-full" onClick={() => setPubOpen(true)} disabled={!designUrl && texts.length === 0}>
              <Export size={15} weight="bold" /> Publish to Etsy
            </Button>
          </div>
        </aside>
      </div>

      <ProductPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={(p: PickedProduct) => setMockup(p.img || "")} />
      <LibraryPickerDialog open={libOpen} onOpenChange={setLibOpen} onPick={(u) => { setDesignUrl(u); setPos(DEFAULT_POS); setSelected("image") }} />
      <PublishDialog open={pubOpen} onOpenChange={setPubOpen} getImage={() => composeDesign(designUrl, pos, texts, 1200)} defaultTitle={name} />
    </div>
  )
}

// Channels that can accept a NEW product. Etsy is the only one today — Shopify has
// connect + order sync but no product-create route, and TikTok is connect-only. Keep the
// list here so adding a channel is a one-line change plus its publish fn, and so the UI
// never offers a destination that can't actually receive a product.
const PUBLISH_CHANNELS = [{ id: "etsy", label: "Etsy", blurb: "Creates a draft listing you review before going live." }] as const

const MAX_TAGS = 13
// Mirrors the server's sanitizer (etsy.js): Etsy rejects the whole listing over a bad
// tag, so keep both ends in step.
const cleanTag = (raw: string) => raw.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 20)

// Publish dialog: destination · images · details · tags. Built channel-shaped rather than
// Etsy-hardcoded so a second channel slots in without a rewrite.
function PublishDialog({ open, onOpenChange, getImage, defaultTitle }: { open: boolean; onOpenChange: (v: boolean) => void; getImage: () => Promise<string>; defaultTitle?: string }) {
  const [channel, setChannel] = useState<string>(PUBLISH_CHANNELS[0].id)
  const [title, setTitle] = useState(defaultTitle ?? "")
  const [desc, setDesc] = useState("")
  const [price, setPrice] = useState("")
  const [qty, setQty] = useState("999")
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")
  const [suggested, setSuggested] = useState<string[]>([])
  // images[0] is the listing's primary photo. Seeded with the composed mockup, but the
  // seller can add more (the API has always accepted an images[] array — the old dialog
  // just never sent one) and promote any of them.
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const didLoad = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || didLoad.current) return
    const id = setTimeout(() => {
      didLoad.current = true
      // Suggestions are a bonus, not the only way in — SpyDeck is plan-gated, so this
      // returns nothing for Starter sellers. The free-text input below is the real path.
      getSpydeckTrending().then((r) => setSuggested((r.keywords ?? []).slice(0, 12))).catch(() => {})
      getImage().then((img) => img && setImages((prev) => (prev.length ? prev : [img]))).catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [open, getImage])

  const addTag = (raw: string) => {
    const t = cleanTag(raw)
    if (!t) return
    setTags((prev) => (prev.some((x) => x.toLowerCase() === t.toLowerCase()) || prev.length >= MAX_TAGS ? prev : [...prev, t]))
    setTagDraft("")
  }
  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t))
  const toggleTag = (t: string) =>
    tags.some((x) => x.toLowerCase() === t.toLowerCase()) ? removeTag(t) : addTag(t)

  const addImages = (files: FileList | null) => {
    for (const f of Array.from(files ?? []).slice(0, 10)) {
      readImageFile(f, (url) => setImages((prev) => (prev.length >= 10 ? prev : [...prev, url])), (m) => setResult({ ok: false, text: m }))
    }
  }
  const makePrimary = (i: number) => setImages((prev) => [prev[i], ...prev.filter((_, x) => x !== i)])
  const removeImage = (i: number) => setImages((prev) => prev.filter((_, x) => x !== i))

  const publish = async () => {
    if (!title.trim() || !(Number(price) > 0)) { setResult({ ok: false, text: "A title and a price are required." }); return }
    setBusy(true); setResult(null)
    try {
      const imgs = images.length ? images : [await getImage()]
      const r = await publishEtsy({
        title: title.trim(), description: desc.trim() || title.trim(),
        price: Number(price), quantity: Number(qty) || 999,
        image: imgs[0], images: imgs, tags,
      })
      if (r.error) throw new Error(r.error)
      setResult({ ok: true, text: "Published as a draft listing", url: r.url })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Publish failed." })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Publish product</DialogTitle></DialogHeader>
        {result?.ok ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="font-semibold text-emerald-600">{result.text}</div>
            {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">View the listing →</a>}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            {/* Destination */}
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Publish to</div>
              <div className="flex flex-wrap gap-2">
                {PUBLISH_CHANNELS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setChannel(c.id)}
                    className={
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors " +
                      (channel === c.id ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40")
                    }
                  >
                    <Storefront size={15} weight="bold" /> {c.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {PUBLISH_CHANNELS.find((c) => c.id === channel)?.blurb}
              </p>
            </div>

            {/* Photos — first one is the listing's primary image. */}
            <div className="space-y-1.5">
              <div className="text-sm font-medium">
                Photos <span className="text-muted-foreground">({images.length}/10)</span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {images.map((src, i) => (
                  <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                    {i === 0 && (
                      <span className="absolute inset-x-0 bottom-0 bg-primary/90 py-0.5 text-center text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
                        Primary
                      </span>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      {i !== 0 && (
                        <button onClick={() => makePrimary(i)} title="Make primary" className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                          Primary
                        </button>
                      )}
                      <button onClick={() => removeImage(i)} title="Remove" className="rounded bg-white/90 p-1 text-black">
                        <Trash size={11} weight="bold" />
                      </button>
                    </div>
                  </div>
                ))}
                {images.length < 10 && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <UploadSimple size={16} weight="bold" />
                    <span className="text-[10px] font-medium">Add</span>
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = "" }} />
            </div>

            <label className="flex flex-col gap-1"><span className="text-sm font-medium">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Retro Sunset Comfort Colors Tee" /></label>
            <label className="flex flex-col gap-1"><span className="text-sm font-medium">Description</span>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Describe the product…" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
            </label>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1"><span className="text-sm font-medium">Price ($)</span><Input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="24.00" inputMode="decimal" /></label>
              <label className="flex flex-1 flex-col gap-1"><span className="text-sm font-medium">Quantity</span><Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" /></label>
            </div>

            {/* Tags. Free text is the primary path — suggestions only appear for plans
                that include SpyDeck, and this section used to render as a bare label
                with no way to type one. */}
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Tags <span className="text-muted-foreground">({tags.length}/{MAX_TAGS})</span></div>
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft) }
                  else if (e.key === "Backspace" && !tagDraft && tags.length) removeTag(tags[tags.length - 1])
                }}
                onBlur={() => addTag(tagDraft)}
                disabled={tags.length >= MAX_TAGS}
                placeholder={tags.length >= MAX_TAGS ? "13 tags is Etsy's maximum" : "Type a tag, press Enter"}
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <button key={t} onClick={() => removeTag(t)} title="Remove tag" className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                      {t} ✕
                    </button>
                  ))}
                </div>
              )}
              {suggested.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] text-muted-foreground">Trending suggestions — tap to add</div>
                  <div className="flex flex-wrap gap-1">
                    {suggested.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())).map((s) => (
                      <button key={s} onClick={() => toggleTag(s)} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary">{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {result && !result.ok && <div className="text-sm text-destructive">{result.text}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={publish} disabled={busy}>{busy ? <CircleNotch size={15} className="animate-spin" /> : "Publish"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Creates a draft in your connected Etsy shop, reusing an existing listing&apos;s category &amp; shipping profile. Connect a shop in Stores first.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
