"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Sparkle, Warning, Check, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { getDeskImageConfig, readPhotosForPrompt, generateListingPhotos, type DeskImageConfig, type ListingRender, type AiQuote } from "@/lib/api"

/**
 * THE LISTING PHOTO STUDIO — their shot on the left, ours on the right.
 *
 * It exists for one job: get from "here is the shot that sells" to "here is ours" without
 * saving every competitor photo to a laptop and re-uploading it into the chat generator.
 *
 * WHY IT IS A DIALOG AND NOT A PANEL. It started inline under the Photos grid, where the
 * references were 48px chips and the renders were 9rem tiles behind a hover overlay. Both
 * were too small to judge — you could not see what you were copying from, and you certainly
 * could not see what you had just paid for. Comparison is the entire task here, so the two
 * pictures have to be big and side by side, which needs the width a page column does not have.
 *
 * THE ORDER IS THE DESIGN. Pick references → read them → a prompt appears in a box you edit →
 * renders appear → a press moves one into the listing. Nothing skips a step. That matters
 * twice over: every render is real money, and the publishable set is one click from a live
 * marketplace listing, which is precisely why the competitor's own photos were kept out of it.
 *
 * WHAT THE PROMPT IS ABOUT. The server's writer studies how the product is PHOTOGRAPHED —
 * garment, crop, light, props — and is forbidden from reproducing their artwork, their
 * watermark or any brand name. A competitor's photograph legitimately teaches you how to
 * shoot; it does not license their design.
 */

/**
 * FRAMING, AS EDITABLE TEXT.
 *
 * A preset is not a hidden mode — it appends its sentence to the prompt box, where it can be
 * read, reworded or deleted like anything else typed there. Pressing another swaps it;
 * pressing the live one again takes it out. A listing wants several different shots of one
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
 * One render is $0.134, and rounding that to $0.13 hides which model was picked — a size step
 * is worth less than a cent and would vanish. A batch total of "$0.536" is nonsense on an
 * invoice, though, so the sum comes back to real money at two places.
 */
const unit = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
const money = (n: number) => `$${n.toFixed(2)}`

export function ListingPhotoStudio({
  open, onOpenChange, references, picked, onPickedChange, focusIndex,
  onUse, product, method, colors, listingTitle,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** The competitor's own photos. Source strings exactly as the publish payload carries
   *  them — the server resolves them through its one allowlisted resolver. */
  references: string[]
  /** Indices of the references a render will actually see. Owned by the PAGE, because the
   *  same set is ticked on the Photos grid — two copies would disagree the moment one moved. */
  picked: number[]
  onPickedChange: (next: number[]) => void
  /** Which one to show big when the dialog opens, and to read first. */
  focusIndex: number
  /** Move a finished render into the publishable set. */
  onUse: (url: string) => void
  /** Facts the prompt writer may state. Everything else it may only describe from the
   *  picture — which is what keeps a size or a fabric weight out of a photograph a buyer
   *  reads as a promise. */
  product?: string
  method?: string
  colors?: string[]
  listingTitle?: string
}) {
  const [cfg, setCfg] = useState<(DeskImageConfig & { quote?: AiQuote }) | null>(null)
  const [cfgErr, setCfgErr] = useState<string | null>(null)
  const [loadingCfg, setLoadingCfg] = useState(false)

  const [prompt, setPrompt] = useState("")
  const [preset, setPreset] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [readErr, setReadErr] = useState<string | null>(null)

  const [model, setModel] = useState("")
  const [size, setSize] = useState("")
  const [ratio, setRatio] = useState("1:1")
  const [count, setCount] = useState(1)

  const [busy, setBusy] = useState(false)
  const [cands, setCands] = useState<ListingRender[]>([])
  const [genErrs, setGenErrs] = useState<string[]>([])

  /*
   * WHICH ONE IS BIG, on each side. Separate from `picked` on purpose: "show me this one" and
   * "feed this one to the render" are different questions, and the strip that answered both at
   * 48px answered neither.
   */
  const [heroRef, setHeroRef] = useState(0)
  const [heroGen, setHeroGen] = useState(0)

  const pickedSet = new Set(picked)
  const spec = cfg?.models.find((m) => m.id === model) || null
  // A size one variant offers may not exist on another (Lite has no 4K), so switching models
  // can strand an impossible pick — fall through the variant's own default.
  const effSize = spec ? (spec.sizes.includes(size) ? size : spec.defaultSize) : size

  /*
   * WHAT ONE RENDER COSTS, AND WHOSE NUMBER IT IS.
   *
   * A seller sees THEIR price from the quote; staff see what Google charges US. Those are
   * different numbers with different meanings, and showing one as the other is how our cost
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
      // It REPLACES the box, and the button says so ("Re-read the photos") once there is
      // something to lose. Silently merging into text somebody wrote is worse than either.
      setPrompt(r.prompt)
      setPreset(null)
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : "Couldn't read those photos.")
    } finally {
      setReading(false)
    }
  }, [references, listingTitle, product, method, colors])

  /*
   * OPENING IS AN EVENT — load the settings once, feature what was clicked, and read it.
   *
   * SAFE AS AN EFFECT, and worth saying why, because the rule in this codebase is that an
   * effect must never fetch on a condition its own fetch can satisfy. The guard is a ref
   * holding the last opening this ran for: the fetch cannot write it, a FAILURE cannot re-arm
   * it, and it fires exactly once per open. It is an event delivered through a prop, not a
   * loader watching state.
   */
  const openedOnce = useRef(false)
  useEffect(() => {
    if (!open) { openedOnce.current = false; return }
    if (openedOnce.current) return
    openedOnce.current = true
    // Deferred to a task, which is this repo's standing answer to
    // react-hooks/set-state-in-effect — the same shape the app pages use. It also means the
    // dialog has painted before the read starts, so the spinner appears on a drawn panel.
    const t = setTimeout(() => {
      setHeroRef(focusIndex)
      if (!cfg) loadCfg()
      if (picked.length) runRead(picked)
    }, 0)
    return () => clearTimeout(t)
    // `picked`/`cfg` are READ at open, not watched: watching them would re-run this every
    // time a tick moved or the config landed. `openedOnce` is what makes it once per open —
    // a ref, so a FAILED read cannot re-arm it the way a state guard would.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusIndex])

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

  const toggleRef = (i: number) => {
    const n = new Set(picked)
    if (n.has(i)) n.delete(i); else n.add(i)
    onPickedChange(Array.from(n).sort((a, b) => a - b))
  }

  const generate = async () => {
    if (!prompt.trim()) return
    setBusy(true); setGenErrs([])
    try {
      const r = await generateListingPhotos({
        prompt: prompt.trim(),
        images: picked.map((i) => references[i]).filter(Boolean),
        model, aspectRatio: ratio, imageSize: effSize, count,
      })
      // Partial success is the NORMAL shape here, not an edge case: a daily cap or an empty
      // wallet stops the batch part-way, so both halves are shown rather than one winning.
      if (r.results?.length) { setCands((p) => [...r.results, ...p]); setHeroGen(0) }
      setGenErrs(r.errors?.length ? r.errors : (r.error ? [r.error] : []))
      // The allowance moved, so the price line has to move with it.
      if (r.quote) setCfg((c) => (c ? { ...c, quote: r.quote } : c))
    } catch (e) {
      setGenErrs([e instanceof Error ? e.message : "That didn't work."])
    } finally {
      setBusy(false)
    }
  }

  const drop = (url: string) => {
    setCands((p) => {
      const n = p.filter((x) => x.url !== url)
      setHeroGen((h) => Math.min(h, Math.max(0, n.length - 1)))
      return n
    })
  }
  const use = (r: ListingRender) => { onUse(r.url); drop(r.url) }

  const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
  const hero = cands[heroGen] || null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-auto max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,74rem)]">
        <DialogTitle className="border-b border-border px-4 py-3 text-sm font-semibold">
          Make our own photo
          <span className="ml-2 font-normal text-muted-foreground">
            theirs on the left, ours on the right — nothing joins the listing until you press Use
          </span>
        </DialogTitle>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ── THE COMPARISON. Two panes of equal weight, because the whole task is holding
                one against the other. Stacks below `lg`, where side-by-side would make each
                half too narrow to be worth having. ── */}
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            {/* THEIRS */}
            <section className="min-w-0 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="eg-label text-muted-foreground">Theirs</h3>
                <span className="text-2xs text-muted-foreground">{picked.length} of {references.length} used as reference</span>
              </div>
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30">
                {references[heroRef] ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={references[heroRef]} alt="" className="size-full object-contain" />
                ) : <span className="text-xs text-muted-foreground">No reference photo</span>}
              </div>
              {references.length > 1 && (
                /* Click a thumb to bring it up; the tick decides whether the render sees it.
                   Two jobs, two controls — as siblings, because a button inside a button is
                   invalid and the inner one never gets the click. */
                <div className="flex flex-wrap gap-1.5">
                  {references.map((src, i) => (
                    <div key={i} className="relative size-14">
                      <button
                        type="button"
                        onClick={() => setHeroRef(i)}
                        aria-label={`Show reference photo ${i + 1}`}
                        aria-current={heroRef === i}
                        className={"size-full overflow-hidden rounded-md border outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/60 " +
                          (heroRef === i ? "border-primary ring-1 ring-primary" : "border-border") +
                          (pickedSet.has(i) ? "" : " opacity-35")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="size-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleRef(i)}
                        aria-pressed={pickedSet.has(i)}
                        aria-label={pickedSet.has(i) ? `Stop using reference photo ${i + 1}` : `Use reference photo ${i + 1}`}
                        className={"absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border text-[9px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 " +
                          (pickedSet.has(i) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent")}
                      >
                        <Check size={9} weight="bold" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* OURS */}
            <section className="min-w-0 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="eg-label text-muted-foreground">Ours</h3>
                {hero && <span className="text-2xs tabular-nums text-muted-foreground">{hero.size} · {hero.aspectRatio}</span>}
              </div>
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                {busy ? (
                  <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch size={22} className="animate-spin" />
                    Rendering {count > 1 ? `${count} photos` : "a photo"}…
                  </span>
                ) : hero ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={hero.url} alt="" className="size-full object-contain" />
                ) : (
                  /* An empty state that says what will fill it. "Nothing here" and "this is
                     broken" must never look the same. */
                  <span className="max-w-[16rem] px-4 text-center text-xs leading-relaxed text-muted-foreground">
                    Nothing rendered yet. Write the prompt below and press Generate — what comes
                    back appears here for you to look at before it goes anywhere.
                  </span>
                )}
              </div>
              {/* The decision, on the big version — which is the point of showing it big. */}
              {hero && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => use(hero)}>Use this photo</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => drop(hero.url)}>
                    <X size={13} weight="bold" /> Discard
                  </Button>
                  {cands.length > 1 && <span className="text-2xs text-muted-foreground">{heroGen + 1} of {cands.length}</span>}
                </div>
              )}
              {cands.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {cands.map((c, i) => (
                    <button
                      key={c.url}
                      type="button"
                      onClick={() => setHeroGen(i)}
                      aria-label={`Show render ${i + 1}`}
                      aria-current={heroGen === i}
                      className={"size-14 overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring/60 " +
                        (heroGen === i ? "border-primary ring-1 ring-primary" : "border-border")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.url} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── THE WORDS AND THE DIALS, under both pictures. They apply to the pair, so they
                belong beneath it rather than crowding either half. ── */}
          <div className="space-y-3 border-t border-border p-4">
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
                {readErr && (
                  <div className="flex items-start gap-1.5 text-2xs text-destructive">
                    <Warning size={12} className="mt-0.5 shrink-0" /><span>{readErr}</span>
                  </div>
                )}

                {/* THE PROMPT, AND THE BUTTON THAT FILLS IT, IN ONE BOX.
                    They were two rows and a sentence: a wide outline button, the model's
                    remark about how the competitor shot it, and then the field. The remark
                    read like an explanation of the button rather than a note about the photo,
                    and three rows of chrome sat above the one control that matters. The button
                    now lives in the corner of the box it writes into, which is the only place
                    it needs to be, and it says which press this is — Generate the first time,
                    Regenerate once there are words to replace.

                    field-sizing grows the box with its content, capped so a long prompt cannot
                    push Generate off the screen; rows={6} is the Safari fallback. pb-11 keeps
                    the last line clear of the button sitting over it. */}
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={6}
                    placeholder="Describe the photograph we want — or press Generate prompt and edit what comes back."
                    className="max-h-72 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 pb-11 text-sm leading-relaxed outline-none field-sizing-content focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <Button
                    size="sm" variant="outline"
                    className="absolute bottom-2 left-2 h-7 bg-background text-xs"
                    onClick={() => runRead(picked)} disabled={reading || !picked.length}
                    title={picked.length ? "Read the ticked reference photos and write the prompt" : "Tick a reference photo first"}
                  >
                    {reading ? <CircleNotch size={13} className="animate-spin" /> : <Sparkle size={13} weight="fill" />}
                    {reading ? "Reading…" : prompt ? "Regenerate" : "Generate prompt"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <Button key={p.key} size="sm" variant={preset === p.key ? "secondary" : "outline"}
                      className="h-7 text-xs" onClick={() => applyPreset(p.key)} title={p.text}>
                      {p.label}
                    </Button>
                  ))}
                </div>

                {/* NOT AN EQUAL FOUR-UP. "Nano Banana Pro — best quality" and "1:1 — Etsy /
                    Shopify / Amazon listing" are the long strings; at 1fr each, the two choices
                    that change the price were the two you could not read. */}
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
                    {busy && <CircleNotch size={15} className="animate-spin" />}
                    {busy ? "Rendering…" : "Generate"}
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
                  <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                    <Warning size={13} className="mt-0.5 shrink-0" /><span className="break-words">{e}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
