"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Thumb } from "@/components/app/thumb"

export type PickOption = { value: string; image?: string | null }

/**
 * CHOOSE WHAT THIS PAGE PRINTS — the colourways, or the sizes.
 *
 * One dialog for both, because they are the same question asked about two lists: here is
 * everything the style has, tick the ones the catalogue should show. The only difference is
 * whether an option carries a picture, and a colourway is chosen BY its picture — "S.Pnk"
 * against "H.Pnk" is a guess until you see them next to each other — so when there are images
 * this is a grid of them and when there aren't it is a row of chips.
 *
 * ALL IS A STATE, NOT A FULL TICK LIST. Nothing picked means the page prints the whole range,
 * which is what every page did before this existed and what a newly-added colourway should
 * inherit. So "Show all" clears rather than ticking everything: a page that happens to have
 * every box ticked would freeze the range as it was on the day someone opened this, and a
 * colour added upstream next month would silently not appear.
 */
export function LookbookPickDialog({
  open, onOpenChange, title, options, picked, onSave, busy,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  options: PickOption[]
  /** The current selection, or null for "all". */
  picked: string[] | null | undefined
  /** null clears the override — the page goes back to printing everything. */
  onSave: (next: string[] | null) => void
  busy?: boolean
}) {
  const tl = useLabelT()
  const [sel, setSel] = useState<Set<string>>(new Set())

  // Seeded on OPEN, not on every render of `picked` — the dialog is a draft of the choice and
  // must not be rewritten underneath someone while they are making it.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => setSel(new Set(picked ?? options.map((o) => o.value))), 0)
    return () => clearTimeout(id)
  }, [open, picked, options])

  const toggle = (v: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })

  const hasImages = options.some((o) => o.image)
  // Everything ticked IS "all" — saving it as a list would freeze the range (see the note
  // above), so it resolves to null exactly as the Show all button does.
  const commit = () => {
    onSave(sel.size === 0 || sel.size === options.length ? null : [...sel])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[min(94vw,640px)]">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto">
          {options.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {tl("lookbookPick", "This style lists none to choose from.")}
            </p>
          ) : hasImages ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {options.map((o) => {
                const on = sel.has(o.value)
                return (
                  <button
                    key={o.value} type="button" onClick={() => toggle(o.value)} aria-pressed={on}
                    className={"flex flex-col overflow-hidden rounded-lg border text-left transition-colors "
                      + (on ? "border-primary ring-1 ring-primary" : "border-border opacity-55 hover:opacity-100")}
                  >
                    <Thumb src={o.image ?? ""} alt="" fit="contain" className="aspect-square w-full p-1" />
                    <span className="truncate border-t border-border px-1.5 py-1 text-2xs font-medium">{o.value}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {options.map((o) => {
                const on = sel.has(o.value)
                return (
                  <button
                    key={o.value} type="button" onClick={() => toggle(o.value)} aria-pressed={on}
                    className={"min-w-10 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors "
                      + (on ? "border-selected eg-selected" : "border-border text-muted-foreground hover:bg-muted")}
                  >
                    {o.value}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3">
          {/* The count is the only thing here that isn't a control, and it is the answer to
              "what did I just do" — so it is a reading, not a caption under a button. */}
          <span className="text-xs tabular-nums text-muted-foreground">
            {sel.size === options.length ? tl("lookbookPick", "All") : `${sel.size} of ${options.length}`}
          </span>
          <Button
            variant="ghost" size="sm" className="ml-auto" disabled={busy}
            onClick={() => { onSave(null); onOpenChange(false) }}
            title={tl("lookbookPick", "Print the whole range, including any added later")}
          >
            {tl("lookbookPick", "Show all")}
          </Button>
          <Button size="sm" onClick={commit} disabled={busy}>{tl("lookbookPick", "Done")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
