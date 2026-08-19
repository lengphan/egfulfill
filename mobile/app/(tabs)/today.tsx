import { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getOrders, type Order } from "@/lib/api"
import { router, useFocusEffect } from "expo-router"
import { isOpen, isOverdue, normalizeStage } from "@/lib/orders"
import { F,C, S } from "@/lib/theme"

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
      contentContainerStyle={{ paddingTop: insets.top + S.lg, paddingBottom: insets.bottom + S.xl * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      <View style={{ paddingHorizontal: S.xl }}>
        <Text style={{ fontSize: 13, color: C.muted }}>
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </Text>
        <Text style={{ marginTop: 2, fontSize: 32, fontFamily: F.bold, letterSpacing: -0.8, color: C.fg }}>Today</Text>
      </View>

      {/* The one number, and it is a door. */}
      <View style={{ paddingHorizontal: S.xl, marginTop: S.lg }}>
        <View style={{ borderRadius: 20, backgroundColor: C.primary, padding: S.xl }}>
          <Text style={{ color: C.onPrimary, opacity: 0.85, fontSize: 11, fontFamily: F.semi, letterSpacing: 1 }}>
            NEEDS YOU NOW
          </Text>
          <Text style={{ color: C.onPrimary, fontSize: 52, fontFamily: F.bold, marginTop: 6 }}>
            {orders === null ? "—" : needsYou}
          </Text>
          <Text style={{ color: C.onPrimary, opacity: 0.75, fontSize: 12, marginTop: 4 }}>
            {orders === null ? "Loading…" : needsYou === 0 ? "Nothing overdue or rushed" : "overdue and rush"}
          </Text>
        </View>
      </View>

      <Text style={{ paddingHorizontal: S.xl, marginTop: S.xl, marginBottom: S.sm, fontSize: 11, fontFamily: F.semi, letterSpacing: 1, color: C.muted }}>
        WHAT NEEDS DOING
      </Text>
      <View style={{ marginHorizontal: S.xl, borderRadius: 20, borderWidth: 1, borderColor: C.border, overflow: "hidden" }}>
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
              paddingHorizontal: S.lg, paddingVertical: 14,
              borderTopWidth: i ? 1 : 0, borderTopColor: C.border,
              backgroundColor: pressed ? C.accent : C.card,
            })}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TONE[j.tone] }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontFamily: F.medium, color: C.fg }}>{j.label}</Text>
            </View>
            <Text style={{ fontSize: 18, fontFamily: F.bold, color: TONE[j.tone] }}>
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
