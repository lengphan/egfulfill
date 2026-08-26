"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Plus, Trash, ArrowSquareOut, UploadSimple, Warning, Image as ImageIcon } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getSiteContentAdmin, setSiteContent, uploadHeroImage } from "@/lib/api"
import { DEFAULT_SITE_CONTENT, type SiteContent, type PageFigure } from "@/lib/site-content"
import { useConfirm } from "@/components/app/confirm-dialog"
import { MotionEditor } from "@/components/app/motion-editor"
import { Dropzone } from "@/components/app/dropzone"
import { downscaleImage, fileToDataUrl } from "@/lib/image-downscale"
import { isVideoSrc, MEDIA_ACCEPT } from "@/lib/media"

// Module-scope so they're stable across renders (react-hooks/static-components forbids
// defining components inside render).
const AREA_CLS =
  "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm  outline-none " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

function Field({ label, hint, value, onChange, mono }: {
 label: string; hint?: string; value: string; onChange: (v: string) => void; mono?: boolean
}) {
  const tl = useLabelT()
 return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", label)}</span>}
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={mono ? "tabular-nums" : ""} />
    </label>
  )
}

function Area({ label, hint, value, onChange }: {
 label: string; hint?: string; value: string; onChange: (v: string) => void
}) {
  const tl = useLabelT()
 return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", label)}</span>}
      <textarea className={AREA_CLS} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** The marketing routes that carry an inline editor. Adding one means adding it here AND
 *  wrapping that page's copy in EditableText/EditableImage — a link to a page with no
 *  editable fields opens a toolbar that can save nothing. */
const EDITABLE_PAGES = [
  { href: "/", label: "the homepage" },
] as const
// ONLY HOME, and this is checked rather than assumed: `grep -c EditableText components/
// marketing/bold-{features,how}.tsx` returns 0 for both. Their copy comes from the same blob
// and the tabs below edit it fine — they simply have no on-page fields yet, so linking them
// here would open a toolbar whose Save button has nothing to collect. Wrap their headings in
// EditableText and they belong in this list.

// A tab's intro line, so each section still explains itself without the old long-scroll headings.
function Intro({ children }: { children: React.ReactNode }) {
 return <p className="text-xs text-muted-foreground">{children}</p>
}



/**
 * THE FIGURE EDITOR — image, alt text, ghost word, callouts.
 *
 * Written ONCE and used three times. Three pages carry a CutoutFigure now, and the hero's
 * version of this block was 45 lines of JSX; copying it twice is exactly the re-derivation
 * §4's method section keeps having to undo — by the third copy the alt-text label reads
 * differently on one page and the Remove button behaves differently on another.
 *
 * The upload plumbing stays in the parent because it is one input, one in-flight flag and one
 * error line shared by all three; what varies is only WHERE the resulting URL is written, so
 * that is the callback.
 */
function FigureEditor({ figure, edit, onPickFile, onRemove, uploading, saving, preview, broken, onBroken, hint, video = false }: {
  figure: PageFigure
  /** Scoped to this page's figure, so a call site can't write to the wrong one. */
  edit: (fn: (f: PageFigure) => void) => void
  /** Hand the chosen bytes up. The parent owns the downscale + upload, because the in-flight
   *  flag and the error line are shared; only the destination differs. */
  onPickFile: (file: File | undefined) => void
  onRemove: () => void
  uploading: boolean
  saving: boolean
  /** A data URL shown instantly while the upload runs — null unless THIS figure is the one
   *  being uploaded, which is what keeps three editors from showing each other's preview. */
  preview: string | null
  broken: boolean
  onBroken: () => void
  hint: string
  /**
   * WHETHER THIS SLOT TAKES MOTION, and it is off for two of the three call sites on purpose.
   *
   * Only the homepage hero renders a video — the other two figures are CutoutFigure, which
   * wants a PNG with a real alpha channel and has nothing to do with a film. Accepting an mp4
   * everywhere would let an admin drop one into /features, watch it upload successfully, save,
   * and then find the page renders nothing at all: every step reports success and the result
   * is a blank section. The picker is the only place that mismatch can still be refused with a
   * sentence, so it is refused here.
   */
  video?: boolean
}) {
  const tl = useLabelT()
  /* Each editor owns its own input. A single shared ref in the parent would need a second
     piece of state saying which figure the next change event belongs to — one more thing to
     get wrong, to save one hidden element. */
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={fileRef} type="file" accept={video ? MEDIA_ACCEPT : "image/*"} className="hidden" onChange={(e) => { onPickFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = "" }} />
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", "Figure")}</span>
        {(preview || figure.image) ? (
          <div className="space-y-2">
            {broken && !preview ? (
              // The stored URL couldn't load. Almost always the object storage / CDN isn't
              // serving it publicly — say that plainly instead of a broken-image glyph.
              <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-hold/30 bg-hold/10 px-4 py-8 text-center text-xs text-hold">
                <Warning size={20} weight="fill" />
                <span className="font-medium">{tl("siteContent", "The saved figure isn’t loading.")}</span>
                <span className="max-w-sm">{tl("siteContent", "Its URL was saved, but the browser can’t open it — usually the storage bucket / CDN isn’t public. Re-upload, or check")} <code>SPACES_CDN</code> {tl("siteContent", "and public-read on the server.")}</span>
              </div>
            ) : (
              /* THE PREVIEW MATCHES WHAT THE PAGE WILL DRAW. An <img> pointed at an mp4 fires
                 onError and lands on the "isn't loading" branch above — which would blame the
                 storage bucket for a file that uploaded perfectly. Muted and looping, like the
                 hero, so what is previewed is what ships; controls are on because this one IS
                 a thing to inspect rather than a background. */
              isVideoSrc(preview || figure.image) ? (
                <video src={preview || figure.image} onError={onBroken} controls muted loop playsInline
                  className="max-h-44 w-full rounded-lg border border-border object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview || figure.image} alt={tl("siteContent", "Figure preview")} onError={onBroken}
                  className="max-h-44 w-full rounded-lg border border-border object-contain" />
              )
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <CircleNotch size={13} className="animate-spin" /> : <UploadSimple size={13} />}Replace
              </Button>
              <Button variant="ghost" size="sm" onClick={onRemove} disabled={uploading || saving}>{tl("siteContent", "Remove")}</Button>
            </div>
          </div>
        ) : (
          /* An EMPTY region may carry one sentence (§4), and the hint is the one fact the
             label cannot carry: where a picture with no background comes from. It lives on
             this branch only — once a figure is set, the same sentence would be prose
             under a control, which is the thing §4 keeps having to delete. */
          <Dropzone
            icon={ImageIcon}
            accept={video ? MEDIA_ACCEPT : "image/*"}
            disabled={uploading}
            busy={uploading ? "Uploading…" : null}
            onFiles={(files) => onPickFile(files[0])}
            label={tl("siteContent", "Drop the figure here")}
            hint={hint}
          />
        )}
      </div>

      <Field label={tl("siteContent", "What the picture is, in words")} value={figure.imageAlt} onChange={(v) => edit((f) => { f.imageAlt = v })} />
      <Field label={tl("siteContent", "Ghost word behind the figure")} value={figure.ghostWord} onChange={(v) => edit((f) => { f.ghostWord = v })} />

      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", "Figure callouts")}</span>
        <div className="space-y-2">
          {figure.callouts.map((co, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <div className="flex-1"><Field label={tl("siteContent", "Label")} value={co.label} onChange={(v) => edit((f) => { f.callouts[i].label = v })} /></div>
                <Button variant="ghost" size="sm" className="mt-5" onClick={() => edit((f) => { f.callouts.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
              <div className="mt-2"><Field label={tl("siteContent", "Note")} value={co.note ?? ""} onChange={(v) => edit((f) => { f.callouts[i].note = v })} /></div>
            </div>
          ))}
          {/* Four is what CutoutFigure draws — a fifth would be stored and silently never
              appear, which is the kind of thing that gets reported as "my edit didn't save". */}
          {figure.callouts.length < 4 && (
            <Button variant="outline" size="sm" onClick={() => edit((f) => { f.callouts.push({ label: "", note: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add callout")}</Button>
          )}
        </div>
      </div>
    </>
  )
}

/** One numbered item's fields — title, body and the "— specifics" run under it. Shared by the
 *  how-it-works steps and the features rows, which are the same shape. */
function NumberedItemFields({ item, edit }: {
  item: { title: string; body?: string; points?: string[] }
  edit: (fn: (it: { title: string; body?: string; points?: string[] }) => void) => void
}) {
  const tl = useLabelT()
  const points = item.points ?? []
  return (
    <>
      <Field label={tl("siteContent", "Title")} value={item.title} onChange={(v) => edit((it) => { it.title = v })} />
      <Area label={tl("siteContent", "Body")} value={item.body ?? ""} onChange={(v) => edit((it) => { it.body = v })} />
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", "Specifics")}</span>
        <div className="space-y-2">
          {points.map((pt, j) => (
            <div key={j} className="flex gap-2">
              <Input value={pt} onChange={(e) => edit((it) => { if (it.points) it.points[j] = e.target.value })} />
              <Button variant="ghost" size="sm" onClick={() => edit((it) => { it.points?.splice(j, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((it) => { if (!it.points) it.points = []; it.points.push("") })}><Plus size={13} weight="bold" />{tl("siteContent", "Add")}</Button>
        </div>
      </div>
    </>
  )
}

const SUBTABS: { id: string; label: string }[] = [
  { id: "hero", label: "Hero" },
  { id: "stats", label: "Stats" },
  { id: "features", label: "Features" },
  { id: "steps", label: "Steps" },
  { id: "testimonials", label: "Testimonials" },
  { id: "faq", label: "FAQ" },
  { id: "cta", label: "Closing CTA" },
  // The other two converted marketing pages. Their copy used to be arrays inside their
  // components, so a word change was a deploy.
  { id: "featuresPage", label: "Features page" },
  { id: "howPage", label: "How it works" },
  // Not copy, but the same blob, the same audience and the same Save — see the `motion` note
  // in lib/site-content.ts.
  { id: "motion", label: "Motion" },
]

/**
 * Edit the public marketing-home copy.
 *
 * Admin-only. Every field is backed by lib/site-content.ts defaults, so clearing one and
 * saving falls back to the shipped copy rather than blanking the homepage — the editor
 * reflects that by loading the merged (always-complete) content, never a half-empty form.
 *
 * Split into sub-tabs (one section each) so it's a short page per section, not one long
 * scroll. All tabs share ONE content object and ONE save — switching tabs keeps edits; only
 * Save writes them.
 */
export function SiteContentPanel() {
  const tl = useLabelT()
 const [content, setContent] = useState<SiteContent | null>(null)
 const [updatedAt, setUpdatedAt] = useState<string | null>(null)
 const [sub, setSub] = useState("hero")
 const [saving, setSaving] = useState(false)
 const [saved, setSaved] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [uploading, setUploading] = useState(false)
  // A LOCAL preview of the just-picked image, shown instantly so the banner isn't blank
  // while the upload runs — and stays visible even if the stored URL later fails to load.
 // KEYED BY FIGURE, because there are three of them now (hero, features page, how-it-works)
  // and a bare boolean would have shown the hero's just-picked preview under the features
  // page's dropzone — the two are on different tabs, so it would have looked like the upload
  // landed in the wrong place, which in a sense it would have.
 const [localPreview, setLocalPreview] = useState<{ key: string; url: string } | null>(null)
  // The stored URL didn't load in the <img>: almost always a storage/CDN that isn't public,
  // not a broken editor. Say so instead of showing a broken-image glyph.
 const [imgBroken, setImgBroken] = useState<string | null>(null)

 const load = useCallback(() => {
 getSiteContentAdmin()
      .then((r) => { setContent(r.content); setUpdatedAt(r.updatedAt) })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load site content"))
  }, [])
 useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // structuredClone + mutate keeps the deep-nested updates readable without a patch library.
 const edit = (fn: (c: SiteContent) => void) =>
 setContent((prev) => { if (!prev) return prev; const next = structuredClone(prev); fn(next); return next })

  // `override` lets an action persist the exact content it just produced (e.g. Remove banner)
  // instead of the async `content` state, which wouldn't have updated yet on the same click.
 const save = async (override?: SiteContent) => {
 const payload = override ?? content
 if (!payload) return
 setSaving(true); setErr(null); setSaved(false)
 try {
 const r = await setSiteContent(payload)
 if (r.error) throw new Error(r.error)
 setSaved(true); setTimeout(() => setSaved(false), 2500)
 load()
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Couldn't save — admin only.")
    } finally { setSaving(false) }
  }

  // Remove the figure AND persist it right away — "Remove" that only clears the form and
  // silently comes back on refresh isn't a removal. Saves the current content minus the image,
  // exactly as pressing Save after Remove would.
 const removeFigure = (key: string, apply: (c: SiteContent) => void) => {
 if (!content) return
 const next = structuredClone(content)
 apply(next)
 setLocalPreview(null); setImgBroken(null); setContent(next)
 void save(next)
  }

  // `key` identifies WHICH figure is uploading (for the preview), `apply` says where the
  // resulting URL is written. The route itself is figure-agnostic — it stores bytes and hands
  // back a URL — so nothing on the server needed to change to support three of these.
 const onPickImage = async (file: File | undefined, key: string, apply: (c: SiteContent, url: string) => void) => {
 if (!file) return
    /*
     * TWO MEDIA, TWO GATES. A video cannot go through downscaleImage — that draws the file
     * onto a canvas and re-encodes it as a JPEG, so an mp4 would come back as a single still
     * frame, upload happily, and play as a frozen picture. The branch is not a size
     * optimisation; it is the difference between storing the film and storing a screenshot
     * of it.
     *
     * The ceilings differ for the same reason the server's do (site_content.js): 40MB of
     * photo is a mistake, 40MB of video is a Tuesday. Nothing here re-encodes the video, so
     * what this admits is what gets stored — and the data URL is base64, about 4/3 the file,
     * which lib/api.ts routes to api.egful.store on size rather than through Vercel's proxy.
     */
 const isVid = file.type.startsWith("video/")
 if (!isVid && !file.type.startsWith("image/")) { setErr("That file isn't an image or a video — pick a JPEG, PNG, WebP, AVIF, MP4, WebM or MOV."); return }
    // Generous ceiling only as a sanity check — anything reasonable is downscaled below the
    // proxy limit before it's sent, so a big camera photo is fine.
 if (!isVid && file.size > 40 * 1024 * 1024) { setErr("That image is over 40MB — pick a smaller one."); return }
 if (isVid && file.size > 48 * 1024 * 1024) { setErr("That video is over 48MB — export it shorter or at a lower bitrate."); return }
 setUploading(true); setErr(null); setImgBroken(null)
 try {
      // Resize + re-encode in the browser FIRST. A raw photo base64's past Vercel's ~4.5MB
      // proxy body limit and the upload fails; the downscaled data URL comfortably fits.
 const dataUrl = isVid ? await fileToDataUrl(file) : await downscaleImage(file)
      // Instant local preview, so the banner shows immediately and stays visible even if the
      // stored URL later can't load.
 setLocalPreview({ key, url: dataUrl })
 const r = await uploadHeroImage(dataUrl)
 if (r.error || !r.url) throw new Error(r.error || "Upload failed")
 const url = r.url
 edit((x) => { apply(x, url) })
    } catch (e) {
 setErr(e instanceof Error ? e.message : "Upload failed")
    } finally {
 setUploading(false)
    }
  }


 const confirm = useConfirm()
 const resetToDefaults = async () => { if (await confirm({ title: tl("siteContent", "Reset to default copy?"), body: "This only fills the editor — nothing saves until you press Save.", confirmLabel: "Reset", destructive: false })) setContent(structuredClone(DEFAULT_SITE_CONTENT)) }

 if (!content) {
 return <SectionCard title={tl("siteContent", "Site content")}><div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div></SectionCard>
  }

 const c = content

  /* One call site's worth of plumbing, built from the key and the path. Written here rather
     than repeated three times in the JSX, so a new page carrying a figure is one line. */
 const figureProps = (key: string, pick: (c: SiteContent) => PageFigure, hint: string) => ({
 figure: pick(c),
 edit: (fn: (f: PageFigure) => void) => edit((x) => { fn(pick(x)) }),
 onPickFile: (file: File | undefined) => onPickImage(file, key, (x, url) => { pick(x).image = url }),
 onRemove: () => removeFigure(key, (x) => { pick(x).image = "" }),
 uploading,
 saving,
 preview: localPreview?.key === key ? localPreview.url : null,
 broken: imgBroken === key,
 onBroken: () => setImgBroken(key),
 hint,
  })

 return (
    <SectionCard
 title={tl("siteContent", "Site content")}
 bodyClassName="p-5"
 actions={
        /*
         * TWO DOORS TO THE SAME CONTENT, and the second is the one that was asked for.
         *
         * This form is complete and always was; what it cannot do is show you the thing you
         * are changing. `?edit=1` opens the live page ALREADY in edit mode, so a headline is
         * retyped where it is read and a picture is generated where it sits — see
         * edit-mode.tsx. The parameter grants nothing on its own: the toolbar is still gated
         * on the admin role, so it only skips a click for someone who could already edit.
         *
         * The tabs below stay. A form is faster for a batch of fields, and it is the only
         * surface that reaches content with no on-page representation (the motion presets).
         */
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {EDITABLE_PAGES.map((pg) => (
            <a key={pg.href} href={`${pg.href}?edit=1`} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline">
              Edit {tl("siteContent", pg.label)} <ArrowSquareOut size={13} />
            </a>
          ))}
        </div>
      }
    >
      {err && <div className="mb-4 rounded-lg border border-alert/30 bg-alert/12 p-2.5 text-xs text-alert">{err}</div>}

      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="flex flex-wrap">
          {SUBTABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{tl("siteContent", t.label)}</TabsTrigger>)}
        </TabsList>

        {/* ── Hero ── */}
        <TabsContent value="hero" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "The first thing above the fold.")}</Intro>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Headline")} value={c.hero.headline} onChange={(v) => edit((x) => { x.hero.headline = v })} />
            <Field label={tl("siteContent", "Accent word(s)")} value={c.hero.accent} onChange={(v) => edit((x) => { x.hero.accent = v })} />
          </div>
          <Area label={tl("siteContent", "Subhead")} value={c.hero.subhead} onChange={(v) => edit((x) => { x.hero.subhead = v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Primary button")} value={c.hero.ctaPrimary} onChange={(v) => edit((x) => { x.hero.ctaPrimary = v })} />
            <Field label={tl("siteContent", "Secondary button")} value={c.hero.ctaSecondary} onChange={(v) => edit((x) => { x.hero.ctaSecondary = v })} />
          </div>
          <Field label={tl("siteContent", "'Works with' label")} value={c.hero.worksWithLabel} onChange={(v) => edit((x) => { x.hero.worksWithLabel = v })} />

          {/* The hero figure — see the note on SiteContent.hero.image. `video` is passed HERE
              and nowhere else: this is the only slot whose component (MediaHero) can draw a
              film. The two page figures below are CutoutFigure and take a still with alpha. */}
          <FigureEditor
            video
            {...figureProps("hero", (x) => x.hero, "A full-bleed picture the headline sits on. An MP4 or WebM works too — it plays muted and looping, and holds on a frame under reduced motion.")}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Rule label, left")} value={c.hero.ruleLeft} onChange={(v) => edit((x) => { x.hero.ruleLeft = v })} />
            <Field label={tl("siteContent", "Rule label, right")} value={c.hero.ruleRight} onChange={(v) => edit((x) => { x.hero.ruleRight = v })} />
          </div>
          <Field label={tl("siteContent", "Ghost word behind the figure")} value={c.hero.ghostWord} onChange={(v) => edit((x) => { x.hero.ghostWord = v })} />

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", "Figure callouts")}</span>
            <div className="space-y-2">
              {c.hero.callouts.map((co, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex gap-2">
                    <div className="flex-1"><Field label={tl("siteContent", "Label")} value={co.label} onChange={(v) => edit((x) => { x.hero.callouts[i].label = v })} /></div>
                    <Button variant="ghost" size="sm" className="mt-5" onClick={() => edit((x) => { x.hero.callouts.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
                  </div>
                  <div className="mt-2"><Field label={tl("siteContent", "Note")} value={co.note ?? ""} onChange={(v) => edit((x) => { x.hero.callouts[i].note = v })} /></div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => edit((x) => { x.hero.callouts.push({ label: "", note: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add callout")}</Button>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", "Integrations")}</span>
            <div className="space-y-2">
              {c.hero.integrations.map((name, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={name} onChange={(e) => edit((x) => { x.hero.integrations[i] = e.target.value })} />
                  <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.hero.integrations.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => edit((x) => { x.hero.integrations.push("") })}><Plus size={13} weight="bold" />{tl("siteContent", "Add")}</Button>
            </div>
          </div>
        </TabsContent>

        {/* ── Stats ── */}
        <TabsContent value="stats" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "The band of figures under the hero, divided by rules. Five is what it fits before it wraps.")}</Intro>
          {c.stats.map((st, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <div className="w-28"><Field label={tl("siteContent", "Value")} value={st.value} onChange={(v) => edit((x) => { x.stats[i].value = v })} /></div>
                <div className="flex-1"><Field label={tl("siteContent", "Label")} value={st.label} onChange={(v) => edit((x) => { x.stats[i].label = v })} /></div>
                <Button variant="ghost" size="sm" className="mt-5" onClick={() => edit((x) => { x.stats.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
              <div className="mt-2"><Field label={tl("siteContent", "Note")} value={st.note ?? ""} onChange={(v) => edit((x) => { x.stats[i].note = v })} /></div>
            </div>
          ))}
          {c.stats.length < 5 && (
            <Button variant="outline" size="sm" onClick={() => edit((x) => { x.stats.push({ value: "", label: "", note: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add figure")}</Button>
          )}
        </TabsContent>

        {/* ── Features ── */}
        <TabsContent value="features" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "The section heading plus the four feature cards. The cards are fixed slots — edit their text, but their icons and layout stay in the design.")}</Intro>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Section heading")} value={c.features.heading} onChange={(v) => edit((x) => { x.features.heading = v })} />
            <Field label={tl("siteContent", "Section subhead")} value={c.features.subhead} onChange={(v) => edit((x) => { x.features.subhead = v })} />
          </div>
          {[0, 1, 2, 3].map((i) => {
 const card = c.features.cards[i] ?? DEFAULT_SITE_CONTENT.features.cards[i]
 return (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Card {i + 1}</div>
                <div className="space-y-2">
                  <Field label={tl("siteContent", "Title")} value={card.title} onChange={(v) => edit((x) => { if (!x.features.cards[i]) x.features.cards[i] = { ...DEFAULT_SITE_CONTENT.features.cards[i] }; x.features.cards[i].title = v })} />
                  <Area label={tl("siteContent", "Body")} value={card.body} onChange={(v) => edit((x) => { if (!x.features.cards[i]) x.features.cards[i] = { ...DEFAULT_SITE_CONTENT.features.cards[i] }; x.features.cards[i].body = v })} />
                </div>
              </div>
            )
          })}
        </TabsContent>

        {/* ── Steps ── */}
        <TabsContent value="steps" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "The three-step strip.")}</Intro>
          <Field label={tl("siteContent", "Section heading")} value={c.steps.heading} onChange={(v) => edit((x) => { x.steps.heading = v })} />
          {c.steps.items.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.steps.items.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
                <Field label={tl("siteContent", "Number")} value={s.n} onChange={(v) => edit((x) => { x.steps.items[i].n = v })} mono />
                <Field label={tl("siteContent", "Title")} value={s.title} onChange={(v) => edit((x) => { x.steps.items[i].title = v })} />
              </div>
              <div className="mt-2"><Area label={tl("siteContent", "Body")} value={s.body} onChange={(v) => edit((x) => { x.steps.items[i].body = v })} /></div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.steps.items.push({ n: "", title: "", body: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add step")}</Button>
        </TabsContent>

        {/* ── Testimonials ── */}
        <TabsContent value="testimonials" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "Quotes with a name and a role. The avatar is a placeholder circle by design — no invented photos.")}</Intro>
          <Field label={tl("siteContent", "Section heading")} value={c.testimonials.heading} onChange={(v) => edit((x) => { x.testimonials.heading = v })} />
          {c.testimonials.items.map((t, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Testimonial {i + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.testimonials.items.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
              <Area label={tl("siteContent", "Quote")} value={t.quote} onChange={(v) => edit((x) => { x.testimonials.items[i].quote = v })} />
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label={tl("siteContent", "Name")} value={t.name} onChange={(v) => edit((x) => { x.testimonials.items[i].name = v })} />
                <Field label={tl("siteContent", "Role")} value={t.role} onChange={(v) => edit((x) => { x.testimonials.items[i].role = v })} />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.testimonials.items.push({ quote: "", name: "", role: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add testimonial")}</Button>
        </TabsContent>

        {/* ── FAQ ── */}
        <TabsContent value="faq" className="mt-4 space-y-3">
          <Field label={tl("siteContent", "Section heading")} value={c.faq.heading} onChange={(v) => edit((x) => { x.faq.heading = v })} />
          {c.faq.items.map((f, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Question {i + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.faq.items.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
              <Field label={tl("siteContent", "Question")} value={f.q} onChange={(v) => edit((x) => { x.faq.items[i].q = v })} />
              <div className="mt-2"><Area label={tl("siteContent", "Answer")} value={f.a} onChange={(v) => edit((x) => { x.faq.items[i].a = v })} /></div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.faq.items.push({ q: "", a: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add question")}</Button>
        </TabsContent>

        {/* ── Closing CTA ── */}
        <TabsContent value="cta" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "The dark band at the foot of the page.")}</Intro>
          <Field label={tl("siteContent", "Heading")} value={c.cta.heading} onChange={(v) => edit((x) => { x.cta.heading = v })} />
          <Area label={tl("siteContent", "Subhead")} value={c.cta.subhead} onChange={(v) => edit((x) => { x.cta.subhead = v })} />
          <Field label={tl("siteContent", "Button")} value={c.cta.button} onChange={(v) => edit((x) => { x.cta.button = v })} />
        </TabsContent>

        {/* ── /features ── */}
        <TabsContent value="featuresPage" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "The public /features page. Every word on it is here.")}</Intro>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Headline")} value={c.featuresPage.title} onChange={(v) => edit((x) => { x.featuresPage.title = v })} />
            <Field label={tl("siteContent", "Accent word(s)")} value={c.featuresPage.accent} onChange={(v) => edit((x) => { x.featuresPage.accent = v })} />
          </div>
          <Area label={tl("siteContent", "Subhead")} value={c.featuresPage.sub} onChange={(v) => edit((x) => { x.featuresPage.sub = v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Rule label, left")} value={c.featuresPage.ruleLeft} onChange={(v) => edit((x) => { x.featuresPage.ruleLeft = v })} />
            <Field label={tl("siteContent", "Rule label, right")} value={c.featuresPage.ruleRight} onChange={(v) => edit((x) => { x.featuresPage.ruleRight = v })} />
          </div>

          <FigureEditor
            {...figureProps("featuresPage", (x) => x.featuresPage.figure, "A cut-out PNG floats on the page; a JPEG sits on it as a rectangle. Make one in Studio: Backdrop → cut-out ready, then Remove background.")}
          />

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", "Figures under the hero")}</span>
            <div className="space-y-2">
              {c.featuresPage.stats.map((st, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex gap-2">
                    <div className="w-28"><Field label={tl("siteContent", "Value")} value={st.value} onChange={(v) => edit((x) => { x.featuresPage.stats[i].value = v })} /></div>
                    <div className="flex-1"><Field label={tl("siteContent", "Label")} value={st.label} onChange={(v) => edit((x) => { x.featuresPage.stats[i].label = v })} /></div>
                    <Button variant="ghost" size="sm" className="mt-5" onClick={() => edit((x) => { x.featuresPage.stats.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
                  </div>
                  <div className="mt-2"><Field label={tl("siteContent", "Note")} value={st.note ?? ""} onChange={(v) => edit((x) => { x.featuresPage.stats[i].note = v })} /></div>
                </div>
              ))}
              {c.featuresPage.stats.length < 5 && (
                <Button variant="outline" size="sm" onClick={() => edit((x) => { x.featuresPage.stats.push({ value: "", label: "", note: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add figure")}</Button>
              )}
            </div>
          </div>

          {c.featuresPage.items.map((it, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.featuresPage.items.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
              <div className="space-y-2">
                <NumberedItemFields item={it} edit={(fn) => edit((x) => { fn(x.featuresPage.items[i]) })} />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.featuresPage.items.push({ title: "", body: "", points: [] }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add capability")}</Button>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Closing heading")} value={c.featuresPage.cta.heading} onChange={(v) => edit((x) => { x.featuresPage.cta.heading = v })} />
            <Field label={tl("siteContent", "Closing button")} value={c.featuresPage.cta.button} onChange={(v) => edit((x) => { x.featuresPage.cta.button = v })} />
          </div>
        </TabsContent>

        {/* ── /how-it-works ── */}
        <TabsContent value="howPage" className="mt-4 space-y-3">
          <Intro>{tl("siteContent", "The public /how-it-works page. Every word on it is here.")}</Intro>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Headline")} value={c.howPage.title} onChange={(v) => edit((x) => { x.howPage.title = v })} />
            <Field label={tl("siteContent", "Accent word(s)")} value={c.howPage.accent} onChange={(v) => edit((x) => { x.howPage.accent = v })} />
          </div>
          <Area label={tl("siteContent", "Subhead")} value={c.howPage.sub} onChange={(v) => edit((x) => { x.howPage.sub = v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Rule label, left")} value={c.howPage.ruleLeft} onChange={(v) => edit((x) => { x.howPage.ruleLeft = v })} />
            <Field label={tl("siteContent", "Rule label, right")} value={c.howPage.ruleRight} onChange={(v) => edit((x) => { x.howPage.ruleRight = v })} />
          </div>

          <FigureEditor
            {...figureProps("howPage", (x) => x.howPage.figure, "This one sits on the dark panel, so a cut-out PNG matters more here than anywhere. Studio: Backdrop → cut-out ready, then Remove background.")}
          />

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{tl("siteContent", "Figures under the hero")}</span>
            <div className="space-y-2">
              {c.howPage.stats.map((st, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex gap-2">
                    <div className="w-28"><Field label={tl("siteContent", "Value")} value={st.value} onChange={(v) => edit((x) => { x.howPage.stats[i].value = v })} /></div>
                    <div className="flex-1"><Field label={tl("siteContent", "Label")} value={st.label} onChange={(v) => edit((x) => { x.howPage.stats[i].label = v })} /></div>
                    <Button variant="ghost" size="sm" className="mt-5" onClick={() => edit((x) => { x.howPage.stats.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
                  </div>
                  <div className="mt-2"><Field label={tl("siteContent", "Note")} value={st.note ?? ""} onChange={(v) => edit((x) => { x.howPage.stats[i].note = v })} /></div>
                </div>
              ))}
              {c.howPage.stats.length < 5 && (
                <Button variant="outline" size="sm" onClick={() => edit((x) => { x.howPage.stats.push({ value: "", label: "", note: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add figure")}</Button>
              )}
            </div>
          </div>

          {c.howPage.steps.map((it, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Step {String(i + 1).padStart(2, "0")}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.howPage.steps.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
              <div className="space-y-2">
                <NumberedItemFields item={it} edit={(fn) => edit((x) => { fn(x.howPage.steps[i]) })} />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.howPage.steps.push({ title: "", body: "", points: [] }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add step")}</Button>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Status section heading")} value={c.howPage.journeyHeading} onChange={(v) => edit((x) => { x.howPage.journeyHeading = v })} />
            <Field label={tl("siteContent", "Status section note")} value={c.howPage.journeyNote} onChange={(v) => edit((x) => { x.howPage.journeyNote = v })} />
          </div>
          {/* An empty region may carry one sentence (§4), and this one is load-bearing: the
              colour is NOT a field here, and an admin who renames a row needs to know why it
              went grey. See JOURNEY_TONE in bold-how.tsx. */}
          <Intro>{tl("siteContent", "Status colours come from the label — keep the product’s own words (Draft, Pending, In process, Fulfilled) or the row renders grey.")}</Intro>
          {c.howPage.journey.map((j, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <div className="w-40"><Field label={tl("siteContent", "Status")} value={j.label} onChange={(v) => edit((x) => { x.howPage.journey[i].label = v })} /></div>
                <div className="flex-1"><Field label={tl("siteContent", "What it means")} value={j.body} onChange={(v) => edit((x) => { x.howPage.journey[i].body = v })} /></div>
                <Button variant="ghost" size="sm" className="mt-5" onClick={() => edit((x) => { x.howPage.journey.splice(i, 1) })} aria-label={tl("siteContent", "Remove")}><Trash size={14} /></Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.howPage.journey.push({ label: "", body: "" }) })}><Plus size={13} weight="bold" />{tl("siteContent", "Add status")}</Button>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tl("siteContent", "Closing heading")} value={c.howPage.cta.heading} onChange={(v) => edit((x) => { x.howPage.cta.heading = v })} />
            <Field label={tl("siteContent", "Closing button")} value={c.howPage.cta.button} onChange={(v) => edit((x) => { x.howPage.cta.button = v })} />
          </div>
        </TabsContent>

        {/* ── Motion ──
            Shares this panel's single content object and single Save, exactly like every copy
 tab: switching away keeps unsaved changes and only Save writes them. The editor is
 handed the whole MotionSettings and returns a whole one, so it never has to know
 about `edit`'s structuredClone. */}
        <TabsContent value="motion" className="mt-4">
          <Intro>
            {tl("siteContent", "How sections arrive on the public pages. Which animation each section uses is set in the page code; the feel of each one is set here, and takes effect within a minute of saving.")}
          </Intro>
          <div className="mt-3">
            <MotionEditor value={c.motion} onChange={(next) => edit((x) => { x.motion = next })} />
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Save bar (shared across every sub-tab) ── */}
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
        <div className="text-xs text-muted-foreground">
          {saved ? <span className="text-success">{tl("siteContent", "Saved — live within a minute.")}</span>
 : updatedAt ? `Last edited ${new Date(updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
 : tl("siteContent", "Never edited — showing shipped defaults.")}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={resetToDefaults}>{tl("siteContent", "Reset to defaults")}</Button>
          <Button size="sm" onClick={() => save()} disabled={saving}>
            {saving ? <CircleNotch size={14} className="animate-spin" /> : null}Save
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}
