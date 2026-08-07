"use client"

import { useEffect, useState } from "react"
import { CircleNotch, ArrowSquareOut, Warning, Plus, Check, MagnifyingGlass } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getAlibabaConfig, searchAlibaba, type AlibabaProduct } from "@/lib/api"
import { suggestSuppliers, saveSourcing, fetchSourcingPrice, type EtsyListing } from "@/lib/api"

/**
 * "Find suppliers" — the bridge from a SpyDeck listing to the sourcing pipeline.
 *
 * WHAT THIS CAN AND CANNOT DO, because the difference drives the whole layout:
 * Alibaba's robots.txt disallows /trade/ (the search-results path), so we cannot fetch a
 * ranked supplier list server-side and render it here. What we CAN do is the part that's
 * actually hard — turning a marketing title into queries a B2B marketplace understands —
 * and then hand you a one-click search plus somewhere to bring the result back.
 *
 * So the flow is: read the product -> click a query -> pick a supplier on Alibaba -> paste
 * its link here -> it lands in Sourcing as a Prospect with the name, image and price read
 * off the page. Presenting a fake in-app supplier list would be the dishonest version.
 */

const ALIBABA_SEARCH = "https://www.alibaba.com/trade/search?SearchText="

type Suggestion = Awaited<ReturnType<typeof suggestSuppliers>>

export function SourcingSuggestDialog({ listing, onClose, onSaved }: {
  listing: EtsyListing | null
  onClose: () => void
  onSaved?: (label: string) => void
}) {
  const [data, setData] = useState<Suggestion | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [url, setUrl] = useState("")
  // Whether the buyer API is usable. Null while unknown, so the dialog shows the old
  // new-tab links rather than briefly promising an in-page search it can't do.
  const [apiOn, setApiOn] = useState(false)
  const [hits, setHits] = useState<AlibabaProduct[] | null>(null)
  const [busyQ, setBusyQ] = useState<string | null>(null)
  const [searchErr, setSearchErr] = useState<string | null>(null)

  // Ask once whether the buyer API is connected. Admin-only server-side, so a non-admin
  // simply keeps the new-tab links — which still work, and are what everyone had before.
  useEffect(() => {
    if (!listing) return
    const t = setTimeout(() => {
      getAlibabaConfig().then((c) => setApiOn(!!(c.configured && c.connected))).catch(() => setApiOn(false))
    }, 0)
    return () => clearTimeout(t)
  }, [listing])

  const runSearch = async (keyword: string) => {
    setBusyQ(keyword); setSearchErr(null)
    try {
      const r = await searchAlibaba({ keyword, pageSize: 12 })
      if (r.error) throw new Error(r.error)
      setHits(r.products ?? [])
    } catch (e) {
      // Verbatim. Alibaba's messages name the failing field or the missing entitlement,
      // and "search failed" throws away the only thing that says what to fix.
      setSearchErr(e instanceof Error ? e.message : "Search failed.")
      setHits(null)
    } finally { setBusyQ(null) }
  }
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  // Reset per listing rather than on close, so reopening a different product never shows the
  // previous one's answer for a frame.
  useEffect(() => {
    if (!listing) return
    const t = setTimeout(() => {
      setData(null); setErr(null); setUrl(""); setSavedCount(0); setNote(null)
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

  const sell = listing.price_usd ?? listing.price ?? null

  // Save a supplier link as a Prospect. The competitor's price becomes the sell price — it's
  // the market rate — and the supplier's own cost is left blank because only the supplier
  // page knows it, and guessing would produce a margin built on nothing.
  const saveProspect = async () => {
    if (!url.trim()) return
    setSaving(true); setNote(null)
    try {
      const read = await fetchSourcingPrice(url.trim()).catch(() => null)
      const r = await saveSourcing({
        title: (data?.productType || listing.title).slice(0, 120),
        url: url.trim(),
        image: read?.image || listing.thumb || listing.image || null,
        cost: read?.price ?? null,
        sellPrice: sell,
        moq: 1,
        stage: "prospect",
        productId: String(listing.listing_id),
        note: `From SpyDeck — ${listing.title.slice(0, 80)}`,
      })
      if (r.error) throw new Error(r.error)
      setSavedCount((n) => n + 1)
      setUrl("")
      setNote(read?.price != null
        ? `Saved as a Prospect, with $${read.price} read off the page.`
        : "Saved as a Prospect. Add the unit price in Sourcing to see profit.")
      onSaved?.(data?.productType || listing.title)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save that link.")
    } finally { setSaving(false) }
  }

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
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{err}</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* The most valuable output is often "don't import this" — so it goes first, not
                buried under the queries it would contradict. */}
            {data.podBlank && (
              <div className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm">
                <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
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
              <div className="mb-1.5 text-xs text-muted-foreground">
                {apiOn
                  ? "Search Alibaba — results appear here"
                  : "Search Alibaba — opens in a new tab, where you're already signed in"}
              </div>
              <div className="space-y-1.5">
                {(data.queries ?? []).map((qy) => (
                  apiOn ? (
                    // CONNECTED: the query runs here. The constraint that forced a new tab
                    // was that Alibaba's robots.txt disallows /trade/, so the results page
                    // can't be fetched — the buyer API is a different door and that
                    // constraint doesn't apply to it.
                    <button key={qy} onClick={() => runSearch(qy)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent">
                      <span className="flex-1">{qy}</span>
                      {busyQ === qy
                        ? <CircleNotch size={14} className="shrink-0 animate-spin text-muted-foreground" />
                        : <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />}
                    </button>
                  ) : (
                    <a key={qy} href={ALIBABA_SEARCH + encodeURIComponent(qy)} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-primary/50 hover:bg-accent">
                      <span className="flex-1">{qy}</span>
                      <ArrowSquareOut size={14} className="shrink-0 text-muted-foreground" />
                    </a>
                  )
                ))}
              </div>

              {/* Results, when the API answered. Clicking one fills the paste box below
                  rather than saving directly — the box is where the seller confirms what
                  they picked, and skipping it would make a single mis-click a saved row. */}
              {hits !== null && (
                <div className="mt-2 space-y-1">
                  {hits.length === 0 && <p className="text-xs text-muted-foreground">Nothing came back for that one.</p>}
                  {hits.map((h) => (
                    <button key={h.id ?? h.url ?? h.title} onClick={() => { if (h.url) setUrl(h.url) }}
                      className="flex w-full items-center gap-2 rounded-lg border border-border p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent">
                      {h.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={h.image} alt="" className="size-10 shrink-0 rounded border border-border object-cover" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs">{h.title}</span>
                        {/* A RANGE, not a number — Alibaba prices by quantity band. */}
                        {h.price && <span className="block text-2xs text-muted-foreground">{h.price}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {searchErr && (
                <p className="mt-2 text-xs text-amber-700">{searchErr}</p>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-medium">Found one? Paste its link</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                It lands in Sourcing as a <strong>Prospect</strong>. Save a few and compare them there
                before you message anyone.
              </p>
              <div className="mt-2 flex gap-2">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9"
                       placeholder="https://www.alibaba.com/product-detail/…"
                       onKeyDown={(e) => { if (e.key === "Enter") saveProspect() }} />
                <Button size="sm" onClick={saveProspect} disabled={!url.trim() || saving}>
                  {saving ? <CircleNotch size={14} className="animate-spin" /> : <Plus size={14} weight="bold" />}
                  Save as Prospect
                </Button>
              </div>
              {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
              {savedCount > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
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
