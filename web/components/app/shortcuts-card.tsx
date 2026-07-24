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
  // The card clips its own overflow (rounded corners), so the add-menu can't be a plain
  // absolute child — it gets cut off. Anchor it with position:fixed from the button's rect,
  // which a plain overflow ancestor doesn't clip.
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null)
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const toggleAdd = () => {
    if (addOpen) { setAddOpen(false); return }
    const r = addBtnRef.current?.getBoundingClientRect()
    if (r) {
      const W = 224 // w-56
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
      const below = window.innerHeight - r.bottom
      const above = r.top
      // Flip upward when the button sits low and there's more room above, and cap the menu
      // to whatever space that side actually has so it never runs off the screen edge.
      if (below < 200 && above > below) {
        setMenuPos({ bottom: window.innerHeight - r.top + 4, left, maxHeight: above - 12 })
      } else {
        setMenuPos({ top: r.bottom + 4, left, maxHeight: below - 12 })
      }
    }
    setAddOpen(true)
  }

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

  // Fixed at six slots — a stable 3×2 grid that lines up with the table height and never
  // grows. To add a seventh you remove one first, which is the whole point: it stays tidy.
  const MAX = 6
  const remove = (href: string) => persist(hrefs.filter((h) => h !== href))
  const add = (href: string) => { if (hrefs.length < MAX) persist([...hrefs, href]); setAddOpen(false) }
  const canAdd = hrefs.length < MAX && available.length > 0

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

        {editing && canAdd && (
          <button
            ref={addBtnRef}
            onClick={toggleAdd}
            className="eg-tap flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Plus size={18} weight="bold" />
            <span className="text-xs font-medium">Add shortcut</span>
          </button>
        )}
        {addOpen && menuPos && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />
            <div className="fixed z-50 w-56 overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-xl" style={{ top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, maxHeight: menuPos.maxHeight }}>
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

        {shown.length === 0 && !editing && (
          <div className="col-span-2 py-8 text-center text-sm text-muted-foreground">No shortcuts — tap Edit to add some.</div>
        )}
      </div>
    </SectionCard>
  )
}
