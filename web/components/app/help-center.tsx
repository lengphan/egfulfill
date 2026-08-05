"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  MagnifyingGlass,
  Rocket,
  Package,
  GridFour,
  CreditCard,
  PlugsConnected,
  Code,
  CaretRight,
  EnvelopeSimple,
  ChatCircleDots,
  type Icon,
} from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { HELP_CATEGORIES, HELP_ARTICLES, type HelpArticle } from "@/lib/help"

const ICONS: Record<string, Icon> = { Rocket, Package, GridFour, CreditCard, PlugsConnected, Code }

export function HelpCenter() {
  const [query, setQuery] = useState("")

  // Categories with their articles, filtered by the search query.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return HELP_CATEGORIES.map((c) => {
      let articles = HELP_ARTICLES.filter((a) => a.category === c.id)
      if (q) articles = articles.filter((a) => a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      return { ...c, articles }
    }).filter((c) => c.articles.length)
  }, [query])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Hero + search */}
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="font-title text-3xl font-semibold tracking-tight">How can we help?</h1>
        <p className="mt-1 text-muted-foreground">Search our docs or browse by topic below.</p>
        <div className="relative mx-auto mt-5 max-w-md">
          <MagnifyingGlass size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for answers…"
            className="h-11 pl-10"
            autoFocus
          />
        </div>
      </div>

      {/* Category shortcuts (hidden while searching) */}
      {!query && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HELP_CATEGORIES.map((c) => {
            const Ico = ICONS[c.icon] ?? Rocket
            return (
              <a key={c.id} href={`#${c.id}`} className="group rounded-xl border border-border p-4 transition-colors hover:border-primary hover:bg-accent">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Ico size={18} weight="duotone" />
                </span>
                <div className="mt-3 font-semibold">{c.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{c.desc}</div>
              </a>
            )
          })}
        </div>
      )}

      {/* Article sections — each row links to its dedicated answer page */}
      {results.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No articles match “{query}”. Try a different search, or email support below.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {results.map((c) => {
            const Ico = ICONS[c.icon] ?? Rocket
            return (
              <div key={c.id} id={c.id} className="scroll-mt-20">
                <SectionCard
                  title={
                    <span className="flex items-center gap-2">
                      <Ico size={17} weight="duotone" className="text-primary" /> {c.title}
                    </span>
                  }
                >
                  <div className="divide-y divide-border">
                    {c.articles.map((a: HelpArticle) => (
                      <Link key={a.slug} href={`/help/${a.slug}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-accent">
                        <span>
                          <span className="block">{a.title}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{a.summary}</span>
                        </span>
                        <CaretRight size={14} className="shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </SectionCard>
              </div>
            )
          })}
        </div>
      )}

      {/* Contact CTA */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-border bg-muted/40 p-6 sm:flex-row sm:items-center">
        <div>
          <div className="text-lg font-semibold">Still need help?</div>
          <div className="text-sm text-muted-foreground">Our team typically responds within 2 hours on business days.</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <a href="mailto:support@egful.store" className={cn(buttonVariants({ variant: "outline" }))}>
            <EnvelopeSimple size={15} weight="bold" /> Email support
          </a>
          <Link href="/chat" className={cn(buttonVariants())}>
            <ChatCircleDots size={15} weight="bold" /> Live chat
          </Link>
        </div>
      </div>
    </div>
  )
}
