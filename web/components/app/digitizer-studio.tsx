"use client"

import { useCallback, useEffect, useState } from "react"
// NB: do NOT import phosphor's `Image` — it would shadow the DOM `new Image()` used in
// toDataUrl below. Use ImageSquare for the mode toggle instead.
import { Needle, ImageSquare, PencilSimple, ClockCounterClockwise, MagnifyingGlass, CircleNotch, Eye, DownloadSimple, Warning, ArrowsClockwise, UploadSimple, X, ArrowRight, PaperPlaneTilt, Check } from "@phosphor-icons/react"
import { canvasReadableSrc, nearestThread, matchQuality } from "@/lib/thread-match"
import {
  getOrderUploads, getDesignLibrary, getDesignLibraryItem, getThreadPalette,
  wilcomPreview, wilcomDigitize, getWilcomGenerations, createDesignCard,
  getWilcomAlphabets, wilcomCombinePreview, wilcomCombine,
  type OrderUpload, type LibraryDesign, type ThreadColor, type WilcomResult, type WilcomGeneration,
} from "@/lib/api"

type Tab = "create" | "library" | "history"
type Source = "order" | "library"

// Load an image (remote → same-origin proxy so the canvas isn't tainted; data URL → direct),
// downscale it, and return a data URL under EWA's 2MB auto-digitize cap.
function toDataUrl(src: string, maxEdge = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!src) { reject(new Error("No image")); return }
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement("canvas"); c.width = w; c.height = h
      const ctx = c.getContext("2d")
      if (!ctx) { reject(new Error("Canvas unavailable")); return }
      ctx.drawImage(img, 0, 0, w, h)
      try { resolve(c.toDataURL("image/jpeg", quality)) } catch { reject(new Error("Couldn't read the artwork (cross-origin)")) }
    }
    img.onerror = () => reject(new Error("Couldn't load the artwork"))
    img.src = src.startsWith("data:") ? src : canvasReadableSrc(src)
  })
}

function download(name: string, dataUrl: string) {
  const a = document.createElement("a"); a.href = dataUrl; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
}
function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("read failed")); fr.readAsDataURL(file) })
}
const fmtDate = (s?: string) => { if (!s) return ""; const d = new Date(s); return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }

// Uniform square thumbnail with a graceful fallback — a failed load must not resize the card.
function Thumb({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const [bad, setBad] = useState(false)
  if (bad || !src) return <div className={"flex items-center justify-center bg-muted text-muted-foreground/30 " + (className ?? "")}><Needle size={24} weight="duotone" /></div>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt ?? ""} className={className} onError={() => setBad(true)} />
}

// A unifying shape over the three artwork sources.
type ArtItem = { key: string; name: string; ref?: string; source: Source | "upload"; thumb: string; getImage: () => Promise<string> }
const orderItem = (u: OrderUpload): ArtItem => ({ key: u.url, name: u.name || "Untitled", ref: u.orderRef, source: "order", thumb: canvasReadableSrc(u.url), getImage: () => toDataUrl(u.url) })
const libItem = (d: LibraryDesign): ArtItem => ({
  key: `L${d.id}`, name: d.name || "Untitled", ref: `DSN-${d.id}`, source: "library", thumb: d.thumb || "",
  getImage: async () => { try { const full = await getDesignLibraryItem(d.id); return await toDataUrl(full.data || d.thumb || "") } catch { return toDataUrl(d.thumb || "") } },
})

// Confidence gate — after a Preview, decide whether auto-digitize is likely to disappoint, so
// the modal can nudge toward a human digitizer. Heuristic, deliberately conservative: many
// colours (photographic/detailed art muddles), a very high stitch count (too dense/complex), or
// most colours not matching the thread library. Returns a reason string, or null when it looks fine.
function complexityFlag(res: WilcomResult, pal?: ThreadColor[]): string | null {
  const colours = res.colours ?? 0
  const stitches = res.stitches ?? 0
  const threads = res.threads ?? []
  let poor = 0
  for (const t of threads) { const m = nearestThread(t.r, t.g, t.b, pal); if (!m || matchQuality(t.r, t.g, t.b, m).poor) poor++ }
  const poorRatio = threads.length ? poor / threads.length : 0
  if (colours >= 8) return "lots of colours — auto-digitize tends to muddy detailed, multi-colour art"
  if (stitches >= 30000) return "very high stitch count — likely too dense or complex for a clean auto result"
  if (poorRatio >= 0.4) return "several colours don't map well to your thread library"
  return null
}

export function DigitizerStudio() {
  const [tab, setTab] = useState<Tab>("create")
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Needle size={22} weight="duotone" /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Digitizer</h1>
          <p className="text-sm text-muted-foreground">Turn artwork into an embroidery preview and a machine file — or build one from scratch.</p>
        </div>
      </div>

      <div className="flex w-fit rounded-full border border-border p-0.5">
        {([{ id: "create", label: "Create", icon: PencilSimple }, { id: "library", label: "Library", icon: ImageSquare }, { id: "history", label: "History", icon: ClockCounterClockwise }] as const).map((t) => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={"eg-tap inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon size={15} weight={tab === t.id ? "fill" : "regular"} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === "create" ? <CreateTab /> : tab === "library" ? <BrowseTab /> : <HistoryTab />}
    </div>
  )
}

// ── Browse: order artwork + library + direct upload ─────────────────────────────
function BrowseTab() {
  const [source, setSource] = useState<Source>("order")
  const [orders, setOrders] = useState<OrderUpload[] | null>(null)
  const [lib, setLib] = useState<LibraryDesign[] | null>(null)
  const [palette, setPalette] = useState<ThreadColor[]>([])
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<ArtItem | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [over, setOver] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => {
      getThreadPalette().then((p) => setPalette(Array.isArray(p) ? p : [])).catch(() => {})
      getOrderUploads().then((r) => setOrders(r.images ?? [])).catch(() => setOrders([]))
      getDesignLibrary().then((r) => setLib(r ?? [])).catch(() => setLib([]))
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const takeFile = async (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return
    const dataUrl = await readFile(file)
    setOpen({ key: `U${file.name}`, name: file.name.replace(/\.[^.]+$/, ""), source: "upload", thumb: dataUrl, getImage: () => toDataUrl(dataUrl) })
  }

  const items: ArtItem[] = source === "order" ? (orders ?? []).map(orderItem) : (lib ?? []).map(libItem)
  const loading = source === "order" ? orders === null : lib === null
  const list = items.filter((i) => !q || `${i.name} ${i.ref ?? ""}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      {/* Direct upload — lives in this tab, no separate nav. */}
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void takeFile(e.dataTransfer.files?.[0]) }}
        className={"flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed py-6 text-center transition-colors " + (over ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/50")}
      >
        <UploadSimple size={22} className="text-muted-foreground" />
        <div className="text-sm font-medium">Drop an image to digitize</div>
        <div className="text-xs text-muted-foreground">or click to choose — PNG / JPG, auto-downscaled to fit</div>
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { void takeFile(e.target.files?.[0]); e.currentTarget.value = "" }} />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-full border border-border p-0.5">
          {([{ id: "order", label: "Order artwork" }, { id: "library", label: "Library" }] as const).map((s) => (
            <button key={s.id} onClick={() => setSource(s.id)} className={"eg-tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (source === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{s.label}</button>
          ))}
        </div>
        <div className="relative max-w-xs flex-1">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40" />
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-muted" />)}</div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">{q ? `Nothing matches “${q}”.` : source === "order" ? "No buyer artwork on your orders yet." : "No designs in your library yet."}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((it) => (
              <button key={it.key} onClick={() => setOpen(it)} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-shadow hover:shadow">
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <Thumb src={it.thumb} alt={it.name} className="absolute inset-0 size-full object-cover" />
                  {done.has(it.key) && <span className="absolute left-1.5 top-1.5 z-10 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">Generated</span>}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  {it.ref && <div className="truncate font-mono text-[11px] text-muted-foreground">{it.ref}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && <DigitizeModal item={open} palette={palette} onClose={() => setOpen(null)} onGenerated={() => setDone((p) => new Set(p).add(open.key))} />}
    </>
  )
}

// ── The detail modal: original ↔ big embroidery preview + thread matching ────────
function DigitizeModal({ item, palette, onClose, onGenerated }: { item: ArtItem; palette: ThreadColor[]; onClose: () => void; onGenerated: () => void }) {
  const [status, setStatus] = useState<"idle" | "previewing" | "generating">("idle")
  const [res, setRes] = useState<WilcomResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)
  const [routed, setRouted] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const run = async (design: boolean) => {
    setStatus(design ? "generating" : "previewing"); setErr(null)
    try {
      const image = await item.getImage()
      const r = design
        ? await wilcomDigitize({ image, filename: item.name, name: item.name, orderRef: item.ref, source: item.source })
        : await wilcomPreview({ image, filename: item.name })
      if (!r.ok) throw new Error(r.error || "EWA rejected the request")
      setRes(r); if (design && r.machineFile) onGenerated()
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed") } finally { setStatus("idle") }
  }
  // EXTRA, isolated route: hand the ORIGINAL artwork (never the auto-preview) to the Designer
  // board for a human to digitize when auto-digitize won't cut it. Uses the SAME createDesignCard
  // endpoint the board's own drag-drop uses — additive only, so it never touches the main
  // order→board flow and deleting the Digitizer removes it cleanly.
  const sendToBoard = async () => {
    setRouting(true); setErr(null)
    try {
      const image = await item.getImage()
      const r = await createDesignCard({ title: item.name || "Design", data: image })
      if (r.error) throw new Error(r.error)
      setRouted(true)
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send to the board.") } finally { setRouting(false) }
  }
  const busy = status !== "idle"
  const pal = palette.length ? palette : undefined
  const flag = res ? complexityFlag(res, pal) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-foreground/50" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{item.name}</div>
            {item.ref && <div className="truncate font-mono text-[11px] text-muted-foreground">{item.ref}</div>}
          </div>
          <button onClick={onClose} className="ml-auto grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"><X size={16} /></button>
        </div>

        <div className="grid flex-1 gap-5 overflow-y-auto p-5 sm:grid-cols-2">
          {/* LEFT — preview (full image, object-contain) + actions */}
          <div className="flex flex-col gap-3">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-muted">
              {busy ? (
                <div className="grid size-full place-items-center"><CircleNotch size={24} className="animate-spin text-muted-foreground" /></div>
              ) : res?.trueview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:image/png;base64,${res.trueview}`} alt="embroidery preview" className="absolute inset-0 size-full object-contain" />
              ) : (
                <Thumb src={item.thumb} alt="original" className="absolute inset-0 size-full object-contain" />
              )}
              <span className="absolute left-2 top-2 rounded-md bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{res?.trueview ? "Embroidery" : "Original"}</span>
            </div>

            <div className="flex gap-2">
              {res?.machineFile ? (
                <>
                  {/* Two downloads — the machine file and the preview PNG, separately. */}
                  <button onClick={() => download(res.machineFile!.filename, `data:application/octet-stream;base64,${res.machineFile!.base64}`)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                    <DownloadSimple size={14} weight="bold" /> {res.machineFile.filename.split(".").pop()?.toUpperCase() || "EMB"}
                  </button>
                  <button onClick={() => { if (res.trueview) download(`${res.machineFile!.filename.replace(/\.[^.]+$/, "")}.png`, `data:image/png;base64,${res.trueview}`) }} disabled={!res.trueview} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">
                    <DownloadSimple size={14} weight="bold" /> PNG
                  </button>
                  <button onClick={() => run(true)} disabled={busy} title="Regenerate" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-50"><ArrowsClockwise size={15} /></button>
                </>
              ) : (
                <>
                  <button onClick={() => run(false)} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">
                    {status === "previewing" ? <CircleNotch size={14} className="animate-spin" /> : <Eye size={14} />} Preview
                  </button>
                  <button onClick={() => run(true)} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                    {status === "generating" ? <CircleNotch size={14} className="animate-spin" /> : null} Generate file
                  </button>
                </>
              )}
            </div>

            {err && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"><Warning size={15} weight="fill" className="mt-0.5 shrink-0" />{err}</div>}

            {/* Confidence gate — when auto-digitize is likely poor, say so and nudge the handoff. */}
            {flag && !routed && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
                <span><b>This may need a human.</b> {flag} — send the original to a digitizer for a cleaner file.</span>
              </div>
            )}

            {/* Extra route — hand the ORIGINAL off to a human digitizer when auto won't do. */}
            <button
              onClick={sendToBoard}
              disabled={routing || routed}
              className={"inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-70 " +
                (routed
                  ? "border-border text-muted-foreground"
                  : flag
                    ? "border-amber-400 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
                    : "border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}
            >
              {routing ? <CircleNotch size={14} className="animate-spin" /> : routed ? <Check size={14} weight="bold" className="text-emerald-600" /> : <PaperPlaneTilt size={14} />}
              {routed ? "Sent to Designer board" : "Send original to Designer board"}
            </button>
            <p className="text-[11px] leading-tight text-muted-foreground">For complex art — a person digitizes the original artwork by hand. Sends the source file, not the auto-preview.</p>
          </div>

          {/* RIGHT — details: facts, thread matches, original reference */}
          <div className="min-w-0 space-y-4">
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Design</div>
              {res ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><div className="text-xs text-muted-foreground">Stitches</div><div className="font-semibold tabular-nums">{res.stitches != null ? res.stitches.toLocaleString() : "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Colours</div><div className="font-semibold tabular-nums">{res.colours ?? "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Size</div><div className="font-semibold tabular-nums">{res.width != null && res.height != null ? `${Math.round(res.width)} × ${Math.round(res.height)} mm` : "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Format</div><div className="font-semibold">{res.machineFile ? (res.machineFile.filename.split(".").pop()?.toUpperCase() || "EMB") : "preview"}</div></div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Preview to read the stitch count, colours and size.</p>
              )}
            </div>

            {res && (
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Threads → your library</div>
                {res.threads && res.threads.length > 0 ? (
                  <>
                    {/* Fixed columns so every row lines up: design swatch → cone swatch, name +
                        code (flex, truncates), then the quality flag. The raw RGB text is gone
                        (it wrapped and broke alignment) — it's in the swatch's tooltip instead. */}
                    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                      {res.threads.map((t, i) => {
                        const m = nearestThread(t.r, t.g, t.b, pal)
                        const poor = m ? matchQuality(t.r, t.g, t.b, m).poor : true
                        const srcHex = "#" + [t.r, t.g, t.b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")
                        return (
                          <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <span className="size-5 shrink-0 rounded border border-border" style={{ background: `rgb(${t.r},${t.g},${t.b})` }} title={t.name ? `${t.name} · ${srcHex}` : srcHex} />
                            <ArrowRight size={13} weight="bold" className="shrink-0 text-muted-foreground/50" />
                            {m ? (
                              <>
                                <span className="size-5 shrink-0 rounded border border-border" style={{ background: m.hex }} />
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-medium">{m.name}</span>
                                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{m.code}</span>
                                </span>
                              </>
                            ) : (
                              <span className="min-w-0 flex-1 text-muted-foreground">No close match in your library</span>
                            )}
                            {m && poor && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">poor</span>}
                          </div>
                        )
                      })}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">Suggested from the admin thread library — a person confirms before it&apos;s used.</p>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">{res.colours != null ? `${res.colours} colours — per-thread list not returned.` : "No thread data."}</div>
                )}
              </div>
            )}

            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Original artwork</div>
              <div className="size-16 overflow-hidden rounded-lg border border-border bg-muted"><Thumb src={item.thumb} alt="original" className="size-full object-contain" /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Create — ONE workspace: drop an image AND/OR type text, combined into a single live
// embroidery preview + machine file via the EWA combine endpoint (prototype). ──────────
function CreateTab() {
  const [text, setText] = useState("")
  const [alphabet, setAlphabet] = useState("")
  const [height, setHeight] = useState(20)
  const [color, setColor] = useState("")
  const [alphabets, setAlphabets] = useState<string[]>([])
  const [palette, setPalette] = useState<ThreadColor[]>([])
  const [status, setStatus] = useState<"idle" | "previewing" | "generating">("idle")
  const [res, setRes] = useState<WilcomResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [debug, setDebug] = useState<string | null>(null) // TEMP: EWA's raw response (success OR reject)
  // The dropped/chosen artwork to embroider alongside the text. dataUrl is downscaled under
  // EWA's 2 MB cap; thumb keeps the full-res original for the little in-panel preview.
  const [image, setImage] = useState<{ dataUrl: string; thumb: string; name: string } | null>(null)
  const [over, setOver] = useState(false)
  const takeImage = async (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return
    const thumb = await readFile(file)
    try { const dataUrl = await toDataUrl(thumb); setImage({ dataUrl, thumb, name: file.name.replace(/\.[^.]+$/, "") }) }
    catch { setImage({ dataUrl: thumb, thumb, name: file.name.replace(/\.[^.]+$/, "") }) }
  }
  // Colour-change mode — the palette grid is tucked away until "Change colour", so the
  // controls stay short until you want to recolour.
  const [showPalette, setShowPalette] = useState(false)
  const [pQuery, setPQuery] = useState("")

  useEffect(() => {
    const id = setTimeout(() => {
      getWilcomAlphabets().then((r) => { const a = r.alphabets ?? []; setAlphabets(a); setAlphabet((p) => p || a[0] || "") }).catch(() => {})
      getThreadPalette().then((p) => { const pal = Array.isArray(p) ? p : []; setPalette(pal); setColor((c) => c || pal[0]?.hex || "#111827") }).catch(() => setColor("#111827"))
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const busy = status !== "idle"
  const hasText = !!text.trim()
  // Ready when there's SOMETHING to stitch: an image, or text with an alphabet. (Lettering
  // needs an alphabet; an image on its own doesn't.)
  const ready = !!image || (hasText && !!alphabet)
  const run = async (design: boolean) => {
    if (!ready) return
    setStatus(design ? "generating" : "previewing"); setErr(null); setDebug(null)
    try {
      const body = { image: image?.dataUrl, text: hasText ? text.trim() : undefined, alphabet, height, color, filename: image?.name, name: image?.name || (hasText ? text.trim() : undefined) }
      const r = design ? await wilcomCombine(body) : await wilcomCombinePreview(body)
      setDebug(r.sample ?? null) // capture EWA's raw response whether it succeeded or rejected
      if (!r.ok) { setErr(r.error || "EWA rejected the request"); setRes(null) }
      else setRes(r)
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed") } finally { setStatus("idle") }
  }

  // Live preview — auto-render as you type/tweak (debounced), no button press. Pauses while a
  // file is generating so it isn't interrupted; Generate still emits the machine file on demand.
  useEffect(() => {
    if (!ready || status === "generating") return
    const id = setTimeout(() => { void run(false) }, 650)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.dataUrl, text, alphabet, height, color, ready])

  const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
  const labelCls = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
  const ext = res?.machineFile ? (res.machineFile.filename.split(".").pop()?.toUpperCase() || "EMB") : null
  // The cone currently selected, so the colour control can name it rather than show a bare hex.
  const selCone = palette.find((c) => c.hex.toLowerCase() === color.toLowerCase())
  const cones = pQuery ? palette.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(pQuery.toLowerCase())) : palette

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(340px,400px)_1fr]">
      {/* LEFT — image, text, colour, sequence, readout, actions */}
      <div className="space-y-4">
        {/* Drop / choose the artwork to embroider. Optional — text can stitch on its own,
            an image can stitch on its own, or both combine into one preview. */}
        <div>
          <label className={labelCls}>Image</label>
          {image ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.thumb} alt="" className="size-12 shrink-0 rounded-md border border-border object-contain" />
              <span className="min-w-0 flex-1 truncate text-sm">{image.name}</span>
              <button onClick={() => setImage(null)} title="Remove image" className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-red-600"><X size={14} /></button>
            </div>
          ) : (
            <label
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void takeImage(e.dataTransfer.files?.[0]) }}
              className={"flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-5 text-center transition-colors " + (over ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/50")}
            >
              <ImageSquare size={20} className="text-muted-foreground" />
              <span className="text-xs font-medium">Drop an image to embroider</span>
              <span className="text-[11px] text-muted-foreground">or click to choose — optional</span>
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { void takeImage(e.target.files?.[0]); e.currentTarget.value = "" }} />
            </label>
          )}
        </div>
        <div>
          <label className={labelCls}>Text {image ? "(stitched with the image)" : "(optional)"}</label>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type to add lettering…" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Alphabet</label>
            <select value={alphabet} onChange={(e) => setAlphabet(e.target.value)} className={inputCls}>
              {alphabets.length === 0 && <option value="">Loading…</option>}
              {alphabets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Height (mm)</label>
            <input type="number" min={5} max={50} value={height} onChange={(e) => setHeight(Number(e.target.value) || 20)} className={inputCls} />
          </div>
        </div>

        {/* Colour — Wilcom's "change colour" as a named cone + a tucked-away palette. */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={labelCls + " mb-0"}>Thread colour</span>
            {palette.length > 0 && (
              <button onClick={() => setShowPalette((v) => !v)} className="text-[11px] font-medium text-primary hover:underline">{showPalette ? "Done" : "Change colour"}</button>
            )}
          </div>
          {palette.length ? (
            <>
              <button onClick={() => setShowPalette((v) => !v)} className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40">
                <span className="size-6 shrink-0 rounded-md border border-border" style={{ background: color }} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{selCone?.name ?? "Custom colour"}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">{selCone?.code ?? color}</span>
                </span>
              </button>
              {showPalette && (
                <div className="mt-2 rounded-lg border border-border bg-card p-2.5">
                  <input value={pQuery} onChange={(e) => setPQuery(e.target.value)} placeholder="Search cones by name or code…" className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40" />
                  <div className="grid max-h-44 grid-cols-8 gap-1.5 overflow-y-auto">
                    {cones.map((c) => (
                      <button key={c.code} onClick={() => { setColor(c.hex); setShowPalette(false); setPQuery("") }} title={`${c.name} · ${c.code}`} className={"aspect-square rounded-md border-2 transition-transform hover:scale-110 " + (color.toLowerCase() === c.hex.toLowerCase() ? "border-foreground" : "border-transparent")} style={{ background: c.hex }} />
                    ))}
                    {cones.length === 0 && <div className="col-span-8 py-3 text-center text-xs text-muted-foreground">No cone matches “{pQuery}”.</div>}
                  </div>
                </div>
              )}
            </>
          ) : <p className="text-xs text-muted-foreground">No thread library set — add cones in Settings › Thread palette.</p>}
        </div>

        {/* Layers — the elements in this design (the image and the text). Display for now;
            multi-file + drag-to-reorder is the next step once the combine renders both. */}
        {(image || hasText) && (
          <div>
            <span className={labelCls}>Layers</span>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {image && (
                <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <ImageSquare size={15} className="shrink-0 text-muted-foreground" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.thumb} alt="" className="size-6 shrink-0 rounded border border-border object-contain" />
                  <span className="min-w-0 flex-1 truncate">{image.name}</span>
                  <button onClick={() => setImage(null)} title="Remove image layer" className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-red-600"><X size={13} /></button>
                </div>
              )}
              {hasText && (
                <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <PencilSimple size={15} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">“{text}”</span>
                  <button onClick={() => setText("")} title="Remove text layer" className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-red-600"><X size={13} /></button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Live readout — stitch count, size, file format. */}
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/30 p-3 text-center">
          <div><div className="text-base font-semibold tabular-nums">{res?.stitches != null ? res.stitches.toLocaleString() : "—"}</div><div className="text-[11px] text-muted-foreground">stitches</div></div>
          <div><div className="text-base font-semibold tabular-nums">{res?.width != null && res?.height != null ? `${Math.round(res.width)}×${Math.round(res.height)}` : "—"}</div><div className="text-[11px] text-muted-foreground">mm</div></div>
          <div><div className="text-base font-semibold">{ext ?? (status === "previewing" ? "…" : "—")}</div><div className="text-[11px] text-muted-foreground">file</div></div>
        </div>

        <button onClick={() => run(true)} disabled={busy || !ready} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
          {status === "generating" ? <CircleNotch size={14} className="animate-spin" /> : <DownloadSimple size={14} weight="bold" />} Generate file
        </button>
        {res?.machineFile && (
          <div className="flex gap-2">
            <button onClick={() => download(res.machineFile!.filename, `data:application/octet-stream;base64,${res.machineFile!.base64}`)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"><DownloadSimple size={14} weight="bold" /> {ext}</button>
            <button onClick={() => { if (res.trueview) download(`${res.machineFile!.filename.replace(/\.[^.]+$/, "")}.png`, `data:image/png;base64,${res.trueview}`) }} disabled={!res.trueview} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"><DownloadSimple size={14} weight="bold" /> PNG</button>
          </div>
        )}
        {err && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"><Warning size={15} weight="fill" className="mt-0.5 shrink-0" />{err}</div>}
        {/* TEMP debug — EWA's raw response for a combined design, so we can see why only one
            decoration renders. Copy the whole thing and paste it back. Removed once fixed. */}
        {debug && (
          <details className="rounded-lg border border-border bg-muted/30" open>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">EWA response (debug) — copy &amp; paste this back to me</summary>
            <pre className="max-h-56 select-all overflow-auto whitespace-pre-wrap break-all px-3 pb-3 font-mono text-[10px] leading-snug text-muted-foreground">{debug}</pre>
          </details>
        )}
      </div>

      {/* RIGHT — the big preview, the hero of the tab; sticks while you scroll the controls. */}
      <div className="space-y-2 lg:sticky lg:top-4">
        <div className="relative flex min-h-[440px] w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted lg:min-h-[600px]">
          {res?.trueview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${res.trueview}`} alt="embroidery preview" className="max-h-full max-w-full object-contain p-4" />
          ) : err ? (
            // Surface EWA's own message right in the frame — a blank preview otherwise looks
            // broken with no reason. This is also what tells us why a combine failed.
            <div className="grid size-full place-items-center gap-2 p-6 text-center text-sm text-amber-700 dark:text-amber-300"><Warning size={22} weight="fill" /><span className="max-w-md">{err}</span></div>
          ) : (
            <div className="grid size-full place-items-center p-6 text-center text-sm text-muted-foreground">{ready ? "Rendering…" : "Drop an image or type text to see it stitched."}</div>
          )}
          {status === "previewing" && res?.trueview && <div className="absolute right-3 top-3 rounded-full bg-background/85 p-1.5"><CircleNotch size={16} className="animate-spin text-muted-foreground" /></div>}
        </div>
        <div className="text-center text-[11px] text-muted-foreground">Live preview{status === "previewing" ? " · updating…" : ""} — the true stitched look, on the real fabric render.</div>
      </div>
    </div>
  )
}

// ── History ──────────────────────────────────────────────────────────────────────
function HistoryTab() {
  const [rows, setRows] = useState<WilcomGeneration[] | null>(null)
  const [q, setQ] = useState("")
  const load = useCallback(() => { getWilcomGenerations().then((r) => setRows(r.generations ?? [])).catch(() => setRows([])) }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])
  const list = (rows ?? []).filter((g) => !q || `${g.name} ${g.order_ref} ${g.type}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by design, source or type…" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40" />
        </div>
        <button onClick={() => { setRows(null); load() }} title="Refresh" className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent"><ArrowsClockwise size={15} /></button>
      </div>
      {rows === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">{q ? `No generations match “${q}”.` : "Nothing generated yet — generate a design from Create."}</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3"></th><th className="px-4 py-3">Design</th><th className="px-4 py-3">Source</th>
                <th className="px-4 py-3 text-right">Stitches</th><th className="px-4 py-3 text-right">Colours</th>
                <th className="px-4 py-3">Formats</th><th className="px-4 py-3">Generated</th><th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-2.5"><span className="relative flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted"><Thumb src={g.id ? `/api/wilcom/asset/${g.id}/tv` : (g.trueview_url ?? "")} className="absolute inset-0 size-full object-cover" /></span></td>
                  <td className="px-4 py-2.5 font-medium">{g.name || "Untitled"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{g.order_ref || (g.source === "maker" ? "Maker" : "—")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.stitches != null ? g.stitches.toLocaleString() : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.colours ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{(g.formats ?? []).join(" · ") || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtDate(g.created_at)}</td>
                  <td className="px-4 py-2.5"><a href={`/api/wilcom/asset/${g.id}/file`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><DownloadSimple size={13} weight="bold" /> Download</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
