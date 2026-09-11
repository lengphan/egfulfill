"use client"

import { useLabelT } from "@/lib/i18n"
import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/app/search-field"
import { Input } from "@/components/ui/input"
import { ProductThumb } from "@/components/app/product-thumb"
import { getSupplierStyles, setCatalogPicks, priceCatalogPicks, type SupplierStyle } from "@/lib/api"

const money = (n: number | string | null | undefined) =>
 n == null || n === "" ? "" : `$${(Number(n) || 0).toFixed(2)}`
const PAGE = 40

/**
 * Browse the synced supplier catalogue and publish styles straight into ours.
 *
 * Publishing here does NOT create a product. It writes three columns — supplier, style,
 * price — and everything shown comes from the already-synced ss_products. So publishing
 * 300 styles costs 300 tiny rows rather than 300 duplicated product records that go stale
 * the next time S&S re-syncs.
 *
 * Paged rather than scrolled: there are 825 styles behind this, and loading them to filter
 * in the browser would move the entire catalogue over the wire to save one round trip.
 */
export function SupplierStylesPicker({ onChanged, search }: {
  onChanged?: () => void
  /** The search term from the merged toolbar. When given, this component stops drawing its
   *  own field — one list gets one search box, and two that filter halves of the same grid
   *  is the shape that made these read as separate catalogues in the first place. */
  search?: string
}) {
  const tl = useLabelT()
 const [rows, setRows] = useState<SupplierStyle[] | null>(null)
 const [total, setTotal] = useState(0)
 const [ownQ, setOwnQ] = useState("")
 const controlled = search !== undefined
 const q = controlled ? search : ownQ
 const setQ = setOwnQ
 const [page, setPage] = useState(0)
 const [busy, setBusy] = useState(false)
 const [err, setErr] = useState<string | null>(null)
 const [note, setNote] = useState<string | null>(null)
 const [pct, setPct] = useState("60")
 const [draft, setDraft] = useState<Record<string, string>>({})

 const load = useCallback((term: string, offset: number) => {
 setBusy(true)
 getSupplierStyles({ q: term || undefined, limit: PAGE, offset })
      .then((r) => { setRows(r.styles ?? []); setTotal(r.total ?? 0); setErr(null) })
      .catch((e: Error) => { setErr(e.message); setRows([]) })
      .finally(() => setBusy(false))
  }, [])

  // `q` is handled by the debounced effect below; including it here would fire an extra
  // unpaged fetch on every keystroke. The directive has to be the line IMMEDIATELY before
  // the effect — with the second line of prose under it, it was landing on the comment and
  // suppressing nothing, which is why the rule still fired.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(() => { const t = setTimeout(() => load(q, page * PAGE), 0); return () => clearTimeout(t) }, [load, page])
  // Search resets to the first page — staying on page 6 of a new query shows a slice of
  // results nobody asked for and reads as "no matches".
 useEffect(() => {
 const t = setTimeout(() => { setPage(0); load(q, 0) }, 350)
 return () => clearTimeout(t)
  }, [q, load])

  /** Publish or unpublish ONE style, immediately. */
 const toggle = async (ref: string, include: boolean) => {
 setBusy(true); setErr(null); setNote(null)
 try {
 const r = await setCatalogPicks([ref], include)
 if (r.error) throw new Error(r.error)
 load(q, page * PAGE)
 onChanged?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

 const markup = async () => {
 const inCat = (rows ?? []).filter((x) => x.picked)
 if (!inCat.length) return
 const n = Number(pct)
 if (!isFinite(n) || n < 0) { setErr("Markup must be a number, and not negative."); return }
 setBusy(true); setErr(null); setNote(null)
 try {
 const r = await priceCatalogPicks({ refs: (rows ?? []).filter((x) => x.picked).map((x) => x.ref), markupPct: n })
 if (r.error) throw new Error(r.error)
      // Pricing publishes. Any style that didn't take a price had no cost recorded on it
      // — the only remaining reason, and the one worth naming.
 setNote(r.priced
        ? `${r.priced} in the catalogue at cost + ${n}%.${r.skippedNoCost ? ` ${r.skippedNoCost} skipped — no supplier cost recorded on those.` : ""}`
 : "None of those have a supplier cost recorded, so there was nothing to mark up. Type a price in instead.")
 load(q, page * PAGE)
 onChanged?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

 const savePrice = async (ref: string) => {
 const raw = draft[ref]
 if (raw === undefined) return
 const price = raw.trim() === "" ? null : Math.max(0, Number(raw))
 try {
 const r = await priceCatalogPicks({ ref, price })
 if (r.error) throw new Error(r.error)
 setDraft((d) => { const n = { ...d }; delete n[ref]; return n })
 load(q, page * PAGE)
    } catch (e) { setErr((e as Error).message) }
  }

 const pages = Math.max(1, Math.ceil(total / PAGE))

 return (
    /* NO PADDING OF ITS OWN when the parent drives it: it is mounted INSIDE the merged
       tab's padded column, so its own px-5 pushed this grid 20px in and 40px narrower than
       the one above it — cards 275px against 285px, on a different left edge. Two grids
       that ALMOST line up is what tells you they are two grids. Standalone it still needs
       the padding, so this switches rather than deletes. */
    <div className={controlled ? "space-y-3 pt-1" : "space-y-3 px-5 py-4"}>
      <div className="flex flex-wrap items-center gap-2">
        {!controlled && (
          <SearchField
            value={q}
            onChange={setQ}
            width="md"
            placeholder={tl("supplierStylesPicker", "Search style, brand or number…")}
          />
        )}
        <span className="text-xs text-muted-foreground">
          {/* Says what the number COUNTS. It used to read "5,690 styles synced" while the
              pager beside it was narrowed by a search, because the server's count ignored
              the term entirely (fixed in catalog.js). Now it moves with the search, so it
              has to name which of the two it is. */}
          {q
            ? `${total.toLocaleString()} ${total === 1 ? tl("supplierStylesPicker", "style matches") : tl("supplierStylesPicker", "styles match")}`
            : `${total.toLocaleString()} ${tl("supplierStylesPicker", "styles synced")}`}
        </span>
        {busy && <CircleNotch size={14} className="animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={page === 0 || busy} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <CaretLeft size={13} weight="bold" />
          </Button>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">{page + 1} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages || busy} onClick={() => setPage((p) => p + 1)}>
            <CaretRight size={13} weight="bold" />
          </Button>
        </div>
      </div>

      {rows && rows.some((r) => r.picked) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          {/* Setting a price IS adding it to the catalogue — there is no separate publish
 step, because a style with a catalogue price and no place in the catalogue is
 a state nobody wants. "Remove" stays, since taking something out is a real
 decision with no price attached to it. */}
          <span className="text-xs text-muted-foreground">{tl("supplierStylesPicker", "Cost +")}</span>
          <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))}
 className="h-8 w-16 text-center text-xs tabular-nums" inputMode="decimal" aria-label={tl("supplierStylesPicker", "Markup percent")} />
          {/* Applies to the ticked styles ON THIS PAGE — which are, by definition, the
 ones in the catalogue. No second selection to keep in sync with the first. */}
          <Button size="sm" variant="outline" onClick={markup} disabled={busy}>
            Price these {rows.filter((r) => r.picked).length}
          </Button>
        </div>
      )}

      {note && <div className="rounded-lg border border-shipped/30 bg-shipped/12 px-3 py-2 text-xs text-shipped">{note}</div>}
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <CircleNotch size={16} className="animate-spin" /> {tl("supplierStylesPicker", "Loading the supplier catalogue…")}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {q ? `No style matches “${q}”.` : tl("supplierStylesPicker", "No supplier styles are synced yet — run Sync all styles on the Suppliers page.")}
        </p>
      ) : (
        /* THE SAME GRID AS OUR PRODUCTS, because they are the same catalogue. This was a
           table beside a card grid on another tab, and the split was the only thing saying
           these were two different things — they land in one PDF and one CSV. Four-up at
           xl, matching catalog-view exactly so a row of ours and a row of these line up.

           No badge on these: the "Ours" mark on the other cards is the whole signal, and
           marking both sides would make the grid look like two kinds of thing again. */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((st) => {
            const priceValue = draft[st.ref] ?? (st.catalogPrice == null ? "" : String(st.catalogPrice))
            return (
              <div
                key={st.ref}
                className={
                  "flex flex-col overflow-hidden rounded-xl border bg-card transition-colors " +
                  (st.picked ? "border-foreground ring-1 ring-foreground" : "border-border")
                }
              >
                <div className="relative">
                  <ProductThumb src={st.image} alt={st.name || st.ref} className="!h-auto !w-full aspect-[8/9] rounded-none border-0 p-3" />
                  {/* THE TICK IS THE DECISION — it publishes on the spot and unticking
                      removes. It marked a row for a bulk action you then had to press, so
                      ticking a style and hitting "Create lookbook" produced a catalogue
                      without it: the box looked like the answer and was only the question. */}
                  <input
                    type="checkbox"
                    checked={st.picked}
                    disabled={busy}
                    aria-label={`${st.picked ? tl("supplierStylesPicker", "Remove") : tl("supplierStylesPicker", "Add")} ${st.name || st.ref} ${st.picked ? tl("supplierStylesPicker", "from the catalogue") : tl("supplierStylesPicker", "to the catalogue")}`}
                    onChange={(e) => void toggle(st.ref, e.target.checked)}
                    className="absolute left-2.5 top-2.5 size-5 cursor-pointer accent-foreground"
                  />
                </div>

                <div className="min-w-0 px-3 pt-2.5">
                  <div className="truncate text-sm font-medium" title={st.name || st.ref}>{st.name || st.ref}</div>
                  <div className="mt-0.5 truncate text-2xs text-muted-foreground">
                    <span className="tabular-nums">{st.ref}</span>
                    {st.brand && <> · {st.brand}</>}
                    {/* Counts, not the full lists — a 40-colour style would otherwise own
                        the card. The detail belongs on the printed catalogue. */}
                    {(st.colors.length > 0 || st.sizes.length > 0) && (
                      <> · {st.colors.length} {st.colors.length === 1 ? tl("supplierStylesPicker", "colour") : tl("supplierStylesPicker", "colours")} · {st.sizes.length} {st.sizes.length === 1 ? tl("supplierStylesPicker", "size") : tl("supplierStylesPicker", "sizes")}</>
                    )}
                  </div>
                </div>

                {/* mt-auto so every card in a row ends on the same line however long its
                    name wrapped — the same rule our own cards follow. */}
                <div className="mt-auto border-t border-border">
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">{tl("supplierStylesPicker", "Catalogue")}</span>
                    <Input
                      value={priceValue}
                      onChange={(e) => setDraft((d) => ({ ...d, [st.ref]: e.target.value.replace(/[^\d.]/g, "") }))}
                      onBlur={() => savePrice(st.ref)}
                      onKeyDown={(e) => { if (e.key === "Enter") savePrice(st.ref) }}
                      placeholder="0.00"
                      inputMode="decimal"
                      aria-label={`${tl("supplierStylesPicker", "Catalogue price for")} ${st.name || st.ref}`}
                      className="ml-auto h-7 w-20 px-2 text-right text-sm tabular-nums"
                    />
                  </div>
                  {/* Our cost, staff-only — this route is requireStaff and never reaches a
                      seller. It sits under the price because the markup is judged against
                      it: a percentage means nothing without the number it applies to. */}
                  <div className="border-t border-border px-2.5 py-1.5">
                    <span className="block truncate text-2xs uppercase tracking-wide text-muted-foreground">{tl("supplierStylesPicker", "Costs us")}</span>
                    <span className="block text-sm tabular-nums text-muted-foreground">{money(st.maxCost) || "—"}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
