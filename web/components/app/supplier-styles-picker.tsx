"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, MagnifyingGlass, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
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
export function SupplierStylesPicker({ onChanged }: { onChanged?: () => void }) {
 const [rows, setRows] = useState<SupplierStyle[] | null>(null)
 const [total, setTotal] = useState(0)
 const [q, setQ] = useState("")
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

  // eslint-disable-next-line react-hooks/exhaustive-deps -- q is handled by the debounced
  // effect below; including it here would fire an extra unpaged fetch on every keystroke.
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
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search style, brand or number…" className="h-9 w-72 pl-8" />
        </div>
        <span className="text-xs text-muted-foreground">
          {total.toLocaleString()} styles synced
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
          <span className="text-xs text-muted-foreground">Cost +</span>
          <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))}
 className="h-8 w-16 text-center text-xs tabular-nums" inputMode="decimal" aria-label="Markup percent" />
          {/* Applies to the ticked styles ON THIS PAGE — which are, by definition, the
 ones in the catalogue. No second selection to keep in sync with the first. */}
          <Button size="sm" variant="outline" onClick={markup} disabled={busy}>
            Price these {rows.filter((r) => r.picked).length}
          </Button>
        </div>
      )}

      {note && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{note}</div>}
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-xs text-hold">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <CircleNotch size={16} className="animate-spin" /> Loading the supplier catalogue…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {q ? `No style matches “${q}”.` : "No supplier styles are synced yet — run Sync all styles on the Suppliers page."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left eg-label text-muted-foreground">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2">Style</th>
                <th className="px-2 py-2">Catalogue price</th>
                {/* Our cost, staff-only. It sits here because the markup is judged against
 it — a percentage means nothing without the number it applies to. */}
                <th className="px-2 py-2">Costs us</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((st) => {
 return (
                  <tr key={st.ref} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2">
                      {/* THE TICK IS THE DECISION. It used to only mark a row for a bulk
 action you then had to press, so ticking a style and hitting
                          "Create lookbook" produced a catalogue without it — the box looked
 like the answer and was only the question. Now it publishes on the
 spot, and unticking removes. Reversible, so an accidental click
 costs one more click. */}
                      <input
 type="checkbox"
 checked={st.picked}
 disabled={busy}
 aria-label={`${st.picked ? "Remove" : "Add"} ${st.name || st.ref} ${st.picked ? "from" : "to"} the catalogue`}
 onChange={(e) => void toggle(st.ref, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-start gap-3">
                        <ProductThumb src={st.image} alt={st.name || st.ref} />
                        <div className="min-w-0">
                          <div className="max-w-[22rem] truncate font-medium">{st.name || st.ref}</div>
                          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                            <span className="tabular-nums">{st.ref}</span>
                            {st.brand && <span>{st.brand}</span>}
                            {/* No "published" pill — the tick at the head of this row already
 says it, and this tab sits beside Our products, which no longer
 carries one either. */}
                          </div>
                          {/* Counts, not the full lists. A 40-colour style would otherwise
 own the row; the detail belongs on the printed catalogue. */}
                          <div className="mt-0.5 text-2xs text-muted-foreground">
                            {st.colors.length} colour{st.colors.length === 1 ? "" : "s"} · {st.sizes.length} size{st.sizes.length === 1 ? "" : "s"}
                            {st.sizes.length > 0 && <> · {st.sizes.slice(0, 8).join(" ")}{st.sizes.length > 8 ? "…" : ""}</>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Input
 value={draft[st.ref] ?? (st.catalogPrice == null ? "" : String(st.catalogPrice))}
 onChange={(e) => setDraft((d) => ({ ...d, [st.ref]: e.target.value.replace(/[^\d.]/g, "") }))}
 onBlur={() => savePrice(st.ref)}
 onKeyDown={(e) => { if (e.key === "Enter") savePrice(st.ref) }}
 placeholder="set price"
 inputMode="decimal"
 aria-label={`Catalogue price for ${st.name || st.ref}`}
 className="h-8 w-24 text-right text-xs tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{money(st.maxCost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
