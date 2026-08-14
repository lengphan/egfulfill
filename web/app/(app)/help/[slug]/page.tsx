import Link from "next/link"
import { notFound } from "next/navigation"
import { CaretRight, ArrowLeft, ChatCircleDots, EnvelopeSimple } from "@phosphor-icons/react/dist/ssr"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { HELP_ARTICLES, getArticle, categoryById } from "@/lib/help"
import { HelpArticleBody } from "@/components/app/help-article-body"

// Pre-render every answer page at build time (fixed, known set of slugs).
export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = getArticle(slug)
  return a ? { title: `${a.title} — Help`, description: a.summary } : { title: "Help" }
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) notFound()
  const cat = categoryById(article.category)
  // A couple of related reads from the same category (excluding this one).
  const related = HELP_ARTICLES.filter((a) => a.category === article.category && a.slug !== article.slug).slice(0, 4)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-foreground">Help</Link>
        {cat && (
          <>
            <CaretRight size={13} />
            <Link href={`/help#${cat.id}`} className="hover:text-foreground">{cat.title}</Link>
          </>
        )}
      </nav>

      {/* Answer */}
      <article className="rounded-2xl border border-border bg-card p-7">
        <HelpArticleBody article={article} />

      </article>

      {/* Related reads */}
      {related.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related</div>
          <div className="mt-2 divide-y divide-border">
            {related.map((a) => (
              <Link key={a.slug} href={`/help/${a.slug}`} className="flex items-center justify-between gap-3 px-1 py-2.5 text-sm transition-colors hover:text-primary">
                <span>{a.title}</span>
                <CaretRight size={14} className="shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Footer: back + still-need-help */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <Link href="/help" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} /> All help topics
        </Link>
        <div className="flex gap-2">
          <a href="mailto:support@egful.store" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <EnvelopeSimple size={14} weight="bold" /> Email
          </a>
          <Link href="/chat" className={cn(buttonVariants({ size: "sm" }))}>
            <ChatCircleDots size={14} weight="bold" /> Live chat
          </Link>
        </div>
      </div>
    </div>
  )
}
