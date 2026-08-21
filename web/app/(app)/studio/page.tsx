"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, Warning, X, DownloadSimple } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DictateButton } from "@/components/app/dictate-button"
import {
  getDeskImageConfig, generateListingPhotos,
  type DeskImageConfig, type ListingRender,
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
  const [cfg, setCfg] = useState<DeskImageConfig | null>(null)
  const [cfgErr, setCfgErr] = useState<string | null>(null)
  const [group, setGroup] = useState<TemplateGroup>("product")
  const [open, setOpen] = useState<StudioTemplate | null>(null)

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

  useEffect(() => {
    let alive = true
    getDeskImageConfig()
      .then((c) => { if (alive) setCfg(c) })
      .catch((e) => { if (alive) setCfgErr(e instanceof Error ? e.message : "Couldn't load the generator.") })
    return () => { alive = false }
  }, [])

  /* The cheapest model that can do the job, as the default — the same choice the photo
     studio makes. A page of one-click buttons must not quietly open on the dearest option. */
  const model = useMemo(() => {
    if (!cfg?.models?.length) return ""
    const cheapest = [...cfg.models].sort((a, b) =>
      (a.usd[a.defaultSize] ?? 99) - (b.usd[b.defaultSize] ?? 99))[0]
    return cheapest?.id ?? cfg.model
  }, [cfg])
  const spec = cfg?.models.find((m) => m.id === model) ?? null
  const size = spec?.defaultSize ?? "1K"
  const each = spec?.usd[size] ?? cfg?.quote?.imagePrice ?? 0
  const total = each * count

  const pick = useCallback((t: StudioTemplate) => {
    setOpen(t)
    setPrompt(fillTemplate(t.prompt, { product, colour }))
    setShots([]); setErrs([])
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

  const shown = STUDIO_TEMPLATES.filter((t) => t.group === group)
  const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`

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
        {/* A rule under the live word — the app's tab treatment, not a row of pills. */}
        <nav className="-mb-px flex gap-4 border-b border-border">
          {TEMPLATE_GROUPS.map((g) => (
            <button key={g.id} type="button" onClick={() => setGroup(g.id)}
              className={"relative pb-2 text-sm transition-colors " +
                (group === g.id
                  ? "font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground")}>
              {g.label}
            </button>
          ))}
        </nav>

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

          {open.motion && (
            <p className="text-xs text-muted-foreground">
              A clip is made from a still you have approved, not from the brief — so the frame is
              paid for once and animated once. Generate here first, then animate from the result.
            </p>
          )}

          {errs.map((e, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-alert">
              <Warning size={13} className="mt-0.5 shrink-0" /><span className="break-words">{e}</span>
            </div>
          ))}

          {shots.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {shots.map((s) => (
                <div key={s.url} className="overflow-hidden rounded-lg bg-muted/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt="" className="w-full object-contain" />
                  <a href={s.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <DownloadSimple size={13} /> Open
                  </a>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}
