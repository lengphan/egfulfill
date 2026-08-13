"use client"

import { Card } from "@/components/ui/card"
import { useLabelT } from "@/lib/i18n"

/** Universal content block — a card with an optional header (title + description + actions).
 *  Use for tables, lists, forms, any titled section. Keeps every page's section chrome identical.
 *
 *  TRANSLATES ITS OWN HEADER. Every titled section in the app comes through here, so doing it
 *  at each of the ~44 call sites would be 44 chances to forget — and forgetting is what left
 *  half the app in English. A STRING title/description is looked up in the `section`/`sectionDesc`
 *  namespaces and falls back to itself, so English needs no catalog entry and a call site that
 *  passes JSX (an icon beside the words, which several do) is passed through untouched.
 */
export function SectionCard({
  title,
  description,
  actions,
  bodyClassName,
  className,
  children,
}: {
  title?: React.ReactNode
  description?: string
  actions?: React.ReactNode
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}) {
  const tl = useLabelT()
  // Only a plain string can be translated. A ReactNode title is composed at the call site and
  // has to translate its own words there.
  const shownTitle = typeof title === "string" ? tl("section", title) : title
  const shownDesc = description ? tl("sectionDesc", description) : description
  return (
    <Card className={"gap-0 overflow-hidden p-0" + (className ? " " + className : "")}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            {title && <div className="text-base font-bold">{shownTitle}</div>}
            {description && <div className="text-sm text-muted-foreground">{shownDesc}</div>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Card>
  )
}
