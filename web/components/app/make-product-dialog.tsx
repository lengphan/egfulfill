"use client"

import { useEffect, useRef, useState } from "react"
import { UploadSimple, X, CircleNotch, CheckSquare, Square } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readImageFile } from "@/components/app/design-canvas"
import { publishEtsy, type EtsyListing } from "@/lib/api"

// Etsy CDN images taint the canvas cross-origin, but our img-proxy re-serves them
// same-origin so we can read them into a data URL for re-upload to a new listing.
function urlToDataUrl(url: string): Promise<string | null> {
  const src = /^https?:\/\//i.test(url) ? `/api/etsy/img-proxy?url=${encodeURIComponent(url)}` : url
  return fetch(src)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("img fetch"))))
    .then((blob) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || "")); fr.readAsDataURL(blob) }))
    .catch(() => null)
}

const COMMON_SIZES = ["S", "M", "L", "XL", "2XL"]

// Turn a spy'd listing into YOUR OWN Etsy draft: its images + tags + a blank spec.
export function MakeProductDialog({ open, onOpenChange, listing, onPublished }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  listing: EtsyListing | null
  onPublished?: (listing: EtsyListing, url?: string) => void
}) {
  const [title, setTitle] = useState("")
  const [desc, setDesc] = useState("")
  const [price, setPrice] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [imgs, setImgs] = useState<string[]>([]) // source URLs or data URLs
  const [colors, setColors] = useState("")
  const [sizes, setSizes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const loaded = useRef<number | null>(null)

  useEffect(() => {
    if (!open || !listing || loaded.current === listing.listing_id) return
    loaded.current = listing.listing_id
    const id = setTimeout(() => {
      setTitle(listing.title || "")
      setDesc(listing.description || "")
      setPrice(listing.price != null ? String(listing.price) : "")
      setTags((listing.tags ?? []).slice(0, 13))
      setImgs((listing.images && listing.images.length ? listing.images : listing.image ? [listing.image] : []).filter(Boolean).slice(0, 10) as string[])
      setColors("")
      setSizes([])
      setResult(null)
    }, 0)
    return () => clearTimeout(id)
  }, [open, listing])

  const toggleTag = (t: string) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length < 13 ? [...p, t] : p))
  const toggleSize = (s: string) => setSizes((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))

  const publish = async () => {
    if (!title.trim() || !(Number(price) > 0)) { setResult({ ok: false, text: "A title and a price are required." }); return }
    setBusy(true); setResult(null)
    try {
      // Convert every image (URL or data) to a data URL Etsy can accept.
      setProgress("Preparing images…")
      const data: string[] = []
      for (const u of imgs) {
        const d = u.startsWith("data:") ? u : await urlToDataUrl(u)
        if (d) data.push(d)
      }
      // Fold the chosen blank colors/sizes into the description (Etsy variations need a
      // separate API — this keeps them visible on the draft for now).
      const colorList = colors.split(",").map((c) => c.trim()).filter(Boolean)
      const extra = [colorList.length ? `Colors: ${colorList.join(", ")}` : "", sizes.length ? `Sizes: ${sizes.join(", ")}` : ""].filter(Boolean).join("\n")
      const description = [desc.trim(), extra].filter(Boolean).join("\n\n")
      setProgress("Publishing draft…")
      const r = await publishEtsy({ title: title.trim(), description: description || title.trim(), price: Number(price), quantity: 999, image: data[0] || "", tags })
      if (r.error) throw new Error(r.error)
      // publishEtsy sends a single `image`; extra images are best-effort skipped here.
      setResult({ ok: true, text: "Draft created on Etsy!", url: r.url })
      if (listing) onPublished?.(listing, r.url)
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Publish failed." })
    } finally { setBusy(false); setProgress("") }
  }

  if (!listing) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Make product</DialogTitle></DialogHeader>
        {result?.ok ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="font-semibold text-emerald-600">{result.text}</div>
            {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">Open the draft on Etsy →</a>}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Images */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Images ({imgs.length})</span>
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <UploadSimple size={13} weight="bold" /> Add
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => readImageFile(e.target.files?.[0], (u) => setImgs((p) => [...p, u]), () => {})} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {imgs.map((u, i) => (
                  <div key={i} className="relative size-16 overflow-hidden rounded-lg border border-border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.startsWith("data:") ? u : u} alt="" className="size-full object-cover" />
                    <button onClick={() => setImgs((p) => p.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-foreground/70 text-background"><X size={9} weight="bold" /></button>
                  </div>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1"><span className="text-sm font-medium">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="flex flex-col gap-1"><span className="text-sm font-medium">Description</span>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
            </label>
            <label className="flex w-40 flex-col gap-1"><span className="text-sm font-medium">Price ($)</span><Input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></label>

            {/* Blank variants */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className="text-sm font-medium">Colors (comma-sep)</span><Input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="Black, Navy, Sand" /></label>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Sizes</span>
                  <button onClick={() => setSizes(sizes.length === COMMON_SIZES.length ? [] : [...COMMON_SIZES])} className="text-xs font-medium text-primary hover:underline">{sizes.length === COMMON_SIZES.length ? "Clear" : "Select all"}</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {COMMON_SIZES.map((s) => (
                    <button key={s} onClick={() => toggleSize(s)} className={"inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs " + (sizes.includes(s) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                      {sizes.includes(s) ? <CheckSquare size={11} weight="fill" /> : <Square size={11} />} {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-1">
              <span className="text-sm font-medium">Tags ({tags.length}/13)</span>
              <div className="flex flex-wrap gap-1">
                {(listing.tags ?? []).slice(0, 13).map((t) => (
                  <button key={t} onClick={() => toggleTag(t)} className={"rounded-full px-2 py-0.5 text-xs font-medium transition-colors " + (tags.includes(t) ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground")}>{t}</button>
                ))}
              </div>
            </div>

            {result && !result.ok && <div className="text-sm text-destructive">{result.text}</div>}
            <div className="flex items-center justify-end gap-2">
              {busy && progress && <span className="mr-auto text-xs text-muted-foreground">{progress}</span>}
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={publish} disabled={busy}>{busy ? <CircleNotch size={15} className="animate-spin" /> : "Publish draft"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Creates a DRAFT in your connected Etsy shop (review &amp; publish there). Reuses the listing&apos;s images &amp; tags. Full color/size variations are added on Etsy for now.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
