"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MagnifyingGlass, Package, CircleNotch, ArrowsClockwise, Plus, Check, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getSsStatus, getSsStyles, getSsStyle, ssSync, getCatalogProducts, saveCatalogProducts,
  type SsStyle, type CatalogProduct,
} from "@/lib/api"
import { getToken, getUser } from "@/lib/auth"

const PAGE = 60
const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

export function SuppliersView() {
  const isAdmin = getUser()?.role === "admin"
  const [status, setStatus] = useState<{ configured?: boolean; synced_count?: number; last_sync?: string | null } | null>(null)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [styles, setStyles] = useState<SsStyle[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [synced, setSynced] = useState<boolean | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const id = setTimeout(() => { if (getToken()) getSsStatus().then(setStatus).catch(() => setStatus({ configured: false })) }, 0)
    return () => clearTimeout(id)
  }, [])

  // Debounce the search so keystrokes don't refetch every time.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 350)
    return () => clearTimeout(id)
  }, [query])

  const load = useCallback((search: string, off: number) => {
    setLoading(true)
    getSsStyles({ search, limit: PAGE, offset: off })
      .then((r) => {
        setSynced(r.synced)
        setTotal(r.total ?? 0)
        setStyles((prev) => (off === 0 ? r.styles ?? [] : [...prev, ...(r.styles ?? [])]))
      })
      .catch(() => setSynced(false))
      .finally(() => setLoading(false))
  }, [])

  // Reload from the top whenever the (debounced) search changes.
  useEffect(() => {
    const id = setTimeout(() => { if (getToken()) { setOffset(0); load(debounced, 0) } }, 0)
    return () => clearTimeout(id)
  }, [debounced, load])

  const sync = async () => {
    setSyncing(true); setErr(null)
    try {
      const r = await ssSync()
      if (r.error) throw new Error(r.error)
      const s = await getSsStatus().catch(() => null)
      if (s) setStatus(s)
      setOffset(0); load(debounced, 0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed.")
    } finally { setSyncing(false) }
  }

  const addToCatalog = async (s: SsStyle) => {
    setAddingId(s.styleID); setErr(null)
    try {
      const d = await getSsStyle(s.styleID)
      if (d.error) throw new Error(d.error)
      const existing = await getCatalogProducts().catch(() => [] as CatalogProduct[])
      const id = "SS-" + s.styleID
      const product: CatalogProduct = {
        id, name: d.title || s.title, type: "Apparel", method: "DTG", status: "Active",
        price: d.price ?? s.price ?? 0, basePrice: d.price ?? s.price ?? 0,
        sizes: d.sizes ?? [], colorImages: d.colorImages ?? {}, mainColor: (d.colors ?? s.colors)?.[0],
        img: d.image ?? s.image ?? undefined, images: d.extraImages ?? [], sku: s.styleID,
      }
      const next = existing.some((p) => p.id === id) ? existing.map((p) => (p.id === id ? product : p)) : [...existing, product]
      const r = await saveCatalogProducts(next)
      if (r.error) throw new Error(r.error)
      setAdded((prev) => new Set(prev).add(s.styleID))
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add to catalog.")
    } finally { setAddingId(null) }
  }

  const canLoadMore = styles.length < total
  const notConfigured = status && status.configured === false
  const notSynced = useMemo(() => synced === false && !loading, [synced, loading])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package size={18} weight="fill" /></span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="truncate text-sm text-muted-foreground">Browse S&amp;S Activewear blanks and add them to your catalog.{status?.synced_count ? ` ${status.synced_count.toLocaleString()} styles synced.` : ""}</p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={sync} disabled={syncing}>
            <ArrowsClockwise size={14} weight="bold" className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync catalog"}
          </Button>
        )}
      </div>

      <SectionCard title="S&S Activewear" description="Served from your synced catalog — fast, no live-API wait">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <div className="relative max-w-md flex-1">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brand, style, category…" className="pl-9" />
          </div>
          {loading && <CircleNotch size={16} className="animate-spin text-muted-foreground" />}
        </div>

        {err && <div className="flex items-center gap-1.5 border-b border-border bg-amber-50 px-4 py-2 text-sm text-amber-700"><Warning size={14} weight="fill" /> {err}</div>}

        {notConfigured ? (
          <div className="py-16 text-center text-sm text-muted-foreground">S&amp;S isn&apos;t configured on the server (set SS_ACCOUNT_NUMBER + SS_API_KEY).</div>
        ) : notSynced ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Package size={24} weight="duotone" className="text-muted-foreground" />
            <div className="font-medium">Catalog not synced yet</div>
            <div className="max-w-sm text-sm text-muted-foreground">The S&amp;S catalog is huge, so we sync it into the database once for instant browsing.{isAdmin ? "" : " Ask an admin to run a sync."}</div>
            {isAdmin && <Button size="sm" onClick={sync} disabled={syncing}>{syncing ? <CircleNotch size={14} className="animate-spin" /> : <><ArrowsClockwise size={14} weight="bold" /> Sync now</>}</Button>}
          </div>
        ) : styles.length === 0 && !loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No styles match “{debounced}”.</div>
        ) : (
          <>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {styles.map((s) => {
                const isAdded = added.has(s.styleID)
                return (
                  <div key={s.styleID} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="relative flex aspect-square items-center justify-center bg-muted/40">
                      {s.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.image} alt="" loading="lazy" className="size-full object-contain" />
                      ) : (
                        <Package size={24} weight="duotone" className="text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.brand}</div>
                      <div className="line-clamp-2 text-sm font-medium leading-snug">{s.title}</div>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{s.colors?.length ? `${s.colors.length} colors` : s.category || ""}</span>
                        <span className="font-semibold text-foreground tabular-nums">{usd(s.price)}</span>
                      </div>
                      <Button size="sm" variant={isAdded ? "outline" : "default"} className="mt-2.5" disabled={addingId === s.styleID || isAdded} onClick={() => addToCatalog(s)}>
                        {addingId === s.styleID ? <CircleNotch size={13} className="animate-spin" /> : isAdded ? <><Check size={13} weight="bold" /> In catalog</> : <><Plus size={13} weight="bold" /> Add to catalog</>}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            {canLoadMore && (
              <div className="flex justify-center border-t border-border p-4">
                <Button variant="outline" onClick={() => { const off = offset + PAGE; setOffset(off); load(debounced, off) }} disabled={loading}>
                  {loading ? <CircleNotch size={15} className="animate-spin" /> : `Load more (${styles.length}/${total})`}
                </Button>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  )
}
