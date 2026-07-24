"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Plus, X, PencilSimple, Check, DotsSix, type Icon } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"

export type ShortcutItem = { label: string; href: string; icon: Icon; desc?: string }

/**
 * A per-user, customisable launcher of shortcut tiles. The user reorders by drag and
 * adds/removes from a catalog of pages their role can actually reach — so it never offers
 * a link that would just bounce them. The chosen set + order is persisted in localStorage
 * under `storageKey`, which is why the same component can sit on several pages, each with
 * its own remembered layout.
 *
 * The tiles fill the card's height (auto-rows-fr) so, dropped beside a fixed-height table,
 * the column heights line up instead of leaving a lopsided gap.
 */
export function ShortcutsCard({
  title = "Jump to",
  catalog,
  defaults,
  storageKey,
}: {
  title?: string
  catalog: ShortcutItem[]
  defaults: string[]
  storageKey: string
}) {
  const byHref = useMemo(() => Object.fromEntries(catalog.map((c) => [c.href, c])), [catalog])
  // Only ever keep hrefs that still exist in the catalog — a role change or a removed page
  // must not leave a dead tile behind.
  const clean = useCallback((hrefs: string[]) => hrefs.filter((h) => byHref[h]), [byHref])

  const [hrefs, setHrefs] = useState<string[]>(() => clean(defaults))
  const [editing, setEditing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  // Load the saved layout after mount (localStorage is client-only). Deferred to dodge
  // react-hooks/set-state-in-effect, the pattern used across the app pages.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const v = JSON.parse(localStorage.getItem(storageKey) || "null")
        if (Array.isArray(v) && v.length) setHrefs(clean(v.map(String)))
      } catch { /* keep defaults */ }
    }, 0)
    return () => clearTimeout(id)
  }, [storageKey, clean])

  const persist = useCallback((next: string[]) => {
    setHrefs(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
  }, [storageKey])

  const shown = hrefs.map((h) => byHref[h]).filter(Boolean) as ShortcutItem[]
  const available = catalog.filter((c) => !hrefs.includes(c.href))

  const remove = (href: string) => persist(hrefs.filter((h) => h !== href))
  const add = (href: string) => { persist([...hrefs, href]); setAddOpen(false) }

  const onDrop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from === null || from === to) return
    const next = [...hrefs]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    persist(next)
  }

  return (
    <SectionCard
      title={title}
      className="h-full"
      bodyClassName="flex flex-1 flex-col"
      actions={
        <button
          onClick={() => { setEditing((e) => !e); setAddOpen(false) }}
          aria-pressed={editing}
          className={"eg-tap inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors " + (editing ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {editing ? <><Check size={13} weight="bold" /> Done</> : <><PencilSimple size={13} weight="bold" /> Edit</>}
        </button>
      }
    >
      {/* auto-rows-fr makes every tile-row share the card's height equally, so the tiles
          grow to meet a taller neighbour instead of the card leaving empty space below. */}
      <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-2 p-3">
        {shown.map((q, i) => {
          const Icon = q.icon
          const dragProps = editing ? {
            draggable: true,
            onDragStart: () => { dragFrom.current = i },
            onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(i) },
            onDragLeave: () => setDragOver((c) => (c === i ? null : c)),
            onDrop: () => onDrop(i),
            onDragEnd: () => { dragFrom.current = null; setDragOver(null) },
          } : {}
          const tileCls = "group relative flex min-h-[76px] flex-col items-start justify-center gap-2 rounded-lg border p-3 transition-colors " +
            (dragOver === i ? "border-primary bg-primary/5 " : "border-border ") +
            (editing ? "cursor-grab bg-card active:cursor-grabbing" : "hover:border-primary/40 hover:bg-accent")
          const inner = (
            <>
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon size={16} weight="duotone" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{q.label}</span>
                {q.desc && <span className="mt-0.5 block truncate text-xs text-muted-foreground leading-tight">{q.desc}</span>}
              </span>
            </>
          )
          if (editing) {
            return (
              <div key={q.href} {...dragProps} className={tileCls}>
                <DotsSix size={14} className="absolute right-2 top-2 text-muted-foreground/50" />
                <button
                  aria-label={`Remove ${q.label}`}
                  onClick={() => remove(q.href)}
                  className="eg-tap absolute right-1.5 bottom-1.5 grid size-5 place-items-center rounded-full bg-background/85 text-muted-foreground shadow-sm transition-colors hover:text-red-600"
                >
                  <X size={11} weight="bold" />
                </button>
                {inner}
              </div>
            )
          }
          return (
            <Link key={q.href} href={q.href} className={tileCls}>{inner}</Link>
          )
        })}

        {editing && available.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setAddOpen((o) => !o)}
              className="eg-tap flex size-full min-h-[76px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Plus size={18} weight="bold" />
              <span className="text-xs font-medium">Add shortcut</span>
            </button>
            {addOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />
                <div className="absolute left-0 z-50 mt-1 max-h-64 w-56 overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-xl">
                  {available.map((c) => {
                    const Icon = c.icon
                    return (
                      <button key={c.href} onClick={() => add(c.href)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent">
                        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon size={14} weight="duotone" /></span>
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {shown.length === 0 && !editing && (
          <div className="col-span-2 py-8 text-center text-sm text-muted-foreground">No shortcuts — tap Edit to add some.</div>
        )}
      </div>
    </SectionCard>
  )
}
