import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator,
  Animated, Easing, AccessibilityInfo, Image,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { getOrders, assetUrl, type Order } from "@/lib/api"
import { router, useFocusEffect } from "expo-router"
import { isOpen, isOverdue, normalizeStage, platformOf, numOf, lineListing } from "@/lib/orders"
import { TAB_BAR, F, C, R, S, CARD } from "@/lib/theme"

/**
 * MOTION, AND THE ONE RULE IT OBEYS.
 *
 * Every animation here serves FEEDBACK, CONTINUITY or HIERARCHY, nothing is over 500ms, and
 * all of it is skipped under Reduce Motion — the screen still shows, it simply does not move.
 * That is the same contract the launch screen already keeps.
 *
 * What moves is what ARRIVED: the figure counts to its value, the bars grow to theirs. A
 * dashboard that animates on every re-render is a dashboard nobody can read, so each of
 * these runs when the numbers change and not otherwise.
 */
const D = { fast: 200, base: 320, count: 420 } as const

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduced(!!v) })
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(!!v))
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return reduced
}

/** A value that eases to its target. Under Reduce Motion it simply IS its target. */
function useGrow(target: number, reduced: boolean, duration: number = D.base, delay = 0) {
  const v = useRef(new Animated.Value(reduced ? target : 0)).current
  useEffect(() => {
    if (reduced) { v.setValue(target); return }
    const a = Animated.timing(v, {
      toValue: target, duration, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    })
    a.start()
    return () => a.stop()
  }, [target, reduced, duration, delay, v])
  return v
}

/**
 * THE FIGURE COUNTS ONCE.
 *
 * Not decoration: the count is what makes a number that CHANGED look different from a number
 * that was always there, which on a screen you glance at forty times a shift is the whole
 * job. It runs on arrival and on a real change, never on a re-render, and Reduce Motion gets
 * the final value with no steps at all.
 */
function Counter({ value, reduced, style }: { value: number; reduced: boolean; style?: object }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduced || value === from.current) { setShown(value); from.current = value; return }
    const start = Date.now()
    const a = from.current
    let raf = 0
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / D.count)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(a + (value - a) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, reduced])
  return <Text style={style}>{shown}</Text>
}

/**
 * DASHBOARD — the same numbers as the web overview, rebuilt with native primitives.
 *
 * It was called Today and it showed one figure over four rows. The figure had nothing to be
 * read against, so "7" could be a crisis or a Tuesday and the screen could not tell you
 * which; and the four rows were the only thing on it, so the shape of the work — where the
 * queue is actually piled up — was never visible at all.
 *
 * Three things carry it now, and every one of them is drawn from /api/orders, which is the
 * same payload the counts already came from. Nothing here is a figure the console does not
 * also hold:
 *
 *   1. The figure against the whole open queue — 7 OF 31, not 7.
 *   2. The pipeline as ONE proportional bar, so a pile-up is a shape rather than four numbers
 *      you have to compare in your head.
 *   3. Seven days of intake, so the screen can say how it is going and not only how bad it is.
 *
 * COLOUR. The status palette means an order state and nothing else, so none of it is spent
 * on quantity: the funnel is one neutral ramp light→dark, the intake columns are one value
 * with today picked out in ink, and the hero block's bar is two greys. The only coloured
 * things on the screen are the four job rows, where the colour IS the state.
 */
type Job = {
  key: string; label: string; count: number; tone: keyof typeof TONE; urgent?: boolean
  /** WHERE THE TILE GOES. Every one of these names a slice the Orders queue can already
   *  show, so a tile is a question asked of that screen rather than a screen of its own —
   *  which is also why they were pressable with no handler for so long: the destination
   *  did not exist until the queue grew a stage filter. */
  to: { lens?: string; stage?: string }
}

const TONE = { alert: C.alert, warn: C.warn, work: C.primary, quiet: C.muted } as const

/**
 * THE OPEN LADDER, IN ORDER, ON AN ORDINAL RAMP.
 *
 * Stages are ORDERED — they are one pipeline, not four categories — so they take a single
 * hue stepped light to dark rather than four colours. Four categorical colours here would
 * also mean four more hues on a screen that has to keep red, amber and violet meaning
 * exactly one thing each.
 *
 * The dark end is the block colour, so the ramp finishes on something already in the app
 * rather than on a fifth grey invented for a chart.
 */
const LADDER = [
  { stage: "", label: "New", fill: "#C6CBD0" },
  { stage: "in_review", label: "Pending", fill: "#A2AAB1" },
  { stage: "approved", label: "Approved", fill: "#6E7880" },
  { stage: "working", label: "Working", fill: C.ink },
] as const

const SECTION_LABEL = {
  paddingHorizontal: S.xl, marginTop: S.xl, marginBottom: S.sm,
  fontSize: 11.5, fontFamily: F.semi, letterSpacing: 1.4, color: C.muted,
} as const

/**
 * THE CHANNEL FILTER.
 *
 * A filter has to govern everything under it or it reads as broken, and this one does: the
 * platform comes off the order id, so every count, both charts and the job rows all narrow
 * together. A TIME range would not — the open queue is a state, not a window, so three
 * quarters of the screen would sit there unchanged while the control moved.
 *
 * The chips are built from the orders actually present. An empty channel is not offered:
 * a filter that yields nothing is a control that only tells you it was the wrong thing to
 * press.
 */
function FilterRow({ value, options, onPick }: {
  value: string
  options: string[]
  onPick: (v: string) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: S.xl, gap: S.sm }}
      style={{ marginTop: S.lg, flexGrow: 0 }}
    >
      {options.map((o) => {
        const live = o === value
        return (
          <Pressable
            key={o}
            onPress={() => onPick(o)}
            style={({ pressed }) => ({
              paddingHorizontal: 14, height: 34, justifyContent: "center",
              borderRadius: R.control,
              backgroundColor: live ? C.fg : pressed ? C.accent : C.card,
              borderWidth: 1, borderColor: live ? C.fg : C.border,
            })}
          >
            <Text style={{
              fontSize: 13.5,
              fontFamily: live ? F.semi : F.medium,
              color: live ? C.onPrimary : C.muted,
            }}>
              {o}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/**
 * THE ONE NUMBER, ON THE BLOCK, WITH SOMETHING TO BE READ AGAINST.
 *
 * The dark block is the app's one filled surface and this is what it is for — the thing you
 * look at from arm's length. What is new is the bar underneath: the figure is drawn as a
 * proportion of the whole open queue, which is the difference between "seven" and "seven of
 * thirty-one".
 *
 * No status colour in here. Red on slate is not a pair anyone has measured, and the block
 * already has a way to be loud: the bar. A calm morning is a short bar, which is exactly
 * how a zero morning should look.
 */
function HeroFigure({ needsYou, openTotal, loading, reduced }: {
  needsYou: number
  openTotal: number
  loading: boolean
  reduced: boolean
}) {
  const share = openTotal > 0 ? Math.min(1, needsYou / openTotal) : 0
  const grown = useGrow(loading ? 0 : share, reduced)
  return (
    <View style={{
      marginHorizontal: S.xl, marginTop: S.lg,
      backgroundColor: C.ink, borderRadius: R.card, padding: S.xl,
    }}>
      <Text style={{ color: C.onInk, opacity: 0.75, fontSize: 11.5, fontFamily: F.semi, letterSpacing: 1.4 }}>
        NEEDS YOU NOW
      </Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: S.sm, marginTop: 2 }}>
        {/* The placeholder stays QUIET. An em-dash at 60pt in the brightest ink on the block
            is a bar three characters wide, and it reads as a redaction rather than as "not
            known yet" — while being the largest thing on the screen. */}
        {loading ? (
          <Text style={{ color: C.inkAccent, fontSize: 60, fontFamily: F.display, letterSpacing: -1.5 }}>—</Text>
        ) : (
          <Counter
            value={needsYou}
            reduced={reduced}
            style={{ color: C.onInk, fontSize: 60, fontFamily: F.display, letterSpacing: -1.5 }}
          />
        )}
        {!loading && openTotal > 0 ? (
          <Text style={{ color: C.onInk, opacity: 0.7, fontSize: 15, fontFamily: F.medium }}>
            of {openTotal} open
          </Text>
        ) : null}
      </View>

      {/* VALUE, NOT HUE. Two greys off the block itself: the track is the block one step up,
          the fill is the block's own ink. It survives greyscale, which a red-on-slate bar
          would have to be measured to claim. */}
      <View style={{
        height: 6, borderRadius: R.pill, backgroundColor: C.inkAccent,
        marginTop: S.lg, overflow: "hidden",
      }}>
        <Animated.View style={{
          width: grown.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          height: "100%", borderRadius: R.pill, backgroundColor: C.onInk,
        }} />
      </View>

      <Text style={{ color: C.onInk, opacity: 0.7, fontSize: 13, fontFamily: F.body, marginTop: S.sm }}>
        {loading ? "Loading…" : needsYou === 0 ? "Nothing overdue or rushed" : "overdue and rush"}
      </Text>
    </View>
  )
}

/**
 * THE ONLY PICTURES ON THE SCREEN, AND THEY ARE REAL.
 *
 * A dashboard is where decorative imagery goes to be meaningless — a stock photograph of a
 * factory costs a download and tells an operator nothing. So the imagery here is the WORK:
 * the orders that are overdue or rushed, as the things they are, in the order you would pick
 * them up. Tapping one opens it.
 *
 * These are the marketplace's listing photos, not artwork — the list payload does not carry
 * design files, and lineArt is explicit that a product photo must never stand in for one. So
 * the strip is never labelled as artwork, and a line with no photo shows its order number on
 * a plain ground rather than borrowing a picture from somewhere else.
 *
 * It only exists when something is wrong. On a calm morning there is nothing here at all,
 * which is the same argument as the peek: a signal, not chrome.
 */
function NeedsYouStrip({ orders, reduced }: { orders: Order[]; reduced: boolean }) {
  const fade = useGrow(1, reduced, D.fast)
  if (!orders.length) return null
  return (
    <Animated.View style={{ opacity: fade }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: S.xl, gap: S.sm }}
        style={{ marginTop: S.sm, flexGrow: 0 }}
      >
        {orders.map((o) => {
          const src = assetUrl(lineListing(o.items?.[0] ?? {}))
          return (
            <Pressable
              key={o.id}
              onPress={() => router.push(`/order/${encodeURIComponent(o.id)}`)}
              style={({ pressed }) => ({ width: 68, opacity: pressed ? 0.7 : 1, gap: 5 })}
            >
              <View style={{
                width: 68, height: 68, borderRadius: R.badge, overflow: "hidden",
                backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
                borderWidth: 1, borderColor: C.border,
              }}>
                {src ? (
                  <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                ) : (
                  <Ionicons name="shirt-outline" size={22} color={C.muted} />
                )}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: F.medium, color: C.muted }}>
                {numOf(o)}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </Animated.View>
  )
}

/**
 * THE PIPELINE AS ONE BAR.
 *
 * Four separate tracks was the web's problem too: with hundreds in New and a handful in
 * Working, a shared linear scale makes every later stage a three-pixel stub, so the chart
 * cannot show the one thing it exists for — where the work is piling up. Proportion survives
 * a range that magnitude does not.
 *
 * A stage with anything in it keeps a visible sliver (minWidth), because "a few" and "none"
 * are different answers and a 0.4% segment would round to neither.
 */
function Funnel({ counts, loading }: { counts: Record<string, number>; loading: boolean }) {
  const total = LADDER.reduce((n, s) => n + (counts[s.stage] ?? 0), 0)
  return (
    <View style={{ ...CARD, marginHorizontal: S.xl, padding: S.lg }}>
      <View style={{ flexDirection: "row", height: 14, gap: 2 }}>
        {LADDER.map((s) => {
          const n = counts[s.stage] ?? 0
          if (total > 0 && n === 0) return null
          return (
            <View
              key={s.stage || "new"}
              style={{
                flexGrow: total > 0 ? n : 1, flexBasis: 0, minWidth: 8,
                borderRadius: R.badge,
                backgroundColor: loading || total === 0 ? C.accent : s.fill,
              }}
            />
          )
        })}
      </View>

      <View style={{ marginTop: S.md }}>
        {LADDER.map((s, i) => (
          <Pressable
            key={s.stage || "new"}
            onPress={() => router.push({
              pathname: "/(tabs)/orders",
              params: s.stage ? { lens: "Open", stage: s.stage } : { lens: "Open" },
            })}
            disabled={(counts[s.stage] ?? 0) === 0}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: S.md,
              paddingVertical: 9,
              borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border,
              backgroundColor: pressed ? C.accent : "transparent",
            })}
          >
            <View style={{ width: 10, height: 10, borderRadius: R.badge / 2, backgroundColor: s.fill }} />
            <Text style={{ flex: 1, fontSize: 14.5, fontFamily: F.medium, color: C.fg }}>{s.label}</Text>
            <Text style={{
              fontSize: 15, fontFamily: F.semi, fontVariant: ["tabular-nums"],
              color: (counts[s.stage] ?? 0) === 0 ? C.muted : C.fg,
            }}>
              {loading ? "—" : counts[s.stage] ?? 0}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/**
 * SEVEN DAYS OF INTAKE.
 *
 * The screen could say how bad it is and could not say how it is going. This is the cheapest
 * honest answer to the second question: orders CREATED per day for the last seven, off
 * `created_at`, which every row carries.
 *
 * It is deliberately not "shipped per day". There is no shipped timestamp on this payload —
 * `label_scanned_at` is a pre-scan mark and not a dispatch — and a throughput chart built on
 * the nearest-looking column would be a confident wrong answer rather than a missing one.
 */
function Column({ height, today, letter, loading, reduced, delay }: {
  height: number; today: boolean; letter: string; loading: boolean; reduced: boolean; delay: number
}) {
  /* The columns RISE, oldest first. Left-to-right is the direction the axis is read in, so
     the stagger is the reading order rather than a flourish — and at 30ms apart the whole
     week is up in a fifth of a second. */
  const h = useGrow(height, reduced, D.fast, delay)
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
      <Animated.View style={{
        width: "100%", height: h, borderRadius: R.badge,
        backgroundColor: loading ? C.accent : today ? C.fg : C.edge,
      }} />
      <Text style={{
        fontSize: 10.5,
        fontFamily: today ? F.semi : F.body,
        color: today ? C.fg : C.muted,
      }}>
        {letter}
      </Text>
    </View>
  )
}

function Intake({ days, loading, reduced }: {
  days: { key: string; letter: string; n: number }[]; loading: boolean; reduced: boolean
}) {
  const peak = Math.max(1, ...days.map((d) => d.n))
  const total = days.reduce((n, d) => n + d.n, 0)
  return (
    <View style={{ ...CARD, marginHorizontal: S.xl, padding: S.lg }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: S.sm, height: 72 }}>
        {days.map((d, i) => (
          <Column
            key={d.key}
            /* A day with nothing gets a 3pt baseline rather than no bar: an absent column
               and a zero column must not look like the same day. */
            height={loading ? 3 : Math.max(3, Math.round((d.n / peak) * 52))}
            today={i === days.length - 1}
            letter={d.letter}
            loading={loading}
            reduced={reduced}
            delay={i * 30}
          />
        ))}
      </View>
      <Text style={{ marginTop: S.md, fontSize: 13, fontFamily: F.body, color: C.muted }}>
        {loading ? "Loading…" : `${total} in seven days`}
      </Text>
    </View>
  )
}

export default function Dashboard() {
  const insets = useSafeAreaInsets()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [channel, setChannel] = useState("All")
  const reduced = useReducedMotion()

  const load = useCallback(async () => {
    try { setOrders(await getOrders()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load orders.") }
  }, [])

  /**
   * REFETCH WHEN THE SCREEN COMES BACK.
   *
   * These tabs loaded once on mount and never again, so returning from an action showed
   * the numbers from before it: submit an order, come back to Wallet, and the balance is
   * the old one until you pull to refresh. A tab bar makes that constant — you leave and
   * return to these screens dozens of times an hour, and every arrival was stale.
   *
   * useFocusEffect, not an interval: the trigger is arriving at the screen, which is
   * exactly when a person is about to read it. Polling would fetch while nobody is
   * looking and still be stale at the moment they arrive.
   */
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false)
  }, [load])

  /* Only the channels that are actually represented, All first. */
  const channels = useMemo(() => {
    const seen = new Set<string>()
    for (const o of orders ?? []) {
      const p = platformOf(o)
      if (p) seen.add(p)
    }
    return ["All", ...Array.from(seen).sort()]
  }, [orders])

  const rows = useMemo(
    () => (orders ?? []).filter((o) => channel === "All" || platformOf(o) === channel),
    [orders, channel],
  )

  const open = rows.filter(isOpen)
  const loading = orders === null

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of open) {
      const s = normalizeStage(o.factory_status)
      c[s] = (c[s] ?? 0) + 1
    }
    return c
  }, [open])

  /**
   * SEVEN BUCKETS, OLDEST FIRST, TODAY LAST.
   *
   * Built from a local-midnight walk rather than by dividing timestamps: a day is what the
   * person reading it calls a day, and a 24h-modulo bucket drifts off it the moment a clock
   * changes.
   */
  const days = useMemo(() => {
    const out: { key: string; letter: string; n: number }[] = []
    const start = new Date(); start.setHours(0, 0, 0, 0)
    for (let i = 6; i >= 0; i--) {
      const from = new Date(start); from.setDate(from.getDate() - i)
      const to = new Date(from); to.setDate(to.getDate() + 1)
      const n = rows.filter((o) => {
        if (!o.created_at) return false
        const t = new Date(o.created_at).getTime()
        return t >= from.getTime() && t < to.getTime()
      }).length
      out.push({
        key: from.toISOString().slice(0, 10),
        letter: from.toLocaleDateString(undefined, { weekday: "narrow" }),
        n,
      })
    }
    return out
  }, [rows])

  const jobs: Job[] = [
    { key: "overdue", label: "Overdue", tone: "alert", urgent: true,
      count: open.filter(isOverdue).length, to: { lens: "Late" } },
    /* Rush has no filter of its own on the queue yet, so this opens the open orders and is
       honest about being one step short rather than pretending to a slice that isn't there. */
    { key: "rush", label: "Rush", tone: "warn", urgent: true,
      count: open.filter((o) => o.rush).length, to: { lens: "Open" } },
    { key: "working", label: "In production", tone: "work",
      count: open.filter((o) => normalizeStage(o.factory_status) === "working").length,
      to: { lens: "Open", stage: "working" } },
    { key: "scan", label: "Awaiting scan", tone: "quiet",
      count: open.filter((o) => !!o.label_printed_at && !o.label_scanned_at).length,
      to: { lens: "Open" } },
  ]
  const needsYou = jobs.filter((j) => j.urgent).reduce((n, j) => n + j.count, 0)

  /* The strip's subjects: overdue first, then rush, deduped, capped at twelve — past that it
     is a queue and the queue is one tab away. */
  const urgent = useMemo(() => {
    const late = open.filter(isOverdue)
    const rush = open.filter((o) => o.rush && !late.includes(o))
    return [...late, ...rush].slice(0, 12)
  }, [open])

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top + S.lg, paddingBottom: insets.bottom + TAB_BAR.clearance + S.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      {/* SETTINGS LIVES HERE NOW. The bar went to four so each tab could carry a legible
          glyph and its word; Settings is the one of the five you open least, and this is the
          screen it belongs to — it is where the app reports on itself. */}
      <View style={{ paddingHorizontal: S.xl, flexDirection: "row", alignItems: "flex-start", gap: S.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, color: C.muted }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </Text>
          <Text style={{ marginTop: 2, fontSize: 30, fontFamily: F.display, letterSpacing: -0.5, color: C.fg }}>Dashboard</Text>
        </View>
        {/* A BORDERED CONTROL, NOT A LOOSE GLYPH. It shipped as a bare 22pt outline in muted
            ink against a big display heading, and the first person to look for Settings did
            not find it — which, with the tab gone, is the same as having deleted it. Shape
            says kind here as everywhere else: this is something you press, so it has the
            edge a control has. */}
        {/* CHAT'S PERMANENT ROUTE. The peek only exists while someone is waiting, and a
            seller never gets one at all — the count is staff-only. So this is not a
            convenience, it is the door: without it the feature would be reachable only when
            the app decided to offer it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Chat"
          onPress={() => router.push("/chat")}
          hitSlop={10}
          style={({ pressed }) => ({
            width: 40, height: 40, marginTop: 2,
            alignItems: "center", justifyContent: "center",
            borderRadius: R.control,
            borderWidth: 1, borderColor: C.border,
            backgroundColor: pressed ? C.accent : C.card,
          })}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.fg} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push("/(tabs)/settings")}
          hitSlop={10}
          style={({ pressed }) => ({
            width: 40, height: 40, marginTop: 2,
            alignItems: "center", justifyContent: "center",
            borderRadius: R.control,
            borderWidth: 1, borderColor: C.border,
            backgroundColor: pressed ? C.accent : C.card,
          })}
        >
          <Ionicons name="settings-outline" size={20} color={C.fg} />
        </Pressable>
      </View>

      {channels.length > 2 ? (
        <FilterRow value={channel} options={channels} onPick={setChannel} />
      ) : null}

      <HeroFigure needsYou={needsYou} openTotal={open.length} loading={loading} reduced={reduced} />

      <NeedsYouStrip orders={urgent} reduced={reduced} />

      <Text style={SECTION_LABEL}>WHERE THE WORK IS</Text>
      <Funnel counts={stageCounts} loading={loading} />

      <Text style={SECTION_LABEL}>ORDERS IN</Text>
      <Intake days={days} loading={loading} reduced={reduced} />

      <Text style={SECTION_LABEL}>WHAT NEEDS DOING</Text>
      {/* A GROUP IS A CARD. These rows sat straight on the page under a hairline, which was
          right when the page was white and nothing could be a surface. On the tinted page a
          white card is what says "these four belong together", and it costs no shadow to do
          it. The last row loses its rule so the card's own edge finishes the stack. */}
      <View style={{ ...CARD, marginHorizontal: S.xl, overflow: "hidden" }}>
        {jobs.map((j, i) => (
          <Pressable
            key={j.key}
            onPress={() => router.push({ pathname: "/(tabs)/orders", params: j.to })}
            /* Nothing to press when the count is zero — a tile that opens an empty list is
               a worse answer than the zero already on it. */
            disabled={j.count === 0}
            /* Press feedback on touch-DOWN, which is the tell people read as "native". */
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: S.md,
              paddingVertical: 15, paddingHorizontal: S.lg,
              borderBottomWidth: i === jobs.length - 1 ? 0 : 1, borderBottomColor: C.border,
              backgroundColor: pressed ? C.accent : "transparent",
            })}
          >
            <View style={{ width: 6, height: 6, borderRadius: R.pill, backgroundColor: TONE[j.tone] }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontFamily: F.medium, color: C.fg }}>{j.label}</Text>
            </View>
            <Text style={{
              fontSize: 17, fontFamily: F.semi, fontVariant: ["tabular-nums"],
              color: j.count === 0 ? C.muted : TONE[j.tone],
            }}>
              {loading ? "—" : j.count}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Say WHICH state this is: a failed fetch and an empty queue must never look alike. */}
      {err ? (
        <Text style={{ marginHorizontal: S.xl, marginTop: S.lg, color: C.alert, fontSize: 13 }}>{err}</Text>
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: S.xl }} color={C.primary} />
      ) : null}

    </ScrollView>
  )
}
