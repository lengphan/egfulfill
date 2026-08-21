"use client"

import { useEffect, useRef, useState } from "react"
import { UploadSimple, X, CircleNotch, CheckSquare, Square, Plus } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readImageFile } from "@/components/app/design-canvas"
import { publishEtsy, type EtsyListing } from "@/lib/api"
import { prettyColorName } from "@/lib/color-name"

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
// Sensible blank defaults so colors/sizes are pre-filled — the seller trims to taste.
const DEFAULT_COLORS = ["Black", "White", "Navy", "Sand", "Heather Grey"]

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
  const [colors, setColors] = useState<string[]>([])
  const [colorInput, setColorInput] = useState("")
  const [sizes, setSizes] = useState<string[]>([])
  const [sizePrices, setSizePrices] = useState<Record<string, string>>({}) // per-size variant price
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const loaded = useRef<number | null>(null)

  useEffect(() => {
    if (!open || !listing || loaded.current === listing.listing_id) return
    loaded.current = listing.listing_id
    const base = listing.price != null ? String(listing.price) : ""
    const id = setTimeout(() => {
      setTitle(listing.title || "")
      setDesc(listing.description || "")
      setPrice(base)
      setTags((listing.tags ?? []).slice(0, 13))
      setImgs((listing.images && listing.images.length ? listing.images : listing.image ? [listing.image] : []).filter(Boolean).slice(0, 10) as string[])
      setColors([...DEFAULT_COLORS])        // auto-filled
      setSizes([...COMMON_SIZES])           // auto-filled (all)
      setSizePrices(Object.fromEntries(COMMON_SIZES.map((s) => [s, base])))
      setColorInput("")
      setResult(null)
    }, 0)
    return () => clearTimeout(id)
  }, [open, listing])

  const toggleTag = (t: string) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length < 13 ? [...p, t] : p))
  const toggleSize = (s: string) => setSizes((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))
  const addColor = () => {
    const v = colorInput.trim()
    if (!v) return
    setColors((p) => (p.some((c) => c.toLowerCase() === v.toLowerCase()) ? p : [...p, v]))
    setColorInput("")
  }
  const removeColor = (c: string) => setColors((p) => p.filter((x) => x !== c))
  const setSizePrice = (s: string, v: string) => setSizePrices((p) => ({ ...p, [s]: v.replace(/[^0-9.]/g, "") }))
  // Keep the base price editable; unset per-size prices fall back to it.
  const applyBaseToAll = () => setSizePrices(Object.fromEntries(COMMON_SIZES.map((s) => [s, price])))

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
      // Fold the chosen blank colors + per-size variant prices into the description (true
      // Etsy variations need a separate API — this keeps the full spec visible on the draft).
      const variantLines = sizes.map((s) => {
        const p = (sizePrices[s] || price).trim()
        return `- ${s}: $${Number(p || price).toFixed(2)}`
      })
      const extra = [
        colors.length ? `Colors: ${colors.join(", ")}` : "",
        variantLines.length ? `Sizes & pricing:\n${variantLines.join("\n")}` : "",
      ].filter(Boolean).join("\n\n")
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
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Make product</DialogTitle>
        </DialogHeader>

        {result?.ok ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <div className="font-semibold text-success">{result.text}</div>
            {result.url && <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">Open the draft on Etsy →</a>}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <>
            {/* Scrollable body — two columns on desktop */}
            <div className="grid flex-1 gap-5 overflow-y-auto px-6 py-5 md:grid-cols-2">
              {/* LEFT: images + copy */}
              <div className="space-y-4">
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
                        <img src={u} alt="" className="size-full object-cover" />
                        <button onClick={() => setImgs((p) => p.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-foreground/70 text-background"><X size={9} weight="bold" /></button>
                      </div>
                    ))}
                  </div>
                </div>

                <label className="flex flex-col gap-1"><span className="text-sm font-medium">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">Description</span>
                  <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
                </label>

                {/* Tags */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Tags ({tags.length}/13)</span>
                  <div className="flex flex-wrap gap-1">
                    {/* TOGGLES, so they look like toggles. These were rounded-full capsules
                        that filled solid black when on — and CLAUDE.md names this case
                        outright: a pill must carry MEANING (an order stage, an HTTP method,
                        RUSH/LATE), never a role, a count, a tag or a toggle. It was two of
                        those at once. The shape is a field's now, the state is a tick, and
                        the fill is gone: nothing here is the primary action of this dialog. */}
                    {(listing.tags ?? []).slice(0, 13).map((t) => {
                      const on = tags.includes(t)
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleTag(t)}
                          aria-pressed={on}
                          className={"inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors " +
                            (on ? "border-foreground text-foreground" : "border-input text-muted-foreground hover:text-foreground")}
                        >
                          {on ? <CheckSquare size={12} weight="fill" /> : <Square size={12} />}
                          {t}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* RIGHT: pricing + variants */}
              <div className="space-y-4">
                <label className="flex flex-col gap-1"><span className="text-sm font-medium">Base price ($)</span>
                  <Input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="w-40" />
                </label>

                {/* Colors — chips, no comma typing */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Colors</span>
                    {colors.length > 0 && <button onClick={() => setColors([])} className="text-xs font-medium text-primary hover:underline">Clear</button>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {colors.map((c) => (
                      <span key={c} title={c} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
                        {prettyColorName(c)}
                        <button onClick={() => removeColor(c)} className="flex size-4 items-center justify-center rounded-full hover:bg-primary/20"><X size={9} weight="bold" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Input value={colorInput} onChange={(e) => setColorInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addColor() } }} placeholder="Add a color…" className="h-8 text-xs" />
                    <Button size="sm" variant="outline" className="h-8 shrink-0 px-2" onClick={addColor}><Plus size={13} weight="bold" /></Button>
                  </div>
                </div>

                {/* Sizes + per-size variant pricing */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Sizes &amp; variant pricing</span>
                    <div className="flex items-center gap-3 text-xs font-medium text-primary">
                      <button onClick={applyBaseToAll} className="hover:underline">Reset to base</button>
                      <button onClick={() => setSizes(sizes.length === COMMON_SIZES.length ? [] : [...COMMON_SIZES])} className="hover:underline">{sizes.length === COMMON_SIZES.length ? "Clear" : "All"}</button>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border">
                    {COMMON_SIZES.map((s, i) => {
                      const on = sizes.includes(s)
                      return (
                        <div key={s} className={"flex items-center gap-2 px-2.5 py-1.5 text-sm " + (i > 0 ? "border-t border-border " : "") + (on ? "" : "opacity-50")}>
                          <button onClick={() => toggleSize(s)} className="flex items-center gap-1.5 font-medium">
                            {on ? <CheckSquare size={15} weight="fill" className="text-primary" /> : <Square size={15} className="text-muted-foreground" />}
                            <span className="w-8">{s}</span>
                          </button>
                          <div className="ml-auto flex items-center gap-1 text-muted-foreground">
                            <span className="text-xs">$</span>
                            <Input
                              value={sizePrices[s] ?? price}
                              onChange={(e) => setSizePrice(s, e.target.value)}
                              disabled={!on}
                              inputMode="decimal"
                              className="h-7 w-20 text-right text-xs"
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-2xs text-muted-foreground">Each size is its own Etsy variant — set a different price per size, or reset them all to the base price.</p>
                </div>
              </div>
            </div>

            {/* Sticky footer — buttons pinned so card height never shifts them */}
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              {busy && progress && <span className="mr-auto text-xs text-muted-foreground">{progress}</span>}
              {result && !result.ok && <span className="mr-auto text-sm text-destructive">{result.text}</span>}
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={publish} disabled={busy}>{busy ? <CircleNotch size={15} className="animate-spin" /> : "Publish draft"}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
