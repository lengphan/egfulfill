"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleNotch, Warning, MagnifyingGlass, Percent, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
export function SupplierStylesPicker() {
  const [rows, setRows] = useState<SupplierStyle[] | null>(null)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
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

  useEffect(() => { const t = setTimeout(() => load(q, page * PAGE), 0); return () => clearTimeout(t) }, [load, page])
  // Search resets to the first page — staying on page 6 of a new query shows a slice of
  // results nobody asked for and reads as "no matches".
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); load(q, 0) }, 350)
    return () => clearTimeout(t)
  }, [q, load])

  const chosen = [...picked]

  const publish = async (include: boolean) => {
    if (!chosen.length) return
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await setCatalogPicks(chosen, include)
      if (r.error) throw new Error(r.error)
      setNote(include
        ? `${r.added ?? 0} published${r.already ? ` · ${r.already} were already in` : ""}.`
        : `${r.removed ?? 0} removed.`)
      setPicked(new Set())
      load(q, page * PAGE)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const markup = async () => {
    if (!chosen.length) return
    const n = Number(pct)
    if (!isFinite(n) || n < 0) { setErr("Markup must be a number, and not negative."); return }
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await priceCatalogPicks({ refs: chosen, markupPct: n })
      if (r.error) throw new Error(r.error)
      // Only PUBLISHED styles can be priced — the price lives on the pick row. Saying so
      // beats "priced 0", which reads as a failure when it's a missing first step.
      setNote(r.priced
        ? `Priced ${r.priced} at cost + ${n}%.${r.skippedNoCost ? ` ${r.skippedNoCost} skipped — publish them first, or they have no cost recorded.` : ""}`
        : "Nothing was priced. A style has to be published before it can carry a price.")
      load(q, page * PAGE)
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
          {total.toLocaleString()} styles synced{chosen.length ? ` · ${chosen.length} selected` : ""}
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

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <Button size="sm" onClick={() => publish(true)} disabled={busy}>Publish {chosen.length}</Button>
          <Button size="sm" variant="outline" onClick={() => publish(false)} disabled={busy}>Remove</Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <span className="text-xs text-muted-foreground">Cost +</span>
          <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))}
            className="h-8 w-16 text-center text-xs tabular-nums" inputMode="decimal" aria-label="Markup percent" />
          <Button size="sm" variant="outline" onClick={markup} disabled={busy}>
            <Percent size={14} weight="bold" /> Apply
          </Button>
        </div>
      )}

      {note && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{note}</div>}
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 font-medium">Style</th>
                <th className="px-2 py-2 font-medium">Catalogue price</th>
                {/* Our cost, staff-only. It sits here because the markup is judged against
                    it — a percentage means nothing without the number it applies to. */}
                <th className="px-2 py-2 font-medium">Costs us</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((st) => {
                const on = picked.has(st.ref)
                return (
                  <tr key={st.ref} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={on} aria-label={`Select ${st.name || st.ref}`}
                        onChange={(e) => setPicked((s) => {
                          const n = new Set(s); if (e.target.checked) n.add(st.ref); else n.delete(st.ref); return n
                        })} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-start gap-3">
                        <div className="size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                          {st.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={st.image} alt="" className="size-full object-contain" />
                          ) : (
                            <div className="flex size-full items-center justify-center text-[9px] text-muted-foreground">no image</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="max-w-[22rem] truncate font-medium">{st.name || st.ref}</div>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="font-mono">{st.ref}</span>
                            {st.brand && <span>{st.brand}</span>}
                            {st.picked && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">published</span>}
                          </div>
                          {/* Counts, not the full lists. A 40-colour style would otherwise
                              own the row; the detail belongs on the printed catalogue. */}
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
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
                        placeholder={st.picked ? "not set" : "publish first"}
                        disabled={!st.picked}
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
