"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Sparkle, X } from "@phosphor-icons/react"
import { getDeskImageConfig, generateDeskImage, uploadHeroImage, writeSiteCopy, type Backdrop, type CopyKind, type DeskImageConfig } from "@/lib/api"
import { removeBackground } from "@/lib/remove-background"
import { cheapestImage, cheapestSize } from "@/lib/ai-cheapest"

/**
 * ASK FOR THE PICTURE WHERE THE PICTURE GOES.
 *
 * The inline editor removed one round trip — you no longer walk to Settings to change a word.
 * This removes the other, and it was the longer one: to put a new figure on the homepage you
 * opened the Studio, wrote a prompt, waited, downloaded the render, cut it out, came back,
 * and uploaded it. Six steps and two screens, of which exactly one — the prompt — is the part
 * a person actually has an opinion about.
 *
 * So the prompt happens here, in front of the thing it replaces, and everything after it is
 * automatic: generate, cut out, upload, paint. What you judge is the real figure at the real
 * size on the real page, which is the only place the judgement means anything.
 *
 * ── IT USES THE SAME ROUTE AS THE STUDIO, DELIBERATELY ────────────────────────────────────
 *
 * `POST /api/desk/image` — the same gate, the same billing, the same channel. A second
 * generation path would be a second place for the key, the quota and the charge to be got
 * wrong, and the render still lands in the assistant thread afterwards, so nothing generated
 * from this bubble is invisible to the person paying for it.
 *
 * ── THE BACKDROP IS NOT A STYLE CHOICE ────────────────────────────────────────────────────
 *
 * The render API returns JPEG and always will, so asking a model for transparency makes it
 * PAINT a checkerboard. A flat sweep is the only thing a browser cut-out can separate, which
 * is why the default here is grey rather than none: the page is white, and against white the
 * matte has nothing to tell a pale sleeve from the background.
 */

const GEN_BACKDROPS: { value: Backdrop | ""; label: string }[] = [
  { value: "grey", label: "Grey sweep" },
  { value: "white", label: "White sweep" },
  { value: "", label: "No sweep" },
]

/** Shared with the app's controls: a field is a field (CLAUDE.md §4). */
const FIELD = "eg-control h-9 w-full text-xs"

/**
 * A TEXTAREA IS NOT AN .eg-control, and this was the whole reason the prompt looked broken.
 *
 * `.eg-control` is a one-line control: `display:inline-flex`, `height:2rem`, `line-height:1`
 * and — the one that did the damage — `white-space:nowrap`. On a textarea nowrap means the
 * words CANNOT WRAP, so a prompt of any length became a single line scrolling sideways behind
 * a horizontal scrollbar, with the beginning of the sentence off the left edge. The four rows
 * underneath it stayed empty no matter how much was typed.
 *
 * Same edge, same radius, same focus ring as `Input` — just a field that is allowed to be
 * more than one line tall.
 */
const TEXTAREA = "w-full resize-y rounded-lg border border-input bg-background px-3 py-2 outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"

export function GenerateBubble({ onDone, onClose }: {
  /** Hand back the stored URL of the finished picture. The caller writes it wherever it goes. */
  onDone: (url: string) => void
  onClose: () => void
}) {
  const [cfg, setCfg] = useState<DeskImageConfig | null>(null)
  const [prompt, setPrompt] = useState("")
  const [backdrop, setBackdrop] = useState<Backdrop | "">("grey")
  const [ratio, setRatio] = useState("3:4")
  const [modelId, setModelId] = useState("")
  const [size, setSize] = useState("")
  const [cutOut, setCutOut] = useState(true)
  const [busy, setBusy] = useState<null | "render" | "cut" | "upload">(null)
  /** Seconds since the press. See the effect below for why a spinner alone was not enough. */
  const [secs, setSecs] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      getDeskImageConfig()
        .then((c) => {
          setCfg(c)
          /*
           * OPEN ON THE CHEAPEST PAIR, which is also the FASTEST — the same default the
           * Studio and the listing photo studio already make, from the same shared rule.
           *
           * This opened on the CONFIGURED model at its LARGEST size, and that is Nano Banana
           * Pro at 4K: 24c a press and the slowest render Google sells, for a picture nobody
           * has decided they want yet. The first press on a prompt is a draft. Moving up to
           * Pro is a deliberate choice made once the words are right, which is what the model
           * picker beside this is for.
           */
          const cheap = cheapestImage(c.models)
          const m = c.models?.find((x) => x.id === (cheap?.id || c.model)) ?? c.models?.[0]
          if (m) { setModelId(m.id); setSize(cheap?.size || cheapestSize(m) || m.defaultSize) }
          if (c.ratios?.length && !c.ratios.includes("3:4")) setRatio(c.ratios[0])
        })
        .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't reach image generation."))
    }, 0)
    return () => clearTimeout(t)
  }, [])

  /*
   * HOW LONG IT HAS BEEN GOING. A render is 10–60 seconds at Google — longer on Pro, longer
   * again if the model is contended and the server takes its retries — and the panel said
   * only "Rendering…". After twenty seconds a bare spinner is indistinguishable from a
   * request that died, which is what "taking forever" actually looks like from here.
   * `secs` is reset on the press, not in this effect, so nothing writes state from an effect.
   */
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [busy])

  const model = cfg?.models?.find((m) => m.id === modelId) ?? cfg?.models?.[0]
  /*
   * THE PRICE IS ON SCREEN BEFORE THE PRESS — and it has to be the right person's price.
   *
   * This read `quote.imagePrice` alone, and `quoteFor()` returns 0 for staff because the
   * factory's own desk has no wallet to charge. So the one surface only an admin can open
   * printed "$0.00" over a render that costs us 3.4c to 24c, which reads as free.
   *
   * A seller sees THEIR price from the quote; staff see what Google charges US for the pair
   * that is actually selected. Same split as the listing photo studio — showing one as the
   * other is how our cost ends up presented to a seller as their bill.
   */
  const staffViewer = cfg?.quote ? cfg.quote.staff : false
  const freeLeft = cfg?.quote && !cfg.quote.staff ? cfg.quote.freeLeft : 0
  const perImage = staffViewer ? (model?.usd[size] ?? 0) : freeLeft > 0 ? 0 : (cfg?.quote?.imagePrice ?? 0)
  const blocked = cfg && (!cfg.enabled || !cfg.keySet || !cfg.storageReady)
  const blockedWhy = !cfg ? null
    : !cfg.keySet ? "No image key is set — Settings › Integrations."
    : !cfg.storageReady ? "File storage isn't configured, so a render couldn't be kept."
    : !cfg.enabled ? "Image generation is switched off."
    : null

  const run = useCallback(async () => {
    const text = prompt.trim()
    if (!text) { setErr("Describe the picture you want."); return }
    setErr(null)
    try {
      setSecs(0)
      setBusy("render")
      const r = await generateDeskImage({
        prompt: text,
        aspectRatio: ratio,
        imageSize: size || undefined,
        // The picked model, not the configured one — this panel chooses its own now.
        model: modelId || undefined,
        backdrop: backdrop || undefined,
      })
      if (r.error || !r.ok || !r.attachment?.url) throw new Error(r.error || "The render didn't come back.")

      // SAME-ORIGIN, which is what makes the next step possible at all: the attachment is a
      // proxy URL on our own host, so the canvas the cut-out reads is not tainted.
      let url = r.attachment.url
      if (cutOut) {
        setBusy("cut")
        const cut = await removeBackground(url)
        if ("error" in cut) throw new Error(cut.error)
        // A cut that clears almost nothing means the sweep and the subject were the same
        // value — say so rather than storing a rectangle and calling it a cut-out.
        if (cut.cleared / Math.max(cut.pixels, 1) < 0.02) {
          throw new Error("Nothing separated from the background — try the grey sweep, or turn the cut-out off.")
        }
        setBusy("upload")
        const up = await uploadHeroImage(cut.url)
        if (up.error || !up.url) throw new Error(up.error || "Upload failed.")
        url = up.url
      } else {
        setBusy("upload")
        const up = await uploadHeroImage(url)
        if (up.error || !up.url) throw new Error(up.error || "Upload failed.")
        url = up.url
      }
      onDone(url)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.")
    } finally {
      setBusy(null)
    }
  }, [prompt, ratio, size, modelId, backdrop, cutOut, onDone, onClose])

  return (
    /* ROOM TO WRITE THE PROMPT. 22rem was a chat popover holding a 4,000-character field: the
       prompt is the only part of this panel a person has an opinion about, and it had less
       width than the three selects underneath it. */
    <div className="w-[34rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-4 text-left shadow-xl">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkle size={14} weight="fill" /> Generate a picture
        </span>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Close">
          <X size={14} weight="bold" />
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={6}
        maxLength={4000}
        disabled={!!busy}
        autoFocus
        placeholder="A full-length studio portrait of one person in a canvas work apron, hard key light, seamless sweep behind…"
        className={TEXTAREA + " min-h-[9rem] text-sm leading-relaxed"}
      />

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* THE MODEL IS A CHOICE NOW, and each row carries its own price. The dear one is
            also the slow one, so this is the control that answers both "what does it cost"
            and "why is it taking so long". */}
        <label className="col-span-2 block">
          <span className="mb-1 block text-2xs text-muted-foreground">Model</span>
          <select value={modelId} disabled={!!busy || !cfg} onChange={(e) => {
            const next = e.target.value
            setModelId(next)
            // Sizes are per model — lite offers 1K only, and asking it for 4K is a 400 from
            // Google. Land on the cheapest the new model has rather than keeping a size it
            // may not offer at all.
            const m = cfg?.models?.find((x) => x.id === next)
            if (m) setSize(cheapestSize(m) || m.defaultSize)
          }} className={FIELD}>
            {(cfg?.models ?? []).map((m) => (
              <option key={m.id} value={m.id}>{`${m.label} · $${(m.usd[cheapestSize(m)] ?? 0).toFixed(3)}`}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs text-muted-foreground">Size</span>
          <select value={size} disabled={!!busy || !model} onChange={(e) => setSize(e.target.value)} className={FIELD}>
            {(model?.sizes ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs text-muted-foreground">Shape</span>
          <select value={ratio} disabled={!!busy} onChange={(e) => setRatio(e.target.value)} className={FIELD}>
            {(cfg?.ratios ?? ["3:4"]).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-2xs text-muted-foreground">Backdrop</span>
          <select value={backdrop} disabled={!!busy} onChange={(e) => setBackdrop(e.target.value as Backdrop | "")} className={FIELD}>
            {GEN_BACKDROPS.map((b) => <option key={b.label} value={b.value}>{b.label}</option>)}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2 self-end pb-1.5 text-sm">
          <input type="checkbox" checked={cutOut} disabled={!!busy} onChange={(e) => setCutOut(e.target.checked)} className="size-4" />
          Cut the background out
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {/* WHAT IT COSTS, BEFORE. A generated picture is money, and a button that spends it
            without saying how much is the thing this repo has already been burned by. */}
        <span
          className="text-sm font-medium tabular-nums"
          title={staffViewer ? "What this render costs us at Google" : "What this render costs you"}
        >
          {blocked ? "" : freeLeft > 0 ? `${freeLeft} free left`
            : perImage > 0 ? `$${perImage.toFixed(staffViewer ? 3 : 2)}` : ""}
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!!busy || !!blocked || !prompt.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy && <CircleNotch size={14} className="animate-spin" />}
          {busy === "render" ? `Rendering… ${secs}s` : busy === "cut" ? `Cutting out… ${secs}s` : busy === "upload" ? `Saving… ${secs}s` : "Generate"}
        </button>
      </div>

      {/* A REFUSAL CARRIES ITS REASON — that is the answer, not a subtitle. */}
      {(err || blockedWhy) && <p className="mt-2 text-xs leading-snug text-alert">{err || blockedWhy}</p>}
    </div>
  )
}

/**
 * ASK FOR THE WORDS WHERE THE WORDS ARE.
 *
 * The same argument as the picture, one field smaller. The copy has been editable in place
 * for a while; what still happened in another tab was the WRITING — describe the page to a
 * chat, paste the answer back, find it is the wrong length for the space, do it again. The
 * field already knows what it is and what it currently says, so the only thing left to
 * supply is what you want changed.
 *
 * IT HANDS BACK TEXT, IT DOES NOT SAVE. The editor holds a draft and a person presses Save,
 * exactly as when they type — a generator that published its own output would be the one
 * edit on this page nobody reviewed.
 *
 * The KIND comes from the path rather than from a prop at every call site (see kindForPath),
 * because the length limit is a property of the slot and the slot is what the path names.
 */
export function CopyBubble({ kind, current, onDone, onClose }: {
  kind: CopyKind
  current: string
  onDone: (text: string) => void
  onClose: () => void
}) {
  const [instruction, setInstruction] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    const text = instruction.trim()
    if (!text) { setErr("Say what you want it to say."); return }
    setErr(null); setBusy(true)
    try {
      const r = await writeSiteCopy({ kind, current, instruction: text })
      if (r.error || !r.ok || !r.text) throw new Error(r.error || "Nothing came back.")
      onDone(r.text)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not write that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="block w-[20rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-3 text-left font-sans text-foreground shadow-xl">
      <span className="mb-2 flex items-center justify-between gap-2">
        {/* The slot is named, because "at most 8 words" is the thing the person most needs to
            know before they write the instruction — and it is not adjustable, so it is a
            fact about the field rather than a control. */}
        <span className="text-xs font-semibold normal-case tracking-normal">Rewrite this {kind}</span>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Close">
          <X size={13} weight="bold" />
        </button>
      </span>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
        maxLength={600}
        disabled={busy}
        autoFocus
        placeholder="Say it in plainer words, and lead with the queue"
        className={TEXTAREA + " min-h-[4.5rem] text-sm font-normal normal-case leading-relaxed tracking-normal"}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose() }
          // Enter sends. These are one-line instructions, and a textarea that needs a button
          // press for a single sentence is a form pretending to be a message box.
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run() }
        }}
      />
      <span className="mt-2 flex items-center justify-end">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !instruction.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium normal-case tracking-normal text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy && <CircleNotch size={12} className="animate-spin" />}
          {busy ? "Writing…" : "Rewrite"}
        </button>
      </span>
      {/* A REFUSAL CARRIES ITS REASON — the server says whether the key is missing or the
          instruction was rejected, and that sentence is the answer. */}
      {err && <span className="mt-2 block text-2xs font-normal normal-case leading-snug tracking-normal text-alert">{err}</span>}
    </span>
  )
}

/**
 * THE SLOT, DERIVED FROM THE PATH.
 *
 * `hero.headline` is a headline and `cta.button` is a button — the blob's own field names
 * already say what each string is for, so a `kind` prop at every EditableText call site would
 * be a second copy of that information, kept by hand, wrong the first time someone adds a
 * field. The last path segment is the answer; anything unrecognised is prose.
 */
export function kindForPath(path: string): CopyKind {
  const last = path.split(".").pop() ?? ""
  if (/headline|heading|title/i.test(last)) return "headline"
  if (/accent/i.test(last)) return "accent"
  if (/subhead|subtitle/i.test(last)) return "subhead"
  if (/button|cta/i.test(last)) return "button"
  if (/label|rule[LR]|ghostWord/i.test(last)) return "label"
  return "body"
}
