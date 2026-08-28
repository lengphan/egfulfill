import { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getOrders, type Order } from "@/lib/api"
import { router, useFocusEffect } from "expo-router"
import { isOpen, isOverdue, normalizeStage } from "@/lib/orders"
import { TAB_BAR,F,C, R, S, CARD } from "@/lib/theme"

/**
 * TODAY — the same screen as the web shell, rebuilt with native primitives.
 *
 * The point of the spike is the FEEL, not new features: a real ScrollView with platform
 * momentum, pull-to-refresh that belongs to the OS rather than a button someone has to
 * find, and press states that respond on touch-down. That is what "clunky" was.
 *
 * The counts come from the same /api/orders every board reads, through the same rules, so
 * a number here cannot disagree with the console.
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

export default function Today() {
  const insets = useSafeAreaInsets()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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

  const open = (orders ?? []).filter(isOpen)
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top + S.lg, paddingBottom: insets.bottom + TAB_BAR.clearance + S.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      <View style={{ paddingHorizontal: S.xl }}>
        <Text style={{ fontSize: 13, color: C.muted }}>
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </Text>
        <Text style={{ marginTop: 2, fontSize: 30, fontFamily: F.display, letterSpacing: -0.5, color: C.fg }}>Today</Text>
      </View>

      {/* The one number, and it is a door. */}
      <View style={{ paddingHorizontal: S.xl, marginTop: S.lg }}>
        {/* THE ONE NUMBER, and it is a door.
            It was a filled violet slab carrying a 52pt figure — the loudest thing in the app,
            and loudest of all on the morning it reads ZERO, which is the morning that should
            feel calm. The number is still the biggest thing on the screen; it just sits on
            the page in ink like everything else, and only takes ALERT's colour when there is
            genuinely something overdue. Colour means something here or it means nothing. */}
        <View>
          <Text style={{ color: C.muted, fontSize: 11.5, fontFamily: F.semi, letterSpacing: 1.4 }}>
            NEEDS YOU NOW
          </Text>
          {/* THE PLACEHOLDER IS MUTED, and that is not a nicety. An em-dash set at 60pt in
              near-black is a solid black bar three characters wide — it reads as a redaction,
              not as "not known yet", and it is the largest thing on the screen while it is
              there. Colour is the only thing separating a figure from a waiting state here,
              so the waiting state has to be the quiet one. */}
          <Text style={{
            color: orders === null ? C.muted : needsYou > 0 ? C.alert : C.fg,
            fontSize: 60, fontFamily: F.display, marginTop: 2, letterSpacing: -1.5,
          }}>
            {orders === null ? "—" : needsYou}
          </Text>
          <Text style={{ color: C.muted, fontSize: 13.5, fontFamily: F.body, marginTop: 2 }}>
            {orders === null ? "Loading…" : needsYou === 0 ? "Nothing overdue or rushed" : "overdue and rush"}
          </Text>
        </View>
      </View>

      <Text style={{ paddingHorizontal: S.xl, marginTop: S.xl, marginBottom: S.sm, fontSize: 11.5, fontFamily: F.semi, letterSpacing: 1.4, color: C.muted }}>
        WHAT NEEDS DOING
      </Text>
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
            <Text style={{ fontSize: 17, fontFamily: F.semi, color: j.count === 0 ? C.muted : TONE[j.tone] }}>
              {orders === null ? "—" : j.count}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Say WHICH state this is: a failed fetch and an empty queue must never look alike. */}
      {err ? (
        <Text style={{ marginHorizontal: S.xl, marginTop: S.lg, color: C.alert, fontSize: 13 }}>{err}</Text>
      ) : orders === null ? (
        <ActivityIndicator style={{ marginTop: S.xl }} color={C.primary} />
      ) : null}

    </ScrollView>
  )
}
