"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowClockwise, ArrowCounterClockwise, ArrowUUpLeft, CheckCircle, CircleNotch, MagnifyingGlassMinus, MagnifyingGlassPlus, PencilSimple, Sparkle, X } from "@phosphor-icons/react"
import { getUser } from "@/lib/auth"
import { setSiteContent, uploadHeroImage } from "@/lib/api"
import { downscaleImage } from "@/lib/image-downscale"
import { FIGURE_SCALE_MAX, FIGURE_SCALE_MIN, type SiteContent } from "@/lib/site-content"
import { CopyBubble, GenerateBubble, kindForPath } from "@/components/marketing/generate-bubble"

/**
 * EDITING THE MARKETING SITE ON THE MARKETING SITE.
 *
 * The copy has always been editable — it lives in one jsonb blob and Settings › Site content
 * is a complete form over it. The complaint was never that it could not be changed; it was
 * the ROUND TRIP. To replace the garment on the homepage you made a render in Studio, cut it
 * out, exported it, walked to Settings, found the right sub-tab, uploaded it, saved, then went
 * back to the homepage to see whether it looked right — and if it did not, all of that again.
 * A form on another screen cannot show you the thing you are editing, so every edit is a
 * guess followed by a check.
 *
 * So the page becomes the form. The same blob, the same PUT, the same upload route — what
 * changes is only WHERE you stand while you edit, which is in front of the result.
 *
 * ── WHY A DRAFT, NOT A LIVE WRITE ────────────────────────────────────────────────────────
 *
 * Every keystroke going straight to the database would mean the public homepage rendered a
 * half-typed headline to anyone loading it at that moment. So edits accumulate in a draft
 * held here, the page renders the draft, and NOTHING is public until Save. Discard throws the
 * draft away and the server's copy is untouched, which is what makes trying something safe.
 *
 * ── WHY NOT A CONTROLLED contentEditable ─────────────────────────────────────────────────
 *
 * React and contentEditable fight over the DOM: re-rendering a node while the caret is in it
 * moves the caret, usually to the start, which makes typing a sentence backwards. So the text
 * is read on BLUR, not on input. The draft therefore lags the DOM by one field, which is
 * correct — the value you committed is the one you finished writing.
 */

/** A dotted path into the content blob — `hero.title`, `hero.callouts.0.label`. */
export type ContentPath = string

function readPath(obj: unknown, path: ContentPath): unknown {
  return path.split(".").reduce<unknown>((v, k) => {
    if (v == null || typeof v !== "object") return undefined
    return (v as Record<string, unknown>)[k]
  }, obj)
}

/**
 * Immutable set down a dotted path, cloning only the spine.
 *
 * An ARRAY has to stay an array: the blob carries callouts and stats as lists, and rebuilding
 * one as `{0: …, 1: …}` would serialise to an object and quietly empty every list it touched.
 */
function writePath<T>(obj: T, path: ContentPath, value: unknown): T {
  const keys = path.split(".")
  const walk = (node: unknown, i: number): unknown => {
    if (i === keys.length) return value
    const key = keys[i]
    if (Array.isArray(node)) {
      const next = node.slice()
      next[Number(key)] = walk(node[Number(key)], i + 1)
      return next
    }
    const src = (node && typeof node === "object" ? node : {}) as Record<string, unknown>
    return { ...src, [key]: walk(src[key], i + 1) }
  }
  return walk(obj, 0) as T
}

type EditCtx = {
  /** Is edit mode switched ON. False for everyone who is not an admin. */
  on: boolean
  /** Is the viewer allowed to edit at all — drives whether the toolbar exists. */
  admin: boolean
  read: (path: ContentPath) => unknown
  write: (path: ContentPath, value: unknown) => void
  dirty: boolean
}

const Ctx = createContext<EditCtx | null>(null)

export function useEditMode(): EditCtx {
  return useContext(Ctx) ?? { on: false, admin: false, read: () => undefined, write: () => {}, dirty: false }
}

export function EditModeProvider({ initial, children }: { initial: SiteContent; children: React.ReactNode }) {
  const router = useRouter()
  const [admin, setAdmin] = useState(false)
  const [on, setOn] = useState(false)
  const [draft, setDraft] = useState<SiteContent>(initial)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /**
   * The role is read AFTER mount, never during render.
   *
   * The marketing pages are server-rendered and the session lives in browser storage, so the
   * server cannot know who is looking. Deciding during render would mean the server says "no
   * toolbar" and the client says "toolbar", which is a hydration mismatch — React discards
   * the tree and the page flashes. Deferred to an effect, the toolbar simply appears a beat
   * after paint, which is what a control for one person in the company should do anyway.
   */
  useEffect(() => {
    const id = setTimeout(() => {
      const u = getUser()
      const isAdmin = u?.role === "admin"
      setAdmin(isAdmin)
      /*
       * ?edit=1 OPENS STRAIGHT INTO EDITING.
       *
       * The floating bar has always been here, but it is one pill at the bottom of a long
       * page that only one person in the company ever sees — which makes it findable only if
       * you already know it exists. A link is the discoverable half: Settings › Site content
       * sends you to the page you want ALREADY in edit mode, so the route in is a control on
       * a screen people open on purpose rather than a thing to notice.
       *
       * Still gated on the role, so the parameter grants nothing — it only skips a click for
       * someone who could already have made it.
       */
      if (isAdmin && new URLSearchParams(window.location.search).get("edit") === "1") setOn(true)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  /**
   * NO EFFECT SYNCS THE DRAFT BACK TO THE SERVER COPY, deliberately.
   *
   * The obvious version — "when `initial` changes and nothing is dirty, adopt it" — is a
   * setState inside an effect, which this codebase lints against for good reason: it renders
   * one frame of stale state and then corrects it. It is also unnecessary. After a save the
   * draft already IS what was saved, so the refreshed server copy agrees with it; and while
   * an edit is in flight, adopting a server copy is precisely the thing that would delete
   * work in progress. `discard` reads the current `initial` prop directly, so the way back to
   * the published version stays exact without anything watching.
   */
  const read = useCallback((path: ContentPath) => readPath(draft, path), [draft])
  const write = useCallback((path: ContentPath, value: unknown) => {
    setDraft((d) => writePath(d, path, value))
    setDirty(true)
    setSaved(false)
  }, [])

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      const r = await setSiteContent(draft)
      if (r?.error) throw new Error(r.error)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2600)
      // The page is server-rendered on a 60-second window, so without this the words you
      // just saved would be replaced by the stale ones the next time you navigated.
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.")
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setDraft(initial); setDirty(false); setErr(null); setOn(false)
  }

  const value = useMemo<EditCtx>(() => ({ on: on && admin, admin, read, write, dirty }), [on, admin, read, write, dirty])

  return (
    <Ctx.Provider value={value}>
      {children}
      {admin && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
          {/* One bar, and it says what state the page is in. A control that toggles between
              "editing" and "not editing" has to show WHICH, or the only way to find out is to
              click something and see whether it turns into a text box. */}
          <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-2 py-2 shadow-lg backdrop-blur">
            {!on ? (
              <button
                type="button"
                onClick={() => setOn(true)}
                className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <PencilSimple size={15} weight="bold" /> Edit this page
              </button>
            ) : (
              <>
                <span className="px-2 text-sm font-medium">
                  {dirty ? "Unsaved changes" : "Editing"}
                </span>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? <CircleNotch size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} weight="bold" /> : null}
                  {saving ? "Saving…" : saved ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={discard}
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X size={14} weight="bold" /> {dirty ? "Discard" : "Done"}
                </button>
              </>
            )}
          </div>
          {/* A REFUSAL CARRIES ITS REASON — the server says which field or which limit. */}
          {err && <p className="mt-2 rounded-lg bg-alert/10 px-3 py-1.5 text-center text-xs text-alert">{err}</p>}
        </div>
      )}
    </Ctx.Provider>
  )
}

/**
 * A string you can edit where it sits.
 *
 * Off, this renders the text and nothing else — no wrapper, no class, no change to the page
 * a visitor sees. That is the whole contract: an editing affordance that alters the layout is
 * a second design to keep in sync with the first.
 */
export function EditableText({ path, children }: { path: ContentPath; children: string }) {
  const { on, read, write } = useEditMode()
  const ref = useRef<HTMLSpanElement>(null)
  const [asking, setAsking] = useState(false)
  const stored = read(path)
  const value = typeof stored === "string" ? stored : children

  if (!on) return <>{value}</>

  /*
   * A SPAN, NOT A DIV, and the bubble is spans all the way down.
   *
   * These sit INSIDE an <h1> and inside <p> — a div in either is invalid nesting, and the
   * browser's repair for it is to close the paragraph early, which silently drops the rest of
   * the line. So the wrapper and the bubble are inline elements made to lay out as blocks,
   * and `relative` on an inline element is still a valid positioning context.
   */
  return (
    <span className="relative">
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      tabIndex={0}
      // Read on blur, never on input — see the note at the top of this file about the caret.
      onBlur={(e) => {
        const next = e.currentTarget.textContent ?? ""
        if (next !== value) write(path, next)
      }}
      /* A LABEL INSIDE A LINK MUST NOT FOLLOW IT while it is being edited. Three of these sit
         in a CTA pill, so clicking to place the caret navigated to /signup and took the page —
         and the draft — with it. Only the click is cancelled; mousedown is what places the
         caret, so the field still behaves like a field. */
      onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.currentTarget.textContent = value; e.currentTarget.blur() }
        // Enter commits rather than inserting a newline: these are headlines and labels, and
        // a stray <br> in a jsonb string renders as a literal on the public page.
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() }
      }}
      className="-mx-1 rounded px-1 outline-none ring-1 ring-inset ring-foreground/15 transition-[box-shadow,background-color] hover:bg-foreground/[0.04] focus:bg-foreground/[0.04] focus:ring-2 focus:ring-foreground/40"
    >
      {value}
    </span>
    {/* THE HANDLE IS A SUPERSCRIPT MARK, not a button beside the words.
        A control on the baseline would push the line it is editing — the headline would
        re-wrap the moment edit mode came on, so what you are judging is no longer the page a
        visitor sees. Absolute and tiny keeps the type where it was. */}
    <button
      type="button"
      onClick={() => setAsking((v) => !v)}
      title={`Rewrite this ${kindForPath(path)}`}
      className="absolute -top-2 left-full z-10 ml-0.5 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground opacity-40 transition-opacity hover:opacity-100"
    >
      <Sparkle size={9} weight="fill" />
    </button>
    {asking && (
      <span className="absolute left-0 top-full z-20 mt-2 block">
        <CopyBubble
          kind={kindForPath(path)}
          current={value}
          onDone={(text) => {
            write(path, text)
            // The contentEditable owns its own DOM (see the note at the top of this file), so
            // a write to the draft does not reach the text already on screen — React will not
            // re-render a node it was told to leave alone. Setting it here is what makes the
            // new words appear where the old ones were, which is the entire point.
            if (ref.current) ref.current.textContent = text
          }}
          onClose={() => setAsking(false)}
        />
      </span>
    )}
    </span>
  )
}

/**
 * THE DRAFT VALUE FOR A PATH, or what the server rendered.
 *
 * `EditableText` renders the draft because it owns the node the words are in. A figure does
 * not: `EditableImage` wraps whatever the page already draws, and that child was handed
 * `content.hero.image` — the SERVER's copy — so generating or uploading a picture wrote the
 * new URL into the draft and the page went on showing the old one. Nothing appeared to
 * happen until Save, which is the exact round trip this mode exists to remove, and it made a
 * working generate look like a broken one.
 *
 * So the src comes through here. Off, it is the published value and the hook adds nothing.
 */
export function useEditableSrc(path: ContentPath, fallback: string): string {
  const { on, read } = useEditMode()
  if (!on) return fallback
  const v = read(path)
  return typeof v === "string" ? v : fallback
}

/**
 * THE SAME THING FOR A NUMBER — how the picture sits, rather than which picture it is.
 *
 * Identical reasoning to useEditableSrc: the page was handed the SERVER's value, so pressing
 * rotate wrote to the draft and the figure did not move until Save. A control that appears to
 * do nothing is worse than no control.
 */
export function useEditableNum(path: ContentPath, fallback: number): number {
  const { on, read } = useEditMode()
  if (!on) return fallback
  const v = read(path)
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

/** The two siblings that say how a figure sits. `hero.image` → `hero.imageScale`. Derived
 *  rather than passed, so a new EditableImage cannot forget to wire them; a path that is not
 *  a figure's simply gets no transform controls. */
function transformPaths(path: ContentPath): { scale: ContentPath; rotate: ContentPath } | null {
  if (!path.endsWith(".image")) return null
  return { scale: `${path}Scale`, rotate: `${path}Rotate` }
}

/** Degrees, kept in -180..180 so pressing one way repeatedly never runs off to 7200. */
function wrapDeg(d: number) { return ((d + 180) % 360 + 360) % 360 - 180 }

/**
 * The figure, replaceable from the page.
 *
 * This is the round trip the whole thing exists to remove, so it accepts a file the two ways
 * a picture actually arrives — dropped on the page, or picked from disk — and does the
 * downscale-and-upload the Settings form already did, through the same route.
 *
 * `children` is the figure as it renders publicly. In edit mode it gets an overlay rather
 * than a replacement, so what you are judging is still the real thing at the real size.
 */
export function EditableImage({ path, children }: { path: ContentPath; children: React.ReactNode }) {
  const { on, read, write } = useEditMode()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  /** The prompt composer, open in place. See generate-bubble.tsx for why it lives here and
   *  not behind a link to the Studio. */
  const [asking, setAsking] = useState(false)
  const current = read(path)
  /* How this figure sits. Derived from the path so no call site has to wire it — see
     transformPaths. A path that is not a figure's yields null and the group is not drawn. */
  const tp = transformPaths(path)
  const rawScale = tp ? read(tp.scale) : undefined
  const rawRotate = tp ? read(tp.rotate) : undefined
  const scaleV = typeof rawScale === "number" && Number.isFinite(rawScale) ? rawScale : 1
  const rotateV = typeof rawRotate === "number" && Number.isFinite(rawRotate) ? rawRotate : 0
  const hasImage = typeof current === "string" && current !== ""
  const moved = scaleV !== 1 || rotateV !== 0
  /* Clamped HERE as well as in the normalizer: a disabled button is how the control tells
     you it is at the end of its range, and 0.1 steps on a float need the rounding or the
     readout reads 119.99999%. */
  const zoom = (d: number) => tp && write(tp.scale,
    Math.round(Math.min(FIGURE_SCALE_MAX, Math.max(FIGURE_SCALE_MIN, scaleV + d)) * 10) / 10)
  const spin = (d: number) => tp && write(tp.rotate, wrapDeg(rotateV + d))

  const take = async (file: File | undefined) => {
    if (!file) return
    setErr(null)
    if (!file.type.startsWith("image/")) { setErr("That isn't an image."); return }
    setBusy(true)
    try {
      const dataUrl = await downscaleImage(file)
      const r = await uploadHeroImage(dataUrl)
      if (r.error || !r.url) throw new Error(r.error || "Upload failed")
      write(path, r.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setBusy(false)
    }
  }

  if (!on) return <>{children}</>

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]) }}
      className={"relative rounded-2xl ring-1 ring-inset transition-colors " + (over ? "ring-2 ring-foreground/50 bg-foreground/[0.04]" : "ring-foreground/15")}
    >
      {children}
      {/* TOP-RIGHT, not bottom-centre: the page-level toolbar is fixed to the bottom middle,
          and the two landed on top of each other — the figure's own controls were underneath
          the Save button, which is the one place they must not be. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end p-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 px-2 py-1.5 shadow-md backdrop-blur">
          {/* GENERATE COMES FIRST, because it is the one that does not need you to already
              have a file. Upload is the fallback for a picture that exists. */}
          <button
            type="button"
            onClick={() => { setErr(null); setAsking((v) => !v) }}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Sparkle size={13} weight="fill" /> Generate
          </button>
          <span aria-hidden className="h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {busy ? <CircleNotch size={13} className="animate-spin" /> : <PencilSimple size={13} weight="bold" />}
            {busy ? "Uploading…" : typeof current === "string" && current ? "Replace" : "Upload"}
          </button>
          {typeof current === "string" && current && !busy && (
            <button
              type="button"
              onClick={() => write(path, "")}
              className="rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Remove
            </button>
          )}
          {/* HOW IT SITS — only once there is something to sit. A rotate button over an empty
              figure is a control for nothing, and the bar is long enough already. Icons with
              `title`, which §4 names as where a control explains itself; a sentence under any
              of these would be the defect that section is about. */}
          {hasImage && tp && !busy && (
            <>
              <span aria-hidden className="h-4 w-px bg-border" />
              <button type="button" onClick={() => spin(-15)} title="Rotate left 15°"
                className="rounded-full p-1.5 transition-colors hover:bg-accent">
                <ArrowCounterClockwise size={13} weight="bold" /><span className="sr-only">Rotate left</span>
              </button>
              <button type="button" onClick={() => spin(15)} title="Rotate right 15°"
                className="rounded-full p-1.5 transition-colors hover:bg-accent">
                <ArrowClockwise size={13} weight="bold" /><span className="sr-only">Rotate right</span>
              </button>
              <button type="button" onClick={() => zoom(-0.1)} disabled={scaleV <= FIGURE_SCALE_MIN}
                title="Smaller" className="rounded-full p-1.5 transition-colors hover:bg-accent disabled:opacity-40">
                <MagnifyingGlassMinus size={13} weight="bold" /><span className="sr-only">Smaller</span>
              </button>
              {/* The value you are setting, not a caption about it. */}
              <span className="min-w-[2.75rem] text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(scaleV * 100)}%
              </span>
              <button type="button" onClick={() => zoom(0.1)} disabled={scaleV >= FIGURE_SCALE_MAX}
                title="Bigger" className="rounded-full p-1.5 transition-colors hover:bg-accent disabled:opacity-40">
                <MagnifyingGlassPlus size={13} weight="bold" /><span className="sr-only">Bigger</span>
              </button>
              {/* A rotation has no layout answer, so it can push the figure past its box. The
                  way back is a button, not a guess at what the original angle was. */}
              {moved && (
                <button type="button" onClick={() => { write(tp.scale, 1); write(tp.rotate, 0) }}
                  title="Back to as generated"
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <ArrowUUpLeft size={13} weight="bold" /><span className="sr-only">Reset size and rotation</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {/* UNDER the control bar and inside the figure, so the prompt sits beside the picture it
          is about to replace — the whole reason it is not a link to another screen. */}
      {asking && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-3 pt-14">
          <div className="pointer-events-auto">
            <GenerateBubble onDone={(url) => write(path, url)} onClose={() => setAsking(false)} />
          </div>
        </div>
      )}
      {err && <p className="absolute inset-x-0 -bottom-6 text-center text-xs text-alert">{err}</p>}
      <input
        ref={fileRef} type="file" accept="image/*" className="sr-only"
        onChange={(e) => { void take(e.target.files?.[0]); e.target.value = "" }}
      />
    </div>
  )
}
