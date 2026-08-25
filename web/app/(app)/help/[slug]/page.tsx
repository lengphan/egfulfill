import { notFound } from "next/navigation"
import { HELP_ARTICLES, getArticle, categoryById } from "@/lib/help"
import { HelpArticleBody, HelpArticleChrome } from "@/components/app/help-article-body"

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
  const related = HELP_ARTICLES.filter((a) => a.category === article.category && a.slug !== article.slug)
    .slice(0, 4)
    .map((a) => ({ slug: a.slug, title: a.title }))

  // Breadcrumb, Related and the footer all live in HelpArticleChrome — a client island, so
  // they translate. This page stays a static server component (see generateStaticParams).
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <HelpArticleChrome categoryId={cat?.id} categoryTitle={cat?.title} related={related}>
        <article className="rounded-2xl border border-border bg-card p-7">
          <HelpArticleBody article={article} />
        </article>
      </HelpArticleChrome>
    </div>
  )
}
