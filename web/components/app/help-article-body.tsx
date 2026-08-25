"use client"

import Link from "next/link"
import { ArrowRight, ArrowLeft, CaretRight, ChatCircleDots, EnvelopeSimple, Info } from "@phosphor-icons/react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useLabelT, useT } from "@/lib/i18n"
import type { HelpArticle } from "@/lib/help"

/**
 * THE ANSWER ITSELF, TRANSLATED.
 *
 * The article page is a SERVER component and statically pre-rendered — which is right for
 * help content — so it cannot call useLabelT, and every block rendered in English no matter
 * the locale. A Vietnamese reader got a Vietnamese heading over an English answer, because
 * `helpArticle.*` and `helpSummary.*` existed and the prose had no namespace at all.
 *
 * A CLIENT ISLAND rather than reading the locale cookie on the server. Reading cookies would
 * make every help page dynamic and give up the static rendering they were built for; this
 * keeps the page static and translates after mount, which is exactly what the rest of the app
 * already does (see LanguageProvider — English for one frame, then the saved locale).
 *
 * Keyed on the ENGLISH STRING, like every other label namespace here: useLabelT falls back to
 * the value itself, so English needs no catalogue entry and an untranslated line renders as
 * written rather than blank.
 */
export function HelpArticleBody({ article }: { article: HelpArticle }) {
  const tl = useLabelT()
  return (
    <>
      <h1 className="font-title text-2xl font-semibold tracking-tight">{tl("helpArticle", article.title)}</h1>
      <p className="mt-1.5 text-muted-foreground">{tl("helpSummary", article.summary)}</p>

      <div className="mt-5 space-y-4">
        {article.body.map((b, i) => {
          if (b.type === "p") {
            return <p key={i} className="text-sm leading-relaxed text-foreground/90">{tl("helpBody", b.text)}</p>
          }
          if (b.type === "steps") {
            return (
              <ol key={i} className="space-y-2">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-3 text-sm leading-relaxed">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-semibold text-primary">{j + 1}</span>
                    <span className="text-foreground/90">{tl("helpStep", it)}</span>
                  </li>
                ))}
              </ol>
            )
          }
          return (
            <div key={i} className="flex items-start gap-2.5 rounded-lg bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground">
              <Info size={16} weight="fill" className="mt-px shrink-0 text-primary/70" />
              <span>{tl("helpNote", b.text)}</span>
            </div>
          )
        })}
      </div>

      {article.action && (
        <Link href={article.action.href} className={cn(buttonVariants(), "mt-6 w-full sm:w-auto")}>
          {tl("helpAction", article.action.label)} <ArrowRight size={15} weight="bold" />
        </Link>
      )}
    </>
  )
}

/**
 * THE CHROME AROUND THE ANSWER, TRANSLATED.
 *
 * Same reason as the body above: the article page is a static SERVER component, so the
 * breadcrumb, the Related list, and the still-need-help footer all rendered in English over
 * a Vietnamese answer. The body was carved out into a client island when it was fixed; the
 * chrome around it never was, which is exactly what a Vietnamese reader sees.
 *
 * Takes only serialisable props, so the page keeps generateStaticParams and stays static.
 */
export function HelpArticleChrome({
  categoryId,
  categoryTitle,
  related,
  children,
}: {
  categoryId?: string
  categoryTitle?: string
  related: { slug: string; title: string }[]
  children: React.ReactNode
}) {
  const t = useT()
  const tl = useLabelT()
  return (
    <>
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-foreground">{t("help.breadcrumb")}</Link>
        {categoryId && categoryTitle && (
          <>
            <CaretRight size={13} />
            <Link href={`/help#${categoryId}`} className="hover:text-foreground">{tl("helpCat", categoryTitle)}</Link>
          </>
        )}
      </nav>

      {children}

      {related.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("help.related")}</div>
          <div className="mt-2 divide-y divide-border">
            {related.map((a) => (
              <Link key={a.slug} href={`/help/${a.slug}`} className="flex items-center justify-between gap-3 px-1 py-2.5 text-sm transition-colors hover:text-primary">
                <span>{tl("helpArticle", a.title)}</span>
                <CaretRight size={14} className="shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <Link href="/help" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} /> {t("help.allTopics")}
        </Link>
        <div className="flex gap-2">
          <a href="mailto:support@egful.store" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <EnvelopeSimple size={14} weight="bold" /> {t("help.email")}
          </a>
          <Link href="/chat" className={cn(buttonVariants({ size: "sm" }))}>
            <ChatCircleDots size={14} weight="bold" /> {t("help.liveChat")}
          </Link>
        </div>
      </div>
    </>
  )
}
