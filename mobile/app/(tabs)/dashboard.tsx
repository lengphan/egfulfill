import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator,
  Animated, Easing, AccessibilityInfo, Image,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { getOrders, getMe, assetUrl, type Order, type User } from "@/lib/api"
import {
  Screen, Head, HeadButton, SectionHead, Tile, TileRow, Skeleton, EmptyState, Appear, GUTTER,
} from "@/components/kit"
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
 * THREE BLOCKS, NOT FIVE. It was read back as dense, and the diagnosis was repetition rather
 * than volume: overdue and rush appeared three times (the figure, the strip, and two rows in
 * "What needs doing") and Working appeared twice (a funnel segment and "In production"). The
 * strip and the week's trend now live INSIDE the hero — they are readings of the same object
 * — the jobs card is gone, and the one row on it that said something new, Awaiting scan,
 * moved under the funnel. Two of the three section headings went with it.
 *
 * COLOUR. The status palette means an order state and nothing else, so none of it is spent on
 * quantity: the funnel is one neutral ramp light→dark, the columns are one value with today
 * picked out, and the block's bar is two greys off the block itself.
 */
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
        contentContainerStyle={{ gap: S.sm }}
        style={{ marginTop: S.lg, flexGrow: 0 }}
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
                backgroundColor: C.inkAccent, alignItems: "center", justifyContent: "center",
              }}>
                {src ? (
                  <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                ) : (
                  <Ionicons name="shirt-outline" size={22} color={C.onInk} />
                )}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: F.medium, color: C.onInk, opacity: 0.7 }}>
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
 * A PHOTO CARD — the picture is INSIDE it, not behind the page.
 *
 * Behind the page a photograph fights every word on top of it: on the sky used here, ink
 * measured 1.7:1 and white 1.1:1, because a mid blue sits between both and neither wins.
 * Inside a card the crop is a decision — each of these was chosen by scanning every window
 * of the source and taking the highest contrast under the type block, then softening the
 * lower third where the words actually sit. Ink clears 5.9:1 on both.
 *
 * The card IS the action. An earlier draft put a circular button on the corner, which is
 * one more thing to explain when the whole card is already pressable.
 */


function PhotoCard({ art, title, note, thumbs, onPress, height, top }: {
  art: number; title: string; note?: string | null
  thumbs?: string[]; onPress: () => void
  /** Space above it. The card lost its section heading, so it now owns the gap the heading
   *  used to provide. */
  top?: number
  /* AN EXPLICIT HEIGHT, not an aspectRatio. aspectRatio on an <Image> resolved against the
     file's own dimensions rather than the given width, and a 4:3 crop drew 555pt tall on a
     414pt screen — one card filling the whole home screen. A card's height is a layout
     decision anyway; it should not change because someone re-crops the art. */
  height: number
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: S.xl, marginTop: top ?? 0, borderRadius: 26, overflow: "hidden",
        opacity: pressed ? 0.92 : 1, backgroundColor: C.accent,
      })}
    >
      <Image source={art} style={{ width: "100%", height }} resizeMode="cover" />
      <View style={{ position: "absolute", left: 18, right: 18, bottom: 16 }}>
        {thumbs && thumbs.length > 0 && (
          <View style={{ flexDirection: "row", marginBottom: 10 }}>
            {thumbs.slice(0, 3).map((u, i) => (
              <Image
                key={i}
                source={{ uri: u }}
                style={{
                  width: 38, height: 38, borderRadius: R.control, backgroundColor: C.accent,
                  marginLeft: i === 0 ? 0 : -12, borderWidth: 2, borderColor: "#fff",
                }}
                resizeMode="cover"
              />
            ))}
          </View>
        )}
        <Text style={{ fontSize: height >= 200 ? 25 : 22, fontFamily: F.bold, color: C.fg, letterSpacing: -0.6 }}>
          {title}
        </Text>
        {note ? (
          <Text style={{ fontSize: 13, lineHeight: 19, fontFamily: F.body, color: C.fg, opacity: 0.75, marginTop: 5 }}>
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
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

  /* One shot, on mount, for the name in the greeting. Empty deps on purpose: an effect
     whose condition its own result could re-satisfy is the shape that took a machine down
     (CLAUDE.md 2.8), and this one has no condition at all. */
  const [me, setMe] = useState<User | null>(null)
  useEffect(() => { getMe().then(setMe).catch(() => {}) }, [])

  const hour = new Date().getHours()
  const hello = `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}${me?.name ? `, ${String(me.name).split(" ")[0]}` : ""}`

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

  /**
   * WHAT THE SCREEN COUNTS, after the cleanup.
   *
   * There were four rows here — Overdue, Rush, In production, Awaiting scan — and three of
   * them were already on the screen somewhere else: overdue and rush ARE the figure and the
   * strip, and "in production" is the funnel's Working segment with its own count beside it.
   * Saying a thing twice does not make it twice as visible; it makes the screen feel full.
   *
   * So two numbers survive: the figure's (overdue + rush, which is what "needs you" means)
   * and awaiting scan, which appears nowhere else on the page.
   */
  const needsYou = open.filter((o) => isOverdue(o) || o.rush).length
  const awaitingScan = open.filter((o) => !!o.label_printed_at && !o.label_scanned_at).length

  /* The strip's subjects: overdue first, then rush, deduped, capped at twelve — past that it
     is a queue and the queue is one tab away. */
  /* The reason, in words — the hero said "overdue and rush" under a bar, which names the
     two buckets without saying how many are in either. */
  const needsNote = useMemo(() => {
    const lateN = open.filter(isOverdue).length
    const rushN = open.filter((o) => o.rush && !isOverdue(o)).length
    /* Written as a sentence, not a tally. "3 overdue." under "3 orders need you" repeats a
       number and then abbreviates its way out of a verb. */
    const all = lateN + rushN
    const many = (n: number) => (n === all && all > 1 ? "All" : String(n))
    if (lateN && rushN) return `${lateN} are overdue and ${rushN} is marked rush.`
    if (lateN) return lateN === 1 ? "It is overdue." : `${many(lateN)} of them are overdue.`
    if (rushN) return rushN === 1 ? "It is marked rush." : `${many(rushN)} of them are marked rush.`
    return null
  }, [open])

  const shipped = useMemo(
    () => rows.filter((o) => normalizeStage(o.factory_status) === "shipped").length,
    [rows],
  )

  /* What is on the floor right now, as pictures. Capped at eight: this is a glance, and a
     strip you scroll for a minute is a list wearing a different coat. */
  const inWorks = useMemo(
    () => open
      .filter((o) => normalizeStage(o.factory_status) === "working")
      .map((o) => {
        const it = (o.items ?? [])[0]
        const uri = it ? assetUrl(it.img_ref || it.img) : null
        return uri ? { id: String(o.id), num: numOf(o), uri } : null
      })
      .filter(Boolean)
      .slice(0, 8) as { id: string; num: string; uri: string }[],
    [open],
  )

  const urgent = useMemo(() => {
    const late = open.filter(isOverdue)
    const rush = open.filter((o) => o.rush && !late.includes(o))
    return [...late, ...rush].slice(0, 12)
  }, [open])

  /* The hero card carried three faces for a while. They came off when "In the works" grew
     its own strip below: two rows of the same thumbnails on one screen is the padding this
     pass exists to remove, and on a photograph they read as stickers. */

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      {/* SETTINGS LIVES HERE. The bar went to four so each tab could carry a legible glyph
          and its word; Settings is the one you open least, and this is the screen it belongs
          to — it is where the app reports on itself. */}
      <Head
        title={hello}
        sub={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        right={
          <View style={{ flexDirection: "row", gap: S.sm }}>
            <HeadButton icon="chatbubble-ellipses-outline" label="Chat" onPress={() => router.push("/chat")} />
            <HeadButton icon="settings-outline" label="Settings" onPress={() => router.push("/(tabs)/settings")} />
          </View>
        }
      />

      {channels.length > 2 ? (
        <FilterRow value={channel} options={channels} onPick={setChannel} />
      ) : null}

      {/* LOADING IS THE SHAPE OF WHAT IS COMING, not a spinner. A spinner says something is
          happening somewhere; a skeleton says this is what will be here, and nothing jumps
          when it lands. */}
      {loading && !orders ? (
        <View style={{ paddingHorizontal: GUTTER, marginTop: S.xl, gap: 10 }}>
          <Skeleton h={228} radius={26} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Skeleton h={104} radius={26} style={{ flex: 1 }} />
            <Skeleton h={104} radius={26} style={{ flex: 1 }} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Skeleton h={104} radius={26} style={{ flex: 1 }} />
            <Skeleton h={104} radius={26} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <>
          {/* EACH BLOCK ARRIVES, one after another. A screenful that is simply already there
              is the difference between an app that feels built and one that feels assembled —
              and it is one property, because two fighting over one element never shows. */}
          <Appear index={0}>
            <PhotoCard
              height={228}
              top={S.xl}
              art={require("../../assets/card-sky.webp")}
              title={needsYou === 0 ? "Nothing needs you" : `${needsYou} ${needsYou === 1 ? "order needs" : "orders need"} you`}
              note={needsYou === 0 ? "Everything open is on time." : needsNote}
              onPress={() => router.push("/(tabs)/orders")}
            />
          </Appear>

          {/* THE CARD OWNS "needs you", so the tiles are VOLUMES and none repeats it. The
              labels are the app's own words — Working and Shipped out of STAGE_LABEL, Open a
              lens, Scan a tab — so the word on a tile is the word on the screen it opens. */}
          <Appear index={1}>
            <TileRow first>
              <Tile n={open.length} label="Open" bg={C.brand} fg={C.onBrand}
                    onPress={() => router.push("/(tabs)/orders")} />
              <Tile n={stageCounts.working ?? 0} label="Working" bg={C.lit} fg={C.onLit}
                    onPress={() => router.push({ pathname: "/(tabs)/orders", params: { lens: "Open" } })} />
            </TileRow>
          </Appear>
          <Appear index={2}>
            <TileRow>
              <Tile n={awaitingScan ?? 0} label="Scan" bg={C.acid} fg={C.onAcid}
                    onPress={() => router.push("/(tabs)/scan")} />
              <Tile n={shipped} label="Shipped" bg={C.pop} fg={C.onPop}
                    onPress={() => router.push({ pathname: "/(tabs)/orders", params: { lens: "All" } })} />
            </TileRow>
          </Appear>

          {/* WHAT IS BEING MADE, as pictures. The heading is a PLACE, not a stage: Working is
              the tile directly above, and the tile is how many there are while the floor is
              where they are. */}
          {inWorks.length > 0 && (
            <Appear index={3}>
              <SectionHead label="On the floor" action="View all"
                           onPress={() => router.push({ pathname: "/(tabs)/orders", params: { lens: "Open" } })} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingHorizontal: GUTTER }}
              >
                {inWorks.map((w) => (
                  <Pressable key={w.id} onPress={() => router.push(`/order/${encodeURIComponent(w.id)}`)}
                             style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                    <Image source={{ uri: w.uri }}
                           style={{ width: 132, height: 132, borderRadius: R.card, backgroundColor: C.accent }}
                           resizeMode="cover" />
                    <Text numberOfLines={1} style={{ width: 132, marginTop: 7, fontSize: 12.5, fontFamily: F.medium, color: C.muted }}>
                      {w.num}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Appear>
          )}
        </>
      )}

      {/* Say WHICH state this is: a failed fetch and an empty queue must never look alike. */}
      {err ? (
        <EmptyState bad icon="cloud-offline-outline" line="Couldn't load your orders"
                    note={err} action="Try again" onAction={onRefresh} />
      ) : null}
    </Screen>
  )
}
