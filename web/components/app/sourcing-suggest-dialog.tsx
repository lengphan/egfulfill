"use client"

import { useEffect, useState } from "react"
import { CircleNotch, Warning, Plus, Check } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { suggestSuppliers, saveSourcing, searchAlibaba, type EtsyListing, type AlibabaProduct } from "@/lib/api"

/**
 * "Find suppliers" — the bridge from a SpyDeck listing to the sourcing pipeline.
 *
 * WHAT THIS CAN AND CANNOT DO, because the difference drives the whole layout:
 * Alibaba's robots.txt disallows /trade/ (the search-results path), so we cannot fetch a
 * ranked supplier list server-side and render it here. What we CAN do is the part that's
 * actually hard — turning a marketing title into queries a B2B marketplace understands —
 * and then hand you a one-click search plus somewhere to bring the result back.
 *
 * So the flow is: read the product -> click a query -> it opens Sourcing with that keyword
 * already searching, against the buyer API. The API is a different door from /trade/ and the
 * robots rule does not apply to it, which is what finally made a real in-app result list
 * possible — but it lives on Sourcing, which has the width and the pagination for it, not in
 * this modal. Pasting a link by hand still works and still lands at the Saved stage.
 */


type Suggestion = Awaited<ReturnType<typeof suggestSuppliers>>

export function SourcingSuggestDialog({ listing, onClose, onSaved }: {
 listing: EtsyListing | null
 onClose: () => void
 onSaved?: (label: string) => void
}) {
 const [data, setData] = useState<Suggestion | null>(null)
 const [err, setErr] = useState<string | null>(null)


  /**
   * The supplier products themselves. null = still looking, [] = nothing came back — the
   * two must not look the same, or a dead search reads as "no such supplier exists".
   */
 const [hits, setHits] = useState<AlibabaProduct[] | null>(null)
 const [hitErr, setHitErr] = useState<string | null>(null)
 const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
 const [savingId, setSavingId] = useState<string | null>(null)
 const [savedCount, setSavedCount] = useState(0)   // read by the footer line below
 const [note, setNote] = useState<string | null>(null)

  /**
   * TRY THE QUERIES UNTIL ONE ANSWERS, then fall back to a shorter phrase.
   *
   * Running only the first returned nothing on every listing tested. The model writes
   * long-tail B2B phrases — "custom engraved nameplate pendant necklace wholesale", six
   * words — and Alibaba's search matches those poorly; the same endpoint returns a full
   * grid for "necklace". So a single attempt made the whole panel look broken when the
   * search was working perfectly.
   *
   * Extra calls happen ONLY on an empty result, never on a hit, so the common case is
   * still one request. Capped at four attempts total: three queries plus one trimmed to
   * its last two words, which is the shape that actually matches a marketplace listing.
   */
 useEffect(() => {
 const queries = (data?.queries ?? []).filter(Boolean)
 if (!queries.length) return
 let alive = true
 const shorten = (q: string) => q.split(/\s+/).filter((w) => !/^(wholesale|supplier|bulk|custom|blank)$/i.test(w)).slice(-2).join(" ")
 const attempts = [...queries.slice(0, 3), shorten(queries[0])].filter((v, i, a) => v && a.indexOf(v) === i)
 const t = setTimeout(async () => {
 for (const kw of attempts) {
 if (!alive) return
 try {
 const r = await searchAlibaba({ keyword: kw, page: 1, pageSize: 12 })
 if (!alive) return
 if (r.error) { setHitErr(r.error); setHits([]); return }   // an error is not "no suppliers"
 if ((r.products ?? []).length) { setHits(r.products ?? []); setHitErr(null); return }
        } catch (e) {
 if (!alive) return
 setHitErr(e instanceof Error ? e.message : "search failed"); setHits([]); return
        }
      }
 if (alive) { setHits([]); setHitErr(null) }   // genuinely nothing, after trying every angle
    }, 0)
 return () => { alive = false; clearTimeout(t) }
  }, [data])

  /** Save one result straight to Sourcing — the paste-a-link step this replaces. */
 const saveHit = async (h: AlibabaProduct) => {
 const id = String(h.id ?? h.url ?? "")
 if (!id || savedIds.has(id)) return
 setSavingId(id)
 try {
 await saveSourcing({
 title: (h.title || "Alibaba product").slice(0, 120),
 url: h.url || "", image: h.image || null,
        // Alibaba quotes a RANGE by quantity band ("$6.06-8.07"); there is no single number
        // to store, so cost stays null rather than guessing an end of it.
 cost: null, sellPrice: null, moq: 1, stage: "prospect",
      })
 setSavedIds((p) => new Set(p).add(id))
 setSavedCount((n) => n + 1)
      // The parent shows a toast naming what landed — pass the title, not a bare ping.
 onSaved?.(h.title || "Supplier product")
    } catch (e) {
 setNote(e instanceof Error ? e.message : "Couldn't save that one.")
    } finally { setSavingId(null) }
  }

  // Reset per listing rather than on close, so reopening a different product never shows the
  // previous one's answer for a frame.
 useEffect(() => {
 if (!listing) return
 const t = setTimeout(() => {
 setData(null); setErr(null); setSavedCount(0); setNote(null)
 setHits(null); setHitErr(null); setSavedIds(new Set()); setSavingId(null)
 suggestSuppliers({
 listingId: String(listing.listing_id),
 title: listing.title,
 image: listing.image || listing.thumb || null,
      })
        .then((r) => { if (r.error) setErr(r.error); else setData(r) })
        .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't get suggestions."))
    }, 0)
 return () => clearTimeout(t)
  }, [listing])

 if (!listing) return null

  // Save a supplier link. The competitor's price becomes the sell price — it's
  // the market rate — and the supplier's own cost is left blank because only the supplier
  // page knows it, and guessing would produce a margin built on nothing.

 return (
    <Dialog open={!!listing} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Find suppliers</DialogTitle>
          <DialogDescription className="line-clamp-2">{listing.title}</DialogDescription>
        </DialogHeader>

        {/* DERIVED, not a loading flag. A `loading` state initialised to false only flips
 true inside the deferred effect, so between opening the dialog and that state
 landing there was a frame with no spinner, no error and no data — a blank panel
 that reads as a broken feature. "Nothing has arrived yet" is exactly
            !data && !err, so ask that instead of tracking it. */}
        {!data && !err && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" /> Reading the product…
          </div>
        )}

        {err && (
          <div className="rounded-lg border border-hold/30 bg-hold/10 p-3 text-sm text-hold">{err}</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* The most valuable output is often "don't import this" — so it goes first, not
 buried under the queries it would contradict. */}
            {data.podBlank && (
              <div className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm">
                <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-hold" />
                <div>
                  <div className="font-medium">This is a blank you already stock</div>
                  <p className="mt-0.5 text-muted-foreground">
                    {data.note || "Buy it from SanMar, S&&S or Otto — domestic, no minimum, days not weeks."}
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What it is" value={data.productType} />
              <Field label="Likely material" value={data.material} />
            </div>

            {!!data.attributes?.length && (
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">Specs a supplier will list</div>
                <div className="flex flex-wrap gap-1.5">
                  {data.attributes.map((a) => (
                    <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-xs">{a}</span>
                  ))}
                </div>
              </div>
            )}

            <div>
              {/* Says what the CLICK does. "full width, and paginated" was the reason this
 hands off rather than searching here — a note about our own implementation,
 which is no use to the person reading it. The reasoning belongs in the
 comment below, where it already is. */}
              <div className="mb-1.5 text-xs text-muted-foreground">
                Suppliers who can make this
              </div>
              {/* THE PRODUCTS THEMSELVES, not more keywords.
                  This listed the AI's suggested queries and asked you to go and run one,
 then offered a box to paste a link back. Three steps to see a photograph.
                  Someone opening "Find suppliers" on a listing already knows what the thing
 is — what they don't have is a picture of who can make it. So the best
 query runs on arrival and the results land here. The queries still do the
 hard part (turning a marketing title into something a B2B marketplace
 understands); they just don't need to be read to be useful. */}
              {hits === null && !hitErr && (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <CircleNotch size={14} className="animate-spin" /> Finding suppliers…
                </div>
              )}
              {hitErr && (
                <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                  {/^.*(token is invalid|expired)/i.test(hitErr)
                    ? "Alibaba needs reconnecting — open Sourcing and click Reconnect, then try again."
 : `Couldn't reach Alibaba just now — ${hitErr}`}
                </p>
              )}
              {hits !== null && hits.length === 0 && !hitErr && (
                <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                  No supplier matches on any of the search angles we tried. Sourcing has the full search if you want to widen it.
                </p>
              )}
              {hits !== null && hits.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {hits.slice(0, 9).map((h) => {
 const id = String(h.id ?? h.url ?? "")
 const isSaved = savedIds.has(id)
 return (
                      <div key={id} className="flex flex-col overflow-hidden rounded-xl border border-border">
                        <a href={h.url || "#"} target="_blank" rel="noopener noreferrer"
 className="relative block aspect-square bg-muted">
                          {h.image
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={h.image} alt="" className="size-full object-cover" />
 : <span className="flex size-full items-center justify-center text-2xs text-muted-foreground">no image</span>}
                          {h.price && (
                            <span className="absolute bottom-1 left-1 rounded bg-foreground/80 px-1.5 py-0.5 text-2xs font-semibold text-background">
                              {h.price}
                            </span>
                          )}
                        </a>
                        <div className="flex flex-1 flex-col gap-1.5 p-2">
                          <p className="line-clamp-2 text-2xs leading-snug">{h.title}</p>
                          <Button size="sm" variant={isSaved ? "outline" : "default"}
 className="mt-auto h-7 w-full text-2xs"
 disabled={isSaved || savingId === id}
 onClick={() => saveHit(h)}>
                            {savingId === id ? <CircleNotch size={12} className="animate-spin" />
 : isSaved ? <Check size={12} weight="bold" /> : <Plus size={12} weight="bold" />}
                            {isSaved ? "Saved" : "Add"}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {/* Confirmation stays after the grid: adding from here sends the product to a
 page you are not looking at, so without a line saying so the button looks
 like it did nothing. */}
              {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
              {savedCount > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-shipped">
                  <Check size={13} weight="bold" />
                  {savedCount} saved — open Sourcing to compare and move them along.
                </p>
              )}
            </div>

            {data.cached && (
              <p className="text-xs text-muted-foreground">
                Read earlier and cached — looking at this product again costs nothing.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
 return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value || "—"}</div>
    </div>
  )
}
