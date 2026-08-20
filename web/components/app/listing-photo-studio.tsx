"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Sparkle, Warning, Check, X, Eraser, CaretDown, ImageSquare } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DictateButton } from "@/components/app/dictate-button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { getDeskImageConfig, readPhotosForPrompt, generateListingPhotos, type DeskImageConfig, type ListingRender, type AiQuote } from "@/lib/api"
import { promptWarning } from "@/lib/image-gen"
import { removeBackground } from "@/lib/remove-background"
import { canvasReadableSrc } from "@/lib/thread-match"

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

/**
 * ONE REFERENCE TILE, at either size.
 *
 * Two jobs, two controls, as SIBLINGS: the picture selects which one is shown big, the
 * corner tick decides whether the render sees it at all. A button inside a button is invalid
 * and the inner one never receives the click.
 *
 * `big` is the pre-render grid size; the strip size is the default. One component for both so
 * the tiles keep their identity across the layout change and the browser can tween them,
 * rather than unmounting one tree and mounting another.
 *
 * Module scope, not nested in the dialog: a component defined during render is a new type
 * every pass, so React remounts every tile on each keystroke (react-hooks/static-components).
 */
function RefTile({ src, i, picked, current, onShow, onToggle }: {
  src: string; i: number; picked: boolean; current: boolean
  onShow: () => void; onToggle: () => void
}) {
  return (
    /* One size. `big` existed to tween a tile between the grid layout and the strip layout,
       and there is only one layout now — see the note on the panel grid. */
    <div className="relative size-14">
      <button
        type="button"
        onClick={onShow}
        aria-label={`Show reference photo ${i + 1}`}
        aria-current={current}
        /* A ring marks the one being shown; nothing outlines the rest. A border on every
           thumbnail is a line around a picture that already has an edge, and it made the
           strip read as a row of empty slots. Unpicked stays dimmed, which is the state
           that actually changes what gets generated. */
        className={"size-full overflow-hidden rounded-md outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/60 " +
          (current ? "ring-2 ring-primary" : "") +
          (picked ? "" : " opacity-35")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="size-full object-cover" />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={picked}
        aria-label={picked ? `Stop using reference photo ${i + 1}` : `Use reference photo ${i + 1}`}
        title={picked ? "Using this one — click to drop it" : "Not used — click to add it"}
        /* Same two states as the grid on the publish page: one ring, filled or not. */
        className={"absolute -right-1 -top-1 grid place-items-center rounded-full border-2 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 " +
          "size-4 " +
          (picked ? "border-white bg-white text-slate-900" : "border-white/90 bg-black/25 text-transparent hover:bg-black/40")}
      >
        <Check size={9} weight="bold" />
      </button>
    </div>
  )
}

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
  /* The four render settings live behind one control — see the note where it renders. */
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  /** Is there a right-hand side yet? A render, or one on its way — the spinner needs the pane
   *  open, or the panel would jump sideways the instant the picture arrived. */
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
      /*
       * THE CHEAPEST OPTION IS THE DEFAULT, at the owner's instruction.
       *
       * The configured model is what the chat generator opens on, and it is Pro — 13.4c a
       * render. A default that spends is the wrong way round for a panel you press while
       * still deciding what you want: the first press should be a draft, and moving up to Pro
       * should be a deliberate choice made once the prompt is right.
       *
       * Cheapest by the PRICE LIST, not by position — the catalogue is ordered best-first and
       * gains rows over time, so reading `[length - 1]` would silently pick whatever landed
       * last. Falls back to the configured model when nothing carries a price.
       */
      const cheapest = c.models.reduce<{ id: string; size: string; usd: number } | null>((best, m) => {
        for (const sz of m.sizes) {
          const usd = m.usd[sz]
          if (typeof usd !== "number") continue
          if (!best || usd < best.usd) best = { id: m.id, size: sz, usd }
        }
        return best
      }, null)
      setModel(cheapest?.id || c.model)
      setSize(cheapest?.size || c.models.find((m) => m.id === c.model)?.defaultSize || "1K")
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
      // Only when something is actually ticked. Nothing is, by default — the grid opens for
      // you to choose from, and a read of an empty set would be a call with no input.
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

  /*
   * CUT THE BACKGROUND OUT — in the browser, on the render we already have.
   *
   * The model cannot give us transparency (JPEG has no alpha, see lib/image-gen.ts), so the
   * only honest way to a PNG is to lift the backdrop off afterwards. That is the same flood
   * the design maker uses, on the same terms: no model, no API, no credit — which is why it
   * can sit on a button rather than behind a price.
   *
   * It replaces the candidate IN PLACE. The result is a data: URL, so whatever this is used
   * for next carries the cut-out rather than a link back to the opaque original — the same
   * rule the design maker follows for exactly the same reason.
   */
  const [cutting, setCutting] = useState<string | null>(null)
  const [cutErr, setCutErr] = useState<string | null>(null)
  const cutOut = async (r: ListingRender) => {
    setCutting(r.url); setCutErr(null)
    try {
      const out = await removeBackground(r.url.startsWith("data:") ? r.url : canvasReadableSrc(r.url), 12)
      if ("error" in out) { setCutErr(out.error); return }
      setCands((p) => p.map((x) => (x.url === r.url ? { ...x, url: out.url, cutOut: true } : x)))
    } catch (e) {
      setCutErr(e instanceof Error ? e.message : "That didn't work.")
    } finally {
      setCutting(null)
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
        {/* No subtitle. It changed text halfway through the job, which put a second moving
            part in the header of a window whose whole problem was things moving. The two
            column headings below already say which side is which. */}
        <DialogTitle className="border-b border-border px-4 py-3 text-sm font-semibold">
          Generate Images
        </DialogTitle>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ── THE SPACE IS RESERVED. NOTHING GROWS INTO IT. ──────────────────
                This used to open the right-hand pane only once there was something to put in
                it, animating grid-template-columns from `1fr 0fr` to `1fr 1fr` over 500ms.
                Four things then moved at once, and two of them fought:

                  • the reference grid was `auto-fill minmax(9rem,1fr)`, so as the pane
                    narrowed the COLUMN COUNT stepped 5 → 4 → 3 → 2 and every tile jumped
                    position at each step. That was the visible chaos.
                  • the left pane swapped content trees (grid of big tiles → hero + strip).
                    A ternary between two different element types remounts the subtree, so
                    the tiles blinked instead of gliding — the opposite of what the comment
                    on RefTile promised.

                And below `lg` there were no column tracks at all, so it was a vertical
                stack: "Ours" arrived below the fold while the left pane rearranged itself.
                You watched the thing you were looking at reshuffle while the new thing
                appeared somewhere you couldn't see.

                So the geometry is now FIXED. Both panes are their final size from the moment
                the window opens, and the right one holds its empty state until a render
                lands in it. Only opacity changes. This is the ordinary answer — reserving
                the final dimensions before the content exists is what every image-generation
                UI does, and what Cumulative Layout Shift is a measure of. ── */}
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            {/* THEIRS — NO LABEL ROW.
                "Theirs" over a photograph of somebody else's product, beside "Ours" over an
                empty frame, is a caption telling you what the two things obviously are. The
                count went with it: the ticks on the thumbs below say which are in use, and
                say it where the choice is actually made. Every generation UI worth copying
                leaves this strip silent — the frames carry the meaning. */}
            <section className="min-w-0 space-y-2">
              {/* ONE TREE, ALWAYS. A hero at the same size as Ours, with the rest as a strip
                  underneath. There is no second layout to switch to, so there is nothing to
                  remount and nothing to tween. */}
              {/* NO BORDER ON EITHER FRAME, and the same treatment on both.
                  Theirs was dashed and Ours was solid — two different line styles, side by
                  side, for two things that are the same kind of thing. Dashed reads as
                  provisional or broken, so the reference permanently looked like a slot
                  that had failed to fill.

                  A picture is its own edge. The frame only has to say WHERE the picture
                  goes while there isn't one, and a filled well does that without drawing a
                  line around something that already has a boundary. This is the outlined-box
                  count CLAUDE.md §4 is about — the app carried 490 of them, and two of them
                  were here disagreeing with each other. */}
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                {references[heroRef] ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={references[heroRef]} alt="" className="size-full object-contain" />
                ) : <span className="text-xs text-muted-foreground">No reference photo</span>}
              </div>
              {references.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {references.map((src, i) => (
                    <RefTile key={i} src={src} i={i} picked={pickedSet.has(i)} current={heroRef === i}
                      onShow={() => setHeroRef(i)} onToggle={() => toggleRef(i)} />
                  ))}
                </div>
              )}
            </section>

            {/* OURS — overflow-hidden is load-bearing, not tidiness. A 0fr track does not clip
                on its own, so the heading leaked past the collapsed edge and rendered as "OU"
                beside the reference grid. */}
            <section className="min-w-0 space-y-2 overflow-hidden">
              {/* THE WELL IS THE EMPTY STATE, not a paragraph inside it.
                  It held three lines explaining that nothing had been rendered and what to
                  press — under a button labelled Generate, beside the picture it would be
                  made from. That is instructions for a control already in view, and it is
                  what every image tool leaves out: Midjourney, Firefly and the rest give the
                  waiting slot a tinted frame and a shimmer, never prose.

                  So: the house periwinkle, at the strength CLAUDE.md §4 reserves for a large
                  FILL, with one quiet glyph so the frame reads as "a picture goes here"
                  rather than as something that failed. The distinction the honesty rule
                  actually cares about is empty-versus-broken, and a deliberate tint carries
                  that where grey does not. */}
              <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg">
                {hero && !busy ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hero.url} alt="" className="size-full bg-muted/40 object-contain" />
                    {/* The size rode in a header row that is gone. On the picture is where it
                        belonged anyway — it describes THIS render, not the column. */}
                    <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-2xs tabular-nums text-white">
                      {hero.size} · {hero.aspectRatio}
                    </span>
                  </>
                ) : (
                  <div className="absolute inset-0 bg-brand/20">
                    {/* A SHEEN WHILE IT WORKS, and stillness while it waits — the difference
                        between the two states without a word or a spinner. Off under
                        prefers-reduced-motion, where the tint alone still says which frame
                        this is. */}
                    {busy && (
                      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-transparent via-white/45 to-transparent motion-reduce:animate-none" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      {/* The violet itself, not --brand-foreground. That token is the LIME half of the
                          action pair — it is a label colour for a solid violet fill, and at
                          1.19:1 on a near-white tint it would be invisible. */}
                      <ImageSquare size={30} weight="light" className="text-primary/40" />
                    </div>
                  </div>
                )}
              </div>
              {/* The decision, on the big version — which is the point of showing it big. */}
              {hero && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => use(hero)}>Use this photo</Button>
                    {/* Free, so it says so — every other button in this panel spends money. */}
                    <Button size="sm" variant="outline" onClick={() => cutOut(hero)} disabled={cutting === hero.url || hero.cutOut}
                      title={hero.cutOut ? "Background already removed" : "Lift the backdrop off and keep it as a PNG — done in your browser, no charge"}>
                      {cutting === hero.url ? <CircleNotch size={13} className="animate-spin" /> : <Eraser size={13} weight="bold" />}
                      {hero.cutOut ? "Background removed" : cutting === hero.url ? "Removing…" : "Remove background"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => drop(hero.url)}>
                      <X size={13} weight="bold" /> Discard
                    </Button>
                    {cands.length > 1 && <span className="text-2xs text-muted-foreground">{heroGen + 1} of {cands.length}</span>}
                  </div>
                  {cutErr && (
                    <div className="flex items-start gap-1.5 text-2xs text-destructive">
                      <Warning size={12} className="mt-0.5 shrink-0" /><span>{cutErr}</span>
                    </div>
                  )}
                </>
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

                {/* ── ONE COMPOSER. EVERYTHING THAT ACTS ON THE PROMPT LIVES INSIDE IT. ──
                    It had become a box with a crowd around it: two buttons floating over the
                    textarea, a row of preset pills under it, then a separate row holding
                    Generate, the settings pill and the price. Five clusters at four different
                    left edges, for one job — which is what makes the eye hunt.
                    Now the border is the container, the way the chat composer works: write at
                    the top, everything that acts on what you wrote along the bottom, and the
                    press that spends money alone on the right where a primary action belongs.
                    focus-within moves the ring to the whole box so the textarea can lose its
                    own border and stop drawing a second rectangle inside the first. ── */}
                <div className="rounded-lg border border-input transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={8}
                    placeholder="Describe the photograph we want — or press Write from photos and edit what comes back."
                    /* Bigger, because this is a paragraph and it was being written through a
                       letterbox. field-sizing still grows it; the cap stops a long brief
                       pushing the toolbar off screen. */
                    className="min-h-44 max-h-96 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none field-sizing-content"
                  />

                  {/* The presets ADD a sentence to the prompt, so they sit with the prompt
                      rather than with the render controls. One scrolling line — they are a
                      menu of starting points, not four decisions to weigh. */}
                  <div className="flex gap-1.5 overflow-x-auto px-2 pb-2">
                    {PRESETS.map((p) => (
                      <Button key={p.key} size="sm" variant={preset === p.key ? "secondary" : "ghost"}
                        className="h-7 shrink-0 text-xs font-normal" onClick={() => applyPreset(p.key)} title={p.text}>
                        {p.label}
                      </Button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-1 border-t border-border px-1.5 py-1.5">
                    {/* NOT "Generate prompt". There were two buttons a few centimetres apart
                        whose labels both began with Generate, one of which spends money and
                        one of which does not — the single worst pair of names available. This
                        one WRITES THE BRIEF by reading the ticked photos; the other renders.
                        Different verbs, so the expensive one is unmistakable. */}
                    <Button
                      size="sm" variant="ghost"
                      className="h-8 gap-1.5 text-xs font-normal"
                      onClick={() => runRead(picked)} disabled={reading || !picked.length}
                      title={picked.length ? "Read the ticked reference photos and write the brief" : "Tick a reference photo above first"}
                    >
                      {reading ? <CircleNotch size={13} className="animate-spin" /> : <Sparkle size={13} weight="fill" />}
                      {reading ? "Reading…" : !picked.length ? "Pick a photo above" : prompt ? "Rewrite from photos" : "Write from photos"}
                    </Button>

                    {/* A photograph brief is the longest free text anyone types in this app and
                        the least like a form field, which is exactly what dictation is good at. */}
                    <DictateButton
                      value={prompt}
                      onChange={setPrompt}
                      className="size-8 shrink-0"
                      label="Describe the photo out loud"
                    />

                    {/* FOUR SETTINGS, ONE CONTROL — the shape the chat composer already uses.
                        The trigger SUMMARISES rather than saying "Settings", so the three facts
                        that change the price stay readable without opening anything; the panel
                        is for changing them, not for finding out what they are. */}
                    <div className="relative">
                      <Button
                        type="button" variant="ghost" size="sm"
                        onClick={() => setSettingsOpen((o) => !o)}
                        aria-expanded={settingsOpen}
                        className="h-8 gap-1.5 text-xs font-normal tabular-nums"
                        title="Model, shape, size and how many"
                      >
                        {ratio} · {effSize} · ×{count}
                        <CaretDown size={11} weight="bold" className="text-muted-foreground" />
                      </Button>
                      {settingsOpen && (
                        <>
                          {/* Click-away, same as the composer's emoji sheet. */}
                          <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setSettingsOpen(false)} />
                          <div className="absolute bottom-full left-0 z-20 mb-1.5 w-72 space-y-2.5 rounded-lg border border-border bg-card p-3 shadow-lg">
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
                            <div className="grid grid-cols-2 gap-2">
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
                          </div>
                        </>
                      )}
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                      {/* THE PRICE, IMMEDIATELY BEFORE THE PRESS — never discovered on the
                          wallet afterwards, and never rounded away: a batch of four is four
                          charges. */}
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {batchCost > 0
                          ? <>{count} × {unit(perImage)} = <span className="font-semibold text-foreground">{money(batchCost)}</span></>
                          : "no charge"}
                        {!staffViewer && freeLeft > 0 && <> · {freeLeft} free left this month</>}
                        {!staffViewer && quote?.imagesLeftToday != null && <> · {quote.imagesLeftToday} left today</>}
                      </span>
                      <Button size="sm" className="h-8" onClick={generate} disabled={busy || !prompt.trim()}>
                        {busy && <CircleNotch size={14} className="animate-spin" />}
                        {busy ? "Rendering…" : "Generate"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* WHAT THIS PROMPT CANNOT PRODUCE, before it is paid for. Not a block — the
                    person may know exactly what they are doing — but a render that comes back
                    with a painted-on checkerboard is a charge for something unusable, and the
                    natural next move is to ask again, and pay again. */}
                {promptWarning(prompt) && (
                  <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <Warning size={14} className="mt-0.5 shrink-0" />
                    <span>{promptWarning(prompt)}</span>
                  </div>
                )}

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
