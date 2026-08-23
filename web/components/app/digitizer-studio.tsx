"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from "react"
// NB: do NOT import phosphor's `Image` — it would shadow the DOM `new Image()` used in
// toDataUrl below. Use ImageSquare for the mode toggle instead.
import { Needle, ImageSquare, PencilSimple, ClockCounterClockwise, MagnifyingGlass, CircleNotch, Eye, DownloadSimple, Warning, ArrowsClockwise, X, ArrowRight, PaperPlaneTilt, Check, ArrowsOutCardinal, CaretUp, CaretDown } from "@phosphor-icons/react"
import { canvasReadableSrc, nearestThread, matchQuality } from "@/lib/thread-match"
import { orderRefLabel } from "@/lib/order-format"
import {
 getOrderUploads, getDesignLibrary, getDesignLibraryItem, getThreadPalette,
 wilcomPreview, wilcomDigitize, getWilcomGenerations, createDesignCard,
 getWilcomAlphabets, wilcomCombine, wilcomLetteringPreview,
 type OrderUpload, type LibraryDesign, type ThreadColor, type WilcomResult, type WilcomGeneration, type WilcomTransform,
} from "@/lib/api"
import { PageTitle } from "@/components/app/page-title"
import { TabLabel } from "@/components/app/tab-label"
import { Thumb } from "@/components/app/thumb"

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

// This studio's tile: the shared Thumb (which is the "a failed load never paints its alt"
// rule) wearing the needle mark, which is this surface's own vocabulary for "artwork".
function StudioThumb({ src, alt, className }: { src: string; alt?: string; className?: string }) {
 return <Thumb src={src} alt={alt} className={className} icon={<Needle size={24} weight="duotone" />} />
}

// A unifying shape over the three artwork sources.
type ArtItem = { key: string; name: string; ref?: string; source: Source | "upload"; thumb: string; getImage: () => Promise<string> }
const orderItem = (u: OrderUpload): ArtItem => ({ key: u.url, name: u.name || "Untitled", ref: u.orderRef, source: "order", thumb: canvasReadableSrc(u.url), getImage: () => toDataUrl(u.url) })
// IMG-, because this is LIBRARY ARTWORK. The namespaces are fixed (see the note in
// app/(app)/design/page.tsx): IMG- is a picture in the library, DSN- is the design work on an
// order, TPL- is a saved template. This said DSN-, so the same picture was IMG-7 in the
// Images tab and DSN-7 here — while DSN-7 already means an unrelated thing on the board.
// One id, one meaning: the rule exists because "send me the design id" was otherwise an
// ambiguous request in a system that runs on ids.
const libItem = (d: LibraryDesign): ArtItem => ({
 key: `L${d.id}`, name: d.name || "Untitled", ref: `IMG-${d.id}`, source: "library", thumb: d.thumb || "",
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
        <Needle size={18} weight="regular" className="shrink-0 text-primary" />
        <div>
          <PageTitle>Digitizer</PageTitle>
          <p className="text-sm text-muted-foreground">Turn artwork into an embroidery preview and a machine file — or build one from scratch.</p>
        </div>
      </div>

      {/* A rule under the live word — the app's one tab treatment (tabsListVariants `line`).
          These were a capsule group with a filled active pill, which is the same shape a
          primary BUTTON has: three things that look pressable, one of which looks pressed. */}
      <nav className="-mb-px flex gap-5 border-b border-border">
        {([{ id: "create", label: "Create", icon: PencilSimple }, { id: "library", label: "Library", icon: ImageSquare }, { id: "history", label: "History", icon: ClockCounterClockwise }] as const).map((t) => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={"eg-tap relative inline-flex items-center gap-1.5 pb-2 text-sm transition-colors " + (tab === t.id
                ? "font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground"
                : "text-muted-foreground hover:text-foreground")}>
              <Icon size={15} /> <TabLabel>{t.label}</TabLabel>
            </button>
          )
        })}
      </nav>

      {tab === "create" ? <CreateTab /> : tab === "library" ? <BrowseTab /> : <HistoryTab />}
    </div>
  )
}

// ── Browse: order artwork + library + direct upload ─────────────────────────────
function BrowseTab() {
 const [orders, setOrders] = useState<OrderUpload[] | null>(null)
 const [lib, setLib] = useState<LibraryDesign[] | null>(null)
 const [palette, setPalette] = useState<ThreadColor[]>([])
 const [q, setQ] = useState("")
 const [open, setOpen] = useState<ArtItem | null>(null)
 const [done, setDone] = useState<Set<string>>(new Set())

 useEffect(() => {
 const id = setTimeout(() => {
 getThreadPalette().then((p) => setPalette(Array.isArray(p) ? p : [])).catch(() => {})
 getOrderUploads().then((r) => setOrders(r.images ?? [])).catch(() => setOrders([]))
 getDesignLibrary().then((r) => setLib(r ?? [])).catch(() => setLib([]))
    }, 0)
 return () => clearTimeout(id)
  }, [])

  // Order artwork + design library shown TOGETHER (no source toggle).
 const items: ArtItem[] = [...(orders ?? []).map(orderItem), ...(lib ?? []).map(libItem)]
 const loading = orders === null || lib === null
 const list = items.filter((i) => !q || `${i.name} ${i.ref ?? ""}`.toLowerCase().includes(q.toLowerCase()))

 return (
    <>
      {/* Search only, top-right — order artwork and the design library live in one grid below. */}
      <div className="flex justify-end">
        <div className="relative w-full max-w-sm">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search artwork…" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40" />
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-muted" />)}</div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">{q ? `Nothing matches “${q}”.` : "No artwork yet — buyer uploads and your design library will appear here."}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((it) => (
              <button key={it.key} onClick={() => setOpen(it)} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-shadow hover:shadow">
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <StudioThumb src={it.thumb} alt={it.name} className="absolute inset-0 size-full" />
                  {done.has(it.key) && <span className="absolute left-1.5 top-1.5 z-10 rounded bg-shipped px-1.5 py-0.5 text-2xs font-semibold text-white">Generated</span>}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  {it.ref && <div className="truncate tabular-nums text-2xs text-muted-foreground">{orderRefLabel(it.ref)}</div>}
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


/**
 * PLACEMENT SIZES — the sizes a floor actually embroiders, in mm.
 *
 * Auto-digitize has always run at whatever size Wilcom picked, because the client never sent
 * width/height even though the API and buildBitmapXml both accept them. That is the wrong
 * default for embroidery specifically: a design is digitised FOR a placement, and stitch
 * density, pull compensation and the stitch count all follow from the finished size. The same
 * artwork at 90mm and at 280mm is not one file scaled — it is two different files.
 */
const PLACEMENTS: { label: string; w: number; h: number }[] = [
  { label: "Left chest", w: 90, h: 90 },
  { label: "Cap front", w: 120, h: 50 },
  { label: "Sleeve", w: 70, h: 70 },
  { label: "Full front", w: 280, h: 280 },
]
/** Wilcom's auto-digitize ceiling. Past it the request is refused, so warn before spending it. */
const MAX_AREA_MM2 = 22500
const mmToIn = (mm: number) => mm / 25.4
const fmtIn = (mm: number) => `${mmToIn(mm).toFixed(1)}"`
/**
 * Inches as a bare editable value — no quote mark, so it can go in an input.
 *
 * TWO decimals, trailing zeros stripped. One decimal reads more cleanly but quantises to
 * 2.5mm, and the placement presets are stated in round mm: a left chest is 90mm, which at one
 * decimal displays as 3.5" and converts back to 89mm. The preset would then no longer send the
 * size it names. At two decimals it round-trips exactly, and a value that doesn't need them
 * (3.5", 4") still shows short.
 */
const inOf = (mm: number) => mmToIn(mm).toFixed(2).replace(/\.?0+$/, "")
/** What the user typed, back to the mm every size path below is expressed in. NaN when the
 * field is mid-edit or nonsense, and every caller guards on `> 0`. */
const inToMm = (v: string) => Number(v) * 25.4

// ── The detail modal: original ↔ big embroidery preview + thread matching ────────
function DigitizeModal({ item, palette, onClose, onGenerated }: { item: ArtItem; palette: ThreadColor[]; onClose: () => void; onGenerated: () => void }) {
 const [status, setStatus] = useState<"idle" | "previewing" | "generating">("idle")
 const [res, setRes] = useState<WilcomResult | null>(null)
 const [err, setErr] = useState<string | null>(null)
 const [routing, setRouting] = useState(false)
 const [routed, setRouted] = useState(false)
  /** Target finished size in INCHES, as typed. Empty = let Wilcom choose, which is the old
   * behaviour. mm is derived at the edge (wMm/hMm) because that is what EWA is given — the
   * floor states placements in inches, so that is what the field holds. */
 const [size, setSize] = useState<{ w: string; h: string }>({ w: "", h: "" })
  /** Keep the artwork's proportions: typing one dimension derives the other. Off by default
   * would let someone silently distort a logo, which is not recoverable from the output. */
 const [lockRatio, setLockRatio] = useState(true)
 const [aspect, setAspect] = useState<number | null>(null)

  // The source artwork's proportions, read once, so the ratio lock has something to work from.
 useEffect(() => {
 let live = true
 item.getImage()
      .then((src) => new Promise<HTMLImageElement>((res, rej) => {
 const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src
      }))
      .then((im) => { if (live && im.width && im.height) setAspect(im.width / im.height) })
      .catch(() => {})
 return () => { live = false }
  }, [item])

  // Inches as typed; mm as sent. Wilcom's area ceiling is stated in mm², so the check has to
  // happen on the converted values, not the typed ones.
 const wIn = Number(size.w) || 0
 const hIn = Number(size.h) || 0
 const wNum = wIn > 0 ? Math.round(wIn * 25.4) : 0
 const hNum = hIn > 0 ? Math.round(hIn * 25.4) : 0
 const areaOver = wNum > 0 && hNum > 0 && wNum * hNum > MAX_AREA_MM2
  // One decimal, in inches — rounding to whole units here would quantise a 2.5" chest logo
  // to 2" or 3", which mm never did.
 const setW = (v: string) => {
 const n = Number(v)
 setSize(lockRatio && aspect && n > 0 ? { w: v, h: (n / aspect).toFixed(1) } : (p) => ({ ...p, w: v }))
  }
 const setH = (v: string) => {
 const n = Number(v)
 setSize(lockRatio && aspect && n > 0 ? { w: (n * aspect).toFixed(1), h: v } : (p) => ({ ...p, h: v }))
  }

 useEffect(() => {
 const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
 window.addEventListener("keydown", onKey)
 return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

 const run = async (design: boolean) => {
 setStatus(design ? "generating" : "previewing"); setErr(null)
 try {
 const image = await item.getImage()
      // Only send a size when one was actually chosen — an unset field must stay "Wilcom
      // decides", not silently become 0mm.
 const dims = wNum > 0 && hNum > 0 ? { width: wNum, height: hNum } : {}
 const r = design
        ? await wilcomDigitize({ image, filename: item.name, name: item.name, orderRef: item.ref, source: item.source, ...dims })
 : await wilcomPreview({ image, filename: item.name, ...dims })
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
            {item.ref && <div className="truncate tabular-nums text-2xs text-muted-foreground">{orderRefLabel(item.ref)}</div>}
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
                <Thumb src={item.thumb} alt="original" fit="contain" className="absolute inset-0 size-full" />
              )}
              <span className="absolute left-2 top-2 rounded-md bg-background/85 px-2 py-0.5 eg-label text-muted-foreground">{res?.trueview ? "Embroidery" : "Original"}</span>
            </div>

            {/* TARGET SIZE — the thing that was missing. Embroidery is digitised FOR a
 placement: density and pull compensation follow the finished size, so the same
 art at 90mm and 280mm are two different files, not one scaled. Left blank,
 behaviour is unchanged and Wilcom picks. */}
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="eg-label text-muted-foreground">Finished size</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground">
                  <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} className="size-3 accent-primary" disabled={!aspect} />
                  Keep proportions
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {PLACEMENTS.map((pl) => {
                  // A preset fills the box it has to fit INSIDE, so the art keeps its shape
                  // rather than being stretched to the placement's own ratio.
                  // PLACEMENTS are stated in mm (that's how a placement is specified), so the
                  // comparison and the fill both happen in mm and only the stored value is
                  // inches.
 const on = wNum === pl.w || (aspect ? Math.round(Math.min(pl.w, pl.h * aspect)) === wNum : false)
 return (
                    <button
 key={pl.label}
 onClick={() => {
 if (!aspect) { setSize({ w: inOf(pl.w), h: inOf(pl.h) }); return }
 const w = Math.min(pl.w, pl.h * aspect)
 setSize({ w: inOf(w), h: inOf(w / aspect) })
                      }}
 className={"eg-tap rounded-md border px-2 py-1 text-2xs font-medium transition-colors " +
                        (on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}
                    >
                      {pl.label}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="flex flex-1 items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">W</span>
                  <input inputMode="decimal" value={size.w} onChange={(e) => setW(e.target.value)} placeholder="auto"
 className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm tabular-nums" aria-label="Finished width in inches" />
                </label>
                <span className="text-xs text-muted-foreground">×</span>
                <label className="flex flex-1 items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">H</span>
                  <input inputMode="decimal" value={size.h} onChange={(e) => setH(e.target.value)} placeholder="auto"
 className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm tabular-nums" aria-label="Finished height in inches" />
                </label>
                <span className="shrink-0 text-xs text-muted-foreground">in</span>
                {(wNum > 0 || hNum > 0) && (
                  <button onClick={() => setSize({ w: "", h: "" })} className="eg-tap shrink-0 rounded-md px-1.5 py-1 text-2xs text-muted-foreground hover:text-foreground" title="Back to automatic">Auto</button>
                )}
              </div>
              {/* The fields ARE inches now, so this no longer repeats them. What is left is
 the mm² area, which is the only reason mm still appears on this screen:
                  Wilcom's auto-digitize ceiling is stated in mm² and refusing to show it
 would make the warning below arrive from nowhere. */}
              {wNum > 0 && hNum > 0 && (
                <div className="mt-1.5 text-2xs tabular-nums text-muted-foreground">
                  {Math.round(wNum * hNum).toLocaleString()} mm² of Wilcom&apos;s {MAX_AREA_MM2.toLocaleString()} limit
                </div>
              )}
              {areaOver && (
                <div className="mt-1.5 flex items-start gap-1.5 text-2xs text-hold">
                  <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
                  Over Wilcom&apos;s {MAX_AREA_MM2.toLocaleString()} mm² auto-digitize limit — it will refuse this. Reduce the size, or send the original to a digitizer below.
                </div>
              )}
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
                  <button onClick={() => run(true)} disabled={busy || areaOver} title="Regenerate" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-50"><ArrowsClockwise size={15} /></button>
                </>
              ) : (
                <>
                  <button onClick={() => run(false)} disabled={busy || areaOver} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">
                    {status === "previewing" ? <CircleNotch size={14} className="animate-spin" /> : null} Preview
                  </button>
                  <button onClick={() => run(true)} disabled={busy || areaOver} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                    {status === "generating" ? <CircleNotch size={14} className="animate-spin" /> : null} Generate file
                  </button>
                </>
              )}
            </div>

            {err && <div className="flex items-start gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3 py-2 text-sm text-hold"><Warning size={15} weight="fill" className="mt-0.5 shrink-0" />{err}</div>}

            {/* Confidence gate — when auto-digitize is likely poor, say so and nudge the handoff. */}
            {flag && !routed && (
              <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
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
                    ? "border-hold/40 bg-hold/10 text-hold hover:bg-hold/20"
 : "border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}
            >
              {routing ? <CircleNotch size={14} className="animate-spin" /> : routed ? <Check size={14} weight="bold" className="text-success" /> : <PaperPlaneTilt size={14} />}
              {routed ? "Sent to Designer board" : "Send original to Designer board"}
            </button>
            <p className="text-2xs leading-tight text-muted-foreground">For complex art — a person digitizes the original artwork by hand. Sends the source file, not the auto-preview.</p>
          </div>

          {/* RIGHT — details: facts, thread matches, original reference */}
          <div className="min-w-0 space-y-4">
            <div>
              <div className="mb-2 eg-label text-muted-foreground">Design</div>
              {res ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><div className="text-xs text-muted-foreground">Stitches</div><div className="font-semibold tabular-nums">{res.stitches != null ? res.stitches.toLocaleString() : "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Colours</div><div className="font-semibold tabular-nums">{res.colours ?? "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Size</div><div className="font-semibold tabular-nums">{res.width != null && res.height != null ? `${fmtIn(res.width)} × ${fmtIn(res.height)}` : "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Format</div><div className="font-semibold">{res.machineFile ? (res.machineFile.filename.split(".").pop()?.toUpperCase() || "EMB") : "preview"}</div></div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Preview to read the stitch count, colours and size.</p>
              )}
            </div>

            {res && (
              <div>
                <div className="mb-1.5 eg-label text-muted-foreground">Threads → your library</div>
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
                                  <span className="ml-1.5 tabular-nums text-2xs text-muted-foreground">{m.code}</span>
                                </span>
                              </>
                            ) : (
                              <span className="min-w-0 flex-1 text-muted-foreground">No close match in your library</span>
                            )}
                            {m && poor && <span className="shrink-0 rounded-full bg-hold/15 px-2 py-0.5 eg-label text-hold">poor</span>}
                          </div>
                        )
                      })}
                    </div>
                    <p className="mt-1.5 text-2xs leading-tight text-muted-foreground">Suggested from the admin thread library — a person confirms before it&apos;s used.</p>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">{res.colours != null ? `${res.colours} colours — per-thread list not returned.` : "No thread data."}</div>
                )}
              </div>
            )}

            <div>
              <div className="mb-1.5 eg-label text-muted-foreground">Original artwork</div>
              <div className="size-16 overflow-hidden rounded-lg border border-border bg-muted"><Thumb src={item.thumb} alt="original" fit="contain" className="size-full" /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const IDENTITY_TF: WilcomTransform = { x: 0, y: 0, scale: 1, angle: 0 }

// A layer on the Create canvas. Order in the list = stitch order (later = stitched on top).
// Text is a single layer (id "text"); every other layer is an image. Each carries its own
// transform (move/resize/rotate).
type ImgLayer = { id: string; kind: "image"; dataUrl: string; thumb: string; name: string; tf: WilcomTransform }
type Layer = ImgLayer | { id: "text"; kind: "text"; tf: WilcomTransform }
const isImg = (l: Layer): l is ImgLayer => l.kind === "image"
const newLayerId = () => "L" + Math.random().toString(36).slice(2, 9)

// Direct-manipulation box over the preview: drag the body to MOVE, the corner nub to RESIZE,
// the top nub to ROTATE — instant client-side feedback (a ghost of the element). EWA's live
// preview ignores the transform, so the box + ghost is what you position against; the value
// bakes into the generated .emb. BOX_SPAN_MM maps the preview's span to millimetres — a
// nominal hoop width; tune once checked against real output.
const BOX_SPAN_MM = 120
const NOMINAL_MM = 45 // fallback footprint for a layer whose stitched preview hasn't loaded yet
// Garment presets — the preview backdrop, so you can judge the stitching on the real blank colour.
const GARMENTS: { name: string; color: string }[] = [
  { name: "White", color: "#ffffff" }, { name: "Natural", color: "#f3efe6" },
  { name: "Sport Grey", color: "#b6b6b6" }, { name: "Charcoal", color: "#3f3f46" },
  { name: "Black", color: "#141414" }, { name: "Navy", color: "#1f2a44" },
  { name: "Royal", color: "#1d4ed8" }, { name: "Red", color: "#9b2226" },
  { name: "Forest", color: "#1e3a2f" }, { name: "Maroon", color: "#5b1a25" },
  { name: "Sand", color: "#d8c9a3" }, { name: "Pink", color: "#f4c2d0" },
]
// Image layers resize by RE-DIGITIZING at a target size (baked into the .emb), not via the
// decoration transform — whose scale EWA hard-caps at ±20%. So the box scale can range freely.
const clampScale = (s: number) => Math.min(4, Math.max(0.25, Number.isFinite(s) && s > 0 ? s : 1))
// Convert the client box into EWA's transform. Size is already baked into each element (image →
// digitize width, text → letter height), so transform scale stays 1 and we only need dx/dy:
// EWA measures mm from the location's TOP-LEFT (+y down) from the element's top-left, while the
// canvas is centre-origin / +y-up, so convert using the element's EFFECTIVE stitched size (mm).
function toEwaTransform(tf: WilcomTransform, effWmm: number, effHmm: number) {
 const cx = BOX_SPAN_MM / 2 + tf.x   // element centre, mm from the left edge
 const cy = BOX_SPAN_MM / 2 - tf.y   // element centre, mm from the top edge (+y flips to down)
 return { dx: +(cx - effWmm / 2).toFixed(2), dy: +(cy - effHmm / 2).toFixed(2), rotation: tf.angle, scale: 1, mirror: "none" as const }
}
type DragState = { mode: "move" | "resize" | "rotate"; sx: number; sy: number; start: WilcomTransform; cx: number; cy: number; d0: number; a0: number; rw: number; rh: number }
function LayerBoxEditor({ tf, onChange, ghost, selected, onSelect, wmm, hmm, z }: { tf: WilcomTransform; onChange: (t: WilcomTransform) => void; ghost: ReactNode; selected: boolean; onSelect: () => void; wmm: number; hmm: number; z: number }) {
 const drag = useRef<DragState | null>(null)

  // Single handlers, no ref-in-render: the host rect is read off the DOM via closest() at
  // pointer-down time, and `data-mode` on the grabbed element says what to do. Grabbing a box
  // also SELECTS its layer, so one gesture = click-to-select + drag. No EWA call happens here —
  // it's pure client-side manipulation; the transform only reaches EWA on Generate.
 const down = (e: RPointerEvent<HTMLElement>) => {
 e.preventDefault(); e.stopPropagation()
 onSelect()
 const el = e.currentTarget
 const host = el.closest("[data-boxhost]") as HTMLElement | null
 const r = host?.getBoundingClientRect(); if (!r) return
 const cx = r.left + r.width / 2 + (tf.x / BOX_SPAN_MM) * r.width
 const cy = r.top + r.height / 2 - (tf.y / BOX_SPAN_MM) * r.height
 drag.current = { mode: (el.dataset.mode as DragState["mode"]) || "move", sx: e.clientX, sy: e.clientY, start: { ...tf }, cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, a0: Math.atan2(e.clientY - cy, e.clientX - cx), rw: r.width, rh: r.height }
 try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
 const move = (e: RPointerEvent<HTMLElement>) => {
 const d = drag.current; if (!d) return
 e.preventDefault()
 if (d.mode === "move") {
 const dx = ((e.clientX - d.sx) / d.rw) * BOX_SPAN_MM
 const dy = ((e.clientY - d.sy) / d.rh) * BOX_SPAN_MM
 onChange({ ...d.start, x: Math.round(d.start.x + dx), y: Math.round(d.start.y - dy) })
    } else if (d.mode === "resize") {
 const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy)
 onChange({ ...d.start, scale: clampScale(Math.round((dist / d.d0) * d.start.scale * 100) / 100) })
    } else {
 const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx)
 let deg = d.start.angle + ((a - d.a0) * 180) / Math.PI
 deg = Math.round((((deg + 180) % 360) + 360) % 360 - 180)
 onChange({ ...d.start, angle: deg })
    }
  }
 const up = (e: RPointerEvent<HTMLElement>) => { drag.current = null; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ } }

 const nub = "pointer-events-auto absolute size-4 touch-none rounded-full border-2 border-primary bg-background shadow"
  // z-index follows STACK ORDER ONLY (never selection) so the reorder carets visibly change which
  // layer sits on top even while it's selected. Selection is shown by the border + handles alone.
 return (
    <div data-boxhost className="pointer-events-none absolute inset-0" style={{ zIndex: z }}>
      <div
 data-mode="move" onPointerDown={down} onPointerMove={move} onPointerUp={up}
 className={"pointer-events-auto absolute flex touch-none items-center justify-center rounded border-2 " + (selected ? "cursor-move border-primary/80" : "cursor-pointer border-transparent")}
 style={{ left: `${50 + (tf.x / BOX_SPAN_MM) * 100}%`, top: `${50 - (tf.y / BOX_SPAN_MM) * 100}%`, width: `${(wmm / BOX_SPAN_MM) * 100}%`, height: `${(hmm / BOX_SPAN_MM) * 100}%`, transform: `translate(-50%,-50%) rotate(${tf.angle}deg)` }}
      >
        {/* Full opacity — the ghost is the REAL stitched TrueView, so it must not look faded.
            Selection is shown by the border + handles, not by dimming the embroidery. */}
        <div className="pointer-events-none flex size-full items-center justify-center overflow-hidden">{ghost}</div>
        {selected && (
          <>
            {/* All four corners resize (scale from the centre); the top nub rotates. Works for
 images (re-digitize width) and text (letter height) alike. */}
            <div title="Drag to resize" data-mode="resize" onPointerDown={down} onPointerMove={move} onPointerUp={up} className={nub + " -top-2 -left-2 cursor-nwse-resize"} />
            <div title="Drag to resize" data-mode="resize" onPointerDown={down} onPointerMove={move} onPointerUp={up} className={nub + " -top-2 -right-2 cursor-nesw-resize"} />
            <div title="Drag to resize" data-mode="resize" onPointerDown={down} onPointerMove={move} onPointerUp={up} className={nub + " -bottom-2 -left-2 cursor-nesw-resize"} />
            <div title="Drag to resize" data-mode="resize" onPointerDown={down} onPointerMove={move} onPointerUp={up} className={nub + " -bottom-2 -right-2 cursor-nwse-resize"} />
            <div title="Drag to rotate" data-mode="rotate" onPointerDown={down} onPointerMove={move} onPointerUp={up} className={nub + " -top-8 left-1/2 -translate-x-1/2 cursor-grab"} />
          </>
        )}
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
 const [res, setRes] = useState<WilcomResult | null>(null)   // the GENERATED combined .emb (download + readout)
 const [resById, setResById] = useState<Record<string, WilcomResult>>({}) // each layer's OWN stitched preview
 const [err, setErr] = useState<string | null>(null)
  // LAYERS — ordered (list order = stitch order; a later layer stitches on top). Text is one
  // layer (id "text"); the rest are images. Each carries its own move/resize/rotate transform.
 const [layers, setLayers] = useState<Layer[]>([])
 const [openLayer, setOpenLayer] = useState<string | null>(null) // active layer id
 const [over, setOver] = useState(false)
 const [compare, setCompare] = useState(true) // show the generated result beside the arrangement
 const [dragId, setDragId] = useState<string | null>(null) // layer card being drag-reordered
 const [garment, setGarment] = useState("#f4f4f5") // preview backdrop (garment colour) — cosmetic
  // Width box draft. The box is CONTROLLED by a derived, rounded footprint, so resizing on
  // every keystroke fed a half-typed number ("9" of "90") back through the scale clamp and the
  // rounding — typing 90 actually landed on 110. Hold the keystrokes, commit on blur/Enter.
 const [wDraft, setWDraft] = useState<string | null>(null)
  /** Same, for the height box — either dimension can be the one you type. */
 const [hDraft, setHDraft] = useState<string | null>(null)
  // Drop `dragId` onto `targetId`: dragId takes the target's slot in the stack.
 const reorderTo = (dragId: string, targetId: string) => setLayers((prev) => {
 if (dragId === targetId) return prev
 const from = prev.findIndex((l) => l.id === dragId), to = prev.findIndex((l) => l.id === targetId)
 if (from < 0 || to < 0) return prev
 const n = [...prev]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n
  })
 const addImages = async (files: Iterable<File> | null | undefined) => {
 for (const f of Array.from(files ?? []).filter((x) => x.type.startsWith("image/"))) {
 const thumb = await readFile(f)
 let dataUrl = thumb; try { dataUrl = await toDataUrl(thumb) } catch { /* keep raw on downscale failure */ }
 const layer: ImgLayer = { id: newLayerId(), kind: "image", dataUrl, thumb, name: f.name.replace(/\.[^.]+$/, ""), tf: IDENTITY_TF }
 setLayers((prev) => [...prev, layer])
 setOpenLayer(layer.id)
      // Preview this image on its own (once — an image doesn't change after it's dropped).
 wilcomPreview({ image: dataUrl, filename: layer.name }).then((r) => { if (r.ok) setResById((m) => ({ ...m, [layer.id]: r })) }).catch(() => {})
    }
  }
 const setLayerTf = (id: string, tf: WilcomTransform) => setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, tf } : l)))
 const moveLayer = (id: string, dir: -1 | 1) => setLayers((prev) => {
 const i = prev.findIndex((l) => l.id === id); if (i < 0) return prev
 const j = i + dir; if (j < 0 || j >= prev.length) return prev
 const n = [...prev]; const [m] = n.splice(i, 1); n.splice(j, 0, m); return n
  })
 const removeLayer = (id: string) => {
 setLayers((prev) => prev.filter((l) => l.id !== id))
 setResById((m) => { const n = { ...m }; delete n[id]; return n })
 setOpenLayer((o) => (o === id ? null : o))
 if (id === "text") setText("")
  }
  // Keep exactly one text layer while there's text; drop it when the text is cleared.
 const ensureTextLayer = (present: boolean) => setLayers((prev) => {
 const has = prev.some((l) => l.id === "text")
 if (present && !has) return [...prev, { id: "text" as const, kind: "text" as const, tf: IDENTITY_TF }]
 if (!present && has) return prev.filter((l) => l.id !== "text")
 return prev
  })
 const onTextChange = (v: string) => { setText(v); ensureTextLayer(!!v.trim()) }
 const imgLayers = layers.filter(isImg)
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

  // Persist the work-in-progress design so it survives switching tabs OR navigating away — the
  // Create tab unmounts in both cases, which was wiping everything. sessionStorage (this
  // browser session), restored once on mount, saved debounced on change.
 useEffect(() => {
 const id = setTimeout(() => {
 try {
 const s = JSON.parse(sessionStorage.getItem("eg_digitizer_create") || "null")
 if (!s) return
 if (Array.isArray(s.layers)) {
 setLayers(s.layers)
          // Previews aren't persisted — re-fetch each restored image layer's own preview.
 for (const l of s.layers) if (l?.kind === "image" && l.dataUrl) {
 wilcomPreview({ image: l.dataUrl, filename: l.name }).then((r) => { if (r.ok) setResById((m) => ({ ...m, [l.id]: r })) }).catch(() => {})
          }
        }
 if (typeof s.text === "string") setText(s.text)
 if (s.alphabet) setAlphabet(s.alphabet)
 if (typeof s.height === "number") setHeight(s.height)
 if (s.color) setColor(s.color)
 if (s.garment) setGarment(s.garment)
      } catch { /* ignore corrupt/absent */ }
    }, 0)
 return () => clearTimeout(id)
  }, [])
 useEffect(() => {
 const id = setTimeout(() => {
 try { sessionStorage.setItem("eg_digitizer_create", JSON.stringify({ layers, text, alphabet, height, color, garment })) } catch { /* quota/serialise */ }
    }, 500)
 return () => clearTimeout(id)
  }, [layers, text, alphabet, height, color, garment])

 const busy = status !== "idle"
 const hasText = !!text.trim()
  // Ready when there's SOMETHING to stitch: an image layer, or text with an alphabet.
 const ready = imgLayers.length > 0 || (hasText && !!alphabet)
  // GENERATE — the real single .emb: EWA combines the layers with their transforms. Runs only
  // on the button, never live, so arranging on the canvas costs nothing.
 const generate = async (): Promise<WilcomResult | null> => {
 if (!ready) return null
 setStatus("generating"); setErr(null)
 try {
      // Ordered layer payload — each image (auto-digitized server-side) and the text, with its
      // transform, in stitch order. Text content rides alongside for the text layer(s).
 const payload = layers.map((l) => {
 const r = resById[l.id]                          // this layer's own stitched preview (mm size)
 if (l.kind === "image") {
 const s = l.tf.scale || 1
 const natW = r?.width ?? 0, natH = r?.height ?? 0
 const effW = (natW || NOMINAL_MM) * s, effH = (natH || NOMINAL_MM) * s
          // Size baked by RE-DIGITIZING at this width (past EWA's ±20% transform cap); position via dx/dy.
 const targetWidthMm = natW ? +(natW * s).toFixed(1) : undefined
 return { kind: "image" as const, image: l.dataUrl, name: l.name, targetWidthMm, transform: toEwaTransform(l.tf, effW, effH) }
        }
        // Text: resizing scales the LETTER HEIGHT (baked below); footprint scales with it too.
 const s = l.tf.scale || 1
 const effW = (r?.width || NOMINAL_MM) * s, effH = (r?.height || NOMINAL_MM) * s
 return { kind: "text" as const, transform: toEwaTransform(l.tf, effW, effH) }
      })
      // The text box's scale multiplies the letter height (clamped to EWA's 5–50mm range).
 const txtScale = layers.find((l) => l.id === "text")?.tf.scale || 1
 const effHeight = Math.min(50, Math.max(5, Math.round(height * txtScale)))
 const body = { layers: payload, text: hasText ? text.trim() : undefined, alphabet, height: effHeight, color,
 name: imgLayers[0]?.name || (hasText ? text.trim() : undefined) }
 const r = await wilcomCombine(body)
 if (!r.ok) { setErr(r.error || "EWA rejected the request"); setRes(null); return null }
 setRes(r); return r
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); return null } finally { setStatus("idle") }
  }
  /**
   * THE ARRANGEMENT'S REAL FOOTPRINT, in mm — the bounding box of every layer.
   *
   * The old readout showed res.width/res.height, which only exists AFTER a generate: while you
   * were actually arranging, the one number that decides whether this fits a left chest read
   * "—". This is computed from the layer boxes, so it is live.
   *
   * Rotation is ignored deliberately: a rotated box's true AABB is larger, but the boxes are
   * what the user is dragging, and a footprint that grows when you spin a layer reads as a bug.
   */
 const footprint = (() => {
 if (!layers.length) return null
 let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
 for (const l of layers) {
 const r = resById[l.id]
 const sc = l.tf.scale || 1
 const w = (r?.width || NOMINAL_MM) * sc, h = (r?.height || NOMINAL_MM) * sc
 x0 = Math.min(x0, l.tf.x - w / 2); x1 = Math.max(x1, l.tf.x + w / 2)
 y0 = Math.min(y0, l.tf.y - h / 2); y1 = Math.max(y1, l.tf.y + h / 2)
    }
 const w = x1 - x0, h = y1 - y0
 return Number.isFinite(w) && w > 0 && h > 0 ? { w, h } : null
  })()

  /**
   * Resize the WHOLE arrangement to a target width, keeping its proportions and layout.
   *
   * One factor applied to every layer's scale AND its offset — scaling the sizes alone would
   * leave the pieces at their old spacing and pull the composition apart. clampScale still caps
   * each layer at 0.25–4, so an extreme target lands short rather than distorting the layout.
   */
 const resizeTo = (targetW: number) => {
 if (!footprint || !(targetW > 0)) return
 applyFactor(targetW / footprint.w)
  }

  /**
   * The same resize, driven by the HEIGHT instead.
   *
   * Height used to be a read-only number that followed the width, so a placement stated as a
   * height — a cap front is 50mm tall and the width is whatever the art makes it — could only
   * be reached by typing widths until the other number landed. Either dimension can now be the
   * one you pin; the arrangement keeps its proportions whichever you type, because a layer
   * carries ONE scale and there is no honest way to stretch one axis (see the note on the
   * inputs).
   */
 const resizeToHeight = (targetH: number) => {
 if (!footprint || !(targetH > 0)) return
 applyFactor(targetH / footprint.h)
  }

 const applyFactor = (f: number) => {
 if (!Number.isFinite(f) || f <= 0) return
 setLayers((prev) => prev.map((l) => ({
      ...l,
 tf: { ...l.tf, scale: clampScale((l.tf.scale || 1) * f), x: +(l.tf.x * f).toFixed(2), y: +(l.tf.y * f).toFixed(2) },
    })))
  }

  // Generate then download ONE format. The .emb is the MACHINE FILE (stitches only). The PNG
  // is the rendered image. Each click regenerates so it always reflects the current arrangement.
 const generateAnd = async (kind: "emb" | "png") => {
 const r = await generate()
 if (!r) return
 const stem = (r.machineFile?.filename || (hasText ? text.trim() : imgLayers[0]?.name) || "design").replace(/\.[^.]+$/, "")
 if (kind === "emb" && r.machineFile) download(r.machineFile.filename, `data:application/octet-stream;base64,${r.machineFile.base64}`)
 if (kind === "png" && r.trueview) download(`${stem}.png`, `data:image/png;base64,${r.trueview}`)
  }

  // Each layer previews on its OWN (a stitched TrueView) and you arrange THAT directly on the
  // canvas. Image layers are previewed on drop (see addImages); the TEXT layer re-fetches here
  // as the text/font/size/colour changes. Neither re-fires on move/resize — that's client-side.
 useEffect(() => {
 const active = hasText && !!alphabet
 let live = true
 const id = setTimeout(() => {
 if (!live) return
 if (!active) { setResById((m) => { if (!m["text"]) return m; const n = { ...m }; delete n["text"]; return n }); return }
 void wilcomLetteringPreview({ text: text.trim(), alphabet, height, color }).then((r) => { if (live && r.ok) setResById((m) => ({ ...m, text: r })) }).catch(() => {})
    }, active ? 550 : 0)
 return () => { live = false; clearTimeout(id) }
  }, [text, alphabet, height, color, hasText])

 const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
 const labelCls = "mb-1 block eg-label text-muted-foreground"
 const ext = res?.machineFile ? (res.machineFile.filename.split(".").pop()?.toUpperCase() || "EMB") : null
  // Live stitch estimate while arranging = sum of the layers' own previews (the generated
  // combine gives the exact figure once you Generate).
 const shownStitches = res?.stitches ?? (Object.values(resById).reduce((s, r) => s + (r.stitches ?? 0), 0) || null)
  // The cone currently selected, so the colour control can name it rather than show a bare hex.
 const selCone = palette.find((c) => c.hex.toLowerCase() === color.toLowerCase())
 const cones = pQuery ? palette.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(pQuery.toLowerCase())) : palette

  return (
    /*
     * CANVAS LEFT, SETTINGS RIGHT.
     *
     * It was the other way round: a 400px control column on the left and the design pushed to
     * the right edge. That is backwards for a tool you ARRANGE in — the thing you drag is the
     * thing that should own the page, and every control is a thing you touch once and leave
     * alone. Reading order put four blocks of settings between you and your own artwork.
     *
     * So the rail is one bounded column on the right that scrolls by itself, and the canvas
     * gets the whole rest of the width and stays put while you scroll it.
     */
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
      {/* ── LEFT — the design. Drop, drag, resize, rotate. ────────────────────────── */}
      <div className="order-1 space-y-2">
        <div className={"grid gap-2 " + (res?.trueview && compare ? "xl:grid-cols-2" : "grid-cols-1")}>
          <div className="space-y-1">
            {/* Clicking the empty canvas deselects — the layer boxes stopPropagation, so only a
                background click reaches here, dropping the selection (hides border/handles).
                THE CANVAS ITSELF TAKES A DROP. The only drop target used to be a dashed box in
                the control column, so "drag and drop" meant aiming at a 3cm strip beside the
                600px area that looks exactly like where a picture goes. */}
            <div
              onPointerDown={() => setOpenLayer(null)}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void addImages(e.dataTransfer.files) }}
              style={{ background: garment }}
              className={"relative flex min-h-[440px] w-full items-center justify-center overflow-hidden rounded-2xl border transition-colors lg:min-h-[620px] " + (over ? "border-primary ring-2 ring-ring/40" : "border-border")}
            >
              {!ready && (
                <div className="grid size-full place-items-center p-6 text-center text-sm text-muted-foreground">Drop an image here, or type text on the right.</div>
              )}
              {ready && err && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-30 m-2 flex items-start gap-2 rounded-lg bg-hold/10 px-3 py-2 text-sm text-hold"><Warning size={15} weight="fill" className="mt-0.5 shrink-0" /><span>{err}</span></div>
              )}
              {/* Layers arranged DIRECTLY — each shows its own stitched TrueView (or a placeholder
                  while it renders) and you drag / resize / rotate it in place. This IS the design;
                  Generate merges the layers into one .emb. No divergent combined render underneath. */}
              {/* Array order = stack order: later layers render last (on top), matching the panel.
                  Each box is sized in REAL mm (its stitched preview × the image scale), so the box
                  IS the true footprint and resizing an image scales it for real. */}
              {layers.map((l, i) => {
                const r = resById[l.id]
                const s = l.tf.scale || 1  // scale sizes BOTH: image → digitize width, text → letter height
                const effW = (r?.width || NOMINAL_MM) * s
                const effH = (r?.height || NOMINAL_MM) * s
                return (
                <LayerBoxEditor key={l.id} z={i + 1} wmm={effW} hmm={effH} tf={l.tf} onChange={(tf) => setLayerTf(l.id, tf)} selected={openLayer === l.id} onSelect={() => setOpenLayer(l.id)} ghost={
                  isImg(l)
                    ? (resById[l.id]?.trueview
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`data:image/png;base64,${resById[l.id]?.trueview}`} alt="" className="max-h-full max-w-full object-contain" />
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={l.thumb} alt="" className="max-h-full max-w-full object-contain opacity-60" />)
                    : (resById["text"]?.trueview
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`data:image/png;base64,${resById["text"]?.trueview}`} alt="" className="max-h-full max-w-full object-contain" />
                        : /* The ghost is lettering stitched in the SELECTED CONE on the SELECTED GARMENT, so
                             its colour is `color` — not text-foreground, which is near-white in dark
                             mode and disappeared completely against a pale garment (and would do the
                             same in light mode on a black one). The canvas is the blank, not the page. */
                          <span className="truncate px-1 text-center font-bold leading-none" style={{ color, fontSize: "clamp(0.75rem, 4vw, 2.75rem)" }}>{text}</span>)
                } />
                )
              })}
            </div>
            <div className="text-center text-2xs text-muted-foreground">Your arrangement — drag to position. Generate merges the layers into one file.</div>
          </div>
          {res?.trueview && compare && (
            <div className="space-y-1">
              <div style={{ background: garment }} className="relative flex min-h-[440px] w-full items-center justify-center overflow-hidden rounded-2xl border border-border lg:min-h-[620px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/png;base64,${res.trueview}`} alt="Generated stitched output" className="max-h-full max-w-full object-contain p-3" />
              </div>
              <div className="text-center text-2xs text-muted-foreground">Stitched result — what EWA actually generated{shownStitches ? ` · ${shownStitches.toLocaleString()} stitches` : ""}. Regenerate after moving layers.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT — the rail. Everything you set, in one column that scrolls on its own so the
             canvas beside it never moves. ─────────────────────────────────────────── */}
      <div className="order-2 flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        {/* Artwork — drop several. Each becomes its own layer you arrange + reorder below. */}
        <div>
          <label className={labelCls}>Artwork</label>
          <div className="space-y-1.5">
            {imgLayers.map((im) => (
              <div key={im.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.thumb} alt="" className="size-10 shrink-0 rounded-md border border-border object-contain" />
                <span className="min-w-0 flex-1 truncate text-sm">{im.name}</span>
                <button onClick={() => removeLayer(im.id)} title="Remove image" className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-alert"><X size={14} /></button>
              </div>
            ))}
            <label
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void addImages(e.dataTransfer.files) }}
              className={"flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-center text-xs font-medium transition-colors " + (over ? "border-primary bg-primary/5" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground")}
            >
              <ImageSquare size={15} />
              {imgLayers.length ? "Add another image" : "Choose an image"}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addImages(e.target.files); e.currentTarget.value = "" }} />
            </label>
          </div>
        </div>

        <div>
          <label className={labelCls}>Text {imgLayers.length ? "(stitched with the images)" : "(optional)"}</label>
          <input value={text} onChange={(e) => onTextChange(e.target.value)} placeholder="Type to add lettering…" className={inputCls} />
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
              <button onClick={() => setShowPalette((v) => !v)} className="text-2xs font-medium text-primary hover:underline">{showPalette ? "Done" : "Change colour"}</button>
            )}
          </div>
          {palette.length ? (
            <>
              <button onClick={() => setShowPalette((v) => !v)} className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40">
                <span className="size-6 shrink-0 rounded-md border border-border" style={{ background: color }} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{selCone?.name ?? "Custom colour"}</span>
                  <span className="block tabular-nums text-2xs text-muted-foreground">{selCone?.code ?? color}</span>
                </span>
              </button>
              {showPalette && (
                <div className="mt-2 rounded-lg border border-border bg-background p-2.5">
                  <input value={pQuery} onChange={(e) => setPQuery(e.target.value)} placeholder="Search cones by name or code…" className="mb-2 h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40" />
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

        {/* Garment colour — the preview backdrop, so you can judge the stitching on the blank
            you'll actually embroider. Cosmetic (doesn't touch the .emb). */}
        <div>
          <span className={labelCls}>Garment</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {GARMENTS.map((g) => (
              <button key={g.color} title={g.name} onClick={() => setGarment(g.color)}
                className={"size-5 rounded-full transition-transform hover:scale-110 " + (garment.toLowerCase() === g.color.toLowerCase() ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "border border-black/15")}
                style={{ background: g.color }} />
            ))}
            <label className="relative inline-flex size-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-border text-2xs text-muted-foreground" title="Custom colour">
              +<input type="color" value={garment} onChange={(e) => setGarment(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </div>
          {res?.trueview && (
            <button onClick={() => setCompare((c) => !c)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <Eye size={13} />{compare ? "Hide stitched result" : "Compare with stitched result"}
            </button>
          )}
        </div>

        {/* SIZE — the two numbers that decide whether a design fits a placement.
            INCHES, and only inches. It carried the size in mm with a separate inches readout
            beside it — the same two numbers twice. The floor sizes placements in inches, so
            that is the unit; mm survives underneath, because it is what EWA is given. */}
        <div>
          <span className={labelCls}>Size (inches)</span>
          {/* Empty until there is something to measure. An enabled-looking input with no value
              reads as a field that failed to load, not as "nothing here yet". */}
          {!footprint ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <input
                  inputMode="decimal"
                  value={wDraft ?? inOf(footprint.w)}
                  onChange={(e) => setWDraft(e.target.value)}
                  // Commit, then drop the draft so the box snaps back to the size actually
                  // achieved — clampScale can land short of the target, and showing the number
                  // you asked for instead of the one you got would hide that.
                  onBlur={() => { if (wDraft != null) { resizeTo(inToMm(wDraft)); setWDraft(null) } }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setWDraft(null) }}
                  aria-label="Design width in inches"
                  className="h-8 w-16 rounded-lg border border-input bg-background px-2 text-sm font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <span className="text-sm text-muted-foreground">×</span>
                {/* EITHER dimension can be typed. Both drive the SAME uniform resize — a layer
                    carries one scale, so there is no way to stretch one axis without lying about
                    what was actually produced. Pin the one the placement is stated in and the
                    other follows. */}
                <input
                  inputMode="decimal"
                  value={hDraft ?? inOf(footprint.h)}
                  onChange={(e) => setHDraft(e.target.value)}
                  onBlur={() => { if (hDraft != null) { resizeToHeight(inToMm(hDraft)); setHDraft(null) } }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setHDraft(null) }}
                  aria-label="Design height in inches"
                  className="h-8 w-16 rounded-lg border border-input bg-background px-2 text-sm font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
              {/* Same placements as the digitize modal, so a size learned in one is the same
                  button in the other. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {PLACEMENTS.map((pl) => (
                  <button
                    key={pl.label}
                    onClick={() => { setWDraft(null); resizeTo(Math.min(pl.w, pl.h * (footprint.w / footprint.h))) }}
                    className="eg-tap rounded-md border border-border px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {pl.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Layers — the elements in this design, TOP of the list = stitched on top. Each opens a
            move / resize / rotate panel feeding its <transform>; the carets reorder the stack. */}
        {layers.length > 0 && (
          <div>
            {/* Just "Layers". The trailing "· top of the list stitches on top" rode inside an
                eg-label, so it came out UPPERCASE and wrapped the heading over two lines in a
                340px rail — a sentence of explanation sitting on top of a control that already
                shows its own order and carries carets to change it. */}
            <span className={labelCls} title="Top of the list stitches on top">Layers</span>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {/* Reversed so the on-top (last-stitched) layer sits at the top of the list. */}
              {layers.slice().reverse().map((l) => {
                const ai = layers.findIndex((x) => x.id === l.id)
                return (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={() => setDragId(l.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragId) reorderTo(dragId, l.id); setDragId(null) }}
                    onDragEnd={() => setDragId(null)}
                    className={"transition-colors " + (dragId === l.id ? "opacity-40" : dragId ? "hover:bg-primary/5" : "")}
                  >
                    <div className="flex items-center gap-2 px-3 py-2 text-sm">
                      {isImg(l) ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={l.thumb} alt="" className="size-6 shrink-0 rounded border border-border object-contain" />
                          <span className="min-w-0 flex-1 truncate">{l.name}</span>
                        </>
                      ) : (
                        <>
                          <PencilSimple size={15} className="shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">“{text}”</span>
                        </>
                      )}
                      <button onClick={() => moveLayer(l.id, 1)} disabled={ai === layers.length - 1} title="Bring forward" className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"><CaretUp size={13} weight="bold" /></button>
                      <button onClick={() => moveLayer(l.id, -1)} disabled={ai === 0} title="Send back" className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"><CaretDown size={13} weight="bold" /></button>
                      <button onClick={() => setOpenLayer((o) => (o === l.id ? null : l.id))} title="Move / resize / rotate" className={"shrink-0 rounded p-0.5 transition-colors hover:bg-accent " + (openLayer === l.id ? "text-primary" : "text-muted-foreground")}><ArrowsOutCardinal size={14} /></button>
                      <button onClick={() => removeLayer(l.id)} title="Remove layer" className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-alert"><X size={13} /></button>
                    </div>
                    {openLayer === l.id && (
                      <div className="flex items-center justify-between gap-2 border-t border-border bg-primary/5 px-3 py-1.5 text-2xs text-muted-foreground">
                        <span className="min-w-0 truncate">Drag the box on the canvas — corner to resize, top nub to rotate</span>
                        <button type="button" onClick={() => setLayerTf(l.id, IDENTITY_TF)} className="shrink-0 font-medium text-primary hover:underline">Reset</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {err && <div className="flex items-start gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3 py-2 text-sm text-hold"><Warning size={15} weight="fill" className="mt-0.5 shrink-0" />{err}</div>}

        {/* The foot of the rail: what came out, and the two ways to take it away. Machine file
            = the .emb (stitches only, for the embroidery machine); PNG = the rendered image.
            mt-auto pins it to the bottom when the rail is shorter than the canvas. */}
        <div className="mt-auto space-y-2 border-t border-border pt-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xs text-muted-foreground">Stitches</div>
              <div className="text-base font-semibold tabular-nums">{shownStitches != null ? shownStitches.toLocaleString() : "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-2xs text-muted-foreground">File</div>
              <div className="text-base font-semibold">{ext ?? "—"}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void generateAnd("emb")} disabled={busy || !ready} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
              {status === "generating" ? <CircleNotch size={14} className="animate-spin" /> : null} EMB
            </button>
            <button onClick={() => void generateAnd("png")} disabled={busy || !ready} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">
              PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── History ──────────────────────────────────────────────────────────────────────
function HistoryTab() {
 const [rows, setRows] = useState<WilcomGeneration[] | null>(null)
 const [q, setQ] = useState("")
 const [zoom, setZoom] = useState<string | null>(null) // lightbox image src
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
              <tr className="border-b border-border text-left eg-label text-muted-foreground">
                <th className="px-4 py-3"></th><th className="px-4 py-3">Design</th><th className="px-4 py-3">Source</th>
                <th className="px-4 py-3 text-right">Stitches</th><th className="px-4 py-3 text-right">Colours</th>
                <th className="px-4 py-3">Formats</th><th className="px-4 py-3">Generated</th><th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => setZoom(g.id ? `/api/wilcom/asset/${g.id}/tv` : (g.trueview_url ?? ""))} title="Zoom in" className="relative flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted transition-transform hover:scale-110">
                      <Thumb src={g.id ? `/api/wilcom/asset/${g.id}/tv` : (g.trueview_url ?? "")} className="absolute inset-0 size-full" />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{g.name || "Untitled"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{g.order_ref || (g.source === "maker" ? "Maker" : "—")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.stitches != null ? g.stitches.toLocaleString() : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.colours ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums text-xs text-muted-foreground">{(g.formats ?? []).join(" · ") || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtDate(g.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <a href={`/api/wilcom/asset/${g.id}/file`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><DownloadSimple size={13} weight="bold" /> EMB</a>
                      <a href={`/api/wilcom/asset/${g.id}/tv`} download className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><DownloadSimple size={13} weight="bold" /> PNG</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Lightbox — click a design thumbnail to zoom; click anywhere / Esc to close. */}
      {zoom && (
        <div role="button" tabIndex={0} aria-label="Close full-size view" onClick={() => setZoom(null)} onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") setZoom(null) }} className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/80 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </>
  )
}
