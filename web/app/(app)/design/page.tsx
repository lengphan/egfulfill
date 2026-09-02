"use client"

import { useLabelT, useDateFormat } from "@/lib/i18n"
import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Plus, PenNib, X, Check, CircleNotch } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { EmptyState } from "@/components/app/empty-state"
import { TemplatesPanel } from "@/components/app/templates-panel"
import { MachineFilesPanel } from "@/components/app/machine-files-panel"
import { DesignLabTabs, useDesignLabTab } from "@/components/app/design-lab-tabs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
// DesignStudioDialog is no longer mounted here — "Place on a mockup" was its only
// trigger and it was removed. The component itself is untouched on disk.
import { downscale } from "@/components/app/design-studio"
import { readImageFile } from "@/components/app/design-canvas"
import { getDesignLibrary, deleteDesignLibrary, renameDesignLibrary, saveDesignLibrary, type LibraryDesign } from "@/lib/api"
import { proxiedImageSrc } from "@/lib/order-image"
import { Thumb } from "@/components/app/thumb"
import { useLightbox } from "@/components/app/image-lightbox"
import { getToken } from "@/lib/auth"

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
 * gets. (2) is now the shared Thumb's whole job, so this is the pen mark plus the proxy and
 * nothing else; see components/app/thumb.tsx for why a fifth hand-rolled onError was the
 * wrong shape.
 */
function LibraryThumb({ thumb, name }: { thumb?: string | null; name?: string | null }) {
  return (
    <Thumb
      src={thumb ? proxiedImageSrc(thumb) : ""}
      // Empty on purpose: the name is already printed under the tile, and a screen reader
      // does not need it twice.
      alt=""
      note={name ?? undefined}
      className="size-full bg-transparent"
      icon={<PenNib size={26} weight="duotone" className="text-muted-foreground/40" />}
    />
  )
}

function useFmtDate() {
  const fmtDate = useDateFormat()
  return useCallback((s?: string) => {
 if (!s) return ""
 const d = new Date(s)
 return isNaN(d.getTime()) ? "" : fmtDate(d, { month: "short", day: "numeric" })
}, [fmtDate])
}

function DesignLab() {
  const fmtDate = useFmtDate()
  const tl = useLabelT()
 const tab = useDesignLabTab()
 const [designs, setDesigns] = useState<LibraryDesign[] | null>(null)
 const [signedOut, setSignedOut] = useState(false)
  /* The header's own picker. The zone still takes a drop; this is the click route, which is
     what "Import artwork" has to actually do to be telling the truth. */
 const pickRef = useRef<HTMLInputElement | null>(null)
 const [uploading, setUploading] = useState<string | null>(null)
 const [upErr, setUpErr] = useState<string | null>(null)

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

  /**
   * DROPPING A PICTURE IS THE WHOLE INTERACTION.
   *
   * The library's empty state was a mark, a line and a button that opened the studio dialog —
   * so the one thing everybody arrives here to do, put a picture in, went through a modal
   * that exists for something else entirely (choosing a blank, placing artwork on it). The
   * dialog is still here as the second route, under an "or", because placing artwork on a
   * mockup is a real and different job.
   *
   * SEQUENTIAL, not Promise.all. Each file is a base64 body on a 60MB limit; firing ten at
   * once is how a drop of a folder becomes ten simultaneous multi-megabyte POSTs. The loop
   * also means one bad file reports itself and the rest still land.
   */
 const takeFiles = async (files: FileList) => {
 setUpErr(null)
 for (const file of Array.from(files)) {
 const data = await new Promise<string | null>((resolve) => {
 readImageFile(file, (url) => resolve(url), (m) => { setUpErr(m); resolve(null) })
      })
 if (!data) continue
 setUploading(file.name)
 try {
 const thumb = await downscale(data, 320)
 const r = await saveDesignLibrary({ name: file.name.replace(/\.[^.]+$/, ""), data, thumb })
 if (r.error) throw new Error(r.error)
      } catch (e) {
 setUpErr(e instanceof Error ? e.message : "Couldn't save that artwork.")
      } finally { setUploading(null) }
    }
 load()
  }

 const remove = async (id: number | string) => {
 setDesigns((prev) => (prev ?? []).filter((d) => d.id !== id))
 try { await deleteDesignLibrary(id) } catch { load() }
  }

 const zoom = useLightbox()
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
      {/* Portalled to the body, so it opens above the shell rather than inside this column. */}
      {zoom.node}
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
 title={tl("design", "Your artwork")}
 actions={
            /* IMPORT IS THE HEADER'S JOB; the mockup studio is a second, quieter one.
               This button used to open the studio while being the loudest control on the
               panel, so the obvious way to get a file in was the one thing it did not do.
               The zone still takes a drop — this is the click route, and now it imports. */
            <div className="flex items-center gap-2">
              <input
                ref={pickRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) void takeFiles(e.target.files); e.target.value = "" }}
              />
              <Button size="sm" variant="outline" onClick={() => pickRef.current?.click()} disabled={signedOut || !!uploading}>
                {uploading
                  ? <><CircleNotch size={14} className="animate-spin" /> {tl("design", "Saving")} {uploading}</>
                  : <><Plus size={14} weight="bold" /> {tl("design", "Import artwork")}</>}
              </Button>
            </div>
          }
        >
          {designs === null ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-52 animate-pulse rounded-xl bg-muted" />)}
            </div>
          ) : (
            <div className="space-y-4 p-5">
              {/* NO DROPZONE. Import is a click now, and a dashed target above a populated
                  grid was a second control claiming the same verb. Drag-and-drop went with
                  it — the header button is the one way in.
                  The zone WAS the empty state, so an empty library gets a real one rather
                  than a blank panel: mark, line, note, one way out (§4). */}
              {list.length === 0 && (
                <EmptyState
                  icon={PenNib}
                  title={signedOut ? tl("design", "Sign in to build your artwork library")
                    : tl("design", "No artwork yet")}
                  note={tl("design", "PNG, JPG or SVG. Import one and it is reusable on every order.")}
                  action={!signedOut && (
                    <Button size="sm" variant="outline" onClick={() => pickRef.current?.click()}>
                      <Plus size={14} weight="bold" /> {tl("design", "Import artwork")}
                    </Button>
                  )}
                />
              )}
              {upErr && <p className="text-sm text-alert">{upErr}</p>}
              {list.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((d) => (
                <Card key={String(d.id)} className="group flex flex-col gap-0 overflow-hidden p-0">
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted">
                    {/* object-COVER, not contain — see LibraryThumb. A design library holds
                        artwork of every shape, and contain sat each one at a different visual
                        size inside the square, floating in grey bands, so a tidy grid read as
                        crooked even though the frames were identical. */}
                    <LibraryThumb thumb={d.thumb} name={d.name} />
                    {/* THE PICTURE IS THE POINT OF THIS CARD, and it was the one thing you
                        could not look at. The tile is 200-odd pixels of artwork somebody is
                        about to put on a garment; the name renames, the ✕ deletes, and the
                        image itself did nothing at all. Now it opens.

                        Under the ✕ in the DOM, so the delete control keeps its own clicks. */}
                    <button
                      type="button"
                      onClick={() => zoom.open(d.thumb ? proxiedImageSrc(d.thumb) : "", d.name || `IMG-${d.id}`)}
                      title={tl("design", "View full size")}
                      className="absolute inset-0 cursor-zoom-in"
                      aria-label={`View ${d.name || "artwork"} full size`}
                    />
                    <button
 onClick={() => remove(d.id)}
 className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity hover:bg-alert group-hover:opacity-100"
 aria-label={tl("design", "Delete artwork")}
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
 title={tl("design", "Click to rename")}
 className="eg-tap block max-w-full truncate text-left text-sm font-semibold transition-colors hover:text-primary"
                      >
                        {d.name || tl("design", "Untitled")}
                      </button>
                    )}
                    <div className="mt-auto flex items-center gap-1.5 pt-1.5">
                      <span className="text-xs text-muted-foreground">{fmtDate(d.created_at)}</span>
                      {/* The ID, visible and copyable — the reference sellers put on an import
 sheet, so it's shown at a readable size, not a tiny caption. */}
                      <button
 onClick={() => { navigator.clipboard?.writeText(`IMG-${d.id}`).catch(() => {}); setCopied(String(d.id)); setTimeout(() => setCopied(null), 1400) }}
 title={tl("design", "Copy this artwork's reference")}
 className="eg-tap ml-auto rounded-md bg-muted px-2 py-1 tabular-nums text-sm font-semibold text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                      >
                        {copied === String(d.id)
                          ? <span className="inline-flex items-center gap-1">{tl("design", "Copied")}<Check size={12} weight="bold" /></span>
                          : `IMG-${d.id}`}
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
              )}
            </div>
          )}
        </SectionCard>
      ) : tab === "machine" ? (
        <MachineFilesPanel />
      ) : (
        <TemplatesPanel />
      )}

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
