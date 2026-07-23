"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Plus, Trash, ArrowSquareOut, FloppyDisk } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSiteContentAdmin, setSiteContent } from "@/lib/api"
import { DEFAULT_SITE_CONTENT, type SiteContent } from "@/lib/site-content"

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
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
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
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <textarea className={AREA_CLS} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

/**
 * Edit the public marketing-home copy.
 *
 * Admin-only. Every field is backed by lib/site-content.ts defaults, so clearing one and
 * saving falls back to the shipped copy rather than blanking the homepage — the editor
 * reflects that by loading the merged (always-complete) content, never a half-empty form.
 *
 * The bento's four feature cards are FIXED slots (each has bespoke decoration and grid span
 * on the page), so they're edited in place, not added or removed. Stats, steps, testimonials
 * and FAQs are true lists.
 */
export function SiteContentPanel() {
  const [content, setContent] = useState<SiteContent | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getSiteContentAdmin()
      .then((r) => { setContent(r.content); setUpdatedAt(r.updatedAt) })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load site content"))
  }, [])
  useEffect(() => { const id = setTimeout(load, 0); return () => clearTimeout(id) }, [load])

  // structuredClone + mutate keeps the deep-nested updates readable without a patch library.
  const edit = (fn: (c: SiteContent) => void) =>
    setContent((prev) => { if (!prev) return prev; const next = structuredClone(prev); fn(next); return next })

  const save = async () => {
    if (!content) return
    setSaving(true); setErr(null); setSaved(false)
    try {
      const r = await setSiteContent(content)
      if (r.error) throw new Error(r.error)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save — admin only.")
    } finally { setSaving(false) }
  }

  const resetToDefaults = () => { if (confirm("Reset every field to the shipped default copy? This only fills the editor — nothing saves until you press Save.")) setContent(structuredClone(DEFAULT_SITE_CONTENT)) }

  if (!content) {
    return <SectionCard title="Site content"><div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div></SectionCard>
  }

  const c = content
  return (
    <SectionCard
      title="Site content"
      description="The public marketing homepage copy. Edits appear on the live site within a minute."
      actions={
        <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          View homepage <ArrowSquareOut size={13} />
        </a>
      }
    >
      <div className="space-y-6">
        {err && <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{err}</div>}

        {/* ── Hero ── */}
        <Group title="Hero" hint="The first thing above the fold.">
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
        </Group>

        {/* ── Stats ── */}
        <Group title="Stats band" hint="The row of numbers under the hero.">
          {c.stats.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
              <Field label={i === 0 ? "Value" : ""} value={s.value} onChange={(v) => edit((x) => { x.stats[i].value = v })} />
              <Field label={i === 0 ? "Label" : ""} value={s.label} onChange={(v) => edit((x) => { x.stats[i].label = v })} />
              <Button variant="ghost" size="sm" onClick={() => edit((x) => { x.stats.splice(i, 1) })} aria-label="Remove"><Trash size={14} /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => edit((x) => { x.stats.push({ value: "", label: "" }) })}><Plus size={13} weight="bold" />Add stat</Button>
        </Group>

        {/* ── Features ── */}
        <Group title="Features" hint="The section heading plus the four feature cards. The cards are fixed slots — edit their text, but their icons and layout stay in the design.">
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
        </Group>

        {/* ── Steps ── */}
        <Group title="How it works" hint="The three-step strip.">
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
        </Group>

        {/* ── Testimonials ── */}
        <Group title="Testimonials" hint="Quotes with a name and a role. The avatar is a placeholder circle by design — no invented photos.">
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
        </Group>

        {/* ── FAQ ── */}
        <Group title="FAQ">
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
        </Group>

        {/* ── Closing CTA ── */}
        <Group title="Closing call-to-action" hint="The dark band at the foot of the page.">
          <Field label="Heading" value={c.cta.heading} onChange={(v) => edit((x) => { x.cta.heading = v })} />
          <Area label="Subhead" value={c.cta.subhead} onChange={(v) => edit((x) => { x.cta.subhead = v })} />
          <Field label="Button" value={c.cta.button} onChange={(v) => edit((x) => { x.cta.button = v })} />
        </Group>

        {/* ── Save bar ── */}
        <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-6 py-3 backdrop-blur">
          <div className="text-xs text-muted-foreground">
            {saved ? <span className="text-emerald-600 dark:text-emerald-400">Saved — live within a minute.</span>
              : updatedAt ? `Last edited ${new Date(updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : "Never edited — showing shipped defaults."}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={resetToDefaults}>Reset to defaults</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <CircleNotch size={14} className="animate-spin" /> : <FloppyDisk size={14} />}Save
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
