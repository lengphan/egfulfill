"use client"

import { useCallback, useEffect, useState } from "react"
import { Needle, Storefront, PencilSimple, ClockCounterClockwise, MagnifyingGlass, CircleNotch, Eye, DownloadSimple, Warning, ArrowsClockwise } from "@phosphor-icons/react"
import { canvasReadableSrc } from "@/lib/thread-match"
import { getOrderUploads, wilcomPreview, wilcomDigitize, getWilcomGenerations, type OrderUpload, type WilcomResult, type WilcomGeneration } from "@/lib/api"

type Tab = "synced" | "maker" | "history"

// Load a (possibly remote) image through the same-origin proxy so the canvas isn't tainted,
// downscale it, and return a data URL under EWA's 2MB auto-digitize cap. Reused canvas
// pattern — the proxy + reduced edge keep us well under the pixel/size limits.
function toDataUrl(url: string, maxEdge = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement("canvas"); c.width = w; c.height = h
      const ctx = c.getContext("2d")
      if (!ctx) { reject(new Error("Canvas unavailable")); return }
      ctx.drawImage(img, 0, 0, w, h)
      try { resolve(c.toDataURL("image/jpeg", quality)) }
      catch { reject(new Error("Couldn't read the artwork (cross-origin)")) }
    }
    img.onerror = () => reject(new Error("Couldn't load the artwork"))
    img.src = canvasReadableSrc(url)
  })
}

function download(name: string, dataUrl: string) {
  const a = document.createElement("a")
  a.href = dataUrl; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
}

const fmtDate = (s?: string) => {
  if (!s) return ""
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

type CardState = { status: "idle" | "previewing" | "generating"; res?: WilcomResult; err?: string }

export function DigitizerStudio() {
  const [tab, setTab] = useState<Tab>("synced")

  return (
    <div className="mx-auto w-full max-w-5xl p-5 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Needle size={22} weight="duotone" /></span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Digitizer</h1>
          <p className="text-sm text-muted-foreground">Turn synced-order artwork into an embroidery preview and a machine file — or build one from scratch.</p>
        </div>
      </div>

      <div className="mt-5 flex w-fit rounded-full border border-border p-0.5">
        {([{ id: "synced", label: "Synced orders", icon: Storefront }, { id: "maker", label: "Maker", icon: PencilSimple }, { id: "history", label: "History", icon: ClockCounterClockwise }] as const).map((t) => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={"eg-tap inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon size={15} weight={tab === t.id ? "fill" : "regular"} /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        {tab === "synced" ? <SyncedTab /> : tab === "maker" ? <MakerTab /> : <HistoryTab />}
      </div>
    </div>
  )
}

// ── Synced orders ──────────────────────────────────────────────────────────────
function SyncedTab() {
  const [items, setItems] = useState<OrderUpload[] | null>(null)
  const [q, setQ] = useState("")
  const [cards, setCards] = useState<Record<string, CardState>>({})

  useEffect(() => {
    const id = setTimeout(() => { getOrderUploads().then((r) => setItems(r.images ?? [])).catch(() => setItems([])) }, 0)
    return () => clearTimeout(id)
  }, [])

  const run = async (u: OrderUpload, design: boolean) => {
    setCards((p) => ({ ...p, [u.url]: { status: design ? "generating" : "previewing" } }))
    try {
      const image = await toDataUrl(u.url)
      const res = design
        ? await wilcomDigitize({ image, filename: u.name || "art", name: u.name || u.orderRef, orderRef: u.orderRef, source: "order" })
        : await wilcomPreview({ image, filename: u.name || "art" })
      if (!res.ok) throw new Error(res.error || "EWA rejected the request")
      setCards((p) => ({ ...p, [u.url]: { status: "idle", res } }))
    } catch (e) {
      setCards((p) => ({ ...p, [u.url]: { status: "idle", err: e instanceof Error ? e.message : "Failed" } }))
    }
  }

  const list = (items ?? []).filter((u) => !q || `${u.name} ${u.orderRef}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground"><b className="text-foreground">Preview</b> to read stitch count &amp; price, then <b className="text-foreground">Generate</b> the machine file.</p>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search design or order…" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40" />
        </div>
        {items && <span className="ml-auto text-xs text-muted-foreground">{q ? `${list.length} of ${items.length}` : `${items.length} with artwork`}</span>}
      </div>

      {items === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">{q ? `No artwork matches “${q}”.` : "No buyer artwork on your orders yet."}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((u) => {
            const st = cards[u.url] ?? { status: "idle" as const }
            const r = st.res
            const busy = st.status !== "idle"
            const tv = r?.trueview ? `data:image/png;base64,${r.trueview}` : null
            return (
              <div key={u.url} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="relative aspect-[4/3] bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tv || canvasReadableSrc(u.url)} alt={u.name} className="size-full object-cover" />
                  <span className={"absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10.5px] font-semibold uppercase " + (r ? "bg-emerald-500 text-white" : "bg-background/85 text-muted-foreground")}>{r ? (r.machineFile ? "Generated" : "Preview") : "Artwork"}</span>
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <div className="truncate text-sm font-medium">{u.name || "Untitled"}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.orderRef}</div>
                  {r && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {r.stitches != null && <span><b className="tabular-nums text-foreground">{r.stitches.toLocaleString()}</b> stitches</span>}
                      {r.colours != null && <span><b className="text-foreground">{r.colours}</b> colours</span>}
                      {r.width != null && r.height != null && <span className="tabular-nums text-foreground">{Math.round(r.width)} × {Math.round(r.height)} mm</span>}
                    </div>
                  )}
                  {st.err && <div className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400"><Warning size={13} weight="fill" className="mt-0.5 shrink-0" />{st.err}</div>}
                  <div className="mt-auto flex gap-2 pt-3">
                    <button onClick={() => run(u, false)} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">
                      {st.status === "previewing" ? <CircleNotch size={14} className="animate-spin" /> : <Eye size={14} />} Preview
                    </button>
                    {r?.machineFile ? (
                      <button onClick={() => download(r.machineFile!.filename, `data:application/octet-stream;base64,${r.machineFile!.base64}`)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                        <DownloadSimple size={14} weight="bold" /> File
                      </button>
                    ) : (
                      <button onClick={() => run(u, true)} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                        {st.status === "generating" ? <CircleNotch size={14} className="animate-spin" /> : null} Generate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── Maker (Phase 2) ──────────────────────────────────────────────────────────────
function MakerTab() {
  return (
    <div className="rounded-2xl border border-dashed border-border py-16 text-center">
      <PencilSimple size={26} weight="duotone" className="mx-auto text-muted-foreground/50" />
      <div className="mt-2 text-sm font-medium">Lettering &amp; monogram maker</div>
      <div className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Type text, pick an alphabet and thread, preview the TrueView, and export — lands in the next build (Phase 2).</div>
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
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">{q ? `No generations match “${q}”.` : "Nothing generated yet — generate a design from Synced orders."}</div>
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
                  <td className="px-4 py-2.5">
                    <span className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {g.trueview_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={g.trueview_url} alt="" className="size-full object-cover" />
                        : <Needle size={16} className="text-muted-foreground/40" />}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{g.name || "Untitled"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{g.order_ref || (g.source === "maker" ? "Maker" : "—")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.stitches != null ? g.stitches.toLocaleString() : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.colours ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{(g.formats ?? []).join(" · ") || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtDate(g.created_at)}</td>
                  <td className="px-4 py-2.5">
                    {g.file_url && <a href={g.file_url} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><DownloadSimple size={13} weight="bold" /> Download</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
