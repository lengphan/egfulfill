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
import { useCountUp, usePressScale, useReducedMotion } from "@/lib/motion"
import { router, useFocusEffect } from "expo-router"
import { isOpen, isOverdue, normalizeStage, platformOf, numOf, lineListing } from "@/lib/orders"
import { TAB_BAR, F, C, R, S, CARD, TYPE, LADDER_FILL } from "@/lib/theme"
import { AuraCard } from "@/components/kit"
import { MomentIcon } from "@/components/moment-icon"

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
 * The ramp is four steps of the ONE action hue and finishes on `hueDeep`, so a chart of
 * where work sits is drawn in the app's own colour rather than in greys invented for it.
 * See LADDER_FILL in lib/theme.ts.
 */
const LADDER = [
  { stage: "", label: "New", fill: LADDER_FILL[0] },
  { stage: "in_review", label: "Pending", fill: LADDER_FILL[1] },
  { stage: "approved", label: "Approved", fill: LADDER_FILL[2] },
  { stage: "working", label: "Working", fill: LADDER_FILL[3] },
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
              borderRadius: R.chip,
              backgroundColor: live ? C.hueDeep : pressed ? C.hueMist : C.surface,
              borderWidth: 1.5, borderColor: live ? C.hueDeep : C.hairline,
            })}
          >
            <Text style={{
              fontSize: 13.5,
              fontFamily: live ? F.semi : F.medium,
              color: live ? "#FFFFFF" : C.muted,
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
 * THE HERO — the screen's one moment.
 *
 * IT WAS A PHOTOGRAPH: a stock sky, cropped by scanning every window of the source for the
 * highest contrast under the type block. That was the right solution to the old direction's
 * problem, which was that it had no colour of its own to make a hero out of. This one does.
 * The wash IS the brand here, so a photograph of a different sky sitting on top of it is two
 * identities on one card — and the aura is rationed precisely so that this card can spend it.
 *
 * The card IS the action. An earlier draft put a circular button in the corner, which is one
 * more thing to explain when the whole card is already pressable.
 *
 * assets/card-sky.webp and card-hill.webp are now referenced by nothing. They are left in
 * place rather than deleted — CLAUDE.md §2.2, and they are the only two photographs the app
 * ships if this is ever reversed.
 */
function HeroCard({ figure, title, note, onPress }: {
  figure: number | null
  title: string
  note?: string | null
  onPress: () => void
}) {
  const reduced = useReducedMotion()
  const press = usePressScale(reduced, 0.985)
  const shown = useCountUp(figure ?? 0, reduced)
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }], marginTop: S.lg }}>
      <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
        <AuraCard style={{ minHeight: 168, justifyContent: "flex-end", padding: 22 }}>
          {figure === null ? (
            /* ALL CLEAR is a moment in its own right, and it gets the drawn mark rather than
               a zero — "0 orders need you" is a figure you have to parse to feel good about. */
            <MomentIcon kind="done" size={64} />
          ) : (
            <Text style={{ fontSize: 56, lineHeight: 58, fontFamily: F.bold, color: C.ink, letterSpacing: -2 }}>
              {Math.round(shown)}
            </Text>
          )}
          <Text style={{ ...TYPE.h3, fontFamily: F.semi, color: C.ink, marginTop: 6 }}>{title}</Text>
          {note ? (
            <Text style={{ ...TYPE.small, fontFamily: F.body, color: C.muted, marginTop: 3 }}>{note}</Text>
          ) : null}
        </AuraCard>
      </Pressable>
    </Animated.View>
  )
}

export default function Home() {
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

  /* THE NEWEST ARRIVALS, as pictures.
     It was the working stage under the heading "On the floor" — a phrase that names nothing
     anyone would search for and duplicates the Working tile directly above it. New is a real
     stage in STAGE_LABEL and a real lens on the Orders screen, and the newest orders are the
     ones a person has not seen yet, which is the only list a home screen owes them.
     Capped at eight: this is a glance, and a strip you scroll for a minute is a list wearing
     a different coat. */
  const inWorks = useMemo(
    () => [...open]
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
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
            <HeroCard
              figure={needsYou === 0 ? null : needsYou}
              title={needsYou === 0 ? "All clear" : needsYou === 1 ? "order needs you" : "orders need you"}
              note={needsYou === 0 ? "Everything open is on time." : needsNote}
              onPress={() => router.push("/(tabs)/orders")}
            />
          </Appear>

          {/* THE CARD OWNS "needs you", so the tiles are VOLUMES and none repeats it. The
              labels are the app's own words — Working and Shipped out of STAGE_LABEL, Open a
              lens, Scan a tab — so the word on a tile is the word on the screen it opens. */}
          <Appear index={1}>
            <TileRow first>
              <Tile n={open.length} label="Open" bg={C.hueDeep} fg={"#FFFFFF"}
                    onPress={() => router.push("/(tabs)/orders")} />
              <Tile n={stageCounts.working ?? 0} label="Working" bg={C.hueMist} fg={C.hueDeep}
                    onPress={() => router.push({ pathname: "/(tabs)/orders", params: { lens: "Open" } })} />
            </TileRow>
          </Appear>
          <Appear index={2}>
            <TileRow>
              <Tile n={awaitingScan ?? 0} label="Scan" bg={C.warnTint} fg={C.warn}
                    onPress={() => router.push("/(tabs)/scan")} />
              <Tile n={shipped} label="Shipped" bg={C.successTint} fg={C.success}
                    onPress={() => router.push({ pathname: "/(tabs)/orders", params: { lens: "All" } })} />
            </TileRow>
          </Appear>

          {/* WHAT IS BEING MADE, as pictures. The heading is a PLACE, not a stage: Working is
              the tile directly above, and the tile is how many there are while the floor is
              where they are. */}
          {inWorks.length > 0 && (
            <Appear index={3}>
              <SectionHead label="New" action="View all"
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
                           style={{ width: 132, height: 132, borderRadius: R.card, backgroundColor: C.hueMist }}
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
