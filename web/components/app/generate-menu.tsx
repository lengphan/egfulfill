"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Warning, Sparkle, ImageSquare, FilmSlate, CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getDeskImageConfig, getDeskVideoConfig, type DeskImageConfig, type DeskVideoConfig, type Backdrop } from "@/lib/api"
import { cheapestImage, cheapestSize, cheapestVideo, cheapestResolution, modelOptionLabel } from "@/lib/ai-cheapest"

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
  /** image only — ask for a flat sweep the browser cut-out can separate afterwards.
   *  Undefined means "as described", which is the default and stays the default: most
   *  renders are lifestyle shots where a seamless backdrop would be wrong. */
 backdrop?: Backdrop
  /** video only */
 resolution?: string
 seconds?: number
  /** video only — animate this stored still as the first frame */
 imageName?: string
  /** …and its URL, so the composer can SHOW which picture is being animated. Without it,
   *  "Video" armed from the panel and "Animate" pressed on a photo looked identical. */
 imageUrl?: string
  /** Cost of one generation with these settings, shown on the pill before anything runs. */
 usd: number
  /** Short human label. */
 label: string
  /** The compact form for the trigger chip — just the settings, no noun: "2K · 1:1". */
 short: string
}

type Mode = "image" | "video"

/**
 * The settings panel. It does NOT generate anything — it arms the composer and closes.
 */
export function GenerateButton({ disabled, armed, onArm, allowVideo = true, priceNote, autoArm = false }: {
 disabled?: boolean
 armed: GenSettings | null
 onArm: (g: GenSettings | null) => void
  /** Arm with the default model as soon as the composer mounts, so a channel that exists
   *  ONLY for generating does not make someone open a settings panel to confirm defaults
   * the panel would have filled in anyway. Typing and pressing Enter becomes the whole
   * interaction; the panel stays there for changing a setting, not for starting. */
 autoArm?: boolean
  /** Sellers buy images only — video stays a factory tool, so the choice is not offered. */
 allowVideo?: boolean
  /** What this caller pays, e.g. "$0.50 each" or "3 free left this month". Shown so the
   * price is visible BEFORE the button is pressed, not discovered on the wallet after. */
 priceNote?: string | null
}) {
 const [open, setOpen] = useState(false)
 const [mode, setMode] = useState<Mode>("image")
 const [backdrop, setBackdrop] = useState<Backdrop | "">("")
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

  // Belt as well as braces: hiding the selector stops the choice being MADE, but the mode
  // is state and this is what stops a seller ever arming a video the server would refuse.
 const isVideo = mode === "video" && allowVideo
 const imgSpec = img?.models.find((m) => m.id === imgModel) || null
 const vidSpec = vid?.models.find((m) => m.id === vidModel) || null
  // Which row the picker is RECOMMENDING, marked in the list so the default reads as a
  // choice rather than as whatever happened to be selected.
 const cheapImgId = cheapestImage(img?.models)?.id ?? null
 const cheapVidId = cheapestVideo(vid?.models)?.id ?? null
  // A size one variant offers may not exist on another (Lite has no 4K), so switching models
  // can strand an impossible pick — fall through the variant's own default.
 const effImgSize = imgSpec ? (imgSpec.sizes.includes(imgSize) ? imgSize : cheapestSize(imgSpec)) : imgSize
 const effVidRes = vidSpec ? (vidSpec.resolutions.includes(vidRes) ? vidRes : cheapestResolution(vidSpec)) : vidRes

 const cfg = isVideo ? vid : img
 const ratios = isVideo ? (vid?.ratios ?? []) : (img?.ratios ?? [])
 const hints = isVideo ? (vid?.ratioHints ?? {}) : (img?.ratioHints ?? {})

  // Config is fetched on OPEN — an event — never from an effect watching state the fetch
  // would itself rewrite.
 const loadConfig = useCallback(async () => {
 setLoading(true)
 try {
      /*
       * VIDEO IS FETCHED SEPARATELY, AND ITS FAILURE IS NOT FATAL.
       *
       * Both configs used to load in one Promise.all. Video is admin-only, so for a seller
       * that promise rejected and took the IMAGE config down with it — the panel reported
       * "Staff only" on a feature the seller is entitled to and paying for. Video is asked
       * for only when it is on offer, and a refusal there leaves images working.
       */
 const i = await getDeskImageConfig()
 setImg(i)
      /*
       * OPEN ON THE CHEAPEST, at the owner's instruction — for images and for video alike.
       *
       * The configured model is Pro, 13.4c a render, and this panel arms the composer the
       * moment it loads: the default was spending the most on the press most likely to be a
       * first attempt. A draft is the right first render, and moving up is one select away
       * with the price on the pill the whole time.
       *
       * The rule itself lives in lib/ai-cheapest — three surfaces were deriving it and one
       * of them derived it differently.
       */
 const cheapImg = cheapestImage(i.models)
 const imgId = cheapImg?.id || i.model
 const imgSz = cheapImg?.size || cheapestSize(i.models.find((m) => m.id === i.model)) || "1K"
 setImgModel(imgId); setImgSize(imgSz)

 const v = allowVideo ? await getDeskVideoConfig().catch(() => null) : null
 if (v) {
 setVid(v)
        // Same rule for clips, priced per SECOND — the cheapest resolution on the cheapest model.
 const cheapVid = cheapestVideo(v.models)
 setVidModel(cheapVid?.id || v.model)
 setVidRes(cheapVid?.res || cheapestResolution(v.models.find((m) => m.id === v.model)) || "1080p")
      }
 const iM = i.models.find((m) => m.id === imgId)
 if (i.enabled && iM) {
 onArm({
 mode: "image", model: imgId, ratio: "1:1", size: imgSz,
 usd: iM.usd[imgSz] ?? 0, label: `Image · ${imgSz} · 1:1`, short: `${imgSz} · 1:1`,
        })
      }
    } catch (e) {
      // Keep the REAL reason (a 403, a 502, a network failure) — "couldn't load" alone sends
      // the reader looking in entirely the wrong place.
 setErr(e instanceof Error ? `Couldn't load the generation settings — ${e.message}` : "Couldn't load the generation settings.")
    } finally {
 setLoading(false)
    }
  }, [onArm, allowVideo])

 const openMenu = useCallback(async () => {
 const next = !open
 setOpen(next)
 if (!next || img || loading) return
 await loadConfig()
  }, [open, img, loading, loadConfig])

  /*
   * ARM ONCE, ON MOUNT. Guarded by a ref rather than by state the fetch itself writes: a
   * condition like `!armed` would be re-satisfied by every failure and ask forever. One
   * attempt per mount, success or not.
   */
 const armedOnce = useRef(false)
 useEffect(() => {
 if (!autoArm || armedOnce.current || disabled) return
 armedOnce.current = true
 const t = setTimeout(() => { loadConfig() }, 0)
 return () => clearTimeout(t)
  }, [autoArm, disabled, loadConfig])

  /*
   * Build the armed settings from current state, with overrides for the value being changed
   * right now (state setters are async, so reading them back here would arm the PREVIOUS
   * choice — the bug that makes a picker feel one step behind).
   */
 const armWith = (o: Partial<{ mode: Mode; imgModel: string; imgSize: string; imgRatio: string; vidModel: string; vidRes: string; vidRatio: string; secs: number; backdrop: Backdrop | "" }> = {}) => {
 const m = o.mode ?? mode
 const video = m === "video"
 const iM = o.imgModel ?? imgModel, vM = o.vidModel ?? vidModel
 const iSpec = img?.models.find((x) => x.id === iM) || null
 const vSpec = vid?.models.find((x) => x.id === vM) || null
 const iSize = iSpec ? (iSpec.sizes.includes(o.imgSize ?? imgSize) ? (o.imgSize ?? imgSize) : cheapestSize(iSpec)) : (o.imgSize ?? imgSize)
 const vRes = vSpec ? (vSpec.resolutions.includes(o.vidRes ?? vidRes) ? (o.vidRes ?? vidRes) : cheapestResolution(vSpec)) : (o.vidRes ?? vidRes)
 const sc = o.secs ?? secs
 const iRatio = o.imgRatio ?? imgRatio, vRatio = o.vidRatio ?? vidRatio
 const bd = o.backdrop ?? backdrop

 onArm(video
      ? {
 mode: "video", model: vM, ratio: vRatio, resolution: vRes, seconds: sc,
 usd: (vSpec?.usdPerSec[vRes] ?? 0) * sc,
 label: `Video · ${vRes} · ${sc}s`, short: `${vRes} · ${vRatio} · ${sc}s`,
      }
 : {
 mode: "image", model: iM, ratio: iRatio, size: iSize,
 backdrop: bd || undefined,
 usd: iSpec?.usd[iSize] ?? 0,
 label: `Image · ${iSize} · ${iRatio}`,
        // The chip has to say a cut-out backdrop is armed, or the next render comes back on a
        // white sweep for a reason nothing on screen explains.
 short: bd ? `${iSize} · ${iRatio} · cut-out` : `${iSize} · ${iRatio}`,
      })
  }

 const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

 return (
    <div className="relative shrink-0">
      {armed ? (
        <Button
 variant="secondary" size="sm"
 className="h-9 shrink-0 gap-1.5 rounded-full pl-2.5 pr-2 text-xs font-medium"
 onClick={openMenu} disabled={disabled}
 aria-label={`Generating ${armed.mode}: ${armed.short}. Change settings`}
        >
          {armed.mode === "image" ? <ImageSquare size={13} weight="fill" /> : <FilmSlate size={13} weight="fill" />}
          <span className="tabular-nums">{armed.short}</span>
          <CaretDown size={11} weight="bold" className="opacity-60" />
        </Button>
      ) : (
        <Button
 variant="ghost" size="icon" className="size-9"
 onClick={openMenu} disabled={disabled} aria-label="Choose what to generate"
        >
          <Sparkle size={18} />
        </Button>
      )}

      {open && (
        <>
          <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-[70vh] w-[23rem] overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-lg">
            <div className="mb-2 eg-label text-muted-foreground">Generate</div>

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
              <div className="flex items-start gap-2 rounded-md bg-hold/10 p-2 text-xs text-hold">
                <Warning size={14} className="mt-0.5 shrink-0" />
                <span>{!cfg.keySet
                  ? "No Google AI key is set. An admin can add one in Settings › Integrations."
 : "File storage isn't configured, so what's generated couldn't be kept."}</span>
              </div>
            )}

            {cfg?.enabled && (
              <div className="space-y-2.5">
                {priceNote && (
                  <div className="rounded-md px-2 py-1.5 text-2xs text-muted-foreground">{priceNote}</div>
                )}
                <div className={allowVideo ? undefined : "hidden"}>
                  <div className="mb-1 text-2xs text-muted-foreground">What are we making?</div>
                  <select value={mode} onChange={(e) => { const m = e.target.value as Mode; setMode(m); setErr(null); armWith({ mode: m }) }} className={selectCls}>
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
 const r = m && !m.resolutions.includes(vidRes) ? cheapestResolution(m) : vidRes
 if (m && r !== vidRes) setVidRes(r)
 armWith({ vidModel: id, vidRes: r })
                      }}>
                      {vid?.models.map((m) => <option key={m.id} value={m.id}>{modelOptionLabel(m, cheapVidId)}</option>)}
                    </select>
                  ) : (
                    <select value={imgModel} className={selectCls}
 onChange={(e) => {
 const id = e.target.value; setImgModel(id)
 const m = img?.models.find((x) => x.id === id)
 const sz = m && !m.sizes.includes(imgSize) ? cheapestSize(m) : imgSize
 if (m && sz !== imgSize) setImgSize(sz)
 armWith({ imgModel: id, imgSize: sz })
                      }}>
                      {img?.models.map((m) => <option key={m.id} value={m.id}>{modelOptionLabel(m, cheapImgId)}</option>)}
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
 onChange={(e) => {
 const v = e.target.value
 if (isVideo) { setVidRatio(v); armWith({ vidRatio: v }) } else { setImgRatio(v); armWith({ imgRatio: v }) }
                      }}>
                      {ratios.map((r) => <option key={r} value={r}>{hints[r] ? `${r} — ${hints[r]}` : r}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">{isVideo ? "Quality" : "Size"}</div>
                    {isVideo ? (
                      <select value={effVidRes} onChange={(e) => { setVidRes(e.target.value); armWith({ vidRes: e.target.value }) }} className={selectCls}>
                        {(vidSpec?.resolutions || []).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <select value={effImgSize} onChange={(e) => { setImgSize(e.target.value); armWith({ imgSize: e.target.value }) }} className={selectCls}>
                        {(imgSpec?.sizes || []).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                  </div>
                  {isVideo && (
                    <div>
                      <div className="mb-1 text-2xs text-muted-foreground">Length</div>
                      <select value={secs} onChange={(e) => { setSecs(Number(e.target.value)); armWith({ secs: Number(e.target.value) }) }} className={selectCls}>
                        {(vid?.durations || [8]).map((d) => <option key={d} value={d}>{d}s</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/*
                  * BACKDROP — the answer to "remove the background", asked at the only point
                  * it can be answered.
                  *
                  * A render comes back as JPEG and always will, so transparency cannot be
                  * bought here at any price; what CAN be bought is a sweep flat enough that
                  * the free browser cut-out separates it perfectly afterwards. Grey is not a
                  * style choice — a colour-distance flood cannot separate a white shirt from
                  * a white sweep, and a white shirt is the most common thing photographed here.
                  *
                  * Image only. It is a FIELD, so it wears field chrome: it is something you
                  * set, not something you press.
                  */}
                {!isVideo && (
                  <div>
                    <div className="mb-1 text-2xs text-muted-foreground">Backdrop</div>
                    <select value={backdrop} className={selectCls}
 onChange={(e) => { const v = e.target.value as Backdrop | ""; setBackdrop(v); armWith({ backdrop: v }) }}>
                      <option value="">As described</option>
                      <option value="white">Flat white — cut-out ready</option>
                      <option value="grey">Flat grey — cut-out ready, for white garments</option>
                    </select>
                  </div>
                )}

                {/* Arms the composer; it does not spend anything yet. The price rides onto the
 pill so it stays visible while you type, not only at the moment of choosing. */}
                <div className="flex gap-2">
                  <Button variant="outline" className="h-9 flex-1" onClick={() => setOpen(false)}>Done</Button>
                  {/* The pill above the composer used to carry the ✕ that turned this off.
                      With the pill gone (it repeated what the Send button already says), the
 way back to a plain chat box has to live here instead. */}
                  {armed && (
                    <Button variant="ghost" className="h-9 flex-1 text-muted-foreground"
 onClick={() => { onArm(null); setOpen(false) }}>
                      Back to chat
                    </Button>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground">
                  Type in the message box and press Enter — the Send button now says Generate.
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
/**
 * The chip that sits on a picture in the thread. Shared so Edit and Animate are the same
 * object with different verbs — they are two things you can do to one photograph, and a
 * different shape for each would read as two unrelated controls.
 *
 * POSITIONED BY THE CALLER. Both used to carry `absolute right-1.5 top-1.5` themselves,
 * which is fine for one chip and puts two on top of each other. The page holds them in one
 * absolutely-positioned row instead.
 */
const IMG_CHIP = "inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-2xs font-medium shadow-sm backdrop-blur-sm transition-colors hover:bg-background"

/**
 * EDIT THIS ONE — continue from a specific picture rather than the newest.
 *
 * A follow-up already carries the newest image in the thread, which is right almost every
 * time. This is for the other times: you made four, the second was the good one, and the
 * next instruction is about that. It reports the pick; the composer draws it and sends it.
 *
 * Arms image mode when nothing is armed, because pressing Edit on a picture is a clear
 * statement of intent, and leaving it disarmed would mean the press did nothing visible.
 * Cheapest settings for the same reason Animate uses them — an edit is the exploratory
 * move, and everything is one click away in the panel.
 */
export function EditImageButton({ imageName, imageUrl, armed, onArm, onPick }: {
  imageName: string
  imageUrl: string
  armed: GenSettings | null
  onArm: (g: GenSettings) => void
  onPick: (p: { name: string; url: string }) => void
}) {
  const [busy, setBusy] = useState(false)

  const pick = async (e: React.MouseEvent) => {
    // The image sits inside a link to the full-size file; picking must not navigate away.
    e.preventDefault(); e.stopPropagation()
    if (busy) return
    onPick({ name: imageName, url: imageUrl })
    if (armed?.mode === "image") return          // already set up to render — only the picture changed
    setBusy(true)
    try {
      const c = await getDeskImageConfig()
      const priced = c.models
        .flatMap((m) => m.sizes.map((sz) => ({ m, sz, usd: m.usd[sz] ?? Infinity })))
        .sort((a, b) => a.usd - b.usd)
      const p = priced[0]
      if (!p || !Number.isFinite(p.usd)) return
      onArm({
        mode: "image", model: p.m.id, ratio: "1:1", size: p.sz, usd: p.usd,
        label: `Image · ${p.sz} · 1:1`, short: `${p.sz} · 1:1`,
      })
    } catch { /* the pill is the feedback; a failed arm simply doesn't arm */ } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={pick} aria-label="Edit this image" className={IMG_CHIP}>
      {busy ? <CircleNotch size={12} className="animate-spin" /> : null}
      Edit
    </button>
  )
}

export function AnimateImageButton({ imageName, imageUrl, onArm }: {
 imageName: string
 imageUrl: string
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
      /*
       * CHEAPEST settings, not the configured default. Animating is the exploratory move —
       * you already have the picture and you're finding out whether it moves well — so it
       * should not open on the $0.96 option. The floor here is Lite/720p at the shortest
       * length, about 20c. Everything is still one click away in the panel.
       *
       * Derived rather than hardcoded: the catalogue owns the prices, and a hardcoded
       * "veo-lite" would quietly become wrong the day a cheaper tier appears.
       */
 const priced = c.models
        .flatMap((m) => m.resolutions.map((res) => ({ m, res, rate: m.usdPerSec[res] ?? Infinity })))
        .sort((a, b) => a.rate - b.rate)
 const pick = priced[0]
 if (!pick) return
 const secs = Math.min(...(c.durations?.length ? c.durations : [8]))
 onArm({
 mode: "video", model: pick.m.id, ratio: "9:16", resolution: pick.res, seconds: secs,
 imageName, imageUrl, usd: pick.rate * secs,
 label: `Animate · ${pick.res} · ${secs}s`, short: `Animate · ${pick.res} · ${secs}s`,
      })
    } catch { /* the pill is the feedback; a failed arm simply doesn't arm */ } finally {
 setBusy(false)
    }
  }

 return (
    <button type="button" onClick={arm} aria-label="Animate this image" className={IMG_CHIP}>
      {busy ? <CircleNotch size={12} className="animate-spin" /> : null}
      Animate
    </button>
  )
}
