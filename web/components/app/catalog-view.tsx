"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleNotch, Warning, DownloadSimple, MagnifyingGlass, Percent } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/app/section-card"
import {
  getCatalogProducts, setCatalogSelection, setCatalogPrice, applyCatalogMarkup,
  catalogExportUrl, type CatalogProduct,
} from "@/lib/api"

const money = (n: number | string | null | undefined) =>
  n == null || n === "" ? "—" : `$${(Number(n) || 0).toFixed(2)}`

/**
 * Curate the published catalogue: what appears, what it costs, and the download.
 *
 * TWO PRICES, KEPT APART ON SCREEN because they are kept apart in the database. The
 * catalogue price is what a buyer is shown; the seller price is what an order charges.
 * They are shown side by side and labelled, because the whole risk in this feature is
 * someone editing one believing it is the other — this window is where that mistake would
 * be made, so it is the place to make it impossible.
 *
 * Nothing here can change what a seller is billed. The only writable field is the
 * catalogue price, and the markup writes to the same column.
 */
export function CatalogView() {
  const [rows, setRows] = useState<CatalogProduct[] | null>(null)
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pct, setPct] = useState("60")
  const [draft, setDraft] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    getCatalogProducts()
      .then((r) => setRows(r ?? []))
      .catch((e: Error) => { setErr(e.message); setRows([]) })
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const idOf = (p: CatalogProduct) => String(p.id ?? "")
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = rows ?? []
    if (!term) return list
    return list.filter((p) => [p.name, p.sku, p.id].some((f) => String(f ?? "").toLowerCase().includes(term)))
  }, [rows, q])

  const published = (rows ?? []).filter((p) => p.inCatalog).length
  const chosen = [...picked]

  const publish = async (include: boolean) => {
    if (!chosen.length) return
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await setCatalogSelection(chosen, include)
      if (r.error) throw new Error(r.error)
      setNote(`${r.updated ?? 0} ${include ? "published" : "removed from the catalogue"}.`)
      load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const markup = async () => {
    if (!chosen.length) return
    const n = Number(pct)
    if (!isFinite(n) || n < 0) { setErr("Markup must be a number, and not negative."); return }
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await applyCatalogMarkup(chosen, n)
      if (r.error) throw new Error(r.error)
      // Names the products it COULDN'T price. A silent partial run here means a buyer sees
      // a blank where a price should be, and nobody knows which ones until they look.
      const skipped = r.skippedNoCost?.length ?? 0
      setNote(skipped
        ? `Priced ${r.priced ?? 0}. ${skipped} skipped — no supplier cost on record, so there was nothing to mark up: ${r.skippedNoCost!.slice(0, 4).join(", ")}${skipped > 4 ? "…" : ""}`
        : `Priced ${r.priced ?? 0} at cost + ${n}%.`)
      load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const savePrice = async (id: string) => {
    const raw = draft[id]
    if (raw === undefined) return
    const price = raw.trim() === "" ? null : Math.max(0, Number(raw))
    if (price !== null && !isFinite(price)) { setErr("That price isn't a number."); return }
    try {
      const r = await setCatalogPrice({ id, price })
      if (r.error) throw new Error(r.error)
      setDraft((d) => { const n = { ...d }; delete n[id]; return n })
      load()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <SectionCard
      title="Published catalogue"
      description="What appears in the shop window, and what it costs there. Nothing on this page changes what a seller is billed."
      actions={
        <a href={catalogExportUrl()} download>
          <Button size="sm" variant="outline" disabled={!published}
            title={published ? "Download the published catalogue as CSV" : "Publish something first — the file would be empty"}>
            <DownloadSimple size={14} weight="bold" /> Download CSV
          </Button>
        </a>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU…" className="h-9 w-64 pl-8" />
          </div>
          <span className="text-xs text-muted-foreground">{published} published · {chosen.length} selected</span>
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
              {busy ? <CircleNotch size={14} className="animate-spin" /> : <><Percent size={14} weight="bold" /> Apply</>}
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
            <CircleNotch size={16} className="animate-spin" /> Loading products…
          </div>
        ) : shown.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {q ? `Nothing matches “${q}”.` : "No products in the catalogue yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium">Catalogue price</th>
                  {/* Labelled as what it is, and not editable here. The two prices sitting
                      side by side is the point — it's how someone sees they are different
                      things rather than discovering it later. */}
                  <th className="px-2 py-2 font-medium">Seller pays</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const id = idOf(p)
                  const on = picked.has(id)
                  return (
                    <tr key={id} className={"border-b border-border/60 last:border-0 " + (p.inCatalog ? "" : "opacity-60")}>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={on} aria-label={`Select ${p.name || id}`}
                          onChange={(e) => setPicked((s) => {
                            const n = new Set(s); if (e.target.checked) n.add(id); else n.delete(id); return n
                          })} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="max-w-[22rem] truncate font-medium">{p.name || id}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="font-mono">{p.sku || id}</span>
                          {p.inCatalog && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">published</span>}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          value={draft[id] ?? (p.catalogPrice == null ? "" : String(p.catalogPrice))}
                          onChange={(e) => setDraft((d) => ({ ...d, [id]: e.target.value.replace(/[^\d.]/g, "") }))}
                          onBlur={() => savePrice(id)}
                          onKeyDown={(e) => { if (e.key === "Enter") savePrice(id) }}
                          placeholder="not set"
                          inputMode="decimal"
                          aria-label={`Catalogue price for ${p.name || id}`}
                          className="h-8 w-24 text-right text-xs tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">
                        {money(p.base_price ?? p.basePrice ?? p.price)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
