"use client"

import { useCallback, useRef, useState } from "react"
import { ImageSquare, FilmSlate, CircleNotch, Warning, Sparkle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getDeskImageConfig, generateDeskImage, getDeskVideoConfig, generateDeskVideo,
  type DeskImageConfig, type DeskVideoConfig, type ChatAttachment,
} from "@/lib/api"

/** A still already in this thread, offered as the first frame for an animation. */
export type FrameChoice = { name: string; url: string; label: string }

type Mode = "image" | "video" | "animate"

/**
 * Generate an image or a video into the staffer's own assistant channel.
 *
 * Three modes rather than a chain, because you don't always want to go through a still:
 * sometimes it's a picture, sometimes a clip straight from a description, and sometimes
 * animating a product shot you already rendered so the garment stays the one you approved.
 *
 * Factory-only and billed per generation — 13¢ an image, 40¢ to $4.80 a clip — so the
 * price of the CURRENT selection is always on the button before it's pressed. Config is
 * fetched on OPEN, an event, never from an effect watching state the fetch would rewrite.
 */
export function GenerateButton({ disabled, frames, onImage, onVideoStarted }: {
  disabled?: boolean
  /** Recent stills from this thread, newest first — the pool for "Animate a still". */
  frames?: FrameChoice[]
  onImage: (att: ChatAttachment) => void
  onVideoStarted: (info: { jobId: string; usd: number; seconds: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("image")
  const [img, setImg] = useState<DeskImageConfig | null>(null)
  const [vid, setVid] = useState<DeskVideoConfig | null>(null)
  const [loading, setLoading] = useState(false)

  const [prompt, setPrompt] = useState("")
  const [imgModel, setImgModel] = useState("")
  const [imgSize, setImgSize] = useState("")
  const [imgRatio, setImgRatio] = useState("1:1")
  const [vidModel, setVidModel] = useState("")
  const [vidRes, setVidRes] = useState("")
  const [vidRatio, setVidRatio] = useState("9:16")
  const [secs, setSecs] = useState(8)
  const [frame, setFrame] = useState<string>("")

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const promptRef = useRef<HTMLInputElement>(null)

  const isVideo = mode === "video" || mode === "animate"
  const imgSpec = img?.models.find((m) => m.id === imgModel) || null
  const vidSpec = vid?.models.find((m) => m.id === vidModel) || null
  // A resolution one variant offers may not exist on another (Lite has no 4K), so switching
  // models can strand an impossible pick — fall through the variant's own default.
  const effImgSize = imgSpec ? (imgSpec.sizes.includes(imgSize) ? imgSize : imgSpec.defaultSize) : imgSize
  const effVidRes = vidSpec ? (vidSpec.resolutions.includes(vidRes) ? vidRes : vidSpec.defaultResolution) : vidRes

  const usd = isVideo
    ? (vidSpec ? (vidSpec.usdPerSec[effVidRes] ?? 0) * secs : 0)
    : (imgSpec ? (imgSpec.usd[effImgSize] ?? 0) : 0)

  const cfg = isVideo ? vid : img
  const ratios = isVideo ? (vid?.ratios ?? []) : (img?.ratios ?? [])
  const hints = isVideo ? (vid?.ratioHints ?? {}) : (img?.ratioHints ?? {})

  const openMenu = useCallback(async () => {
    const next = !open
    setOpen(next)
    if (!next || (img && vid) || loading) return
    setLoading(true)
    try {
      const [i, v] = await Promise.all([getDeskImageConfig(), getDeskVideoConfig()])
      setImg(i); setVid(v)
      setImgModel(i.model); setImgSize(i.models.find((m) => m.id === i.model)?.defaultSize || "1K")
      setVidModel(v.model); setVidRes(v.models.find((m) => m.id === v.model)?.defaultResolution || "1080p")
      setTimeout(() => promptRef.current?.focus(), 0)
    } catch (e) {
      // Keep the REAL reason (a 403, a 502, a network failure) — "couldn't load" alone
      // sent the last person who hit this looking in entirely the wrong place.
      setErr(e instanceof Error ? `Couldn't load the generation settings — ${e.message}` : "Couldn't load the generation settings.")
    } finally {
      setLoading(false)
    }
  }, [open, img, vid, loading])

  const pickMode = (m: Mode) => {
    setMode(m); setErr(null)
    // Animating needs a frame; default to the newest so the common case is one click.
    if (m === "animate" && !frame && frames?.length) setFrame(frames[0].name)
  }

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    if (mode === "animate" && !frame) { setErr("Pick which still to animate."); return }
    setBusy(true); setErr(null)
    try {
      if (mode === "image") {
        const r = await generateDeskImage({ prompt: text, aspectRatio: imgRatio, imageSize: effImgSize, model: imgModel })
        if (!r.ok || !r.attachment) { setErr(r.error || (r.disabled ? "Image generation is off — an admin can add the Google AI key in Settings › Integrations." : "That didn't work.")); return }
        onImage(r.attachment)
      } else {
        const r = await generateDeskVideo({
          prompt: text, aspectRatio: vidRatio, resolution: effVidRes,
          durationSeconds: secs, model: vidModel,
          imageName: mode === "animate" ? frame : undefined,
        })
        if (!r.ok || !r.jobId) { setErr(r.error || (r.disabled ? "Video generation is off — an admin can add the Google AI key in Settings › Integrations." : "That didn't work.")); return }
        onVideoStarted({ jobId: r.jobId, usd: r.usd ?? usd, seconds: r.seconds ?? secs })
      }
      setPrompt(""); setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.")
    } finally {
      setBusy(false)
    }
  }

  const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

  return (
    <div className="relative shrink-0">
      <Button variant="ghost" size="icon" className="size-10" onClick={openMenu} disabled={disabled} aria-label="Generate an image or video">
        {busy ? <CircleNotch size={16} className="animate-spin" /> : <Sparkle size={18} />}
      </Button>

      {open && (
        <>
          <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-[70vh] w-[23rem] overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-lg">
            <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Generate</div>

            {loading && <div className="py-6 text-center"><CircleNotch size={16} className="mx-auto animate-spin text-muted-foreground" /></div>}

            {/* The config didn't load. Without this the popover rendered an EMPTY BOX —
                `err` was only shown inside the enabled branch, so "the server is down" and
                "there's nothing here" looked identical. Say what happened and offer the
                retry, since the usual cause is a blip rather than a broken install. */}
            {!loading && !cfg && (
              <div className="space-y-2 py-2">
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <Warning size={14} className="mt-0.5 shrink-0" />
                  <span>{err || "Couldn't load the generation settings."}</span>
                </div>
                <Button size="sm" variant="outline" className="h-8 w-full"
                  onClick={() => { setErr(null); setOpen(false); setTimeout(openMenu, 0) }}>
                  Try again
                </Button>
              </div>
            )}

            {cfg && !cfg.enabled && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <Warning size={14} className="mt-0.5 shrink-0" />
                <span>{!cfg.keySet
                  ? "No Google AI key is set. An admin can add one in Settings › Integrations."
                  : "File storage isn't configured, so what's generated couldn't be kept."}</span>
              </div>
            )}

            {cfg?.enabled && (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 text-2xs text-muted-foreground">What are we making?</div>
                  <select value={mode} onChange={(e) => pickMode(e.target.value as Mode)} disabled={busy} className={selectCls}>
                    <option value="image">Image — a still</option>
                    <option value="video">Video — from a description</option>
                    <option value="animate" disabled={!frames?.length}>
                      {frames?.length ? "Animate a still from this chat" : "Animate a still — none in this chat yet"}
                    </option>
                  </select>
                </div>

                {mode === "animate" && !!frames?.length && (
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">First frame</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {frames.slice(0, 8).map((f) => (
                        <button
                          key={f.name} type="button" onClick={() => setFrame(f.name)} title={f.label}
                          className={"size-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors " + (frame === f.name ? "border-primary" : "border-transparent hover:border-border")}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.url} alt={f.label} className="size-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <Input
                  ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run() } }}
                  placeholder={mode === "animate"
                    ? "Slow push-in, fabric shifting gently in the light…"
                    : isVideo ? "A folded tee on warm oak, camera drifting past…" : "A folded heather-grey tee on warm oak, soft daylight…"}
                  className="h-9 text-sm" disabled={busy}
                />

                <div>
                  <div className="mb-1 text-2xs text-muted-foreground">Model</div>
                  {isVideo ? (
                    <select value={vidModel} disabled={busy} className={selectCls}
                      onChange={(e) => {
                        const id = e.target.value; setVidModel(id)
                        const m = vid?.models.find((x) => x.id === id)
                        if (m && !m.resolutions.includes(vidRes)) setVidRes(m.defaultResolution)
                      }}>
                      {vid?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  ) : (
                    <select value={imgModel} disabled={busy} className={selectCls}
                      onChange={(e) => {
                        const id = e.target.value; setImgModel(id)
                        const m = img?.models.find((x) => x.id === id)
                        if (m && !m.sizes.includes(imgSize)) setImgSize(m.defaultSize)
                      }}>
                      {img?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  )}
                  {(isVideo ? vidSpec?.note : imgSpec?.note) && (
                    <p className="mt-1 text-2xs leading-snug text-muted-foreground">{isVideo ? vidSpec?.note : imgSpec?.note}</p>
                  )}
                </div>

                <div className={"grid gap-2 " + (isVideo ? "grid-cols-3" : "grid-cols-2")}>
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">Shape</div>
                    <select value={isVideo ? vidRatio : imgRatio} disabled={busy} className={selectCls}
                      onChange={(e) => (isVideo ? setVidRatio(e.target.value) : setImgRatio(e.target.value))}>
                      {ratios.map((r) => <option key={r} value={r}>{hints[r] ? `${r} — ${hints[r]}` : r}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">{isVideo ? "Quality" : "Size"}</div>
                    {isVideo ? (
                      <select value={effVidRes} onChange={(e) => setVidRes(e.target.value)} disabled={busy} className={selectCls}>
                        {(vidSpec?.resolutions || []).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <select value={effImgSize} onChange={(e) => setImgSize(e.target.value)} disabled={busy} className={selectCls}>
                        {(imgSpec?.sizes || []).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                  </div>
                  {isVideo && (
                    <div>
                      <div className="mb-1 text-2xs text-muted-foreground">Length</div>
                      <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} disabled={busy} className={selectCls}>
                        {(vid?.durations || [8]).map((d) => <option key={d} value={d}>{d}s</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {err && <p className="text-xs text-destructive">{err}</p>}
                {isVideo && (
                  // Set the expectation before the spend, not after: this is the one action
                  // here that does not come back in the same breath you asked.
                  <p className="text-2xs text-muted-foreground">Clips take 1–3 minutes. It appears in this chat when it&rsquo;s ready — you can carry on meanwhile.</p>
                )}

                <Button className="h-9 w-full gap-1.5" onClick={run} disabled={busy || !prompt.trim() || (mode === "animate" && !frame)}>
                  {busy ? <CircleNotch size={14} className="animate-spin" /> : isVideo ? <FilmSlate size={14} /> : <ImageSquare size={14} />}
                  {busy ? (isVideo ? "Starting…" : "Generating…") : `Generate · ~$${usd.toFixed(usd < 1 ? 3 : 2)}`}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
