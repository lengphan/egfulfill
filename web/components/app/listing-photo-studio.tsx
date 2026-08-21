"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Sparkle, Warning, Check, X, Eraser, CaretDown, CaretLeft, CaretRight, ImageSquare, MagnifyingGlassPlus, Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DictateButton } from "@/components/app/dictate-button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { getDeskImageConfig, readPhotosForPrompt, generateListingPhotos, listListingRenders, deleteListingRender, type DeskImageConfig, type ListingRender, type AiQuote } from "@/lib/api"
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
 * THE FRAME IS THE PICTURE'S SHAPE — not a square with the picture parked inside it.
 *
 * Both wells were `aspect-square` with `object-contain`, which is correct only for a 1:1
 * render. Ask for 4:5 — Etsy's own listing shape, and the reason the ratio picker exists —
 * and what came back was a portrait photograph sitting in a square with grey bars down both
 * sides, at roughly two thirds of the area the panel had already reserved for it. The whole
 * job here is judging a photograph against another photograph, and it was being judged
 * small, in the wrong shape, beside a reference that was ALSO being letterboxed because a
 * marketplace photo is rarely square either.
 *
 * So the frame takes the aspect of what is in it and the image fills the frame exactly.
 * Nothing is cropped and nothing is letterboxed, because those are the same statement: the
 * box now agrees with the picture instead of the picture apologising to the box.
 *
 * The HEIGHT is what is capped, not the width. A 9:16 at full column width would push the
 * composer off the bottom of the window, so the frame is bounded by a height and its width
 * follows from the aspect — which is why the cap is expressed as a max-WIDTH of
 * `cap × aspect` rather than a max-height that CSS would then have to argue with.
 */
const FRAME_CAP = "min(50dvh, 30rem)"

/** "4:5" → 0.8. Anything unparseable is a square, which is what the panel opened as. */
const ratioOf = (s?: string) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(s || ""))
  if (!m) return 1
  const w = Number(m[1]), h = Number(m[2])
  return w > 0 && h > 0 ? w / h : 1
}

/**
 * One well, at one aspect. Module scope for the same reason RefTile is — a component
 * declared during render is a new type every pass and remounts its subtree, which on an
 * <img> means the picture reloads and flashes on every keystroke in the prompt box.
 */
function Frame({ aspect, className, children }: {
  aspect: number
  className?: string
  children: React.ReactNode
}) {
  return (
    /* THE BAND IS FIXED; THE PICTURE IS CENTRED IN IT.
       Without the outer band the wells were different heights whenever the two sides were
       different shapes — a 16:9 reference beside a 4:5 render — so the thumbnail strips
       under them sat at different heights and the whole panel grew and shrank as you paged
       through references. Same reasoning as the note on the grid below: reserve the space
       once, and let only the contents change. */
    <div className="flex items-center justify-center" style={{ minHeight: FRAME_CAP }}>
      <div
        style={{ aspectRatio: String(aspect), maxWidth: `calc(${FRAME_CAP} * ${aspect})` }}
        className={"relative flex w-full items-center justify-center overflow-hidden rounded-lg " + (className || "")}
      >
        {children}
      </div>
    </div>
  )
}

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
          (picked ? "border-white bg-white text-draft" : "border-white/90 bg-black/25 text-transparent hover:bg-black/40")}
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
  /**
   * RENDERS PROMOTED TO REFERENCES — ours feeding the next one.
   *
   * The brief could only ever be built from the COMPETITOR's photos, so the second render
   * could not be told "like the one you just made, but on a model". That is the normal way
   * this work goes: the first pass establishes the look and every pass after it is an edit
   * of that look, and without this the only way to say so was to describe the render in
   * words to a model that had just produced it.
   *
   * Held as URLs rather than indices because `picked` indexes the PAGE's reference array,
   * which these are not part of — they are ours, they may be discarded, and they must not
   * renumber the competitor set when they are.
   */
  const [usedAsRef, setUsedAsRef] = useState<string[]>([])
  const toggleRenderRef = (url: string) =>
    setUsedAsRef((p) => (p.includes(url) ? p.filter((u) => u !== url) : [...p, url]))
  const [genErrs, setGenErrs] = useState<string[]>([])

  /*
   * WHICH ONE IS BIG, on each side. Separate from `picked` on purpose: "show me this one" and
   * "feed this one to the render" are different questions, and the strip that answered both at
   * 48px answered neither.
   */
  const [heroRef, setHeroRef] = useState(0)
  const [heroGen, setHeroGen] = useState(0)

  /*
   * THE SHAPE OF A REFERENCE, learned from the picture itself.
   *
   * A competitor's photo arrives with no metadata — a URL and nothing else — so the only
   * honest source for its aspect is the loaded image. Read in the LOAD event, which is an
   * event and not a loader: the frame changing shape does not change the src, so nothing
   * here can re-trigger the load that wrote it. Keyed by index, because the strip switches
   * between photos of different shapes and each keeps its own.
   */
  const [refAspects, setRefAspects] = useState<Record<number, number>>({})

  /*
   * ZOOM. Which picture is open full-size, and from which side.
   *
   * `side` decides which list the arrow keys walk, so paging stays inside the set you opened
   * instead of running off the end of it into the other one — the same shape the publish
   * page's lightbox settled on.
   */
  const [zoom, setZoom] = useState<{ side: "ref" | "gen"; index: number } | null>(null)
  /** Fit, or bigger than the window with the frame scrolling under it. */
  const [zoomedIn, setZoomedIn] = useState(false)
  const zoomBox = useRef<HTMLDivElement | null>(null)

  /*
   * THE HISTORY — renders that outlive the window.
   *
   * `cands` is this session's batch and nothing more; closing the dialog used to throw away
   * work that had been charged for. This is the same list read back from the server, so it
   * survives a reload, a different machine, and the browser being cleared.
   */
  const [history, setHistory] = useState<ListingRender[]>([])
  const [histOpen, setHistOpen] = useState(false)
  const [histErr, setHistErr] = useState<string | null>(null)

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

  /**
   * READ THE HISTORY. Once per open, and once after a batch lands.
   *
   * Never keyed to the list it fills — that is the loader shape this codebase has already
   * been bitten by. It runs on an open, which is an event, and on a generation, which is a
   * press; neither can re-fire on the state this writes.
   *
   * A failure is QUIET. The history is a convenience beside a panel whose actual job is
   * rendering, and an error banner over a feature nobody asked for yet would be the loudest
   * thing in the window. It reappears empty and the section simply does not render.
   */
  const loadHistory = useCallback(async () => {
    try {
      const r = await listListingRenders(60)
      if (r.renders) setHistory(r.renders)
    } catch { /* quiet — see above */ }
  }, [])

  /** Read the ticked references and put the result in the box. A CLICK, never anything automatic. */
  const runRead = useCallback(async (idxs: number[], extra: string[] = []) => {
    const imgs = [...idxs.map((i) => references[i]), ...extra].filter(Boolean)
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
      loadHistory()
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
        images: [...picked.map((i) => references[i]), ...usedAsRef].filter(Boolean),
        model, aspectRatio: ratio, imageSize: effSize, count,
      })
      // Partial success is the NORMAL shape here, not an edge case: a daily cap or an empty
      // wallet stops the batch part-way, so both halves are shown rather than one winning.
      if (r.results?.length) {
        setCands((p) => [...r.results, ...p]); setHeroGen(0)
        // The server filed each one as it rendered and handed the row back, so the history
        // moves with the batch rather than waiting for the next time the window opens.
        setHistory((p) => [...r.results.filter((x) => x.id), ...p])
      }
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
      const out = await removeBackground(r.url.startsWith("data:") ? r.url : canvasReadableSrc(r.url))
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

  /**
   * BRING ONE BACK. A history thumb becomes the big picture on the right, which is where
   * every decision about a render already lives — use it, cut its background out, feed it
   * to the next one, discard it. Nothing is duplicated: if it is already in this session's
   * batch it is simply selected.
   */
  const openFromHistory = (h: ListingRender) => {
    setHistOpen(false)
    const at = cands.findIndex((c) => c.url === h.url)
    if (at >= 0) { setHeroGen(at); return }
    setCands((p) => [h, ...p]); setHeroGen(0)
  }

  /**
   * REMOVE ONE FROM THE LIST — and only from the list.
   *
   * The stored photo stays where it is, on purpose: by the time anyone tidies this panel the
   * picture may already be published on a listing, and a delete here must never be a way to
   * blank a live marketplace photo. Optimistic, then put back if the server refused, because
   * a row that vanishes and returns is honest and a row that vanishes when nothing happened
   * is not.
   */
  const forgetFromHistory = async (h: ListingRender) => {
    if (!h.id) return
    setHistErr(null)
    const before = history
    setHistory((p) => p.filter((x) => x.id !== h.id))
    try {
      const r = await deleteListingRender(h.id)
      if (r.error) { setHistory(before); setHistErr(r.error) }
    } catch (e) {
      setHistory(before)
      setHistErr(e instanceof Error ? e.message : "Couldn't remove that one.")
    }
  }

  const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
  const hero = cands[heroGen] || null

  /*
   * WHAT SHAPE EACH WELL IS.
   *
   * Ours follows the render being shown, and BEFORE there is one it follows the ratio in the
   * settings — so the empty well is already the shape of what the button would make, rather
   * than a square that changes size the moment the picture lands.
   *
   * Theirs follows the photograph, once the browser has told us what shape it is.
   */
  const genAspect = ratioOf(hero ? hero.aspectRatio : ratio)
  const refAspect = refAspects[heroRef] ?? 1

  /** Which list the lightbox is paging through, and what it is showing. */
  const zoomList = zoom?.side === "gen" ? cands.map((c) => c.url) : references
  const zoomSrc = zoom ? zoomList[zoom.index] : null
  const openZoom = (side: "ref" | "gen", index: number) => { setZoomedIn(false); setZoom({ side, index }) }
  const stepZoom = (d: number) =>
    setZoom((z) => {
      if (!z) return z
      const n = (z.side === "gen" ? cands.length : references.length)
      if (!n) return z
      setZoomedIn(false)
      return { ...z, index: (z.index + d + n) % n }
    })

  /**
   * ARROWS WALK THE SET, and the listener is on CAPTURE.
   *
   * A bubble-phase listener never fires from inside a Base UI popup — something between the
   * popup and the window stops the key on its way up, which is how the publish page's
   * gallery ended up ignoring the keyboard entirely. Verified there; the same applies here,
   * where the lightbox is a popup opened over another popup.
   */
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      e.preventDefault()
      stepZoom(e.key === "ArrowRight" ? 1 : -1)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // stepZoom closes over the two lists, which is what the deps below stand for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, cands.length, references.length])

  /**
   * ZOOM IN ON THE MIDDLE, not on the top-left corner.
   *
   * Scaling past the frame with the scroll box parked at 0,0 shows a shoulder and a bit of
   * background — never the print, which is the one part anybody opens this to look at.
   */
  const toggleZoomedIn = () => {
    setZoomedIn((v) => {
      const next = !v
      if (next) {
        // After paint, or the box has not grown yet and there is nothing to scroll.
        setTimeout(() => {
          const el = zoomBox.current
          if (!el) return
          el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
          el.scrollTop = (el.scrollHeight - el.clientHeight) / 2
        }, 0)
      }
      return next
    })
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A DEFINITE WIDTH, not w-auto. The frames size themselves now, and a dialog that
            hugged its content shrank to whatever the two pictures happened to want — so a
            pair of portraits opened a window two thirds the width of the one a pair of
            landscapes opened, and the panel changed size as you paged the thumbnails.
            Fixing the width is what lets the pictures be as large as the space allows
            WITHOUT the space itself moving, which is what the note on the panel grid
            below is about. */}
      <DialogContent className="flex max-h-[92dvh] w-auto max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(96vw,74rem)] sm:max-w-[min(96vw,74rem)]">
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
              <Frame aspect={refAspect} className="bg-muted/40">
                {references[heroRef] ? (
                  /* THE PICTURE IS THE BUTTON. A magnifier hovering in the corner is a
                     control to find before you can look closer; the photograph itself is
                     already under the pointer, which is where every gallery worth copying
                     puts this. The glyph stays as the AFFORDANCE — it says a click does
                     something — and the cursor says what. */
                  <button
                    type="button"
                    onClick={() => openZoom("ref", heroRef)}
                    aria-label="View this reference photo full size"
                    title="View full size"
                    className="group size-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={references[heroRef]}
                      alt=""
                      className="size-full object-contain"
                      /* The only place the shape of a competitor's photo can be learned. An
                         EVENT, not a loader: the frame resizing does not change the src, so
                         this cannot re-trigger what wrote it. */
                      onLoad={(e) => {
                        const el = e.currentTarget
                        if (!el.naturalWidth || !el.naturalHeight) return
                        const a = el.naturalWidth / el.naturalHeight
                        setRefAspects((p) => (Math.abs((p[heroRef] ?? 0) - a) < 0.001 ? p : { ...p, [heroRef]: a }))
                      }}
                    />
                    <span aria-hidden className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/45 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <MagnifyingGlassPlus size={13} weight="bold" />
                    </span>
                  </button>
                ) : <span className="text-xs text-muted-foreground">No reference photo</span>}
              </Frame>
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
              <Frame aspect={genAspect}>
                {hero && !busy ? (
                  <button
                    type="button"
                    onClick={() => openZoom("gen", heroGen)}
                    aria-label="View this render full size"
                    title="View full size"
                    className="group size-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {/* object-contain against a frame that is ALREADY this render's aspect —
                        so it fills the well exactly. Contain rather than cover because the
                        two agree: nothing to letterbox, and nothing to crop either. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hero.url} alt="" className="size-full bg-muted/40 object-contain" />
                    {/* The size rode in a header row that is gone. On the picture is where it
                        belonged anyway — it describes THIS render, not the column. */}
                    <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-2xs tabular-nums text-white">
                      {hero.size} · {hero.aspectRatio}
                    </span>
                    <span aria-hidden className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/45 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <MagnifyingGlassPlus size={13} weight="bold" />
                    </span>
                  </button>
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
                      {/* A SPINNER, NOT ONLY A SHEEN.
                          The sheen was meant to say "working" without a spinner, the way the
                          image tools do. It did not read — the frame looked the same whether
                          a render was in flight or the panel was simply waiting to be used,
                          and a wash that slow is easy to miss entirely on a bright screen.
                          Under prefers-reduced-motion the sheen is off, which left NOTHING
                          moving at all. A turning ring is unambiguous, and the words say
                          which of the two states this is and how many are coming. */}
                      {busy ? (
                        <span className="flex flex-col items-center gap-2 text-xs font-medium text-primary">
                          <CircleNotch size={26} className="animate-spin" />
                          Rendering {count > 1 ? `${count} photos` : "a photo"}…
                        </span>
                      ) : null}
                      {/* The violet itself, not --brand-foreground. That token is the LIME half of the
                          action pair — it is a label colour for a solid violet fill, and at
                          1.19:1 on a near-white tint it would be invisible. */}
                      {!busy && <ImageSquare size={30} weight="light" className="text-primary/40" />}
                    </div>
                  </div>
                )}
              </Frame>
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
                    {/* FEED IT BACK IN. A render can brief the next one, which is how this
                        work actually goes — the first pass sets the look and every pass after
                        is an edit of it. Ghost when off, secondary when on, so the state is
                        the fill and the label stays put. */}
                    <Button
                      size="sm"
                      variant={usedAsRef.includes(hero.url) ? "secondary" : "ghost"}
                      className={usedAsRef.includes(hero.url) ? "" : "text-muted-foreground"}
                      onClick={() => toggleRenderRef(hero.url)}
                      title={usedAsRef.includes(hero.url)
                        ? "The next render and Write from photos will both see this one"
                        : "Use this render as a reference for the next one"}
                    >
                      <Check size={13} weight="bold" />
                      {usedAsRef.includes(hero.url) ? "Used as reference" : "Use as reference"}
                    </Button>
                    {/* THE WORDS THAT MADE IT. Only offered when the box does not already
                        hold them, and only on a render that came back from the history with
                        its brief — which is the whole reason to come back to one. It
                        REPLACES what is typed, the same rule "Rewrite from photos" follows,
                        so the label says which brief you are getting. */}
                    {hero.prompt && hero.prompt !== prompt && (
                      <Button size="sm" variant="ghost" className="text-muted-foreground"
                        onClick={() => { setPrompt(hero.prompt || ""); setPreset(null) }}
                        title={hero.prompt}>
                        <Sparkle size={13} weight="fill" /> Use this brief
                      </Button>
                    )}
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
                      className={"relative size-14 overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60 " +
                        (heroGen === i ? "ring-2 ring-primary" : "")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.url} alt="" className="size-full object-cover" />
                      {/* The SAME mark the reference strip uses, so "this one is feeding the
                          render" looks identical on both sides of the window. */}
                      {usedAsRef.includes(c.url) && (
                        <span aria-hidden className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border-2 border-white bg-white text-draft shadow-sm">
                          <Check size={9} weight="bold" />
                        </span>
                      )}
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
              <div className="flex items-start gap-2 rounded-md bg-hold/10 p-2 text-xs text-hold">
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
                      onClick={() => runRead(picked, usedAsRef)} disabled={reading || (!picked.length && !usedAsRef.length)}
                      /* A promoted RENDER counts as a photo to read, the same as a ticked
                         reference — so the label and the tooltip ask for one only when there
                         is genuinely nothing on either side to read. */
                      title={(picked.length || usedAsRef.length)
                        ? "Read the ticked photos and write the brief"
                        : "Tick a reference photo above, or use one of our renders"}
                    >
                      {reading ? <CircleNotch size={13} className="animate-spin" /> : <Sparkle size={13} weight="fill" />}
                      {reading ? "Reading…"
                        : (!picked.length && !usedAsRef.length) ? "Pick a photo first"
                        : prompt ? "Rewrite from photos" : "Write from photos"}
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
                  <div className="flex items-start gap-2 rounded-md bg-hold/10 p-2 text-xs leading-relaxed text-hold">
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

          {/* ── EVERYTHING THIS ACCOUNT HAS RENDERED ─────────────────────────────
                Closed by default and only present when there is something in it. Open, it
                is a wall of thumbnails under a day heading, which is the only ordering that
                matches how anyone looks for one of these — "the ones from Tuesday", never
                "render 41".

                A thumb PUTS THE PICTURE BACK on the right rather than doing anything itself,
                because every decision about a render already lives there and a second set of
                actions down here would be the same four buttons in a smaller font. ── */}
          {history.length > 0 && (
            <div className="border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setHistOpen((o) => !o)}
                aria-expanded={histOpen}
                className="flex w-full items-center gap-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <CaretDown size={11} weight="bold" className={"text-muted-foreground transition-transform " + (histOpen ? "" : "-rotate-90")} />
                History
                <span className="tabular-nums text-muted-foreground">{history.length}</span>
              </button>

              {histOpen && (
                <div className="mt-3 space-y-3">
                  {histErr && (
                    <div className="flex items-start gap-1.5 text-2xs text-destructive">
                      <Warning size={12} className="mt-0.5 shrink-0" /><span>{histErr}</span>
                    </div>
                  )}
                  {groupByDay(history).map(([day, rows]) => (
                    <div key={day} className="space-y-1.5">
                      <div className="text-2xs text-muted-foreground">{day}</div>
                      <div className="flex flex-wrap gap-2">
                        {rows.map((h) => (
                          <div key={h.id || h.url} className="relative">
                            <button
                              type="button"
                              onClick={() => openFromHistory(h)}
                              title={h.prompt || "Open this render"}
                              aria-label="Open this render"
                              className="size-20 overflow-hidden rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={h.url} alt="" className="size-full object-cover" />
                            </button>
                            {/* The same corner mark the ticks use, so a control in that
                                position reads as a control here too. It removes the ROW —
                                the photo itself stays in storage, because it may already be
                                live on a listing. */}
                            <button
                              type="button"
                              onClick={() => forgetFromHistory(h)}
                              aria-label="Remove this render from the history"
                              title="Remove from history — the photo itself is kept"
                              className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border-2 border-white bg-black/45 text-white shadow-sm outline-none transition-colors hover:bg-destructive focus-visible:ring-2 focus-visible:ring-ring/60"
                            >
                              <Trash size={10} weight="bold" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* ── FULL SIZE ────────────────────────────────────────────────────────────────
          A SIBLING of the studio dialog, never a child of it. A second Base UI dialog
          mounted INSIDE the first one's popup opens and shuts in the same frame — the
          parent's dismiss logic counts the newly mounted child as an outside press. That
          was verified on the publish page's lightbox; this is the same fix.

          Two steps, because they answer different questions. Fit answers "is the whole
          composition right"; actual size answers "is the print sharp, is the type straight,
          did it invent a seam" — which is the question you cannot ask of a 300px tile, and
          the reason this window exists at all. ── */}
    <Dialog open={zoomSrc != null} onOpenChange={(o) => { if (!o) setZoom(null) }}>
      {/* Fit HUGS the picture — a portrait in a letterbox-wide window is the same
          letterboxing this whole change is about, one layer up. Zoomed it takes the
          window instead, because at that point the frame is a viewport onto something
          bigger and a narrow one shows less of it. */}
      <DialogContent className={"w-auto max-w-[calc(100vw-1.5rem)] gap-2 p-3 sm:max-w-[min(96vw,80rem)] "
        + (zoomedIn ? "sm:w-[min(96vw,80rem)]" : "")}>
        <DialogTitle className="pr-10 text-xs font-medium text-muted-foreground">
          {zoom?.side === "gen"
            ? `Our render ${(zoom.index ?? 0) + 1} of ${cands.length}`
            : `Reference photo ${(zoom?.index ?? 0) + 1} of ${references.length} — the competitor's own shot`}
        </DialogTitle>
        <div
          ref={zoomBox}
          className={"max-h-[78dvh] overflow-auto rounded-lg bg-muted/40 " + (zoomedIn ? "cursor-zoom-out" : "cursor-zoom-in")}
        >
          {zoomSrc && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={zoomSrc}
              alt=""
              onClick={toggleZoomedIn}
              className={zoomedIn
                ? "max-w-none"
                : "mx-auto max-h-[78dvh] w-auto max-w-full object-contain"}
              style={zoomedIn ? { width: "220%" } : undefined}
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="outline" onClick={toggleZoomedIn}>
            <MagnifyingGlassPlus size={13} weight="bold" />
            {zoomedIn ? "Fit" : "Zoom in"}
          </Button>
          {zoomList.length > 1 && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => stepZoom(-1)} aria-label="Previous">
                <CaretLeft size={13} weight="bold" />
              </Button>
              <span className="text-2xs tabular-nums text-muted-foreground">{(zoom?.index ?? 0) + 1} / {zoomList.length}</span>
              <Button size="sm" variant="outline" onClick={() => stepZoom(1)} aria-label="Next">
                <CaretRight size={13} weight="bold" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

/**
 * NEWEST FIRST, UNDER A DAY.
 *
 * "Today" and "Yesterday" rather than a date for the two days anybody is actually looking
 * for — a date string for this morning is a small puzzle, and the list is read from the top.
 * The rows arrive ordered from the server, so this only has to keep that order.
 */
function groupByDay(rows: ListingRender[]): [string, ListingRender[]][] {
  const out: [string, ListingRender[]][] = []
  const today = new Date(); today.setHours(0, 0, 0, 0)
  for (const r of rows) {
    const t = r.createdAt ? new Date(r.createdAt) : null
    let label = "Earlier"
    if (t && !Number.isNaN(t.getTime())) {
      const d = new Date(t); d.setHours(0, 0, 0, 0)
      const days = Math.round((today.getTime() - d.getTime()) / 86400000)
      label = days <= 0 ? "Today" : days === 1 ? "Yesterday"
        : t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: t.getFullYear() === today.getFullYear() ? undefined : "numeric" })
    }
    const last = out[out.length - 1]
    if (last && last[0] === label) last[1].push(r)
    else out.push([label, [r]])
  }
  return out
}
