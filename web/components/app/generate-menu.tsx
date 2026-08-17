"use client"

import { useCallback, useState } from "react"
import { ImageSquare, FilmSlate, CircleNotch, Warning, Sparkle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getDeskImageConfig, getDeskVideoConfig, type DeskImageConfig, type DeskVideoConfig } from "@/lib/api"

/**
 * What the composer is armed to make. Null means the message box behaves normally.
 *
 * This is the whole design: the panel picks SETTINGS, a pill shows what is armed, and the
 * words come from the chat box you were already typing in. There is no second prompt field
 * and no separate send button — pressing Enter generates, exactly as it posts a message.
 */
export type GenSettings = {
  mode: "image" | "video"
  model: string
  ratio: string
  /** image only */
  size?: string
  /** video only */
  resolution?: string
  seconds?: number
  /** video only — animate this stored still as the first frame */
  imageName?: string
  /** Cost of one generation with these settings, shown on the pill before anything runs. */
  usd: number
  /** Short human label for the pill. */
  label: string
}

type Mode = "image" | "video"

/**
 * The settings panel. It does NOT generate anything — it arms the composer and closes.
 */
export function GenerateButton({ disabled, armed, onArm }: {
  disabled?: boolean
  armed: GenSettings | null
  onArm: (g: GenSettings | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("image")
  const [img, setImg] = useState<DeskImageConfig | null>(null)
  const [vid, setVid] = useState<DeskVideoConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [imgModel, setImgModel] = useState("")
  const [imgSize, setImgSize] = useState("")
  const [imgRatio, setImgRatio] = useState("1:1")
  const [vidModel, setVidModel] = useState("")
  const [vidRes, setVidRes] = useState("")
  const [vidRatio, setVidRatio] = useState("9:16")
  const [secs, setSecs] = useState(8)

  const isVideo = mode === "video"
  const imgSpec = img?.models.find((m) => m.id === imgModel) || null
  const vidSpec = vid?.models.find((m) => m.id === vidModel) || null
  // A size one variant offers may not exist on another (Lite has no 4K), so switching models
  // can strand an impossible pick — fall through the variant's own default.
  const effImgSize = imgSpec ? (imgSpec.sizes.includes(imgSize) ? imgSize : imgSpec.defaultSize) : imgSize
  const effVidRes = vidSpec ? (vidSpec.resolutions.includes(vidRes) ? vidRes : vidSpec.defaultResolution) : vidRes

  const usd = isVideo
    ? (vidSpec ? (vidSpec.usdPerSec[effVidRes] ?? 0) * secs : 0)
    : (imgSpec ? (imgSpec.usd[effImgSize] ?? 0) : 0)

  const cfg = isVideo ? vid : img
  const ratios = isVideo ? (vid?.ratios ?? []) : (img?.ratios ?? [])
  const hints = isVideo ? (vid?.ratioHints ?? {}) : (img?.ratioHints ?? {})

  // Config is fetched on OPEN — an event — never from an effect watching state the fetch
  // would itself rewrite.
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
    } catch (e) {
      // Keep the REAL reason (a 403, a 502, a network failure) — "couldn't load" alone sends
      // the reader looking in entirely the wrong place.
      setErr(e instanceof Error ? `Couldn't load the generation settings — ${e.message}` : "Couldn't load the generation settings.")
    } finally {
      setLoading(false)
    }
  }, [open, img, vid, loading])

  const arm = () => {
    onArm(isVideo
      ? {
        mode: "video", model: vidModel, ratio: vidRatio, resolution: effVidRes, seconds: secs, usd,
        label: `Video · ${effVidRes} · ${secs}s`,
      }
      : {
        mode: "image", model: imgModel, ratio: imgRatio, size: effImgSize, usd,
        label: `Image · ${effImgSize} · ${imgRatio}`,
      })
    setOpen(false)
  }

  const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

  return (
    <div className="relative shrink-0">
      <Button
        variant={armed ? "default" : "ghost"} size="icon" className="size-10"
        onClick={openMenu} disabled={disabled} aria-label="Choose what to generate"
      >
        <Sparkle size={18} weight={armed ? "fill" : "regular"} />
      </Button>

      {open && (
        <>
          <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-[70vh] w-[23rem] overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-lg">
            <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Generate</div>

            {loading && <div className="py-6 text-center"><CircleNotch size={16} className="mx-auto animate-spin text-muted-foreground" /></div>}

            {/* Without this the popover rendered an EMPTY BOX when the config failed to load —
                "the server is down" and "there's nothing here" looked identical. */}
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
                  <select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setErr(null) }} className={selectCls}>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 text-2xs text-muted-foreground">Model</div>
                  {isVideo ? (
                    <select value={vidModel} className={selectCls}
                      onChange={(e) => {
                        const id = e.target.value; setVidModel(id)
                        const m = vid?.models.find((x) => x.id === id)
                        if (m && !m.resolutions.includes(vidRes)) setVidRes(m.defaultResolution)
                      }}>
                      {vid?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  ) : (
                    <select value={imgModel} className={selectCls}
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
                    <select value={isVideo ? vidRatio : imgRatio} className={selectCls}
                      onChange={(e) => (isVideo ? setVidRatio(e.target.value) : setImgRatio(e.target.value))}>
                      {ratios.map((r) => <option key={r} value={r}>{hints[r] ? `${r} — ${hints[r]}` : r}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">{isVideo ? "Quality" : "Size"}</div>
                    {isVideo ? (
                      <select value={effVidRes} onChange={(e) => setVidRes(e.target.value)} className={selectCls}>
                        {(vidSpec?.resolutions || []).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <select value={effImgSize} onChange={(e) => setImgSize(e.target.value)} className={selectCls}>
                        {(imgSpec?.sizes || []).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                  </div>
                  {isVideo && (
                    <div>
                      <div className="mb-1 text-2xs text-muted-foreground">Length</div>
                      <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} className={selectCls}>
                        {(vid?.durations || [8]).map((d) => <option key={d} value={d}>{d}s</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/* Arms the composer; it does not spend anything yet. The price rides onto the
                    pill so it stays visible while you type, not only at the moment of choosing. */}
                <Button className="h-9 w-full gap-1.5" onClick={arm}>
                  {isVideo ? <FilmSlate size={14} /> : <ImageSquare size={14} />}
                  Use {isVideo ? "Video" : "Image"} · ~${usd.toFixed(usd < 1 ? 3 : 2)}
                </Button>
                <p className="text-2xs text-muted-foreground">
                  Then type in the message box and press Enter — it goes to the model instead of the chat.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * "Animate" — sits ON the image it would animate.
 *
 * It arms the composer the same way the panel does, with the still's asset name carried as
 * the first frame. The flow never changes: press it, then describe the motion in the box you
 * were already typing in.
 */
export function AnimateImageButton({ imageName, onArm }: {
  imageName: string
  onArm: (g: GenSettings) => void
}) {
  const [busy, setBusy] = useState(false)

  const arm = async (e: React.MouseEvent) => {
    // The image sits inside a link to the full-size file; arming must not navigate away.
    e.preventDefault(); e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const c = await getDeskVideoConfig()
      const m = c.models.find((x) => x.id === c.model) || c.models[0]
      if (!m) return
      const res = m.defaultResolution
      onArm({
        mode: "video", model: m.id, ratio: "9:16", resolution: res, seconds: 8,
        imageName, usd: (m.usdPerSec[res] ?? 0) * 8,
        label: `Animate · ${res} · 8s`,
      })
    } catch { /* the pill is the feedback; a failed arm simply doesn't arm */ } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button" onClick={arm} aria-label="Animate this image"
      className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-2xs font-medium shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
    >
      {busy ? <CircleNotch size={12} className="animate-spin" /> : <FilmSlate size={12} weight="duotone" />}
      Animate
    </button>
  )
}
