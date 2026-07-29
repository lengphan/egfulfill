"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Plus, Trash, ArrowSquareOut, FloppyDisk, UploadSimple, Warning, Image as ImageIcon } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getSiteContentAdmin, setSiteContent, uploadHeroImage } from "@/lib/api"
import { DEFAULT_SITE_CONTENT, type SiteContent } from "@/lib/site-content"
import { useConfirm } from "@/components/app/confirm-dialog"

// Module-scope so they're stable across renders (react-hooks/static-components forbids
// defining components inside render).
const AREA_CLS =
  "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

function Field({ label, hint, value, onChange, mono }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; mono?: boolean
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>}
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={mono ? "font-mono" : ""} />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Area({ label, hint, value, onChange }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>}
      <textarea className={AREA_CLS} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

// A tab's intro line, so each section still explains itself without the old long-scroll headings.
function Intro({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

/**
 * Downscale + re-encode an image in the browser BEFORE upload.
 *
 * A phone/DSLR photo is 4–12MB; base64-encoded it blows past Vercel's ~4.5MB proxy body
 * limit, so the upload silently failed on anything but tiny images — which is why "the file
 * is limited". Capping the longest edge and re-encoding as JPEG keeps the payload small
 * (well under the limit) AND stops the homepage shipping a 12MB background. Returns a data
 * URL. Falls back to the original bytes if the canvas isn't available.
 */
async function downscaleImage(file: File, maxEdge = 2400, quality = 0.85): Promise<string> {
  const read = () => new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error("Couldn't read the file"))
    fr.readAsDataURL(file)
  })
  const original = await read()
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error("decode failed"))
      i.src = original
    })
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    // Already small in both bytes and dimensions — send as-is (keeps PNG transparency etc.).
    if (scale === 1 && file.size < 1_200_000) return original
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return original
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL("image/jpeg", quality)
  } catch {
    return original
  }
}

const SUBTABS: { id: string; label: string }[] = [
  { id: "hero", label: "Hero" },
  { id: "stats", label: "Stats" },
  { id: "features", label: "Features" },
  { id: "steps", label: "Steps" },
  { id: "testimonials", label: "Testimonials" },
  { id: "faq", label: "FAQ" },
  { id: "cta", label: "Closing CTA" },
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
  const [content, setContent] = useState<SiteContent | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [sub, setSub] = useState("hero")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // A LOCAL preview of the just-picked image, shown instantly so the banner isn't blank
  // while the upload runs — and stays visible even if the stored URL later fails to load.
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  // The stored URL didn't load in the <img>: almost always a storage/CDN that isn't public,
  // not a broken editor. Say so instead of showing a broken-image glyph.
  const [imgBroken, setImgBroken] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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

  // Remove the banner AND persist it right away — "Remove" that only clears the form and
  // silently comes back on refresh isn't a removal. Saves the current content minus the image,
  // exactly as pressing Save after Remove would.
  const removeBanner = () => {
    if (!content) return
    const next = structuredClone(content)
    next.hero.image = ""
    setLocalPreview(null); setImgBroken(false); setContent(next)
    void save(next)
  }

  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) { setErr("That file isn't an image — pick a JPEG, PNG, WebP or AVIF."); return }
    // Generous ceiling only as a sanity check — anything reasonable is downscaled below the
    // proxy limit before it's sent, so a big camera photo is fine.
    if (file.size > 40 * 1024 * 1024) { setErr("That image is over 40MB — pick a smaller one."); return }
    setUploading(true); setErr(null); setImgBroken(false)
    try {
      // Resize + re-encode in the browser FIRST. A raw photo base64's past Vercel's ~4.5MB
      // proxy body limit and the upload fails; the downscaled data URL comfortably fits.
      const dataUrl = await downscaleImage(file)
      // Instant local preview, so the banner shows immediately and stays visible even if the
      // stored URL later can't load.
      setLocalPreview(dataUrl)
      const r = await uploadHeroImage(dataUrl)
      if (r.error || !r.url) throw new Error(r.error || "Upload failed")
      const url = r.url
      edit((x) => { x.hero.image = url })
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const confirm = useConfirm()
  const resetToDefaults = async () => { if (await confirm({ title: "Reset to default copy?", body: "This only fills the editor — nothing saves until you press Save.", confirmLabel: "Reset", destructive: false })) setContent(structuredClone(DEFAULT_SITE_CONTENT)) }

  if (!content) {
    return <SectionCard title="Site content"><div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div></SectionCard>
  }

  const c = content
  return (
    <SectionCard
      title="Site content"
      description="The public marketing homepage copy. Edits appear on the live site within a minute."
      bodyClassName="p-5"
      actions={
        <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          View homepage <ArrowSquareOut size={13} />
        </a>
      }
    >
      {err && <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{err}</div>}

      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="flex flex-wrap">
          {SUBTABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
        </TabsList>

        {/* ── Hero ── */}
        <TabsContent value="hero" className="mt-4 space-y-3">
          <Intro>The first thing above the fold.</Intro>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Headline" value={c.hero.headline} onChange={(v) => edit((x) => { x.hero.headline = v })} />
            <Field label="Accent word(s)" hint="Shown italic and in violet, right after the headline." value={c.hero.accent} onChange={(v) => edit((x) => { x.hero.accent = v })} />
          </div>
          <Area label="Subhead" value={c.hero.subhead} onChange={(v) => edit((x) => { x.hero.subhead = v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Primary button" value={c.hero.ctaPrimary} onChange={(v) => edit((x) => { x.hero.ctaPrimary = v })} />
            <Field label="Secondary button" value={c.hero.ctaSecondary} onChange={(v) => edit((x) => { x.hero.ctaSecondary = v })} />
          </div>
          <Field label="'Works with' label" value={c.hero.worksWithLabel} onChange={(v) => edit((x) => { x.hero.worksWithLabel = v })} />

          {/* Hero banner image */}
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Banner image</span>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickImage(e.target.files?.[0])} />
            {(localPreview || c.hero.image) ? (
              <div className="space-y-2">
                {imgBroken && !localPreview ? (
                  // The stored URL couldn't load. Almost always the object storage / CDN isn't
                  // serving it publicly — say that plainly instead of a broken-image glyph.
                  <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-8 text-center text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <Warning size={20} weight="fill" />
                    <span className="font-medium">The saved banner isn&apos;t loading.</span>
                    <span className="max-w-sm">Its URL was saved, but the browser can&apos;t open it — usually the storage bucket / CDN isn&apos;t public. Re-upload, or check <code>SPACES_CDN</code> and public-read on the server.</span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={localPreview || c.hero.image} alt="Hero banner preview" onError={() => setImgBroken(true)}
                    className="max-h-44 w-full rounded-lg border border-border object-cover" />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? <CircleNotch size={13} className="animate-spin" /> : <UploadSimple size={13} />}Replace
                  </Button>
                  <Button variant="ghost" size="sm" onClick={removeBanner} disabled={uploading || saving}><Trash size={13} />Remove</Button>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click() } }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); onPickImage(e.dataTransfer.files?.[0]) }}
                className={"flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed py-10 text-sm transition-colors " +
                  (dragging ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground") +
                  (uploading ? " pointer-events-none opacity-60" : "")}
              >
                {uploading ? <CircleNotch size={20} className="animate-spin" /> : <ImageIcon size={20} />}
                {uploading ? "Uploading…" : "Drag an image here, or click to choose"}
                <span className="text-xs">JPEG, PNG, WebP or AVIF · big photos are resized automatically</span>
              </div>
            )}
            <span className="mt-1 block text-xs text-muted-foreground">
              Optional. Sits behind the hero under a scrim, so the text stays readable. Landscape works best — around 1600×900 (16:9). Leave empty for the default gradient. Press Save to publish — it&apos;s live within a minute.
            </span>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Integrations</span>
            <div className="space-y-2">
              {c.hero.integrations.map((name, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={name} onChange={(e) => edit((x) => { x.hero.integrations[i] = e.target.value })} />
                  <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.hero.integrations.splice(i, 1) })} aria-label="Remove"><Trash size={14} /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => edit((x) => { x.hero.integrations.push("") })}><Plus size={13} weight="bold" />Add</Button>
            </div>
          </div>
        </TabsContent>

        {/* ── Stats ── */}
        <TabsContent value="stats" className="mt-4 space-y-3">
          <Intro>The row of numbers under the hero.</Intro>
          {c.stats.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
              <Field label={i === 0 ? "Value" : ""} value={s.value} onChange={(v) => edit((x) => { x.stats[i].value = v })} />
              <Field label={i === 0 ? "Label" : ""} value={s.label} onChange={(v) => edit((x) => { x.stats[i].label = v })} />
              <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.stats.splice(i, 1) })} aria-label="Remove"><Trash size={14} /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.stats.push({ value: "", label: "" }) })}><Plus size={13} weight="bold" />Add stat</Button>
        </TabsContent>

        {/* ── Features ── */}
        <TabsContent value="features" className="mt-4 space-y-3">
          <Intro>The section heading plus the four feature cards. The cards are fixed slots — edit their text, but their icons and layout stay in the design.</Intro>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Section heading" value={c.features.heading} onChange={(v) => edit((x) => { x.features.heading = v })} />
            <Field label="Section subhead" value={c.features.subhead} onChange={(v) => edit((x) => { x.features.subhead = v })} />
          </div>
          {[0, 1, 2, 3].map((i) => {
            const card = c.features.cards[i] ?? DEFAULT_SITE_CONTENT.features.cards[i]
            return (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Card {i + 1}</div>
                <div className="space-y-2">
                  <Field label="Title" value={card.title} onChange={(v) => edit((x) => { if (!x.features.cards[i]) x.features.cards[i] = { ...DEFAULT_SITE_CONTENT.features.cards[i] }; x.features.cards[i].title = v })} />
                  <Area label="Body" value={card.body} onChange={(v) => edit((x) => { if (!x.features.cards[i]) x.features.cards[i] = { ...DEFAULT_SITE_CONTENT.features.cards[i] }; x.features.cards[i].body = v })} />
                </div>
              </div>
            )
          })}
        </TabsContent>

        {/* ── Steps ── */}
        <TabsContent value="steps" className="mt-4 space-y-3">
          <Intro>The three-step strip.</Intro>
          <Field label="Section heading" value={c.steps.heading} onChange={(v) => edit((x) => { x.steps.heading = v })} />
          {c.steps.items.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.steps.items.splice(i, 1) })} aria-label="Remove"><Trash size={14} /></Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
                <Field label="Number" value={s.n} onChange={(v) => edit((x) => { x.steps.items[i].n = v })} mono />
                <Field label="Title" value={s.title} onChange={(v) => edit((x) => { x.steps.items[i].title = v })} />
              </div>
              <div className="mt-2"><Area label="Body" value={s.body} onChange={(v) => edit((x) => { x.steps.items[i].body = v })} /></div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.steps.items.push({ n: "", title: "", body: "" }) })}><Plus size={13} weight="bold" />Add step</Button>
        </TabsContent>

        {/* ── Testimonials ── */}
        <TabsContent value="testimonials" className="mt-4 space-y-3">
          <Intro>Quotes with a name and a role. The avatar is a placeholder circle by design — no invented photos.</Intro>
          <Field label="Section heading" value={c.testimonials.heading} onChange={(v) => edit((x) => { x.testimonials.heading = v })} />
          {c.testimonials.items.map((t, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Testimonial {i + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.testimonials.items.splice(i, 1) })} aria-label="Remove"><Trash size={14} /></Button>
              </div>
              <Area label="Quote" value={t.quote} onChange={(v) => edit((x) => { x.testimonials.items[i].quote = v })} />
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="Name" value={t.name} onChange={(v) => edit((x) => { x.testimonials.items[i].name = v })} />
                <Field label="Role" value={t.role} onChange={(v) => edit((x) => { x.testimonials.items[i].role = v })} />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.testimonials.items.push({ quote: "", name: "", role: "" }) })}><Plus size={13} weight="bold" />Add testimonial</Button>
        </TabsContent>

        {/* ── FAQ ── */}
        <TabsContent value="faq" className="mt-4 space-y-3">
          <Field label="Section heading" value={c.faq.heading} onChange={(v) => edit((x) => { x.faq.heading = v })} />
          {c.faq.items.map((f, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Question {i + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.faq.items.splice(i, 1) })} aria-label="Remove"><Trash size={14} /></Button>
              </div>
              <Field label="Question" value={f.q} onChange={(v) => edit((x) => { x.faq.items[i].q = v })} />
              <div className="mt-2"><Area label="Answer" value={f.a} onChange={(v) => edit((x) => { x.faq.items[i].a = v })} /></div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.faq.items.push({ q: "", a: "" }) })}><Plus size={13} weight="bold" />Add question</Button>
        </TabsContent>

        {/* ── Closing CTA ── */}
        <TabsContent value="cta" className="mt-4 space-y-3">
          <Intro>The dark band at the foot of the page.</Intro>
          <Field label="Heading" value={c.cta.heading} onChange={(v) => edit((x) => { x.cta.heading = v })} />
          <Area label="Subhead" value={c.cta.subhead} onChange={(v) => edit((x) => { x.cta.subhead = v })} />
          <Field label="Button" value={c.cta.button} onChange={(v) => edit((x) => { x.cta.button = v })} />
        </TabsContent>
      </Tabs>

      {/* ── Save bar (shared across every sub-tab) ── */}
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
        <div className="text-xs text-muted-foreground">
          {saved ? <span className="text-emerald-600 dark:text-emerald-400">Saved — live within a minute.</span>
            : updatedAt ? `Last edited ${new Date(updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
            : "Never edited — showing shipped defaults."}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={resetToDefaults}>Reset to defaults</Button>
          <Button size="sm" onClick={() => save()} disabled={saving}>
            {saving ? <CircleNotch size={14} className="animate-spin" /> : <FloppyDisk size={14} />}Save
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}
