"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { Plus, PenNib, X } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { TemplatesPanel } from "@/components/app/templates-panel"
import { MachineFilesPanel } from "@/components/app/machine-files-panel"
import { DesignLabTabs, useDesignLabTab } from "@/components/app/design-lab-tabs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DesignStudioDialog } from "@/components/app/design-studio"
import { getDesignLibrary, deleteDesignLibrary, renameDesignLibrary, type LibraryDesign } from "@/lib/api"
import { proxiedImageSrc } from "@/lib/order-image"
import { getToken } from "@/lib/auth"
import { EmptyState } from "@/components/app/empty-state"

/**
 * A LIBRARY THUMBNAIL, and what it does when the picture is not there.
 *
 * Two separate failures were rendering as one:
 *
 *  1. A marketplace thumb (etsystatic, Shopify, TikTok) was hotlinked straight into `src`,
 *     so it answered to THEIR referrer and CORS rules rather than ours. proxiedImageSrc
 *     routes those through /api/etsy/img-proxy — same origin, a content type, a day of
 *     cache — which is the route the canvas reader has used all along.
 *  2. Whatever still failed showed the ALT TEXT: a paragraph of Etsy listing title sitting
 *     where a square picture should be, in a grid of square pictures. That is not an empty
 *     state, it is a broken one wearing an empty one's clothes.
 *
 * So the placeholder is the answer to both — the same pen mark a design with no thumbnail
 * gets — and alt stays empty, because the name is already printed under the tile and a
 * screen reader does not need it twice.
 *
 * Module scope, not inside the map: react-hooks/static-components refuses a component
 * defined during render, and this one needs its own broken flag per row.
 */
function LibraryThumb({ thumb, name }: { thumb?: string | null; name?: string | null }) {
  const [broken, setBroken] = useState(false)
  const placeholder = <PenNib size={26} weight="duotone" className="text-muted-foreground/40" />
  if (!thumb || broken) return placeholder
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={proxiedImageSrc(thumb)}
      alt=""
      title={name ?? undefined}
      className="size-full object-cover"
      onError={() => setBroken(true)}
    />
  )
}

const fmtDate = (s?: string) => {
 if (!s) return ""
 const d = new Date(s)
 return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function DesignLab() {
 const tab = useDesignLabTab()
 const [designs, setDesigns] = useState<LibraryDesign[] | null>(null)
 const [signedOut, setSignedOut] = useState(false)
 const [studioOpen, setStudioOpen] = useState(false)

 const load = useCallback(() => {
 if (!getToken()) { setSignedOut(true); setDesigns([]); return }
 getDesignLibrary().then((r) => setDesigns(r ?? [])).catch(() => setDesigns([]))
  }, [])
  // Only when the Library tab is actually showing. Thumbs are base64 data URLs, so
  // landing on ?tab=templates used to pull the whole library down to render none of it.
  // `designs` gates the refetch: switching tabs keeps this component mounted, so the
  // list survives and coming back doesn't re-download it.
 useEffect(() => {
 if (tab !== "library" || designs !== null) return
 const id = setTimeout(load, 0)
 return () => clearTimeout(id)
  }, [tab, designs, load])

 const remove = async (id: number | string) => {
 setDesigns((prev) => (prev ?? []).filter((d) => d.id !== id))
 try { await deleteDesignLibrary(id) } catch { load() }
  }

 const [copied, setCopied] = useState<string | null>(null)
 const [editId, setEditId] = useState<string | number | null>(null)
 const list = designs ?? []

  // Rename in place. Reads the input's own value (uncontrolled) so there's no stale-draft
  // state, and skips the request when the name is unchanged. The id — the import reference —
  // never changes; only the label does.
 const commitName = async (id: string | number, value: string) => {
 setEditId(null)
 const name = value.trim()
 const cur = list.find((d) => d.id === id)
 if (!name || (cur && (cur.name || "") === name)) return
 setDesigns((prev) => (prev ?? []).map((d) => (d.id === id ? { ...d, name } : d)))
 try { await renameDesignLibrary(id, name) } catch { load() }
  }

 return (
    <div className="space-y-4">
      <DesignLabTabs />

      {/**
        * IMAGES, not "designs".
        *
        * This holds uploaded ARTWORK — the picture you put on a garment. Three other things
        * in this system were already called a design: the artwork attached to an order line
        * (DSN-1042, in the designer), a designer's work card on the board (also DSN-), and a
        * saved template (TPL-). One word over four meanings, and the numbers looked alike,
        * so "send me the design id" was an ambiguous request in a system that runs on ids.
        *
        * IMG- is its own namespace and says what the thing is. DSN- keeps meaning what it
        * meant — the design work on an order — which is the pair people actually need to
        * tell apart.
        */}
      {tab === "library" ? (
        <SectionCard
 title="Your images"
 actions={
            <Button size="sm" onClick={() => setStudioOpen(true)} disabled={signedOut}>
              <Plus size={14} weight="bold" /> Add artwork
            </Button>
          }
        >
          {designs === null ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-52 animate-pulse rounded-xl bg-muted" />)}
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={PenNib}
              title={signedOut ? "Sign in to build your image library" : "No images yet"}
              note={signedOut ? "Your saved artwork lives here." : "Add artwork — a picture you upload is reusable on any order or design."}
              action={!signedOut && (
                <Button size="sm" onClick={() => setStudioOpen(true)}>
                  <Plus size={14} weight="bold" /> Add artwork
                </Button>
              )}
            />
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((d) => (
                <Card key={String(d.id)} className="group flex flex-col gap-0 overflow-hidden p-0">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted">
                    {/* object-COVER, not contain — see LibraryThumb. A design library holds
                        artwork of every shape, and contain sat each one at a different visual
                        size inside the square, floating in grey bands, so a tidy grid read as
                        crooked even though the frames were identical. */}
                    <LibraryThumb thumb={d.thumb} name={d.name} />
                    <button
 onClick={() => remove(d.id)}
 className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity hover:bg-alert group-hover:opacity-100"
 aria-label="Delete image"
                    >
                      <X size={13} weight="bold" />
                    </button>
                  </div>
                  {/* flex-1 + flex-col so the meta row can pin to the BOTTOM (mt-auto below).
                      The card stretches to its grid row's height, and without this the
 date + ID sat directly under the title — so a one-line title and a
 wrapped one put their badges at different heights across a row, which
 is the other half of the crooked look. Pinned, every badge lands on
 the same line regardless of title length. */}
                  <div className="flex flex-1 flex-col p-3">
                    {/* Click the title to rename. Uncontrolled input keyed off the design id
 so remounting per row starts from the right value; Enter/blur saves,
                        Esc reverts. */}
                    {editId === d.id ? (
                      <input
 autoFocus
 defaultValue={d.name || ""}
 onFocus={(e) => e.currentTarget.select()}
 onBlur={(e) => commitName(d.id, e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() }
 else if (e.key === "Escape") { e.currentTarget.value = d.name || ""; e.currentTarget.blur() }
                        }}
 className="w-full rounded-md border border-primary/50 bg-background px-1.5 py-0.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring/40"
                      />
                    ) : (
                      <button
 onClick={() => setEditId(d.id)}
 title="Click to rename"
 className="eg-tap block max-w-full truncate text-left text-sm font-semibold transition-colors hover:text-primary"
                      >
                        {d.name || "Untitled"}
                      </button>
                    )}
                    <div className="mt-auto flex items-center gap-1.5 pt-1.5">
                      <span className="text-xs text-muted-foreground">{fmtDate(d.created_at)}</span>
                      {/* The ID, visible and copyable — the reference sellers put on an import
 sheet, so it's shown at a readable size, not a tiny caption. */}
                      <button
 onClick={() => { navigator.clipboard?.writeText(`IMG-${d.id}`).catch(() => {}); setCopied(String(d.id)); setTimeout(() => setCopied(null), 1400) }}
 title="Copy this image's reference"
 className="eg-tap ml-auto rounded-md bg-muted px-2 py-1 tabular-nums text-sm font-semibold text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                      >
                        {copied === String(d.id) ? "Copied ✓" : `IMG-${d.id}`}
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SectionCard>
      ) : tab === "machine" ? (
        <MachineFilesPanel />
      ) : (
        <TemplatesPanel />
      )}

      <DesignStudioDialog open={studioOpen} onOpenChange={setStudioOpen} onSaved={load} />
    </div>
  )
}

export default function DesignPage() {
  // useSearchParams (via useDesignLabTab) needs a Suspense boundary to prerender.
  // The fallback mirrors the default (Library) view — bar plus the same 8-card grid the
  // loading state uses — so the page doesn't collapse to a sliver and pop back.
 return (
    <>
    <Suspense
 fallback={
        <div className="space-y-4">
          <div className="h-8 w-72 animate-pulse rounded-2xl bg-muted" />
          <Card className="gap-0 overflow-hidden p-0">
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-52 animate-pulse rounded-xl bg-muted" />)}
            </div>
          </Card>
        </div>
      }
    >
      <DesignLab />
    </Suspense>
    </>
  )
}
