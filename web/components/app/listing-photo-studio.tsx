"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Sparkle, Warning, ImageSquare, Check, X, CaretUp } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { getDeskImageConfig, readPhotosForPrompt, generateListingPhotos, type DeskImageConfig, type ListingRender, type AiQuote } from "@/lib/api"

/**
 * THE LISTING PHOTO STUDIO — competitor's shots in, our own photograph out.
 *
 * It sits under the Photos grid on the publish page and exists for one job: get from "here
 * is the shot that sells" to "here is ours" without saving every competitor photo to a
 * laptop and re-uploading it into the chat generator.
 *
 * THE ORDER IS THE DESIGN. Read the photos → a prompt appears in a box → the person edits it
 * → renders appear as CANDIDATES → a press moves one into the publishable set. Nothing skips
 * a step. That matters twice over: every render is real money, and the publishable set is one
 * click from a live marketplace listing, which is precisely why the competitor's own photos
 * were taken out of it in the first place.
 *
 * WHAT THE PROMPT IS ABOUT. The server's writer studies how the product is PHOTOGRAPHED —
 * garment, colour, crop, light, props — and is forbidden from reproducing their artwork,
 * their watermark or any brand name. A competitor's photograph legitimately teaches you how
 * to shoot; it does not license their design.
 */

/**
 * FRAMING, AS EDITABLE TEXT.
 *
 * A preset is not a hidden mode — it appends its sentence to the prompt box, where it can be
 * read, reworded or deleted like anything else the person typed. Pressing another swaps it;
 * pressing the same one again takes it out. A listing wants several different shots of one
 * product, which is what these are for.
 */
const PRESETS: { key: string; label: string; text: string }[] = [
  { key: "flat", label: "Flat lay", text: "Shot flat from directly overhead on a clean neutral surface, the garment smoothed out, soft even daylight, a little empty space around it." },
  { key: "model", label: "On a model", text: "Worn by a person and cropped from the shoulders to the hips so the print fills the frame, natural indoor daylight, relaxed pose, face out of frame." },
  { key: "detail", label: "Close-up detail", text: "Close crop on the printed area with the fabric weave and the print texture clearly visible, raking light from one side." },
  { key: "scene", label: "Lifestyle scene", text: "In a lived-in setting with a few simple props just out of focus behind it, warm side light, shallow depth of field." },
  { key: "studio", label: "Plain studio", text: "Centred on a plain seamless white background under even studio light, no props and no cast shadow." },
]

/**
 * A UNIT PRICE and a TOTAL are not the same number.
 *
 * One render is $0.134 and rounding that to $0.13 hides which model was picked — a size
 * step is worth less than a cent and would vanish. A batch total of "$0.536" is nonsense on
 * an invoice, though, so the sum comes back to real money at two places.
 */
const unit = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
const money = (n: number) => `$${n.toFixed(2)}`

export type PhotoFocus = { index: number; nonce: number }

export function ListingPhotoStudio({
  references, focus, onUse, product, method, colors, listingTitle,
}: {
  /** The competitor's own photos. Source strings exactly as the publish payload carries
   *  them — the server resolves them through its one allowlisted resolver. */
  references: string[]
  /** A reference tile was clicked. The nonce is what makes a SECOND click on the SAME tile
   *  an event rather than a no-op; see the effect below for why that is safe. */
  focus: PhotoFocus | null
  /** Move a finished render into the publishable set. */
  onUse: (url: string) => void
  /** Facts the prompt writer is allowed to state. Everything else it may only describe from
   *  the picture — which is what keeps a size or a fabric weight out of a photograph a buyer
   *  reads as a promise. */
  product?: string
  method?: string
  colors?: string[]
  listingTitle?: string
}) {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState<DeskImageConfig & { quote?: AiQuote } | null>(null)
  const [cfgErr, setCfgErr] = useState<string | null>(null)
  const [loadingCfg, setLoadingCfg] = useState(false)

  // Which references the render actually SEES. All on by default — the whole point is not
  // having to gather them by hand — and a click drops one.
  const [picked, setPicked] = useState<Set<number>>(() => new Set(references.map((_, i) => i)))

  const [prompt, setPrompt] = useState("")
  const [preset, setPreset] = useState<string | null>(null)
  const [read, setRead] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [readErr, setReadErr] = useState<string | null>(null)

  const [model, setModel] = useState("")
  const [size, setSize] = useState("")
  const [ratio, setRatio] = useState("1:1")
  const [count, setCount] = useState(1)

  const [busy, setBusy] = useState(false)
  const [cands, setCands] = useState<ListingRender[]>([])
  const [genErrs, setGenErrs] = useState<string[]>([])

  const spec = cfg?.models.find((m) => m.id === model) || null
  // A size one variant offers may not exist on another (Lite has no 4K), so switching models
  // can strand an impossible pick — fall through the variant's own default.
  const effSize = spec ? (spec.sizes.includes(size) ? size : spec.defaultSize) : size

  /*
   * WHAT ONE RENDER COSTS, AND WHOSE NUMBER IT IS.
   *
   * A seller sees THEIR price from the quote; staff see what Google charges US. Those are
   * different numbers with different meanings and showing one as the other is how our cost
   * ends up presented to a seller as their bill.
   */
  const quote = cfg?.quote
  const staffViewer = quote ? quote.staff : false
  const freeLeft = quote && !quote.staff ? quote.freeLeft : 0
  const perImage = staffViewer ? (spec?.usd[effSize] ?? 0) : (quote?.imagePrice ?? 0)
  // The free allowance covers the first `freeLeft` of THIS batch, not all of it.
  const batchCost = staffViewer ? perImage * count : perImage * Math.max(0, count - freeLeft)

  const loadCfg = useCallback(async () => {
    setLoadingCfg(true); setCfgErr(null)
    try {
      const c = await getDeskImageConfig()
      setCfg(c)
      setModel(c.model)
      setSize(c.models.find((m) => m.id === c.model)?.defaultSize || "1K")
    } catch (e) {
      // Keep the REAL reason. "Couldn't load" alone sends the reader looking in the wrong place.
      setCfgErr(e instanceof Error ? e.message : "Couldn't load the generation settings.")
    } finally {
      setLoadingCfg(false)
    }
  }, [])

  // Config is fetched when the panel is OPENED — an event — and once per mount, guarded by a
  // ref rather than by `!cfg`, which a failed load would re-satisfy on every render.
  const cfgOnce = useRef(false)
  const openPanel = useCallback(() => {
    setOpen(true)
    if (cfgOnce.current) return
    cfgOnce.current = true
    loadCfg()
  }, [loadCfg])

  /** Read the ticked references and put the result in the box. A CLICK, never anything automatic. */
  const runRead = useCallback(async (idxs: number[]) => {
    const imgs = idxs.map((i) => references[i]).filter(Boolean)
    if (!imgs.length) { setReadErr("Tick at least one reference photo first."); return }
    setReading(true); setReadErr(null)
    try {
      const r = await readPhotosForPrompt({
        images: imgs,
        title: listingTitle || undefined,
        product: product || undefined,
        method: method || undefined,
        colors: colors && colors.length ? colors : undefined,
      })
      if (r.error || !r.prompt) { setReadErr(r.error || "Nothing came back. Try again."); return }
      // It REPLACES the box, and it says so on the button ("Re-read the photos") once there
      // is something to lose. Silently merging into text somebody wrote is worse than either.
      setPrompt(r.prompt)
      setPreset(null)
      setRead(r.read || null)
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : "Couldn't read those photos.")
    } finally {
      setReading(false)
    }
  }, [references, listingTitle, product, method, colors])

  /*
   * A REFERENCE TILE WAS CLICKED — open, tick that photo, and read it straight away.
   *
   * SAFE AS AN EFFECT, and worth saying why, because the rule in this codebase is that an
   * effect must never fetch on a condition its own fetch can satisfy. The condition here is a
   * NONCE that only a click increments: the fetch cannot write it, a failure cannot re-arm it,
   * and the ref makes each value fire exactly once. It is an event delivered through a prop,
   * not a loader watching state.
   */
  const lastFocus = useRef(0)
  useEffect(() => {
    if (!focus || focus.nonce === lastFocus.current) return
    lastFocus.current = focus.nonce
    openPanel()
    const next = new Set(picked)
    next.add(focus.index)
    setPicked(next)
    runRead(Array.from(next).sort((a, b) => a - b))
    // `picked` is read, not watched — including it would re-fire this on every tick change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, openPanel, runRead])

  /** Swap the trailing framing sentence. Pressing the live one again removes it. */
  const applyPreset = (key: string) => {
    const next = preset === key ? null : key
    let body = prompt
    for (const p of PRESETS) body = body.split(p.text).join("")
    body = body.replace(/\s+$/, "")
    const chosen = next ? PRESETS.find((p) => p.key === next) : null
    setPrompt(chosen ? (body ? body + " " + chosen.text : chosen.text) : body)
    setPreset(next)
  }

  const toggleRef = (i: number) => setPicked((p) => {
    const n = new Set(p)
    if (n.has(i)) n.delete(i); else n.add(i)
    return n
  })

  const generate = async () => {
    if (!prompt.trim()) return
    setBusy(true); setGenErrs([])
    try {
      const r = await generateListingPhotos({
        prompt: prompt.trim(),
        images: Array.from(picked).sort((a, b) => a - b).map((i) => references[i]).filter(Boolean),
        model, aspectRatio: ratio, imageSize: effSize, count,
      })
      // Partial success is the NORMAL shape here, not an edge case: a daily cap or an empty
      // wallet stops the batch part-way, so both halves are shown rather than one winning.
      if (r.results?.length) setCands((p) => [...r.results, ...p])
      setGenErrs(r.errors?.length ? r.errors : (r.error ? [r.error] : []))
      // The allowance moved, so the price line has to move with it.
      if (r.quote) setCfg((c) => (c ? { ...c, quote: r.quote } : c))
    } catch (e) {
      setGenErrs([e instanceof Error ? e.message : "That didn't work."])
    } finally {
      setBusy(false)
    }
  }

  const use = (r: ListingRender) => {
    onUse(r.url)
    setCands((p) => p.filter((x) => x.url !== r.url))
  }

  const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

  if (!references.length) return null

  if (!open) {
    return (
      <div className="border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={openPanel}>
          <Sparkle size={14} weight="fill" />
          Make our own photo from these
        </Button>
        <p className="mt-1.5 text-2xs leading-snug text-muted-foreground">
          Reads the reference photos, writes a prompt you can edit, and renders our own shot — nothing reaches the listing until you press Use.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="eg-label text-muted-foreground">Make our own photo</div>
        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => setOpen(false)}>
          <CaretUp size={12} weight="bold" /> Hide
        </Button>
      </div>

      {loadingCfg && <div className="py-4 text-center"><CircleNotch size={16} className="mx-auto animate-spin text-muted-foreground" /></div>}

      {/* Without this an unreachable server rendered an EMPTY panel — "it's down" and
          "there's nothing here" looked identical. */}
      {!loadingCfg && !cfg && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <Warning size={14} className="mt-0.5 shrink-0" />
            <span>{cfgErr || "Couldn't load the generation settings."}</span>
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={loadCfg}>Try again</Button>
        </div>
      )}

      {cfg && !cfg.enabled && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Warning size={14} className="mt-0.5 shrink-0" />
          <span>{!cfg.keySet
            ? "No Google AI key is set. An admin can add one in Settings › Integrations."
            : "File storage isn't configured, so a generated photo couldn't be kept."}</span>
        </div>
      )}

      {cfg?.enabled && (
        <>
          {/* WHICH PHOTOS THE RENDER SEES. All on by default; a click drops one. Shown as the
              pictures themselves rather than a list of filenames — nobody knows a competitor
              photo by its name. */}
          <div>
            <div className="mb-1 text-2xs text-muted-foreground">
              References ({picked.size} of {references.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {references.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleRef(i)}
                  aria-pressed={picked.has(i)}
                  title={picked.has(i) ? "Using this one — click to drop it" : "Not used — click to add it"}
                  className={"relative size-12 overflow-hidden rounded-md border transition-opacity " +
                    (picked.has(i) ? "border-primary" : "border-border opacity-40")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="size-full object-cover" />
                  {picked.has(i) && (
                    <span className="absolute bottom-0 right-0 rounded-tl bg-primary px-0.5 text-primary-foreground">
                      <Check size={9} weight="bold" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* THE PROMPT. It is the box, not a hidden setting — the whole reason the read step
              is separate from the render step is so this can be reviewed before money moves. */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => runRead(Array.from(picked).sort((a, b) => a - b))} disabled={reading || !picked.size}>
                {reading ? <CircleNotch size={14} className="animate-spin" /> : <Sparkle size={14} weight="fill" />}
                {reading ? "Reading the photos…" : prompt ? "Re-read the photos" : "Read the photos → write a prompt"}
              </Button>
              {read && <span className="text-2xs text-muted-foreground">{read}</span>}
            </div>
            {readErr && (
              <div className="flex items-start gap-1.5 text-2xs text-destructive">
                <Warning size={12} className="mt-0.5 shrink-0" /><span>{readErr}</span>
              </div>
            )}
            {/* TALL ENOUGH TO HOLD WHAT THE READER WRITES. At five rows a returned prompt
                sat one and a half lines under the fold, and a paragraph cut mid-word reads
                as a rendering fault rather than a scroll — on the one control whose whole
                purpose is being read before money moves.

                field-sizing-content grows it with what is in it, capped so a very long prompt
                cannot push the Generate button off the screen. rows={8} is what Safari, which
                has no field-sizing yet, falls back to — enough for a returned prompt whole. */}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              placeholder="Describe the photograph we want — or press Read the photos and edit what comes back."
              className="max-h-96 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed outline-none field-sizing-content focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.key} size="sm" variant={preset === p.key ? "secondary" : "outline"}
                  className="h-7 text-xs" onClick={() => applyPreset(p.key)}
                  title={p.text}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          {/* NOT AN EQUAL FOUR-UP. "Nano Banana Pro — best quality" and "1:1 — Etsy /
              Shopify / Amazon listing" are the two long strings here; at 1fr each they both
              closed to an ellipsis, so the model and the shape — the two choices that change
              the price — were the two you could not read. Size and count are three characters. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="mb-1 text-2xs text-muted-foreground">Model</div>
              <select value={model} className={selectCls}
                onChange={(e) => {
                  const id = e.target.value; setModel(id)
                  const m = cfg.models.find((x) => x.id === id)
                  if (m && !m.sizes.includes(size)) setSize(m.defaultSize)
                }}>
                {cfg.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-2xs text-muted-foreground">Shape</div>
              <select value={ratio} onChange={(e) => setRatio(e.target.value)} className={selectCls}>
                {cfg.ratios.map((r) => <option key={r} value={r}>{cfg.ratioHints[r] ? `${r} — ${cfg.ratioHints[r]}` : r}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-2xs text-muted-foreground">Size</div>
              <select value={effSize} onChange={(e) => setSize(e.target.value)} className={selectCls}>
                {(spec?.sizes || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-2xs text-muted-foreground">How many</div>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={selectCls}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          {spec?.note && <p className="text-2xs leading-snug text-muted-foreground">{spec.note}</p>}

          {/* THE PRICE, BEFORE THE PRESS. Never discovered on the wallet afterwards, and
              never rounded away — a batch of four is four charges. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generate} disabled={busy || !prompt.trim()}>
              {busy ? <CircleNotch size={15} className="animate-spin" /> : <ImageSquare size={15} weight="fill" />}
              {busy ? `Rendering ${count}…` : `Generate ${count}`}
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {batchCost > 0
                ? <>{count} × {unit(perImage)} = <span className="font-semibold text-foreground">{money(batchCost)}</span></>
                : "no charge"}
              {!staffViewer && freeLeft > 0 && <> · {freeLeft} free left this month</>}
              {!staffViewer && quote?.imagesLeftToday != null && <> · {quote.imagesLeftToday} left today</>}
            </span>
          </div>

          {genErrs.map((e, i) => (
            <div key={i} className="flex items-start gap-1.5 text-2xs text-destructive">
              <Warning size={12} className="mt-0.5 shrink-0" /><span>{e}</span>
            </div>
          ))}

          {/* CANDIDATES, NOT PHOTOS. They are ours and they are paid for, but they are not in
              the listing until somebody looks at one and presses Use. */}
          {cands.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-2xs text-muted-foreground">
                {cands.length} render{cands.length === 1 ? "" : "s"} to review — Use puts one in Photos
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
                {cands.map((r) => (
                  <div key={r.url} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt="" className="size-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button onClick={() => use(r)} className="rounded bg-white/90 px-2 py-1 text-2xs font-semibold text-black">Use</button>
                      <button onClick={() => setCands((p) => p.filter((x) => x.url !== r.url))}
                        aria-label="Discard this render" className="rounded bg-white/90 p-1 text-black"><X size={11} weight="bold" /></button>
                    </div>
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-2xs tabular-nums text-white">
                      {r.size} · {r.aspectRatio}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
