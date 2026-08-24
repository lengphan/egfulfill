"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cheapestImage, cheapestSize, cheapestVideo } from "@/lib/ai-cheapest"
import { CircleNotch, Warning, X, DownloadSimple, FilmSlate, ArrowSquareOut, Prohibit } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"
import { getUser } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DictateButton } from "@/components/app/dictate-button"
import { TabBar } from "@/components/app/tab-bar"
import Link from "next/link"
import {
  getDeskImageConfig, generateListingPhotos,
  getDeskVideoConfig, generateDeskVideo, getDeskVideoJob,
  type DeskImageConfig, type DeskVideoConfig, type ListingRender,
} from "@/lib/api"
import {
  STUDIO_TEMPLATES, TEMPLATE_GROUPS, fillTemplate,
  type StudioTemplate, type TemplateGroup,
} from "@/lib/studio-templates"

/**
 * STUDIO — pictures without writing a prompt.
 *
 * The generator has existed for a while and went unused, because it opens on an empty box.
 * A blank prompt field asks you to be a photographer at the moment you wanted a photo of a
 * t-shirt, so the real cost of an image was ten minutes of writing rather than three cents
 * of rendering. A template is those ten minutes, already done.
 *
 * ITS OWN PAGE, not the dashboard. The dashboard's job is reading state — what is late,
 * what is short, what shipped — and a generator sitting in it makes the page two jobs at
 * once. This is a place you come to on purpose.
 *
 * THE PRICE IS ON SCREEN BEFORE THE PRESS, every time, like every other paid surface here.
 */
export default function StudioPage() {
  /**
   * ADMINS AND OPERATORS, SAID HERE TOO — the sidebar entry is gone for every other role,
   * and a removed link is not a guard: the URL still resolves. The pair mirrors the server's
   * `IMAGE_ROLES` (support_ai.js / publish.js); widen both or neither.
   *
   * What happened before was the worst of the three options. The page rendered in full —
   * title, four tabs, the template grid — and every press came back with the server's
   * "Generating images is limited to admins and sellers" in red. A screen that cannot be
   * READ versus one that does not exist has to say which (CLAUDE.md §4), and this said
   * neither: it looked like a working page that was broken.
   *
   * Deferred, like every other role read on these pages: getUser() reads storage, which
   * does not exist during the prerender.
   */
  const [role, setRole] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    const id = setTimeout(() => setRole(getUser()?.role ?? null), 0)
    return () => clearTimeout(id)
  }, [])

  const [cfg, setCfg] = useState<DeskImageConfig | null>(null)
  const [cfgErr, setCfgErr] = useState<string | null>(null)
  const [group, setGroup] = useState<TemplateGroup>("product")
  const [open, setOpen] = useState<StudioTemplate | null>(null)
  /**
   * WHERE THE EDITOR IS, so pressing a template does something you can SEE.
   *
   * The brief opens in a second card BELOW the template grid — four rows of tiles down, off
   * the bottom of the window on any short one. So a click on a template changed nothing
   * visible, which is indistinguishable from a card that does not respond, and the answer
   * to "where does my picture come out" was "somewhere you have not scrolled to".
   */
  const editorRef = useRef<HTMLDivElement | null>(null)

  // What the slots get filled with. Deliberately two plain fields rather than a product
  // picker: this page makes marketing and site imagery as well as listing photos, and most
  // of those have no product record behind them at all.
  const [product, setProduct] = useState("")
  const [colour, setColour] = useState("")

  const [prompt, setPrompt] = useState("")
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState<string[]>([])
  const [shots, setShots] = useState<ListingRender[]>([])

  /**
   * ── THE CLIP ──────────────────────────────────────────────────────────────────────────
   *
   * The Motion tab used to end in a sentence: "Generate here first, then animate from the
   * result." There was nothing to press. Veo has been wired end to end for a while, but the
   * only way to reach it was to ARM THE CHAT COMPOSER — open a chat channel, press a
   * settings panel, describe the motion in the message box — so the page with the motion
   * templates on it, whose templates already carry a written `motion` brief, was the one
   * place that could not make a clip.
   *
   * So: a still is a still and a clip is a clip, and both are one press from the same
   * picture. Which is the choice this page should have been offering all along.
   *
   * IT DOES NOT COME BACK HERE, and the button says so. The server posts the finished video
   * into the caller's own chat thread — that is where a 1–3 minute job's result lives, and
   * inventing a second delivery route for it would be two places for one file. `jobs` keeps
   * the spinner honest until then; the poll returns a STATUS, never a url.
   */
  const [vid, setVid] = useState<DeskVideoConfig | null>(null)
  const [jobs, setJobs] = useState<Record<string, { status: string; usd: number; error?: string | null }>>({})
  /**
   * EVERY POLL THIS PAGE STARTED, so leaving the page stops all of them.
   *
   * A bare setInterval inside an async handler survives unmount and keeps hitting the API
   * from a page nobody is looking at. That is the family §2.8 is about — an unbounded loop
   * with nothing releasing it — even though this one is slow enough not to hurt.
   */
  const polls = useRef<number[]>([])
  useEffect(() => () => { polls.current.forEach(clearInterval); polls.current = [] }, [])

  useEffect(() => {
    let alive = true
    // A failure here is not an error on this page — it means video is off, and the Animate
    // button simply does not appear. Nothing about making a still depends on it.
    getDeskVideoConfig().then((c) => { if (alive) setVid(c.enabled ? c : null) }).catch(() => {})
    return () => { alive = false }
  }, [])

  /** The cheapest clip these settings can buy, derived from the catalogue rather than named:
   *  a hardcoded tier becomes wrong the day a cheaper one ships. */
  const clipSpec = useMemo(() => {
    const pick = cheapestVideo(vid?.models)
    if (!pick) return null
    const secs = Math.min(...(vid?.durations?.length ? vid.durations : [8]))
    return { model: pick.id, res: pick.res, rate: pick.usdPerSec, secs, usd: pick.usdPerSec * secs }
  }, [vid])

  useEffect(() => {
    let alive = true
    getDeskImageConfig()
      .then((c) => { if (alive) setCfg(c) })
      .catch((e) => { if (alive) setCfgErr(e instanceof Error ? e.message : "Couldn't load the generator.") })
    return () => { alive = false }
  }, [])

  /* THE CHEAPEST RENDER THE CATALOGUE OFFERS, as the default — the same choice the photo
     studio and the chat composer make. A page of one-click buttons must not quietly open on
     the dearest option.

     Priced over every (model, SIZE) pair, not by each model's own default: a model's default
     size is a quality choice, so ranking models by it can pick a dearer render than the one
     beside it. The rule is lib/ai-cheapest — shared, because this page had its own. */
  const cheapest = useMemo(() => cheapestImage(cfg?.models), [cfg])
  const model = cheapest?.id ?? cfg?.model ?? ""
  const spec = cfg?.models.find((m) => m.id === model) ?? null
  const size = cheapest?.size ?? cheapestSize(spec) ?? "1K"
  const each = spec?.usd[size] ?? cfg?.quote?.imagePrice ?? 0
  const total = each * count

  const pick = useCallback((t: StudioTemplate) => {
    setOpen(t)
    setPrompt(fillTemplate(t.prompt, { product, colour }))
    setShots([]); setErrs([])
    // After the card exists. A ref read in the same tick is still null on the first pick,
    // which is the one that matters — nothing was open before it.
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0)
  }, [product, colour])

  /* Re-filling on a subject change is an EVENT, not an effect.
     Watching [product, colour] and calling setPrompt is the shape CLAUDE.md §2.8 warns
     about — state written from an effect that reads the state beside it — and
     react-hooks/set-state-in-effect refuses it outright. Typing in the subject field is a
     keystroke, so the re-fill belongs on the keystroke. A hand-edited brief is never
     overwritten: the prompt only moves while it still matches what the template produced. */
  const retarget = (next: { product?: string; colour?: string }) => {
    const p = next.product ?? product
    const c = next.colour ?? colour
    if (next.product !== undefined) setProduct(next.product)
    if (next.colour !== undefined) setColour(next.colour)
    if (open && prompt === fillTemplate(open.prompt, { product, colour })) {
      setPrompt(fillTemplate(open.prompt, { product: p, colour: c }))
    }
  }

  const run = async () => {
    if (!open || !prompt.trim()) return
    setBusy(true); setErrs([])
    try {
      const r = await generateListingPhotos({
        prompt: prompt.trim(), model, aspectRatio: open.ratio, imageSize: size, count,
      })
      if (r.results?.length) setShots((p) => [...r.results, ...p])
      setErrs(r.errors?.length ? r.errors : (r.error ? [r.error] : []))
    } catch (e) {
      setErrs([e instanceof Error ? e.message : "That didn't work."])
    } finally { setBusy(false) }
  }

  /**
   * Start a clip from one still. The MOTION brief comes from the template — it is the field
   * that made this a motion template in the first place — and falls back to the still's own
   * brief for a template that has none, which is the honest thing to send rather than an
   * empty prompt.
   *
   * Polling stops when the job leaves `pending`; there is no retry and no ceiling to breach,
   * because the interval is cleared on the terminal status and on unmount (CLAUDE.md §2.8).
   */
  const animate = async (shot: ListingRender) => {
    const name = shot.url.split("/api/support/asset/")[1]
    if (!name || !clipSpec || !open) return
    setJobs((j) => ({ ...j, [shot.url]: { status: "starting", usd: clipSpec.usd } }))
    try {
      const r = await generateDeskVideo({
        prompt: open.motion || prompt.trim(),
        imageName: name,
        aspectRatio: open.ratio,
        resolution: clipSpec.res,
        durationSeconds: clipSpec.secs,
        model: clipSpec.model,
      })
      if (!r.ok || !r.jobId) {
        setJobs((j) => ({ ...j, [shot.url]: { status: "error", usd: 0, error: r.error || "The clip didn't start." } }))
        return
      }
      const id = r.jobId
      setJobs((j) => ({ ...j, [shot.url]: { status: "pending", usd: r.usd ?? clipSpec.usd } }))
      /* A CEILING, because "keep asking until it answers" has no end. Veo takes 1–3
         minutes; at 10s a tick, 60 tries is ten minutes, which is well past any clip that
         is still coming. After that the chat thread is the answer, not this page. */
      let tries = 0
      const tick = window.setInterval(async () => {
        const stop = () => { clearInterval(tick); polls.current = polls.current.filter((t) => t !== tick) }
        if (++tries > 60) { stop(); setJobs((j) => ({ ...j, [shot.url]: { status: "slow", usd: j[shot.url]?.usd ?? 0 } })); return }
        try {
          const s = await getDeskVideoJob(id)
          if (s.status && s.status !== "pending") {
            stop()
            setJobs((j) => ({ ...j, [shot.url]: { status: s.status, usd: j[shot.url]?.usd ?? 0, error: s.error } }))
          }
        } catch { stop() }
      }, 10_000)
      polls.current.push(tick)
    } catch (e) {
      setJobs((j) => ({ ...j, [shot.url]: { status: "error", usd: 0, error: e instanceof Error ? e.message : "The clip didn't start." } }))
    }
  }

  const shown = STUDIO_TEMPLATES.filter((t) => t.group === group)
  const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`

  // undefined = the role has not been read yet. Rendering the refusal in that frame would
  // flash "not for you" at an admin on every load.
  if (role === undefined) return null
  if (role !== "admin" && role !== "operator") {
    return (
      <SectionCard title="Studio" bodyClassName="p-4">
        <EmptyState
          icon={Prohibit}
          title="Studio is for admins and operators"
          note="Generating spends from the platform account. Listing photos are made from the publish dialog instead."
        />
      </SectionCard>
    )
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Studio"
        actions={
          <div className="flex items-center gap-2">
            <Input value={product} onChange={(e) => retarget({ product: e.target.value })}
              placeholder="What is it? e.g. canvas apron" className="h-8 w-52" />
            <Input value={colour} onChange={(e) => retarget({ colour: e.target.value })}
              placeholder="Colour" className="h-8 w-28" />
          </div>
        }
        bodyClassName="space-y-4 p-4"
      >
        {/* THE SHARED BAR, not a sixteenth copy of it. This was fourteen lines of fresh
            Tailwind reproducing tab-bar.tsx by hand — the exact thing that component's own
            header says it exists to stop, and the reason its spacing could not be fixed in
            one place. (digitizer-studio.tsx still carries its own copy.) */}
        <TabBar ariaLabel="Studio templates" items={TEMPLATE_GROUPS} value={group} onChange={setGroup} />

        {cfgErr ? (
          <p className="text-sm text-alert">{cfgErr}</p>
        ) : !cfg ? (
          <div className="flex justify-center py-10"><CircleNotch size={20} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((t) => (
              <button key={t.id} type="button" onClick={() => pick(t)}
                className="group overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-foreground/25">
                {/* No stock thumbnail. A picture of someone else's render is a promise this
                    template cannot keep — the ratio says what SHAPE you get, which is the
                    part that actually is guaranteed.
                    ONE TILE HEIGHT for every card. Sizing each tile to its own ratio made a
                    ragged grid where a 4:5 card pushed its neighbours out of line, so the
                    set read as broken rather than as varied. The proportion is drawn INSIDE
                    a fixed frame instead — you still see the shape, and the rows align. */}
                <div className="relative flex h-32 items-center justify-center bg-muted/60">
                  <span aria-hidden className="rounded-sm bg-background/70 shadow-sm"
                    style={{ aspectRatio: t.ratio.replace(":", " / "), height: "4.5rem", maxWidth: "80%" }} />
                  <span className="absolute font-mono text-xs text-muted-foreground">{t.ratio}</span>
                  {t.motion && (
                    <span className="absolute right-2 top-2 rounded bg-pop px-1.5 py-0.5 text-2xs font-medium text-pop-foreground">
                      Motion
                    </span>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t.what}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {open && (
        <div ref={editorRef} className="scroll-mt-4">
        <SectionCard
          title={open.name}
          actions={<Button variant="ghost" size="icon-sm" onClick={() => setOpen(null)} aria-label="Close"><X size={14} /></Button>}
          bodyClassName="space-y-3 p-4"
        >
          <div className="rounded-lg border border-input focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
              className="min-h-28 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none field-sizing-content" />
            <div className="flex flex-wrap items-center gap-1 border-t border-border px-1.5 py-1.5">
              <DictateButton value={prompt} onChange={setPrompt} className="size-8 shrink-0" label="Describe it out loud" />
              <span className="font-mono text-2xs text-muted-foreground">{open.ratio} · {size}</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}
                className="eg-control h-8 text-xs" aria-label="How many">
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {total > 0 ? <>{count} × {money(each)} = <span className="font-semibold text-foreground">{money(total)}</span></> : "no charge"}
                </span>
                <Button size="sm" className="h-8" onClick={run} disabled={busy || !prompt.trim()}>
                  {busy && <CircleNotch size={14} className="animate-spin" />}
                  {busy ? "Rendering…" : "Generate"}
                </Button>
              </div>
            </div>
          </div>

          {/* THE SENTENCE THAT USED TO BE HERE said "generate here first, then animate from
              the result" — an instruction for a control that did not exist on this page. It
              is a button on each still now, so the words are gone: a control explains itself
              in its label (CLAUDE.md §4). */}

          {errs.map((e, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-alert">
              <Warning size={13} className="mt-0.5 shrink-0" /><span className="break-words">{e}</span>
            </div>
          ))}

          {/* THE RESULT HAS A PLACE BEFORE IT EXISTS.
              This rendered only once `shots` had something in it, so until a render came
              back there was nothing on screen to say a picture was coming, where it would
              appear, or what shape it would be — and while one WAS rendering the only sign
              was a spinner inside the button, at the far end of a toolbar. An empty frame in
              the right shape answers all three before the money is spent.

              The one sentence is allowed here because this is an empty state and there is
              nothing else to read — and it is carrying the fact people actually ask about:
              these are CANDIDATES. Nothing is written into a listing, by anything, ever. */}
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {shots.map((s) => {
              const job = jobs[s.url]
              return (
              <div key={s.url} className="overflow-hidden rounded-lg border border-border bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt="" className="w-full object-contain" />
                <div className="flex items-center justify-center gap-1 border-t border-border px-1 py-1">
                  <a href={s.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <DownloadSimple size={13} /> Open
                  </a>
                  {/* EITHER OUTPUT, FROM THE SAME PICTURE. The still is already paid for, so
                      this is the only place a clip can start without buying a second frame —
                      which is exactly why it lives on the image rather than in the toolbar. */}
                  {clipSpec && !job && (
                    <button type="button" onClick={() => void animate(s)}
                      title={`Animate this still — ${clipSpec.secs}s at ${clipSpec.res}, ${money(clipSpec.usd)}`}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                      <FilmSlate size={13} /> Animate
                      <span className="tabular-nums opacity-70">{money(clipSpec.usd)}</span>
                    </button>
                  )}
                  {/* The sweeper writes `done` or `failed`; this page adds `starting` and
                      `error` for a request that never reached it. Anything else is still in
                      flight — a status this page has not heard of must not read as success. */}
                  {job && !["error", "failed", "done", "slow"].includes(job.status) && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
                      <CircleNotch size={13} className="animate-spin" /> Rendering
                    </span>
                  )}
                  {/* WHERE IT WENT. The server posts the clip into your own chat thread, so
                      the finished state is a LINK to it — not a claim that it is on this
                      page, which it never will be. */}
                  {job?.status === "done" && (
                    <Link href="/chat"
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent">
                      <FilmSlate size={13} /> Clip in chat <ArrowSquareOut size={11} />
                    </Link>
                  )}
                  {/* STILL RUNNING, and this page stopped watching. Not a failure and not a
                      success — the clip is the thread's to deliver, so it points there. */}
                  {job?.status === "slow" && (
                    <Link href="/chat"
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                      <FilmSlate size={13} /> Still rendering — it lands in chat <ArrowSquareOut size={11} />
                    </Link>
                  )}
                  {(job?.status === "error" || job?.status === "failed") && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-alert" title={job.error ?? undefined}>
                      <Warning size={13} /> Clip failed
                    </span>
                  )}
                </div>
              </div>
              )
            })}
            {/* One frame per render still on its way, in the ratio it will come back in. */}
            {busy && Array.from({ length: count }, (_, i) => (
              <div key={`pending-${i}`} className="flex animate-pulse items-center justify-center rounded-lg bg-muted/60"
                style={{ aspectRatio: open.ratio.replace(":", " / ") }}>
                <CircleNotch size={18} className="animate-spin text-muted-foreground" />
              </div>
            ))}
          </div>
          {!busy && shots.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
              <span aria-hidden className="rounded-sm bg-muted" style={{ aspectRatio: open.ratio.replace(":", " / "), height: "3.5rem" }} />
              <p className="text-xs text-muted-foreground">
                {open.ratio} candidates appear here. Download the ones you want — nothing is added to a listing.
              </p>
            </div>
          )}
        </SectionCard>
        </div>
      )}
    </div>
  )
}
