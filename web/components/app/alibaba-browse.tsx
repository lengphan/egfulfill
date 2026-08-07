"use client"

import { useCallback, useEffect, useState } from "react"
import { MagnifyingGlass, CircleNotch, Plus, Check, ArrowSquareOut, ChatCircleDots } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/app/section-card"
import { getAlibabaConfig, searchAlibaba, saveSourcing, type AlibabaProduct } from "@/lib/api"
import { getUser } from "@/lib/auth"

/**
 * Browse Alibaba as a grid, and turn anything into a Prospect.
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
export function AlibabaBrowse() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<AlibabaProduct[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const isAdmin = getUser()?.role === "admin"

  const load = useCallback(() => {
    if (!isAdmin) return
    getAlibabaConfig()
      .then((c) => setConnected(!!(c.configured && c.connected)))
      .catch(() => setConnected(false))
  }, [isAdmin])
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const run = async () => {
    const keyword = q.trim()
    if (!keyword) return
    setBusy(true); setErr(null)
    try {
      const r = await searchAlibaba({ keyword, pageSize: 24 })
      if (r.error) throw new Error(r.error)
      setRows(r.products ?? [])
    } catch (e) {
      // Verbatim: Alibaba names the failing field or the missing entitlement, and
      // "search failed" throws away the only part that says what to do about it.
      setErr(e instanceof Error ? e.message : "Search failed.")
      setRows(null)
    } finally { setBusy(false) }
  }

  const addProspect = async (p: AlibabaProduct) => {
    const id = String(p.id ?? p.url ?? "")
    if (!id || saved.has(id)) return
    setSavingId(id); setErr(null)
    try {
      await saveSourcing({
        title: (p.title || "Alibaba product").slice(0, 120),
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
          <p className="text-xs text-muted-foreground">
            Search Alibaba and keep what&apos;s worth quoting. Prices are per-unit ranges by quantity band.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run() }}
              placeholder="e.g. blank cotton tote bag" className="h-9 pl-8"
            />
          </div>
          <Button size="sm" onClick={run} disabled={busy || !q.trim()}>
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((p) => {
              const id = String(p.id ?? p.url ?? "")
              const isSaved = saved.has(id)
              return (
                <div key={id} className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
                  <div className="relative aspect-square overflow-hidden bg-muted/40">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-muted-foreground">no photo</div>
                    )}
                    {p.price && (
                      <span className="absolute bottom-2 left-2 rounded-lg bg-black/70 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                        {p.price}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <p className="line-clamp-2 text-xs leading-snug">{p.title}</p>
                    <div className="mt-auto flex items-center gap-1.5">
                      <Button
                        size="sm" variant={isSaved ? "outline" : "default"} className="h-7 flex-1 text-2xs"
                        onClick={() => addProspect(p)} disabled={isSaved || savingId === id}
                      >
                        {savingId === id ? <CircleNotch size={12} className="animate-spin" />
                          : isSaved ? <Check size={12} weight="bold" /> : <Plus size={12} weight="bold" />}
                        {isSaved ? "Prospect" : "Add"}
                      </Button>
                      {p.url && (
                        <>
                          {/* CONTACT is a link, not a chat. Alibaba's messaging is
                              TradeManager/Messenger — a first-party product with no buyer
                              messaging API in the ISV set — so the honest version sends you
                              to the product page where Contact Supplier lives, rather than
                              a chat box in here that could never send anything. */}
                          <a href={p.url} target="_blank" rel="noopener noreferrer"
                             title="Open on Alibaba to message the supplier"
                             className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
                            <ChatCircleDots size={13} weight="bold" />
                          </a>
                          <a href={p.url} target="_blank" rel="noopener noreferrer"
                             title="Open on Alibaba"
                             className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
                            <ArrowSquareOut size={13} weight="bold" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
