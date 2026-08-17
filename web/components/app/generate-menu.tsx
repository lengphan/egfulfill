"use client"

import { useCallback, useRef, useState } from "react"
import { ImageSquare, FilmSlate, CircleNotch, Warning, Sparkle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getDeskImageConfig, generateDeskImage, getDeskVideoConfig, generateDeskVideo,
  type DeskImageConfig, type DeskVideoConfig, type ChatAttachment,
} from "@/lib/api"

type Mode = "image" | "video"

/**
 * Generate an image or a video into the staffer's own assistant channel.
 *
 * A still or a clip, chosen from one control rather than two buttons.
 *
 * Factory-only and billed per generation — 13¢ an image, 40¢ to $4.80 a clip — so the
 * price of the CURRENT selection is always on the button before it's pressed. Config is
 * fetched on OPEN, an event, never from an effect watching state the fetch would rewrite.
 */
export function GenerateButton({ disabled, onImage, onVideoStarted }: {
  disabled?: boolean
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

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const promptRef = useRef<HTMLInputElement>(null)

  const isVideo = mode === "video"
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

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
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
                  <select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setErr(null) }} disabled={busy} className={selectCls}>
                    <option value="image">Image — a still</option>
                    <option value="video">Video — from a description</option>
                  </select>
                </div>


                <Input
                  ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run() } }}
                  placeholder={isVideo
                    ? "A folded tee on warm oak, camera drifting past…"
                    : "A folded heather-grey tee on warm oak, soft daylight…"}
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

                <Button className="h-9 w-full gap-1.5" onClick={run} disabled={busy || !prompt.trim()}>
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

/**
 * "Animate" — sits ON the image it would animate, in the chat.
 *
 * This started life as a third mode in the menu above, which was the wrong shape: it made
 * you pick a mode, then pick which picture, when the picture was already on screen in front
 * of you. Here the subject is implicit — you press it on the still you mean — and the only
 * thing left to say is how it should move.
 *
 * The server takes the bare asset NAME, never a URL, so it can only ever read back an object
 * we already stored for this chat.
 */
export function AnimateImageButton({ imageName, onStarted }: {
  imageName: string
  onStarted: (info: { jobId: string; usd: number; seconds: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState<DeskVideoConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState("")
  const [res, setRes] = useState("")
  const [ratio, setRatio] = useState("9:16")
  const [secs, setSecs] = useState(8)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const promptRef = useRef<HTMLInputElement>(null)

  const spec = cfg?.models.find((m) => m.id === model) || null
  const effRes = spec ? (spec.resolutions.includes(res) ? res : spec.defaultResolution) : res
  const usd = spec ? (spec.usdPerSec[effRes] ?? 0) * secs : 0

  const toggle = useCallback(async (e: React.MouseEvent) => {
    // The image sits inside a link to the full-size file; opening the panel must not
    // navigate away from the conversation.
    e.preventDefault(); e.stopPropagation()
    const next = !open
    setOpen(next)
    if (!next || cfg || loading) return
    setLoading(true)
    try {
      const c = await getDeskVideoConfig()
      setCfg(c); setModel(c.model)
      setRes(c.models.find((m) => m.id === c.model)?.defaultResolution || "1080p")
      setTimeout(() => promptRef.current?.focus(), 0)
    } catch (e2) {
      setErr(e2 instanceof Error ? `Couldn't load the video settings — ${e2.message}` : "Couldn't load the video settings.")
    } finally {
      setLoading(false)
    }
  }, [open, cfg, loading])

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await generateDeskVideo({ prompt: text, aspectRatio: ratio, resolution: effRes, durationSeconds: secs, model, imageName })
      if (!r.ok || !r.jobId) { setErr(r.error || "That didn't work."); return }
      onStarted({ jobId: r.jobId, usd: r.usd ?? usd, seconds: r.seconds ?? secs })
      setPrompt(""); setOpen(false)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "That didn't work.")
    } finally {
      setBusy(false)
    }
  }

  const selectCls = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs"

  return (
    <>
      <button
        type="button" onClick={toggle} aria-label="Animate this image"
        className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-2xs font-medium shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
      >
        {busy ? <CircleNotch size={12} className="animate-spin" /> : <FilmSlate size={12} weight="duotone" />}
        Animate
      </button>

      {open && (
        <>
          <button aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }} />
          <div
            className="absolute right-1.5 top-9 z-30 w-72 rounded-lg border border-border bg-card p-2.5 text-left shadow-lg"
            onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          >
            <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Animate this still</div>

            {loading && <div className="py-4 text-center"><CircleNotch size={14} className="mx-auto animate-spin text-muted-foreground" /></div>}

            {!loading && !cfg && (
              <p className="text-xs text-destructive">{err || "Couldn't load the video settings."}</p>
            )}

            {cfg && !cfg.enabled && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {!cfg.keySet ? "No Google AI key is set — an admin can add one in Settings › Integrations." : "File storage isn't configured, so a clip couldn't be kept."}
              </p>
            )}

            {cfg?.enabled && (
              <div className="space-y-2">
                <Input
                  ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run() } }}
                  placeholder="Slow push-in, light moving across the fabric…"
                  className="h-8 text-xs" disabled={busy}
                />
                <select value={model} disabled={busy} className={selectCls}
                  onChange={(e) => {
                    const id = e.target.value; setModel(id)
                    const m = cfg.models.find((x) => x.id === id)
                    if (m && !m.resolutions.includes(res)) setRes(m.defaultResolution)
                  }}>
                  {cfg.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <div className="grid grid-cols-3 gap-1.5">
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)} disabled={busy} className={selectCls}>
                    {cfg.ratios.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={effRes} onChange={(e) => setRes(e.target.value)} disabled={busy} className={selectCls}>
                    {(spec?.resolutions || []).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} disabled={busy} className={selectCls}>
                    {(cfg.durations || [8]).map((d) => <option key={d} value={d}>{d}s</option>)}
                  </select>
                </div>
                {err && <p className="text-xs text-destructive">{err}</p>}
                <p className="text-2xs text-muted-foreground">Takes 1–3 minutes; it appears in this chat when it&rsquo;s ready.</p>
                <Button className="h-8 w-full gap-1.5 text-xs" onClick={run} disabled={busy || !prompt.trim()}>
                  {busy ? <CircleNotch size={12} className="animate-spin" /> : <FilmSlate size={12} />}
                  {busy ? "Starting…" : `Animate · ~$${usd.toFixed(2)}`}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
