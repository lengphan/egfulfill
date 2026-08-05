import { Card } from "@/components/ui/card"

/** Universal content block — a card with an optional header (title + description + actions).
 *  Use for tables, lists, forms, any titled section. Keeps every page's section chrome identical. */
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
  return (
    <Card className={"gap-0 overflow-hidden p-0" + (className ? " " + className : "")}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            {title && <div className="text-base font-bold">{title}</div>}
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Card>
  )
}
