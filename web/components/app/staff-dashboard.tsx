"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { SquaresFour, ArrowRight, CircleNotch, Warning } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { TabBar } from "@/components/app/tab-bar"
import { StageBadge } from "@/components/app/stage-badge"
import { ShortcutsCard, type ShortcutItem } from "@/components/app/shortcuts-card"
import { GmvPanel } from "@/components/app/gmv-panel"
import { StageBracket } from "@/components/app/stage-bracket"
import { ChannelFan } from "@/components/app/channel-fan"
import { getOverview, getFactoryPnl, type Overview, type FactoryPnl } from "@/lib/api"
import { useT, useLabelT, useDateFormat } from "@/lib/i18n"
import { numOf } from "@/lib/order-format"
import { getToken, getUser } from "@/lib/auth"
import { staffNav, staffTools } from "@/lib/staff-nav"

// Whole-dollar KPI money — cents are noise at this size.
//
// USD, en-US, IN EVERY LOCALE, and deliberately so: GMV and the P&L are dollar figures
// whatever language the labels are read in. Translating the wording around a number must
// never restate the number in another currency.
const usd = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`

// Time windows the money KPIs can be read over. `since` is a cutoff timestamp; "all" = 0.
const DAY = 864e5
const RANGES = [
  { id: "today", label: "Today", sub: "today", since: () => new Date(new Date().toDateString()).getTime() },
  { id: "7d", label: "7 days", sub: "last 7 days", since: () => Date.now() - 7 * DAY },
  { id: "30d", label: "30 days", sub: "last 30 days", since: () => Date.now() - 30 * DAY },
  { id: "all", label: "All", sub: "all time", since: () => 0 },
] as const
type RangeId = (typeof RANGES)[number]["id"]


// Short blurbs for the shortcut tiles. Nav items don't carry descriptions; anything not
// listed just shows its label, which is self-explanatory for a launcher.
const SHORTCUT_DESC: Record<string, string> = {
  "/production": "Production queue",
  "/designer": "Artwork board",
  "/shipping": "Dispatch + shipments",
  "/inventory": "Stock levels + scan",
  "/purchasing": "Browse, cart + orders",
  "/finance": "Wallet + costs",
  "/broadcasts": "Seller email",
  "/sourcing": "Supplier costing",
  "/campaigns": "Ad spend",
  "/earnings": "Payouts",
  "/digitizer": "Machine files",
  "/spydeck": "Competitor research",
  "/products": "Catalog + blanks",
  "/published-catalog": "Trade shop window",
  "/design": "Design lab",
  "/stores": "Seller stores",
  "/reports": "Analytics",
  "/developers": "API keys",
}

// MiniStat went with the tile rows it existed for. Every figure it used to draw is now
// either a side figure on the money panel or a block on the stage bracket.

// Gauge went with the card it was drawn for.

// The staff home — role-meaningful KPIs off the shared order feed, a live production-line
// snapshot, a recent-orders list, and quick links into the surfaces that role actually uses.
export function StaffDashboard() {
 const t = useT()
  const fmtOn = useDateFormat()
  // Short "MMM d" for a row of dates. Was a module-scope helper pinned to en-US.
  const fmtDate = (v?: string | null) => (v ? fmtOn(v, { month: "short", day: "numeric" }) : "—")
  // KPI labels, captions, window names and shortcut blurbs are all defined as English
  // strings in data structures, so they translate through useLabelT (keyed by the value)
  // rather than being restructured into keys.
 const tl = useLabelT()
 const router = useRouter()
 const role = getUser()?.role || ""
 const name = getUser()?.name || t("dash.there")
 const isAdmin = role === "admin"
 /* isWarehouse is gone: what it used to select was two hand-written lists of stage tiles,
  * and that difference now lives in the bracket — where canSetStage decides it from the same
  * rules the server enforces, rather than from two arrays that could drift from them. */
 const [ov, setOv] = useState<Overview | null>(null)
  // Leaving orders null on failure keeps every tile at "—" instead of asserting a factory
  // with nothing in it. A staff dashboard reading all-zeros during an outage is how a
  // backlog gets missed.
 const [loadErr, setLoadErr] = useState<string | null>(null)
  // The window the money KPIs are read over. Admin-only surface, so seller-facing roles
  // never see it. Default to 30 days — a useful horizon without being all-time noise.
 const [range, setRange] = useState<RangeId>("30d")

  /**
   * ONE SMALL ANSWER, not every order.
   *
   * This called getOrders() and reduced the result six ways in the browser: 890 orders and
   * 2,321 KB of JSON to render six numbers, with every card on a skeleton until the payload
   * had crossed the wire, been parsed on the main thread and walked several times. The same
   * arithmetic runs where the rows already are now and comes back in about two kilobytes —
   * measured on production at 116ms against 217ms for a payload 1,160x larger.
   *
   * The window is part of the request, because the server does the bucketing too.
   */
 const load = useCallback(() => {
    /*
     * The no-token branch is the ONLY synchronous setState in here, and it is the whole
     * reason this used to be wrapped in setTimeout(fn, 0) — the lint rule bans setting state
     * during an effect, and the deferral bought the rule off by pushing the fetch behind a
     * macrotask. That is a frame the page spends doing nothing before it even asks.
     *
     * A microtask satisfies the rule and starts the request in the same tick. The success
     * path never needed deferring at all: its setState happens in a .then(), long after the
     * effect has returned.
     */
 if (!getToken()) { queueMicrotask(() => setLoadErr(t("dash.errSignedOut"))); return }
 const days = range === "today" ? 1 : range === "7d" ? 7 : range === "all" ? 365 : 30
 getOverview(days, isAdmin && range !== "all")
      .then((r) => { setOv(r ?? null); setLoadErr(null) })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : t("dash.errServer")))
  }, [t, range, isAdmin])
 useEffect(() => { load() }, [load])

  // Time-of-day greeting + today's date. Client component, so `new Date()` is the browser's
  // local clock — the reader's own morning, not the server's.
 const now = new Date()
 const greeting = t(now.getHours() < 12 ? "dash.goodMorning" : now.getHours() < 18 ? "dash.goodAfternoon" : "dash.goodEvening")
 const todayLabel = fmtOn(now, { weekday: "long", month: "short", day: "numeric" })

  /**
   * The floor's shape, counted by the server. This was eight filter() passes over every
   * order — the same list, walked eight times, to produce eight integers.
   */
 const c = ov?.counts
 const stats = {
 total: c?.total ?? 0,
 newCount: c?.draft ?? 0,
 review: c?.pending ?? 0,
    // Approved and Working are both "being made" as far as this tile is concerned; the
    // production line below is where the two are told apart.
 production: (c?.approved ?? 0) + (c?.working ?? 0),
 ready: c?.working ?? 0,
 shipped: c?.shipped ?? 0,
 createdToday: c?.createdToday ?? 0,
 attention: c?.onHold ?? 0,
  }

 const shippedPct = stats.total ? Math.round((stats.shipped / stats.total) * 100) : 0

  // Money read over the chosen window — revenue, platform profit, order volume and the
  // average order. All live off total/profit/created_at; nothing modelled. An order with
  // no created_at (orderTs → NaN) falls out of every window rather than landing in "today".
 const rangeMeta = RANGES.find((r) => r.id === range) ?? RANGES[2]

  /**
   * Real profit, from the ledger — not orders.total minus anything.
   *
   * `orders.total` is GMV: what a buyer paid a seller on their own marketplace. Our income
   * and our costs both land on the `factory` account as they happen, so that account IS the
   * P&L. Admin/warehouse only server-side; anyone else simply gets no card.
   */
 const [pnl, setPnl] = useState<FactoryPnl | null>(null)
 useEffect(() => {
 if (!isAdmin) return
 const days = rangeMeta.id === "today" ? 1 : rangeMeta.id === "7d" ? 7 : rangeMeta.id === "all" ? 365 : 30
    // Nothing here sets state synchronously — the fetch does it in .then() — so it starts
    // now rather than one frame from now. `live` is what stops a stale range's answer from
    // landing after a newer one.
 let live = true
 getFactoryPnl(days).then((r) => { if (live) setPnl(r) }).catch(() => { if (live) setPnl(null) })
 return () => { live = false }
  }, [isAdmin, rangeMeta])
  // Summed by the server over the same window this component asked for.
 const money = { revenue: ov?.money.gmv ?? 0, count: ov?.money.orders ?? 0, aov: ov?.money.aov ?? 0 }

  /**
   * The three figures that QUALIFY the headline, at a third its weight. Hierarchy is the
   * whole point of the panel: GMV is the number you glance at, these are what it means.
   */
 const moneySide = useMemo(() => ([
    { label: tl("kpi", "Our revenue"), value: pnl ? usd(pnl.income) : "—", sub: tl("kpisub", pnl?.known ? "we earned" : "nothing booked") },
    { label: tl("kpi", "Profit"), value: pnl?.known ? usd(pnl.profit) : "—", sub: pnl?.known ? t("kpi.afterCosts", { cost: usd(Math.abs(pnl.cost)) }) : tl("kpisub", "nothing booked") },
    { label: tl("kpi", "Orders"), value: ov === null ? "—" : String(money.count), sub: tl("rangesub", rangeMeta.sub) },
    { label: tl("kpi", "Avg order"), value: ov === null ? "—" : usd(money.aov), sub: tl("kpisub", "per order") },
  ]), [pnl, ov, money.aov, money.count, rangeMeta.sub, t, tl])

  /**
   * GMV per day across the window, scaled 0..1 — the shape of the run, nothing more.
   * Built here rather than reusing revenueSeries because that returns labelled buckets with
   * a previous-period series for the full chart, and this needs neither.
   */
  // Bucketed by the server, scaled 0..1 — the shape of the run, which is all this draws.
 const gmvBars = ov?.gmvBars ?? []

 /* WHAT NEEDS A PERSON, and only then what is recent.
  *
  * The exceptions come from the server oldest-first, because filtering `recent` for them
  * would report nothing on an account holding twelve orders none of which are among the
  * eight newest. When nothing is stuck the card falls back to the recent list rather than
  * an empty state — "nothing needs you" is good news and an empty table does not read that
  * way. The title says which of the two it is showing. */
 const attention = ov?.attention ?? []
 const showingAttention = attention.length > 0
 const recent = showingAttention ? attention : (ov?.recent ?? [])

  // The production line honours the same window the money cards use — but only where the
  // control is actually shown (admin). For roles without the toggle it stays a full,
  // unfiltered snapshot so nothing is silently hidden behind a filter they can't see.
  // "All" means the live floor; a bounded window means "orders from this window, by their
  // current stage" — which is what makes the toggle useful (e.g. where did today's intake go).
  // The window is applied by the SERVER when the toggle is visible — see load(). A role
  // without the toggle gets the live floor, because hiding orders behind a filter someone
  // cannot see is worse than showing all of them.

  // Role-tuned KPI cards. `today` is shown only where it's a real, live delta.
  // Admin gets the money view — revenue, profit, volume, average — read over the chosen
  // window; the production counts it used to show now live in the Production line chart
  // below. Warehouse/operator keep the production tiles (a bit less than admin).
 /* NO TILE ROW, for any role.
  *
  * Admin's five were GMV, Our revenue, Profit, Orders and Avg order — and the money panel
  * directly beneath them opened with the same GMV and carried three of the other four. One
  * screen said $18,665 twice, eighteen inches apart. Orders was the only figure the panel
  * did not already have, so it joined the side figures and the row went.
  *
  * The two floor roles lost theirs earlier for a different reason: their tiles were stage
  * counts in a vocabulary that had drifted from the system. Both roads end here — the money
  * is the panel, the stages are the bracket, and neither is drawn twice. */

  /* THE LADDER. `Overview.counts` is already the stage vocabulary — draft, pending,
   * approved, working, shipped, onHold — under the server's own spelling, and `line`
   * carries the per-stage channel split. Both come off one read; nothing new is fetched.
   *
   * The map is the only place the two spellings meet: the endpoint says `pending`, the
   * canonical id is `in_review`, and `""` is Draft. */
 const ladder = useMemo(() => {
 const c = ov?.counts
 const counts: Record<string, number> = {
      "": c?.draft ?? 0,
 in_review: c?.pending ?? 0,
 approved: c?.approved ?? 0,
 working: c?.working ?? 0,
 shipped: c?.shipped ?? 0,
 on_hold: c?.onHold ?? 0,
    }
 const mix: Record<string, Record<string, number>> = {}
 const oldest: Record<string, string> = {}
 for (const row of ov?.line ?? []) {
 const id = row.id === "pending" ? "in_review" : row.id === "draft" ? "" : row.id === "onHold" ? "on_hold" : row.id
 if (row.byPlatform) mix[id] = row.byPlatform
      // The STAMP, not the age. Turning it into days needs the clock, and the clock is not
      // a pure value — it is read once at render like the greeting above, not inside a memo
      // that would then have to be busted on every tick to stay true.
 if (row.oldest) oldest[id] = row.oldest
    }
    // Channel totals for the fan, summed off the same per-stage splits. One read, and the
    // fan can never disagree with the mix bars it sits beside.
 const byChannel: Record<string, number> = {}
 for (const row of ov?.line ?? []) {
 for (const [k, v] of Object.entries(row.byPlatform ?? {})) byChannel[k] = (byChannel[k] ?? 0) + v
    }
 return { counts, mix, oldest, byChannel }
  }, [ov])

 /* Biggest first, so the ramp runs dark-to-light across the arc and a channel keeps its
  * colour when a smaller one drops out of the window entirely. The server counts by
  * platform id; SLOT_OF-style capitalisation is the one place the two spellings meet. */
 const SLOT: Record<string, string> = { etsy: "Etsy", tiktok: "TikTok", shopify: "Shopify", manual: "Manual" }
 const fanSlices = Object.entries(ladder.byChannel)
   .map(([k, n]) => ({ name: SLOT[k] ?? k.charAt(0).toUpperCase() + k.slice(1), n }))
   .filter((s) => s.n > 0)
   .sort((a, b) => b.n - a.n)

 /* Stage ages, in days, off the stamps the memo carried. Read at render with the same clock
  * as the greeting — `now` is already the browser's own, and an age is only ever drawn where
  * a stage actually holds something. */
 const stageAges = Object.fromEntries(
   Object.entries(ladder.oldest).flatMap(([id, iso]) => {
 const t0 = Date.parse(iso)
 return isNaN(t0) ? [] : [[id, (now.getTime() - t0) / 86400000] as const]
   })
 )

  // Shortcut catalog = every page this role can actually reach (nav boards + tools), so the
  // launcher never offers a link that would just bounce. /overview is this page, so it's
  // dropped. The user picks and reorders from here; the choice persists per user.
 const catalog: ShortcutItem[] = useMemo(() => {
 const seen = new Set<string>()
 return [...staffNav(role), ...staffTools(role)]
      .filter((i) => i.href !== "/overview" && !seen.has(i.href) && seen.add(i.href))
      // `label` stays English here — ShortcutsCard translates it through the shared `nav.`
      // namespace, so the launcher and the sidebar can never drift apart. Only the blurb,
      // which is local to this file, is translated at source.
      .map((i) => ({ label: i.label, href: i.href, icon: i.icon, desc: SHORTCUT_DESC[i.href] ? tl("shortcut", SHORTCUT_DESC[i.href]) : undefined }))
  }, [role, tl])
  // Sensible starting set before the user customises — the first handful of their catalog.
 const shortcutDefaults = useMemo(() => catalog.slice(0, 6).map((c) => c.href), [catalog])

 return (
    /**
     * FULL-BLEED HEADER, white ground.
     *
     * This carried a tinted wash on the argument that the house white-canvas rule was
     * written for long queues and this page is only cards and a chart. That argument was
     * wrong in practice: colour behind the figures competed with the reserved status hues
     * that carry meaning elsewhere, and it made the dashboard look like a different
     * application from every page it links to. Removed 2026-08-10.
     *
     * The bleed stays. The negative margins match `eg-content`'s gutter so the header can
     * reach the shell edges without touching the shared layout, and no other board inherits
     * it — that part was never the problem.
     */
    <div
 className="-mx-4 -mt-5 -mb-5 px-4 pt-5 pb-10 md:-mx-8 md:-mt-6 md:-mb-6 md:px-8 md:pt-6"
      // NO TINTED WASH. Two radial gradients used to sit behind this header — a violet
      // bleeding into pink across the full bleed of the page. It broke the rule the rest of
      // the app follows: the canvas is white, cards are white and separated by their border,
      // and the sidebar is the one bounded block that carries colour. Colour behind the
      // numbers competes with the reserved status hues (emerald shipped, amber hold, red
      // alert) that carry meaning on the floor, and a page you read all day should not be a
      // sheet you read THROUGH. The negative margins stay: they are what lets the header sit
      // flush to the shell edges, and that was never the part doing the damage.
    >
      <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SquaresFour size={18} weight="regular" className="shrink-0 text-primary" />
          <div>
            <h1 className="font-title text-2xl font-semibold tracking-tight">{greeting}, {name}</h1>
            <p className="text-sm text-muted-foreground">
              {/* The full weekday and date went. Anyone reading this knows what day it is,
                  and it was the widest thing under their own name. What arrived today is the
                  half that is actually news, so it stands alone — and when nothing has, the
                  line is dropped rather than padded back out with a date. */}
              {stats.createdToday > 0
                ? <><span className="font-medium text-foreground">{stats.createdToday}</span> {t("dash.newToday")}</>
                : todayLabel}
            </p>
          </div>

        </div>
        {/* Money window — admin only, since the money cards are. */}
        {isAdmin && (
          <TabBar
            look="segmented"
            size="sm"
            spacing="none"
            ariaLabel={tl("range", "Date range")}
            items={RANGES.map((r) => ({ id: r.id, label: tl("range", r.label) }))}
            value={range}
            onChange={setRange}
          />
        )}
      </div>

      {loadErr && (
        <div className="flex items-start gap-2 rounded-lg border border-hold/20 bg-hold/10 px-3.5 py-2 text-xs font-medium text-hold">
          <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
          {/* The server's own message is appended untranslated — the API is English-only. */}
          <span>{t("dash.errCounts")} {loadErr}</span>
        </div>
      )}

      {/* THE FIGURE ROW. Compact tiles rather than the single money panel that was here —
 same numbers, same source, read across instead of down. `cards` is already
 role-tuned, so warehouse and operator get their production counts in the same
 shape admin gets money in.
 orders===null means NOT READ, so every tile shows — rather than 0. */}
      {/* WHERE THE WORK IS, and — for operator and warehouse — which part of it is theirs.
          A block is a link into the queue at that stage; the ones past this role's reach are
          drawn dashed and say why on hover. */}
      <div>
        {/* No label. Every block on the bracket is titled — DRAFT, PENDING, APPROVED — so a
            caption above them names a thing that already names itself. */}
        <StageBracket
 role={role}
          /* NOT isFactory. That flag is about one ORDER's path — a job the floor raised for
           * itself never sits at Pending — and this is a summary of every order, most of
           * which are sellers' and all of which pass through it. Dropping it here hid 26
           * orders from the operator whose whole job on this line is approving them. */
 counts={ladder.counts}
 mix={ladder.mix}
 ages={stageAges}
 onPick={(stage) => router.push(`/production?stage=${encodeURIComponent(stage)}`)}
        />
      </div>

      {/* Money chart + the one rate worth a gauge. Admin only, like the money itself. */}
      {isAdmin && (
        <div className="grid items-stretch gap-4">
          <div>
            <GmvPanel
              /* A WHITE CARD, not the slate band the plan drew.
               *
               * The plan's reasoning was that slate is "the app's one dark surface", which is
               * exactly backwards: the app already HAS its one dark surface, and it is the
               * rail. §4 is explicit that the sidebar carries the colour as "one bounded block
               * that is never underneath the data" — a full-width slate card in the content
               * area makes two dark blocks and puts one of them directly on the numbers.
               *
               * Everything else the band was for survives: the fan shares the card, and the
               * second row of figures sits under the headline. It was the GROUND that was
               * wrong, not the composition. */
              title={tl("kpi", "GMV")}
              headline={ov === null ? "—" : usd(money.revenue)}
              headlineSub={tl("rangesub", rangeMeta.sub)}
              side={moneySide.map((c) => ({ label: tl("kpi", c.label), value: c.value, sub: c.sub }))}
              foot={[
                { label: tl("kpi", "On hold"), value: ov === null ? "—" : String(ov.counts.onHold ?? 0) },
                { label: tl("kpi", "Avg to ship"), value: ov?.speed?.total?.days != null ? `${ov.speed.total.days}d` : "—" },
                { label: tl("kpi", "On time"), value: ov?.speed?.onTime?.pct != null ? `${ov.speed.onTime.pct}%` : "—" },
                { label: tl("kpi", "Shipped"), value: ov === null ? "—" : `${shippedPct}%` },
              ]}
              bars={gmvBars}
              aside={fanSlices.length > 1
                ? <ChannelFan slices={fanSlices} caption={tl("kpi", "orders")} />
                : undefined}
            />
          </div>

          {/* The Shipped gauge went with the tile rows. Its percentage is a figure on the
              band above and its two counts are the bracket's Shipped block and its own total
              — a dial drawn to say a number that is already written twice on the same
              screen. */}
        </div>
      )}

      {/* Speed and Production line BOTH came off this page.
       *
       * The bracket above says the count and the channel mix for every stage, and now the
       * age of the oldest thing at each one too — which was the only thing the production
       * line knew that the bracket did not. What was left was the same five counts drawn a
       * second time, on a linear scale where one big stage turns every other bar into a
       * 3px stub, so it could not show the one thing it existed for.
       *
       * Speed moved to Reports rather than being deleted. Four lead times and an on-time
       * rate are figures you review, not ones you act on standing at a machine, and Reports
       * already holds the orders they are computed from.
       *
       * The on-hold link that lived under the line is the bracket's Hold block, which
       * carries the same count and opens the same queue. */}

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title={showingAttention ? t("dash.needsPerson") : t("dash.recentOrders")} actions={<Link href="/production" className="eg-tap inline-flex items-center gap-1 text-sm text-primary hover:underline">{t("dash.openQueue")} <ArrowRight size={13} weight="bold" /></Link>}>
            {ov === null ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground"><CircleNotch size={22} className="animate-spin" /></div>
            ) : recent.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{t("dash.noOrders")}</div>
            ) : (
              <div className="divide-y divide-border">
                {/* The server sends what this row PRINTS — a number, a stage, a name, a
                    date — rather than eight orders for the browser to derive them from.
                    numOf still decides how the number reads, because a marketplace order
                    shows its own and a manual one shows ours. */}
                {recent.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="tabular-nums text-sm font-semibold">{numOf({ id: o.id, seq: o.seq ?? undefined })}</span>
                    <StageBadge status={o.stage} />
                    <span className="truncate text-sm text-muted-foreground">{o.customer || "—"}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.store || o.source || "manual"} · {fmtDate(o.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <ShortcutsCard catalog={catalog} defaults={shortcutDefaults} storageKey="eg_shortcuts_overview" />
      </div>
      </div>
    </div>
  )
}
