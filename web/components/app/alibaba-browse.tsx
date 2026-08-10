"use client"

import { useCallback, useEffect, useState } from "react"
import { MagnifyingGlass, CircleNotch, Plus, Check } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/app/section-card"
import { getAlibabaConfig, searchAlibaba, saveSourcing, type AlibabaProduct } from "@/lib/api"
import { getUser } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { CARD_ACTION_PRIMARY, CARD_ACTION_SECONDARY } from "@/lib/card-actions"

/**
 * Browse Alibaba as a grid, and turn anything into a Saved source.
 *
 * MODELLED ON THE SPYDECK CARD deliberately: same square photo, same price chip in the
 * corner, same hover. Product research and supplier research are the same motion — look at
 * a wall of things, keep the ones worth keeping — so making them look alike means the
 * second one needs no learning.
 *
 * NO PER-CARD STATS, and that is not a shortcut. SpyDeck's estimates come from Etsy data we
 * can model; this endpoint returns title, photo, price and a link and NOTHING else — no MOQ,
 * no supplier name, no order volume. Inventing a "score" from four fields would be the
 * dishonest version of the SpyDeck card rather than the equivalent of it.
 */
/** Starting points, not a ranking. Broad enough that each returns a full grid, and skewed
 *  to what this factory actually decorates. */
const SEEDS = [
  "blank t-shirt cotton", "canvas tote bag", "ceramic mug", "embroidered cap",
  "hoodie fleece blank", "apron canvas", "pet accessories", "phone case blank",
]

/**
 * Alibaba returns titles with the quotes escaped — `28\" Modern Cat Tree` — and React
 * renders the backslash literally, so the grid showed `28\" Modern…`. Unescape rather than
 * strip: the inch mark is part of the product name and dropping it changes the size.
 */
const cleanTitle = (t?: string | null) =>
  String(t || "").replace(/\\(["'\\])/g, "$1").trim()

export function AlibabaBrowse({ onConnectedChange, initialQuery, onSaved }: {
  onConnectedChange?: (v: boolean) => void
  /** Handed in from a SpyDeck query, so the search is already running when you arrive. */
  initialQuery?: string
  /** Fired after a prospect is saved, so the other tab's list is current the moment you
   *  switch to it — otherwise you add three things and find an empty table. */
  onSaved?: () => void
} = {}) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [q, setQ] = useState(initialQuery ?? "")
  // Alibaba pages server-side (param0.index), so this is a real page cursor, not a slice of
  // one fetched list — 24 at a time, and "Next" costs one call.
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AlibabaProduct[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const isAdmin = getUser()?.role === "admin"

  const load = useCallback(() => {
    if (!isAdmin) return
    getAlibabaConfig()
      .then((c) => { const ok = !!(c.configured && c.connected); setConnected(ok); onConnectedChange?.(ok) })
      .catch(() => { setConnected(false); onConnectedChange?.(false) })
  }, [isAdmin, onConnectedChange])
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const run = useCallback(async (keyword: string, p = 1) => {
    if (!keyword.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await searchAlibaba({ keyword: keyword.trim(), page: p, pageSize: 24 })
      if (r.error) throw new Error(r.error)
      setRows(r.products ?? [])
      setPage(p)
    } catch (e) {
      // Verbatim: Alibaba names the failing field or the missing entitlement, and
      // "search failed" throws away the only part that says what to do about it.
      setErr(e instanceof Error ? e.message : "Search failed.")
      setRows(null)
    } finally { setBusy(false) }
  }, [])

  // A keyword handed in from SpyDeck searches itself on arrival — the point of the handoff
  // is not having to retype what you just clicked.
  useEffect(() => {
    if (!initialQuery || connected !== true) return
    const t = setTimeout(() => run(initialQuery, 1), 0)
    return () => clearTimeout(t)
  }, [initialQuery, connected, run])

  /**
   * SOMETHING TO LOOK AT BEFORE ANYONE TYPES.
   *
   * An empty grid behind a search box asks you to already know what you want, which is the
   * opposite of what sourcing is for. So one seed category runs on arrival.
   *
   * It is NOT called trending, and it shows no counts or rankings — we have no sales data
   * from Alibaba, and a "popular" badge over an arbitrary keyword search would be a
   * fabricated stat. It is a starting point, and it says so.
   *
   * The seed rotates by day-of-year so the page isn't the same wall every morning, while
   * staying stable within a day — a grid that reshuffles on every visit makes it impossible
   * to go back to something you just saw.
   */
  useEffect(() => {
    if (initialQuery || connected !== true) return
    const seed = SEEDS[Math.floor(Date.now() / 864e5) % SEEDS.length]
    const t = setTimeout(() => run(seed, 1), 0)
    return () => clearTimeout(t)
  }, [initialQuery, connected, run])

  const addProspect = async (p: AlibabaProduct) => {
    const id = String(p.id ?? p.url ?? "")
    if (!id || saved.has(id)) return
    setSavingId(id); setErr(null)
    try {
      await saveSourcing({
        title: (cleanTitle(p.title) || "Alibaba product").slice(0, 120),
        url: p.url || "",
        image: p.image || null,
        // Alibaba quotes a RANGE ("$0.88-1.05") because it prices by quantity band. There is
        // no single number to store, so cost stays null rather than guessing an end of it —
        // a landed-cost calculation built on a guessed unit price is worse than one that
        // plainly has no unit price yet.
        cost: null,
        sellPrice: null,
        moq: 1,
        stage: "prospect",
      })
      setSaved((s) => new Set(s).add(id))
      onSaved?.()   // the prospect table is on the other tab; refresh it now, not on next mount
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that as a prospect.")
    } finally { setSavingId(null) }
  }

  if (!isAdmin || connected === false || connected === null) return null

  return (
    <SectionCard>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Find suppliers</h2>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(q, 1) }}
              placeholder="e.g. blank cotton tote bag" className="h-9 pl-8"
            />
          </div>
          <Button size="sm" onClick={() => run(q, 1)} disabled={busy || !q.trim()}>
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <MagnifyingGlass size={14} weight="bold" />} Search
          </Button>
        </div>

        {err && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{err}</div>
        )}

        {rows !== null && rows.length === 0 && !err && (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing matched “{q}”.</p>
        )}

        {rows !== null && rows.length > 0 && (
          <>
          {/* Say WHOSE search this is. A grid the reader didn't ask for, with no label,
              reads as a result they somehow triggered. "Starting points" is also the
              honest word: we have no sales data from Alibaba, so it is not trending and
              carries no counts — it is a seeded category, and the reader can tell. */}
          {!q.trim() && (
            <p className="mb-3 text-xs text-muted-foreground">
              Starting points while you decide what to look for — search above for anything specific.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((p) => {
              const id = String(p.id ?? p.url ?? "")
              const isSaved = saved.has(id)
              return (
                <div key={id} className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
                  {/* The photo goes to the product, because that is what a photo in a
                      results grid is for — every other shopping surface behaves this way,
                      and clicking one here did nothing at all. Same destination as
                      Contact below; the anchor wraps only the image so the price chip
                      stays a label rather than becoming part of the hit target.
                      Without a url there is nowhere to go, so it stays a plain div rather
                      than a link that looks clickable and isn't. */}
                  <div className="relative aspect-square overflow-hidden bg-muted/40">
                    {(() => {
                      const art = p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-xs text-muted-foreground">no photo</div>
                      )
                      return p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                           title="Open this product on Alibaba"
                           className="block size-full cursor-pointer">
                          {art}
                        </a>
                      ) : art
                    })()}
                    {p.price && (
                      <span className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-black/70 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                        {p.price}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <p className="line-clamp-2 text-xs leading-snug">{cleanTitle(p.title)}</p>
                    <div className="mt-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        className={cn(isSaved ? CARD_ACTION_SECONDARY : CARD_ACTION_PRIMARY, "flex-1")}
                        onClick={() => addProspect(p)} disabled={isSaved || savingId === id}
                      >
                        {savingId === id ? <CircleNotch size={12} className="animate-spin" />
                          : isSaved ? <Check size={12} weight="bold" /> : <Plus size={12} weight="bold" />}
                        {/* "Saved", matching the stage this lands the row at. It said
                            "Prospect" — the old first-stage label — so renaming the stage
                            without renaming this would leave the button naming something
                            that no longer appears anywhere in Sourcing. */}
                        {isSaved ? "Saved" : "Add"}
                      </button>
                      {p.url && (
                        /* ONE button, and it says what it does. There were two — a speech
                           bubble and an external-link arrow — pointing at the same URL, so
                           the bubble read as an in-app chat and opened a product page.
                           There is no chat to open: Alibaba's messaging is TradeManager /
                           Messenger, a first-party product with no buyer-messaging API in
                           the ISV set, and this endpoint returns no supplier or company id,
                           so even a deep link into their messenger cannot be constructed.
                           The product page is where Contact Supplier lives. */
                        /* No icons, and the SAME box as Add, so the pair reads as two equal
                           choices rather than a button beside a decorated link. It said that
                           and wasn't: hand-rolled as rounded-MD next to a Button that is
                           rounded-full, which is a pill sitting beside a rectangle. Now the
                           shared definition, so it can't drift again.
                           The speech bubble was actively misleading: it suggested an in-app
                           chat, and this only opens a product page. */
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                           title="Opens the product on Alibaba, where Contact Supplier is"
                           className={cn(CARD_ACTION_SECONDARY, "flex-1")}>
                          Contact
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {/* No total count comes back from the search, so this can't say "page 2 of 9".
              Next is offered while a full page came back — a short page is the last one. */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-2xs text-muted-foreground">Page {page} · {rows.length} results</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={busy || page <= 1} onClick={() => run(q, page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={busy || rows.length < 24} onClick={() => run(q, page + 1)}>Next</Button>
            </div>
          </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}
