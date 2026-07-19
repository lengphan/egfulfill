"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ArrowsClockwise,
  Trash,
  Plus,
  CheckCircle,
  Storefront,
  Warning,
} from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"
import { ForwardSetup } from "@/components/app/forward-setup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatCard, StatGrid } from "@/components/app/stat-card"
import {
  getEtsyConnections,
  getEtsyConfig,
  syncEtsy,
  disconnectEtsy,
  getShopifyConfig,
  getShopifyConnections,
  disconnectShopify,
  type EtsyConnection,
} from "@/lib/api"
import { startEtsyConnect } from "@/lib/etsy-oauth"
import { startShopifyConnect } from "@/lib/shopify-oauth"
import { getUser } from "@/lib/auth"

const fmtDate = (s: string | null) => {
  if (!s) return "never"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Channels shown even when unconnected. Only Etsy has a live OAuth route today.
const CHANNELS = [
  { key: "etsy", name: "Etsy", blurb: "Sync orders & push tracking back", live: true },
  { key: "shopify", name: "Shopify", blurb: "Storefront order sync", live: true },
  { key: "tiktok", name: "TikTok Shop", blurb: "Marketplace order sync", live: false },
  { key: "woocommerce", name: "WooCommerce", blurb: "WordPress store sync", live: false },
]

export function StoresManager() {
  const reduce = useReducedMotion()
  const [conns, setConns] = useState<EtsyConnection[] | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // shop_id or "connect"
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; msg: string } | null>(null)
  // Admins get the full scope list per shop (the exact grants that shop authorised),
  // not just the count — useful for diagnosing "why can't we read X". Expanded per shop.
  const isAdmin = getUser()?.role === "admin"
  const [openScopes, setOpenScopes] = useState<Set<string>>(new Set())

  const [shopDomain, setShopDomain] = useState("")

  const load = useCallback(() => {
    Promise.all([
      getEtsyConnections().catch(() => [] as EtsyConnection[]),
      getShopifyConnections().catch(() => [] as EtsyConnection[]),
    ]).then(([e, s]) => { setConns([...(e ?? []), ...(s ?? [])]); setIsDemo(false) })
      .catch(() => { setConns([]); setIsDemo(true) })
  }, [])

  useEffect(() => {
    load()
    // Surface the post-OAuth redirect result (deferred so it isn't a synchronous mount render).
    const params = new URLSearchParams(window.location.search)
    if (!params.get("connected")) return
    window.history.replaceState({}, "", "/stores")
    const id = setTimeout(() => setNotice({ tone: "ok", msg: "Shop connected. Your orders will start syncing." }), 0)
    return () => clearTimeout(id)
  }, [load])

  const onConnect = async () => {
    setBusy("connect")
    setNotice(null)
    try {
      const cfg = await getEtsyConfig()
      if (!cfg.configured || !cfg.keystring) {
        setNotice({ tone: "err", msg: "Etsy isn't configured on the server yet (ETSY_KEYSTRING)." })
        setBusy(null)
        return
      }
      await startEtsyConnect(cfg) // redirects away
    } catch (e) {
      setNotice({ tone: "err", msg: e instanceof Error ? e.message : "Couldn't start the Etsy connection." })
      setBusy(null)
    }
  }

  const onConnectShopify = async () => {
    setBusy("connect-shopify"); setNotice(null)
    try {
      const cfg = await getShopifyConfig()
      if (!cfg.configured || !cfg.api_key) {
        setNotice({ tone: "err", msg: "Shopify isn't configured on the server yet (SHOPIFY_API_KEY / SECRET)." }); setBusy(null); return
      }
      startShopifyConnect(cfg, shopDomain) // redirects away
    } catch (e) {
      setNotice({ tone: "err", msg: e instanceof Error ? e.message : "Enter your store as mystore.myshopify.com" })
      setBusy(null)
    }
  }

  const onSync = async () => {
    setBusy("sync")
    setNotice(null)
    try {
      const r = await syncEtsy()
      if (r.error) throw new Error(r.error)
      setNotice({ tone: "ok", msg: r.imported != null ? `Synced — ${r.imported} order(s) imported.` : "Sync complete." })
      load()
    } catch (e) {
      setNotice({ tone: "err", msg: e instanceof Error ? e.message : "Sync failed." })
    } finally {
      setBusy(null)
    }
  }

  const onDisconnect = async (c: EtsyConnection) => {
    setBusy(c.shop_id)
    setNotice(null)
    try {
      if ((c.platform || "").toLowerCase() === "shopify") await disconnectShopify(c.shop_id)
      else await disconnectEtsy(c.shop_id)
      setNotice({ tone: "ok", msg: `Disconnected ${c.shop_name || "shop"}.` })
      setConns((prev) => (prev ?? []).filter((x) => x.shop_id !== c.shop_id))
    } catch (e) {
      setNotice({ tone: "err", msg: e instanceof Error ? e.message : "Couldn't disconnect." })
    } finally {
      setBusy(null)
    }
  }

  const connected = conns ?? []
  const scopeCount = (s: string | null) => (s ? s.split(/[\s,]+/).filter(Boolean).length : 0)

  return (
    <div className="space-y-5">
      <StatGrid>
        <StatCard label="Connected shops" value={String(connected.length)} sub="syncing orders" />
        <StatCard label="Channels live" value="1" sub="Etsy" tone="pos" />
        <StatCard label="Coming soon" value="3" sub="Shopify · TikTok · Woo" />
        <StatCard
          label="Last sync"
          value={connected.length ? fmtDate(connected[0].last_sync_at).split(",")[0] : "—"}
          sub="most recent shop"
        />
      </StatGrid>

      {notice && (
        <div
          className={
            "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium " +
            (notice.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700")
          }
        >
          {notice.tone === "ok" ? <CheckCircle size={15} weight="fill" /> : <Warning size={15} weight="fill" />}
          {notice.msg}
        </div>
      )}

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-700">
          <Warning size={14} weight="fill" />
          Sign in to load and manage your connected shops.
        </div>
      )}

      {/* Connected shops */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="font-semibold">Connected shops</div>
          {connected.length > 0 && (
            <Button size="sm" variant="outline" onClick={onSync} disabled={busy === "sync"}>
              <ArrowsClockwise size={14} weight="bold" className={busy === "sync" ? "animate-spin" : ""} />
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </div>

        {conns === null ? (
          <div className="space-y-3 p-5">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : connected.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Storefront size={26} weight="duotone" />
            </span>
            <div className="font-medium">No shops connected yet</div>
            <div className="max-w-xs text-sm text-muted-foreground">
              Connect a marketplace below to start syncing orders into one queue.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {connected.map((c) => (
              <div key={String(c.id)} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-semibold text-primary">
                    {(c.shop_name || "E").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.shop_name || `Shop ${c.shop_id}`}</span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {c.platform}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {isAdmin && c.scopes ? (
                        <button
                          type="button"
                          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                          onClick={() => setOpenScopes((prev) => { const n = new Set(prev); n.has(c.shop_id) ? n.delete(c.shop_id) : n.add(c.shop_id); return n })}
                        >
                          {scopeCount(c.scopes)} scopes
                        </button>
                      ) : (
                        <>{scopeCount(c.scopes)} scopes</>
                      )}
                      {" · last sync "}{fmtDate(c.last_sync_at)}
                    </div>
                    {isAdmin && openScopes.has(c.shop_id) && c.scopes && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.scopes.split(/[\s,]+/).filter(Boolean).map((s) => (
                          <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-red-600"
                  onClick={() => onDisconnect(c)}
                  disabled={busy === c.shop_id}
                >
                  <Trash size={14} weight="bold" />
                  {busy === c.shop_id ? "Removing…" : "Disconnect"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available channels */}
      <div>
        <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Add a channel</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CHANNELS.map((ch, i) => (
            <motion.div
              key={ch.key}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="flex flex-col rounded-2xl border border-border bg-card p-5"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Storefront size={22} weight="duotone" />
              </span>
              <div className="mt-3 font-semibold">{ch.name}</div>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{ch.blurb}</p>
              {ch.key === "shopify" ? (
                <div className="mt-4 space-y-2">
                  <Input value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} placeholder="mystore.myshopify.com" className="h-9 text-sm" />
                  <Button size="sm" className="w-full" onClick={onConnectShopify} disabled={busy === "connect-shopify" || !shopDomain.trim()}>
                    <Plus size={14} weight="bold" /> {busy === "connect-shopify" ? "Redirecting…" : "Connect"}
                  </Button>
                </div>
              ) : ch.live ? (
                <Button size="sm" className="mt-4" onClick={onConnect} disabled={busy === "connect"}>
                  <Plus size={14} weight="bold" />
                  {busy === "connect" ? "Redirecting…" : "Connect"}
                </Button>
              ) : (
                <span className="mt-4 inline-flex h-8 items-center justify-center rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground">
                  Coming soon
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Stopgap while Etsy's address entitlement is pending — sits with the Etsy
          connection because that's where a seller goes when orders won't ship. */}
      {/* Forwarding first — it is the hands-off path; the CSV below is the fallback. */}
      <ForwardSetup />

    </div>
  )
}
