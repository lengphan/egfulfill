"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MagnifyingGlass, Package, CircleNotch, ArrowsClockwise, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getSsStatus, getSsStylesAll, getSsStyleImgs, getSsStyle, toggleSsFavorite, ssWarm, getCatalogProducts, saveCatalogProducts,
  type SsStyle, type CatalogProduct,
} from "@/lib/api"
import { OttoSuppliers } from "@/components/app/otto-suppliers"
import { SupplierProductCard } from "@/components/app/supplier-product-card"
import { Loading } from "@/components/app/loading"
import { getToken, getUser } from "@/lib/auth"

const PAGE = 60

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
  const [supplier, setSupplier] = useState<"ss" | "otto">("ss")

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
    // The FULL live catalog (all products). Cards may come without images on this account,
    // so resolve this page's thumbnails/colors in one batched call (cached server-side).
    getSsStylesAll({ search, limit: PAGE, offset: off })
      .then(async (r) => {
        setSynced(true)
        setTotal(r.total ?? 0)
        const page = r.styles ?? []
        setStyles((prev) => (off === 0 ? page : [...prev, ...page]))
        const ids = page.filter((s) => !s.image).map((s) => s.styleID)
        if (ids.length) {
          const imgs = await getSsStyleImgs(ids).catch(() => ({} as Record<string, { image: string | null; colors: string[] }>))
          setStyles((prev) => prev.map((s) => {
            const hit = imgs[s.styleID]
            if (!hit) return s
            return { ...s, image: s.image ?? hit.image, colors: s.colors?.length ? s.colors : (hit.colors ?? []) }
          }))
        }
      })
      .catch(() => setSynced(true))
      .finally(() => setLoading(false))
  }, [])

  // Reload from the top whenever the (debounced) search changes.
  useEffect(() => {
    const id = setTimeout(() => { if (getToken()) { setOffset(0); load(debounced, 0) } }, 0)
    return () => clearTimeout(id)
  }, [debounced, load])

  // Pre-warm every style's thumbnail into the DB (background) so browsing is instant.
  const sync = async () => {
    setSyncing(true); setErr(null)
    try {
      const r = await ssWarm()
      if (r.error) throw new Error(r.error)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start warming.")
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
        description: d.description ?? undefined, supplier: "S&S",
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
          <p className="truncate text-sm text-muted-foreground">Browse blanks from your suppliers and add them to your catalog.{supplier === "ss" && total ? ` ${total.toLocaleString()} S&S styles.` : ""}</p>
        </div>
        {isAdmin && supplier === "ss" && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={sync} disabled={syncing}>
            <ArrowsClockwise size={14} weight="bold" className={syncing ? "animate-spin" : ""} /> {syncing ? "Refreshing…" : "Refresh"}
          </Button>
        )}
      </div>

      {/* Supplier tabs */}
      <div className="flex w-fit rounded-lg border border-border p-0.5">
        {([{ id: "ss", label: "S&S Activewear" }, { id: "otto", label: "Otto Cap" }] as const).map((t) => (
          <button key={t.id} onClick={() => setSupplier(t.id)} className={"rounded-full px-3 py-1.5 text-sm font-medium transition-colors " + (supplier === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{t.label}</button>
        ))}
      </div>

      {supplier === "otto" ? <OttoSuppliers /> : (
      <SectionCard title="S&S Activewear" description="The full S&S catalog — every style; thumbnails resolve as you browse">
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
        ) : styles.length === 0 && loading ? (
          <Loading label="Loading catalog…" />
        ) : styles.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No styles match “{debounced}”.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {styles.map((s) => (
                <SupplierProductCard
                  key={s.styleID}
                  data={{ id: s.styleID, title: s.title, brand: s.brand, subtitle: s.category, image: s.image, price: s.price, colors: s.colors, favorited: s.favorited }}
                  added={added.has(s.styleID)}
                  adding={addingId === s.styleID}
                  onAdd={() => addToCatalog(s)}
                  onFavorite={(on) => toggleSsFavorite(s, on).catch(() => {})}
                  loadColors={() => getSsStyle(s.styleID).then((d) => (d && !d.error ? d.colorImages ?? {} : {}))}
                />
              ))}
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
      )}
    </div>
  )
}
