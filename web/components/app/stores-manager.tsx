"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ArrowsClockwise,
  Trash,
  Plus,
  CheckCircle,
  Storefront,
  Warning,
  Prohibit,
} from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"
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
  syncShopify,
  getTiktokConfig,
  getTiktokConnections,
  disconnectTiktok,
  syncTiktok,
  type EtsyConnection,
} from "@/lib/api"
import { startEtsyConnect } from "@/lib/etsy-oauth"
import { startShopifyConnect } from "@/lib/shopify-oauth"
import { startTikTokConnect } from "@/lib/tiktok-oauth"
import { getUser } from "@/lib/auth"

const fmtDate = (s: string | null) => {
  if (!s) return "never"
  const d = new Date(s)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Channels shown even when unconnected. (Etsy + Shopify also import orders; TikTok is
// connect-only so far.)
//
// `live` means the connect button actually works end to end. `soon` overrides the generic
// "Coming soon" with a REASON, which is worth doing — "we're waiting on the marketplace" and
// "we haven't built it" are different facts to a seller.
//
// But only when the reason is TRUE. Walmart and Amazon read "Awaiting app approval" while
// nothing had been submitted for either — a status this array invented and showed a seller as
// fact. Both are back on the generic fallback until there is something real to report; don't
// restore a claim about a marketplace's queue that nobody has verified.
const CHANNELS: { key: string; name: string; blurb: string; live: boolean; soon?: string }[] = [
  { key: "etsy", name: "Etsy", blurb: "Sync orders & push tracking back", live: true },
  { key: "tiktok", name: "TikTok Shop", blurb: "Marketplace order sync", live: true },
  { key: "walmart", name: "Walmart", blurb: "Marketplace order sync", live: false },
  { key: "amazon", name: "Amazon", blurb: "Seller Central order sync", live: false },
  { key: "shopify", name: "Shopify", blurb: "Storefront order sync", live: true },
  { key: "woocommerce", name: "WooCommerce", blurb: "WordPress store sync", live: false },
]
// The two counters above the list read off the same array, so adding a channel can't leave a
// hard-coded "3 live" behind.
const liveChannels = CHANNELS.filter((c) => c.live)
const soonChannels = CHANNELS.filter((c) => !c.live)

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
  // Which channel is awaiting a "how far back to import" choice (pre-connect modal), if any.
  const [pending, setPending] = useState<"etsy" | "shopify" | "tiktok" | null>(null)
  // Which TikTok region the server's authorize URL targets ("us" | "global"). Shown in the
  // connect modal so a US seller can catch a wrong-region login BEFORE hitting "account not
  // found" — that error means the popup opened the other region's separate account system.
  const [tiktokRegion, setTiktokRegion] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      getEtsyConnections().catch(() => [] as EtsyConnection[]),
      getShopifyConnections().catch(() => [] as EtsyConnection[]),
      getTiktokConnections().catch(() => [] as EtsyConnection[]),
    ]).then(([e, s, t]) => { setConns([...(e ?? []), ...(s ?? []), ...(t ?? [])]); setIsDemo(false) })
      .catch(() => { setConns([]); setIsDemo(true) })
  }, [])

  // The TikTok authorize page is region-split (US vs global); fetch which one this server
  // opens so the connect modal can show it. Best-effort — a failure just hides the hint.
  useEffect(() => {
    getTiktokConfig().then((c) => setTiktokRegion(c.region || "global")).catch(() => {})
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

  // A connect opens a popup; the /oauth-callback posts back a result (handled by the effect
  // below). Keep the button busy until then — and clear it if the popup is closed unfinished.
  const watch = useCallback((popup: Window | null) => {
    if (!popup) return // redirect fallback took over
    const iv = setInterval(() => { if (popup.closed) { clearInterval(iv); setBusy(null) } }, 600)
    setTimeout(() => clearInterval(iv), 300000)
  }, [])

  useEffect(() => {
    type OAuthResult = { source?: string; ok?: boolean; shop?: string; message?: string; note?: string }
    const handle = (d: OAuthResult | null) => {
      if (!d || d.source !== "eg-oauth") return
      setBusy(null)
      if (!d.ok) { setNotice({ tone: "err", msg: d.message || "Couldn't connect." }); return }
      // `note` is the FIRST IMPORT's outcome, which is not the same event as connecting.
      // A backfill that failed reports as an error even though the shop is connected —
      // "your orders will start syncing" over a sync that already failed is exactly how a
      // store sat connected and empty with nothing on screen admitting it.
      const failed = !!d.note && d.note.includes("import failed")
      setNotice({
        tone: failed ? "err" : "ok",
        msg: d.note || `Connected ${d.shop || "your shop"}.`,
      })
      load()
    }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      handle(e.data as OAuthResult)
    }
    window.addEventListener("message", onMsg)
    // Same-origin fallback for when the provider's COOP severed window.opener, which is why
    // the popup used to strand itself on /stores instead of closing.
    let ch: BroadcastChannel | null = null
    try {
      ch = new BroadcastChannel("eg-oauth")
      ch.onmessage = (e) => handle(e.data as OAuthResult)
    } catch { /* not supported — postMessage still covers the normal path */ }
    return () => {
      window.removeEventListener("message", onMsg)
      try { ch?.close() } catch { /* ignore */ }
    }
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
      watch(await startEtsyConnect(cfg))
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
      watch(startShopifyConnect(cfg, shopDomain))
    } catch (e) {
      setNotice({ tone: "err", msg: e instanceof Error ? e.message : "Enter your store as mystore.myshopify.com" })
      setBusy(null)
    }
  }

  const onConnectTiktok = async () => {
    setBusy("connect-tiktok"); setNotice(null)
    try {
      const cfg = await getTiktokConfig()
      if (!cfg.configured || !cfg.service_id) {
        setNotice({ tone: "err", msg: "TikTok isn't configured on the server yet (TIKTOK_APP_KEY / SECRET / SERVICE_ID)." }); setBusy(null); return
      }
      watch(startTikTokConnect(cfg))
    } catch (e) {
      setNotice({ tone: "err", msg: e instanceof Error ? e.message : "Couldn't start the TikTok connection." })
      setBusy(null)
    }
  }

  // Sync every connected order-importing channel at once (Etsy · TikTok · Shopify). Each
  // endpoint 400s when that channel has no connected shop, so we only call the ones actually
  // present and never surface a "no shop connected" error for a channel the user doesn't use.
  // Pre-connect scope options — how much order history the FIRST import reaches back for.
  // New orders always sync automatically afterward, so this only bounds the initial backfill.
  const SCOPE_OPTIONS: { days: number; label: string; sub: string; rec?: boolean }[] = [
    // "Today", not "New orders only": the server now reads 0 as midnight UTC rather than the
    // instant you connect, so a shop linked at 4pm still gets that morning's sales. The old
    // label described the old behaviour and would now be wrong.
    { days: 0, label: "Today", sub: "Today's orders — nothing older" },
    { days: 7, label: "Past 7 days", sub: "Roughly this week" },
    { days: 30, label: "Past 30 days", sub: "About a month", rec: true },
    { days: 90, label: "Past 90 days", sub: "The last quarter" },
  ]

  /** How far back this channel has ALREADY imported — the floor the chooser ratchets against.
   *
   *  Two sources, because either can be missing:
   *   · `backfill_days`, the window the seller picked. Null on every shop connected before
   *     the chooser existed — which is why an already-connected Etsy shop was still being
   *     offered "Today".
   *   · `oldest_order_at`, the age of the earliest order actually held. Evidence rather than
   *     a record: if orders reach back 60 days, the shop has imported 60 days regardless of
   *     what was or wasn't written down.
   *
   *  The WIDER of the two wins, and it's rounded UP to the nearest offered option — an option
   *  narrower than what's already here can't describe the screen, and nothing is ever deleted
   *  to make it true. */
  const syncedWindowFor = (ch: string): number | null => {
    const mine = (conns ?? []).filter((c) => (c.platform || "etsy").toLowerCase() === ch)
    if (!mine.length) return null
    const recorded = mine.map((c) => c.backfill_days).filter((d): d is number => typeof d === "number")

    const ages = mine
      .map((c) => c.oldest_order_at)
      .filter((s): s is string => !!s)
      .map((s) => (Date.now() - new Date(s).getTime()) / 86400000)
      .filter((d) => Number.isFinite(d) && d >= 0)
    // Round the observed age UP to an offered option: 12 days of history means "Past 7" is
    // already too narrow, so the floor is 30. Beyond the widest option, the floor is that one.
    //
    // Two roundings, both erring wide except where that would be absurd:
    //  · under a day → 0, so a shop holding only today's orders can still pick "Today". A raw
    //    0.2 would otherwise round up to 7 and grey out the very window it's already on.
    //  · otherwise ceil, so 7.9 days of history needs 30 rather than squeaking into "Past 7",
    //    which wouldn't actually cover the oldest order.
    const widest = SCOPE_OPTIONS[SCOPE_OPTIONS.length - 1].days
    const oldest = ages.length ? Math.max(...ages) : null
    const needed = oldest === null ? null : (oldest < 1 ? 0 : Math.ceil(oldest))
    const implied = needed === null
      ? null
      : (SCOPE_OPTIONS.find((o) => o.days >= needed)?.days ?? widest)

    const floors = [...recorded, ...(implied === null ? [] : [implied])]
    return floors.length ? Math.max(...floors) : null
  }
  const channelName = (k: string) => CHANNELS.find((c) => c.key === k)?.name || "shop"

  // A channel's Connect button opens this chooser first; picking a window stashes it for the
  // OAuth callback to persist on the connection, then starts the real connect flow.
  const chooseScope = (days: number) => {
    try { localStorage.setItem("eg_connect_backfill_days", String(days)) } catch { /* ignore */ }
    const ch = pending
    setPending(null)
    if (ch === "etsy") onConnect()
    else if (ch === "shopify") onConnectShopify()
    else if (ch === "tiktok") onConnectTiktok()
  }

  const onSync = async () => {
    setBusy("sync")
    setNotice(null)
    const platforms = new Set((conns ?? []).map((c) => (c.platform || "etsy").toLowerCase()))
    const jobs: Promise<{ imported?: number; error?: string }>[] = []
    if (platforms.has("etsy")) jobs.push(syncEtsy())
    if (platforms.has("tiktok")) jobs.push(syncTiktok())
    if (platforms.has("shopify")) jobs.push(syncShopify())
    try {
      const results = await Promise.allSettled(jobs)
      const imported = results.reduce(
        (n, r) => n + (r.status === "fulfilled" ? r.value.imported || 0 : 0), 0)
      // A per-channel failure shouldn't hide the others' success; only report an error when
      // every channel failed (or one did with nothing imported anywhere).
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error))
      if (failed.length === results.length && results.length > 0) {
        const first = failed[0]
        const msg = first.status === "rejected"
          ? (first.reason instanceof Error ? first.reason.message : "Sync failed.")
          : (first.value.error || "Sync failed.")
        throw new Error(msg)
      }
      setNotice({ tone: "ok", msg: `Synced — ${imported} order(s) imported.` })
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
      const plat = (c.platform || "").toLowerCase()
      if (plat === "shopify") await disconnectShopify(c.shop_id)
      else if (plat === "tiktok") await disconnectTiktok(c.shop_id)
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
        <StatCard
          label="Channels live"
          value={String(liveChannels.length)}
          sub={liveChannels.map((c) => c.name.replace(" Shop", "")).join(" · ")}
          tone="pos"
        />
        <StatCard
          label="Coming soon"
          value={String(soonChannels.length)}
          sub={soonChannels.map((c) => c.name).join(" · ")}
        />
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
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                          <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">{s}</span>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <Button size="sm" className="w-full" onClick={() => setPending("shopify")} disabled={busy === "connect-shopify" || !shopDomain.trim()}>
                    <Plus size={14} weight="bold" /> {busy === "connect-shopify" ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              ) : ch.live ? (
                <Button size="sm" className="mt-4" onClick={() => setPending(ch.key as "etsy" | "tiktok")} disabled={busy === (ch.key === "tiktok" ? "connect-tiktok" : "connect")}>
                  <Plus size={14} weight="bold" />
                  {busy === (ch.key === "tiktok" ? "connect-tiktok" : "connect") ? "Connecting…" : "Connect"}
                </Button>
              ) : (
                <span className="mt-4 inline-flex h-8 items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-xs font-medium text-muted-foreground">
                  {ch.soon ?? "Coming soon"}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Pre-connect scope chooser — appears for every channel, both seller and staff. Bounds
          how far back the FIRST import reaches so connecting a busy shop can't pull thousands
          of historical orders. New orders always sync automatically after connect. */}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPending(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold">Import orders from {channelName(pending)}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              How far back should we pull existing orders? This only affects the first import —
              new orders always sync automatically afterward.
            </p>
            {pending === "tiktok" && tiktokRegion && (
              <div className="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Opens the <span className="font-medium text-foreground">{tiktokRegion === "us" ? "US" : "global"}</span> TikTok Shop
                login. If your shop is {tiktokRegion === "us" ? "not US" : "US"} and it can&apos;t find your account, the
                server&apos;s <code className="font-mono">TIKTOK_REGION</code> is set to the wrong region.
              </div>
            )}
            {/* Already-synced shops: say the rule ONCE, up here, rather than repeating it on
                every greyed row. */}
            {syncedWindowFor(pending) !== null && (
              <div className="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                This shop already imported{" "}
                <span className="font-medium text-foreground">
                  {SCOPE_OPTIONS.find((o) => o.days === syncedWindowFor(pending))?.label.toLowerCase() ?? `${syncedWindowFor(pending)} days`}
                </span>
                . You can widen that, but not narrow it — nothing already imported is ever removed.
              </div>
            )}
            <div className="mt-4 space-y-2">
              {SCOPE_OPTIONS.map((o) => {
                // Greyed, not hidden: a missing option reads as a bug, while a disabled one
                // with a reason says what happened and what to do instead.
                const synced = syncedWindowFor(pending)
                const off = synced !== null && o.days < synced
                return (
                <button
                  key={o.days}
                  type="button"
                  disabled={off}
                  aria-disabled={off}
                  title={off ? "Already imported a longer period — the window can only widen" : undefined}
                  onClick={() => !off && chooseScope(o.days)}
                  className={
                    "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors " +
                    (off
                      ? "cursor-not-allowed border-border/60 bg-muted/30 opacity-55"
                      : "border-border bg-background hover:border-primary hover:bg-primary/5")
                  }
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium">
                      {o.label}
                      {o.rec && !off && synced === null && (
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-primary">
                          Recommended
                        </span>
                      )}
                      {synced === o.days && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Current
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {off ? "Shorter than what's already imported" : o.sub}
                    </span>
                  </span>
                  {off
                    ? <Prohibit size={15} weight="bold" className="shrink-0 text-muted-foreground/70" />
                    : <Plus size={15} weight="bold" className="shrink-0 text-muted-foreground" />}
                </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="mt-4 w-full rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
