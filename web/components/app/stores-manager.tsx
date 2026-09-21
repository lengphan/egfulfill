"use client"

import { useLabelT, useDateFormat } from "@/lib/i18n"
import { useConfirm } from "@/components/app/confirm-dialog"
import { useCallback, useEffect, useState } from "react"
import { ArrowsClockwise, Trash, Plus, CheckCircle, Storefront, Warning, Prohibit } from "@phosphor-icons/react"
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
import { EmptyState } from "@/components/app/empty-state"

function useFmtDate() {
  const fmtDate = useDateFormat()
  return useCallback((s: string | null) => {
 if (!s) return "never"
 const d = new Date(s)
 return isNaN(d.getTime()) ? "—" : fmtDate(d, { month: "short", day: "numeric", year: "numeric" })
}, [fmtDate])
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
// ORDER IS THE MESSAGE: what a seller can connect today comes first, what they can't
// comes last. Etsy · TikTok · Shopify are live; WooCommerce is next to be built; Amazon and
// Walmart trail because both are gated on a marketplace approving us, not on our work.
//
// `markH` is the rendered height of that brand's file, in px, and it is DELIBERATELY
// different for every one. A single height across all six looked wrong because these files
// are not comparable: measuring the visible ink inside each asset gives
//
// woocommerce  98% of its canvas is ink amazon   52% — half the file is padding
// tiktok      100%, and it is a STACKED lockup (icon over "TikTok Shop"), not a wordmark
//
// so at a shared 48px, Woo showed 47px of ink and Amazon showed 25px. These heights
// normalise the INK instead of the file: ~28-30px of mark for the single-line wordmarks,
// more for Amazon to cancel its padding, more again for TikTok so the word under its icon
// stays legible. Re-measure before changing one; don't eyeball it.
const CHANNELS: { key: string; name: string; live: boolean; soon?: string; why?: string; markH: number }[] = [
  { key: "etsy", name: "Etsy", live: true, markH: 32 },
  { key: "tiktok", name: "TikTok Shop", live: true, markH: 46 },
  { key: "shopify", name: "Shopify", live: true, markH: 28 },
  { key: "woocommerce", name: "WooCommerce", live: false, markH: 27 },
  { key: "amazon", name: "Amazon", live: false, markH: 58 },
  { key: "walmart", name: "Walmart", live: false, markH: 28 },
]
/**
 * A channel's own logo, UNALTERED, from `public/channels/<key>.svg`.
 *
 * Not tinted and not redrawn. Etsy, Shopify, TikTok, Amazon and Walmart all require their
 * mark in its own colours and forbid recolouring, and two of those will be reviewing us —
 * an altered logo is a routine flag in app review. So the tile carries a neutral plate and
 * the real mark sits on it, which is also the only version that is actually recognisable.
 *
 * Falls back to the generic storefront icon when the file isn't there, so a channel without
 * an approved asset yet renders as an interface icon rather than a broken image. Defined at
 * module scope — a component declared inside render violates react-hooks/static-components
 * and remounts on every parent render, which would re-trigger the error state.
 */
/** The channels whose mark ships as an SVG. Everything else in public/channels is a PNG. */
const SVG_CHANNELS = new Set(["shopify", "walmart"])

function ChannelMark({ channelKey, name, markH }: { channelKey: string; name: string; markH: number }) {
  // svg → png → icon. Brand press kits give one or the other and it's not worth caring
  // which; public/suppliers already stores PNGs (otto.png, ss.png), so both must work.
  //
  // START AT THE EXTENSION THAT EXISTS. Trying .svg first for every channel meant the four
  // PNG-only marks each fired a guaranteed 404 before the fallback rendered them correctly:
  // the page looked fine and cost four failed round trips on every load, and four red lines
  // in the console that mask the errors worth reading. Only shopify and walmart ship an SVG.
  // A channel missing from this set simply starts at .png and still falls back to the icon,
  // so adding an SVG later means adding the key here — not touching the fallback chain.
 const [step, setStep] = useState(0)
 const ext = step === 0 && SVG_CHANNELS.has(channelKey) ? "svg" : "png"
 const src = `/channels/${channelKey}.${ext}`
  // CONSTRAINED BY HEIGHT, NOT BOXED. These are wordmarks — WooCommerce's is 3.8:1 and
  // Amazon's 2.3:1 — so a square plate shrinks them to a 24×6 smear. Height with free width
  // is the only arrangement in which marks of different aspect ratios read alike, and it's
  // how the brands' own guidelines size them.
  //
  // The height is PER BRAND (see markH on CHANNELS) because equal file heights do not give
  // equal-looking marks — the files differ in how much of themselves is ink.
  //
  // The row is taller than any mark so the tallest file (Amazon, mostly padding) is not
  // clipped and every mark centres on one baseline regardless of its own height.
  //
  // No tinted plate behind them either: each mark carries its own colour and several ship
  // with a white background baked in, so a coloured plate frames them badly.
 return (
    <span className="flex h-[60px] items-center">
      {step > 1 ? (
        <Storefront size={18} weight="regular" className="shrink-0 text-muted-foreground" />
      ) : (
        // A static local asset with an onError fallback; next/image gives no benefit and
        // swallows the 404 we rely on. (The directive must sit on the line IMMEDIATELY
        // before the element — with the explanation above it, "next line" was this comment,
        // so the disable did nothing and the rule fired anyway.)
        // eslint-disable-next-line @next/next/no-img-element
        <img
 src={src}
 alt={`${name} logo`}
 style={{ height: markH }}
 className="w-auto max-w-[180px] object-contain object-left"
 onError={() => setStep((s) => s + 1)}
        />
      )}
    </span>
  )
}

// The two counters above the list read off the same array, so adding a channel can't leave a
// hard-coded "3 live" behind.
const liveChannels = CHANNELS.filter((c) => c.live)
const soonChannels = CHANNELS.filter((c) => !c.live)

export function StoresManager() {
  const fmtDate = useFmtDate()
  const confirm = useConfirm()
  const tl = useLabelT()
 const reduce = useReducedMotion()
 const [conns, setConns] = useState<EtsyConnection[] | null>(null)
 const [isDemo, setIsDemo] = useState(false)
 const [busy, setBusy] = useState<string | null>(null) // shop_id or "connect"
 const [notice, setNotice] = useState<{ tone: "ok" | "err"; msg: string } | null>(null)
  // Admins get the full scope list per shop (the exact grants that shop authorised),
  // not just the count — useful for diagnosing "why can't we read X". Expanded per shop.
 const isAdmin = getUser()?.role === "admin"
  /**
   * WHO IS READING THE PRE-CONNECT DIALOG, because the honest answer differs by role.
   *
   * Staff connect a shop and get everything a connection gives — automatic syncing and
   * tracking pushed back — minus the buyer address Etsy withholds. A SELLER does not have to
   * connect at all any more (owner, 2026-09-17): the browser extension reads their own Shop
   * Manager page and creates the orders. Telling a seller "connect, and by the way addresses
   * arrive separately" is now the wrong first sentence — it presents the harder path as the
   * only one.
   *
   * Connect is still OFFERED rather than removed. It is strictly better where a seller has
   * it: orders arrive without anyone opening a tab, and tracking reaches the buyer through
   * Etsy. Taking it away would also strand every seller already connected.
   */
 const isStaffUser = (getUser()?.role ?? "seller") !== "seller"
 const [openScopes, setOpenScopes] = useState<Set<string>>(new Set())

 const [shopDomain, setShopDomain] = useState("")
  // Which channel is awaiting a "how far back to import" choice (pre-connect modal), if any.
 const [pending, setPending] = useState<"etsy" | "shopify" | "tiktok" | null>(null)
  /**
   * A SELLER ON ETSY IS ON THE EXTENSION'S PATH, and it cannot be asked for a date range.
   *
   * The extension makes ZERO requests to Etsy — it reads the page the seller already has open
   * (extension/src/parse.js, asserted by tools/check-extension-parse.mjs). So "past 90 days"
   * is not something it can do, and offering the window here promised a crawl that
   * deliberately does not exist. The comment beside the steps has said so since 2026-09-21;
   * the chooser rendered anyway, because it sits OUTSIDE the branch that draws them.
   *
   * `showScope` is an escape hatch, not the default. Connect stays REACHABLE — §6 is explicit
   * that taking it away would strand everyone already connected, and it is still the only
   * path that pushes tracking back to Etsy — but it is one line at the foot rather than four
   * buttons above the instructions.
   */
 const [showScope, setShowScope] = useState(false)
 const extensionOnly = pending === "etsy" && !isStaffUser && !showScope
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
    { days: 0, label: tl("stores", "Today"), sub: tl("stores", "Today's orders — nothing older") },
    { days: 7, label: tl("stores", "Past 7 days"), sub: tl("stores", "Roughly this week") },
    { days: 30, label: tl("stores", "Past 30 days"), sub: tl("stores", "About a month"), rec: true },
    { days: 90, label: tl("stores", "Past 90 days"), sub: tl("stores", "The last quarter") },
  ]

  /** How far back this channel has ALREADY imported — the floor the chooser ratchets against.
   *
   *  Two sources, because either can be missing:
   *   · `backfill_days`, the window the seller picked. Null on every shop connected before
   * the chooser existed — which is why an already-connected Etsy shop was still being
   * offered "Today".
   *   · `oldest_order_at`, the age of the earliest order actually held. Evidence rather than
   * a record: if orders reach back 60 days, the shop has imported 60 days regardless of
   * what was or wasn't written down.
   *
   *  The WIDER of the two wins, and it's rounded UP to the nearest offered option — an option
   * narrower than what's already here can't describe the screen, and nothing is ever deleted
   * to make it true. */
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
    // which wouldn't actually cover the oldest order.
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
    /**
     * DISCONNECTING DELETES THE CONNECTION ROW, and it fired on one click.
     *
     * This is the most expensive undo on the screen and it read as the cheapest. Getting a
     * shop back is not a button here — it is the seller going to Etsy/Shopify/TikTok and
     * authorising us again, so an accidental press on someone else's row costs a
     * conversation and a consent screen. Orders already imported stay; what stops is the
     * sync, silently, which is exactly how "why did orders stop arriving" starts.
     */
 const ok = await confirm({
 title: tl("stores", "Disconnect this shop?"),
 body: `${c.shop_name || c.shop_id} ${tl("stores", "stops syncing new orders. Orders already imported stay. Reconnecting means signing in at the marketplace again — it can't be undone from here.")}`,
 confirmLabel: tl("stores", "Disconnect"),
    })
 if (!ok) return
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
        <StatCard label={tl("stores", "Connected shops")} value={String(connected.length)} sub={tl("stores", "syncing orders")} />
        <StatCard
 label={tl("stores", "Channels live")}
 value={String(liveChannels.length)}
 sub={liveChannels.map((c) => c.name.replace(" Shop", "")).join(" · ")}
 tone="pos"
        />
        <StatCard
 label={tl("stores", "Coming soon")}
 value={String(soonChannels.length)}
 sub={soonChannels.map((c) => c.name).join(" · ")}
        />
        <StatCard
 label={tl("stores", "Last sync")}
 value={connected.length ? fmtDate(connected[0].last_sync_at).split(",")[0] : "—"}
 sub={tl("stores", "most recent shop")}
        />
      </StatGrid>

      {notice && (
        <div
 className={
            "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium " +
            (notice.tone === "ok"
              ? "border-shipped/30 bg-shipped/12 text-shipped"
 : "border-alert/30 bg-alert/12 text-alert")
          }
        >
          {notice.tone === "ok" ? <CheckCircle size={15} weight="fill" /> : <Warning size={15} weight="fill" />}
          {notice.msg}
        </div>
      )}

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3.5 py-2 text-xs font-medium text-hold">
          <Warning size={14} weight="fill" />
          {tl("stores", "Sign in to load and manage your connected shops.")}
        </div>
      )}

      {/* Connected shops */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="font-semibold">{tl("stores", "Connected shops")}</div>
          {connected.length > 0 && (
            <Button size="sm" variant="outline" onClick={onSync} disabled={busy === "sync"}>
              <ArrowsClockwise size={14} weight="bold" className={busy === "sync" ? "animate-spin" : ""} />
              {busy === "sync" ? tl("stores", "Syncing…") : tl("stores", "Sync now")}
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
          <EmptyState
            icon={Storefront}
            title={tl("stores", "No shops connected yet")}
            note={tl("stores", "Connect a marketplace below to start syncing orders into one queue.")}
          />
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
                      <span className="rounded-md bg-muted px-1.5 py-0.5 eg-label text-muted-foreground">
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
                      {tl("stores", " · last sync ")}{fmtDate(c.last_sync_at)}
                    </div>
                    {isAdmin && openScopes.has(c.shop_id) && c.scopes && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.scopes.split(/[\s,]+/).filter(Boolean).map((s) => (
                          <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums text-2xs text-muted-foreground">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <Button
 size="sm"
 variant="ghost"
 className="text-muted-foreground hover:text-alert"
 onClick={() => onDisconnect(c)}
 disabled={busy === c.shop_id}
                >
                  <Trash size={14} weight="bold" />
                  {busy === c.shop_id ? tl("stores", "Removing…") : tl("stores", "Disconnect")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available channels */}
      <div>
        <div className="mb-3 eg-label text-muted-foreground">{tl("stores", "Add a channel")}</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((ch, i) => (
            <motion.div
 key={ch.key}
 initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.35, delay: i * 0.05 }}
 className="flex flex-col rounded-2xl border border-border bg-card p-5"
            >
              <ChannelMark channelKey={ch.key} name={ch.name} markH={ch.markH} />
              <div className="flex-1" />
              {ch.key === "shopify" ? (
                <div className="mt-4 space-y-2">
                  <Input value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} placeholder="mystore.myshopify.com" className="h-9 text-sm" />
                  {/* NOT disabled on an empty domain. A greyed Connect is how this channel
 reads as unavailable — indistinguishable from Walmart's "Coming soon"
 to a seller who hasn't worked out that the box above it is a
 precondition. It stays lit and says what's missing when clicked. */}
                  <Button size="sm" className="w-full" disabled={busy === "connect-shopify"}
 onClick={() => {
 if (!shopDomain.trim()) {
 setNotice({ tone: "err", msg: "Enter your store above as mystore.myshopify.com, then Connect." })
 return
                      }
 setPending("shopify")
                    }}>
                    <Plus size={14} weight="bold" /> {busy === "connect-shopify" ? tl("stores", "Connecting…") : tl("stores", "Connect")}
                  </Button>
                </div>
              ) : ch.live ? (
                <Button size="sm" className="mt-4" onClick={() => setPending(ch.key as "etsy" | "tiktok")} disabled={busy === (ch.key === "tiktok" ? "connect-tiktok" : "connect")}>
                  <Plus size={14} weight="bold" />
                  {busy === (ch.key === "tiktok" ? "connect-tiktok" : "connect") ? tl("stores", "Connecting…") : tl("stores", "Connect")}
                </Button>
              ) : (
                /* A REFUSAL CARRIES ITS REASON (§4). "Coming soon" on a channel that was
                   working yesterday is the kind of thing a seller asks support about, so the
                   pill takes a `title` when the channel has one. The pill itself stays one
                   short word — it sits in a 5-unit-wide card and the sentence does not fit. */
                /* `why` fills the tooltip when a channel has a reason worth giving; `soon`
                   overrides the label. Both are unused right now — Woo, Amazon and Walmart
                   are plainly unbuilt and "Coming soon" says so — and both are kept because
                   the next channel withdrawn for a REASON should say the reason (§4) rather
                   than borrow the label for never-built. */
                <span
                  title={ch.why}
                  className={"mt-4 inline-flex h-8 items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-xs font-medium text-muted-foreground" + (ch.why ? " cursor-help" : "")}
                >
                  {/* BOTH LITERALS, not `tl("stores", ch.soon)`. A variable key works at
                      runtime but the i18n scanner cannot see it, so the string silently never
                      gets a Vietnamese entry AND the gate reports 100% — the worst of both.
                      Spelling both out keeps them extractable. */}
                  {ch.soon === "Paused" ? tl("stores", "Paused") : tl("stores", "Coming soon")}
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
 onClick={() => { setPending(null); setShowScope(false) }}
        >
          <div
 className="w-full max-w-md rounded-2xl border border-border bg-card p-5 "
 onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold">
              {extensionOnly
                ? tl("stores", "Get your Etsy orders")
                : `Import orders from ${channelName(pending)}`}
            </div>
            {/* The window question belongs to the path that can answer it. */}
            {!extensionOnly && (
              <p className="mt-1 text-sm text-muted-foreground">
                {tl("stores", "How far back should we pull existing orders? This only affects the first import — new orders always sync automatically afterward.")}
              </p>
            )}
            {pending === "tiktok" && tiktokRegion && (
              <div className="mt-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                Opens the <span className="font-medium text-foreground">{tiktokRegion === "us" ? "US" : "global"}</span> TikTok Shop
 login. If your shop is {tiktokRegion === "us" ? tl("stores", "not US") : "US"} and it can&apos;t find your account, the
 server&apos;s <code className="tabular-nums">TIKTOK_REGION</code> is set to the wrong region.
              </div>
            )}
            {/* WHAT ETSY WILL NOT SEND US, said BEFORE the shop is connected rather than
                discovered one unshippable order at a time.

                Etsy withholds the buyer's street and ZIP from an app on the restricted tier,
                so orders import complete in every respect except the one that gets a parcel
                moving. That is not a defect the seller can fix by reconnecting, and without
                this sentence the obvious reading of a blank address is that WE lost it.

                THE CARD WAS BRIEFLY MARKED "Paused" INSTEAD. That was the wrong lever: the
                extension fills addresses on orders that ALREADY EXIST — it never creates one
                — so closing Connect does not send anyone to the extension, it just means no
                Etsy orders at all. The connection is what brings the order in and what
                pushes tracking back; the extension patches the single field Etsy withholds.
                Both are needed, so the honest move is to connect and say this. */}
            {pending === "etsy" && (isStaffUser ? (
              <div className="mt-3 rounded-lg border border-hold/40 bg-hold/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{tl("stores", "Buyer addresses arrive separately.")}</span>{" "}
                {tl("stores", "Etsy does not release the street and postcode to our app, so orders import without them and cannot be shipped until they are filled in. Our browser extension reads them from your own Etsy orders page. Everything else — items, sizes, artwork, tracking back to Etsy — works from this connection.")}
              </div>
            ) : (
              /**
               * THREE STEPS, NOT A PARAGRAPH (owner, 2026-09-21).
               *
               * A seller does not connect a shop; the extension brings their orders in. The
               * prose that said so was four lines of explanation above a list of import
               * windows that do not apply to them — so the screen described the path they are
               * NOT taking and then offered choices belonging to it.
               *
               * NO PERIOD CHOOSER ON THIS PATH, and that is a fact about the extension rather
               * than a simplification: it makes ZERO requests to Etsy and reads the page the
               * seller already has open, so "past 90 days" is not something it can be asked
               * for. Offering one would promise a crawl the extension deliberately does not
               * do — see extension/src/parse.js and tools/check-extension-parse.mjs.
               */
              <>
                {/**
                  * A PICTURE OF THE BUTTON, because that is the step people get stuck on.
                  *
                  * "Press the egful icon" is a description of something the seller has never
                  * seen, in a toolbar holding a dozen other icons. The real artwork, at the
                  * size Chrome draws it, ringed where it sits — the sentence becomes a
                  * pointer instead of a riddle (owner, 2026-09-21, choosing this over the
                  * steps alone).
                  *
                  * The ring is --primary, not the icon's own periwinkle: §4 keeps hue out of
                  * the chrome, and the icon supplies all the colour this needs.
                  */}
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-2">
                  <span className="flex shrink-0 gap-1" aria-hidden="true">
                    <span className="size-1.5 rounded-full bg-border" />
                    <span className="size-1.5 rounded-full bg-border" />
                    <span className="size-1.5 rounded-full bg-border" />
                  </span>
                  {/* The seller's OWN orders page, named — so the picture matches the tab they
                      are told to open in step 2 rather than showing a generic browser. */}
                  <span className="flex h-5 min-w-0 flex-1 items-center overflow-hidden rounded-full border border-border bg-background px-2 text-[9.5px] text-muted-foreground">
                    <span className="truncate">etsy.com/your/orders</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-background p-0.5 ring-2 ring-primary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/egful-extension.png" alt="" className="size-5 rounded-[5px]" />
                  </span>
                </div>
                <div className="mt-1.5 text-xs font-medium text-foreground">
                  {tl("stores", "↑ this is the button you press")}
                </div>
                <ol className="mt-3 space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold tabular-nums text-foreground">1</span>
                    <span>{tl("stores", "Add the egful extension to Chrome.")}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold tabular-nums text-foreground">2</span>
                    <span>{tl("stores", "Open your Etsy Orders page.")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold tabular-nums text-foreground">3</span>
                    <span className="flex items-center gap-1.5">
                      {tl("stores", "Click")}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/egful-extension.png" alt="" className="inline size-4 rounded" />
                      {tl("stores", "then Sync.")}
                    </span>
                  </li>
                </ol>
                {/* WHAT IT CANNOT DO, once, where the decision is made — and in one line now.
                    The old sentence carried the whole Connect trade-off as well, four lines
                    above a chooser the seller could not use. */}
                <p className="mt-3 text-2xs text-muted-foreground">
                  {tl("stores", "It reads the page you have open. For older orders, go back a page and Sync again.")}
                </p>
              </>
            ))}
            {/* Already-synced shops: say the rule ONCE, up here, rather than repeating it on
 every greyed row. */}
            {!extensionOnly && syncedWindowFor(pending) !== null && (
              <div className="mt-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                This shop already imported{" "}
                <span className="font-medium text-foreground">
                  {SCOPE_OPTIONS.find((o) => o.days === syncedWindowFor(pending))?.label.toLowerCase() ?? `${syncedWindowFor(pending)} days`}
                </span>
                . You can widen that, but not narrow it — nothing already imported is ever removed.
              </div>
            )}
            {!extensionOnly && (
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
 title={off ? tl("stores", "Already imported a longer period — the window can only widen") : undefined}
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
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 eg-label text-primary">
                          {tl("stores", "Recommended")}
                        </span>
                      )}
                      {synced === o.days && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 eg-label text-muted-foreground">
                          {tl("stores", "Current")}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {off ? tl("stores", "Shorter than what's already imported") : o.sub}
                    </span>
                  </span>
                  {off
                    ? <Prohibit size={15} weight="bold" className="shrink-0 text-muted-foreground/70" />
 : <Plus size={15} weight="bold" className="shrink-0 text-muted-foreground" />}
                </button>
                )
              })}
            </div>
            )}
            {/**
              * CONNECT IS STILL HERE, as a line rather than as the screen.
              *
              * §6 keeps it offered to sellers — taking it away would strand everyone already
              * connected, and it is the only path that pushes tracking back to Etsy. But it
              * is the exception now, not the question the dialog opens with.
              */}
            {extensionOnly && (
              <button
 type="button"
 onClick={() => setShowScope(true)}
 className="mt-3 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {tl("stores", "Connect the shop instead")}
              </button>
            )}
            <button
 type="button"
 onClick={() => { setPending(null); setShowScope(false) }}
 className="mt-4 w-full rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {extensionOnly ? tl("stores", "Close") : tl("stores", "Cancel")}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
