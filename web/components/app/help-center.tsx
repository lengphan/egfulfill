"use client"

import { useCallback, useMemo, useState } from "react"
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
import { useT, useLabelT } from "@/lib/i18n"

const ICONS: Record<string, Icon> = { Rocket, Package, GridFour, CreditCard, PlugsConnected, Code }

export function HelpCenter() {
  const [query, setQuery] = useState("")
  const t = useT()
  // Help content is plain data shared with the server-rendered answer pages (lib/help.ts),
  // so it stays English there and is translated HERE, at the render site — the same split
  // the nav labels use. An article with no translation shows its English title rather than
  // disappearing from a list someone is searching.
  const tl = useLabelT()

  // Search matches BOTH languages: what is on screen, and the English underneath it. A
  // Vietnamese reader typing "đơn hàng" and an English one typing "orders" both find the
  // same article, and neither has to know which language the data is stored in.
  const matches = useCallback(
    (a: HelpArticle, c: { title: string }, q: string) =>
      [a.title, a.summary, c.title, tl("helpArticle", a.title), tl("helpSummary", a.summary), tl("helpCat", c.title)]
        .some((s) => s.toLowerCase().includes(q)),
    [tl])

  // Categories with their articles, filtered by the search query.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return HELP_CATEGORIES.map((c) => {
      let articles = HELP_ARTICLES.filter((a) => a.category === c.id)
      if (q) articles = articles.filter((a) => matches(a, c, q))
      return { ...c, articles }
    }).filter((c) => c.articles.length)
    // `matches` closes over tl, which is stable per locale — listing it keeps the results
    // correct when the language is switched with a search already typed.
  }, [query, matches])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Hero + search */}
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="font-title text-3xl font-semibold tracking-tight">{t("help.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("help.subtitle")}</p>
        <div className="relative mx-auto mt-5 max-w-md">
          <MagnifyingGlass size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("help.searchPlaceholder")}
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
                <Ico size={18} weight="regular"  className="shrink-0 text-primary" />
                <div className="mt-3 font-semibold">{tl("helpCat", c.title)}</div>
                <div className="mt-1 text-sm text-muted-foreground">{tl("helpCatDesc", c.desc)}</div>
              </a>
            )
          })}
        </div>
      )}

      {/* Article sections — each row links to its dedicated answer page */}
      {results.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {t("help.noResults", { query })}
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
                      <Ico size={17} weight="duotone" className="text-primary" /> {tl("helpCat", c.title)}
                    </span>
                  }
                >
                  <div className="divide-y divide-border">
                    {c.articles.map((a: HelpArticle) => (
                      <Link key={a.slug} href={`/help/${a.slug}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-accent">
                        <span>
                          <span className="block">{tl("helpArticle", a.title)}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{tl("helpSummary", a.summary)}</span>
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
          <div className="text-lg font-semibold">{t("help.stillNeedHelp")}</div>
          <div className="text-sm text-muted-foreground">{t("help.responseTime")}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <a href="mailto:support@egful.store" className={cn(buttonVariants({ variant: "outline" }))}>
            <EnvelopeSimple size={15} weight="bold" /> {t("help.emailSupport")}
          </a>
          <Link href="/chat" className={cn(buttonVariants())}>
            <ChatCircleDots size={15} weight="bold" /> {t("help.liveChat")}
          </Link>
        </div>
      </div>
    </div>
  )
}
