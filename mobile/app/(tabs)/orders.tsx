import { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getOrders, setOrderStage, getMe, type Order, type User } from "@/lib/api"
import { isOpen, isOverdue, numOf, plainNum, nextStage, lineTitle, STAGE_LABEL, STAGE_VERB } from "@/lib/orders"
import { C, R, LIFT } from "@/lib/theme"
import { OrderRow } from "@/components/order-row"

/**
 * ORDERS — a searchable list, and the way into one order.
 *
 * FlatList rather than a ScrollView of rows: this list is the length of the floor (237 open
 * on the day it was built), and mounting every row is how a phone list starts dropping
 * frames. It virtualises.
 *
 * Numbers and stage words come from lib/orders, the same rules Today counts with, so a row
 * here cannot describe an order differently from the tile that led you to it.
 *
 * SELECTION is the second thing this screen gained. Twelve orders that all need starting is
 * twelve trips into a detail screen and back, which is the point at which someone stops
 * using the phone and walks to a desk. Long-press opens selection, tap adds, and one press
 * moves them all — each to ITS OWN next stage, since a selection is rarely all at one point
 * in the pipeline.
 */
const FILTERS = ["Open", "Late", "All"] as const
type Filter = (typeof FILTERS)[number]

export default function Orders() {
  const insets = useSafeAreaInsets()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>("Open")
  const [search, setSearch] = useState("")
  const [me, setMe] = useState<User | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [selecting, setSelecting] = useState(false)
  const [moving, setMoving] = useState(false)

  const load = useCallback(async () => {
    try { setOrders(await getOrders()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load orders.") }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)) }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false)
  }, [load])

  const all = useMemo(() => orders ?? [], [orders])
  const counts = useMemo(() => ({
    Open: all.filter(isOpen).length,
    Late: all.filter(isOverdue).length,
    All: all.length,
  }), [all])

  const rows = useMemo(() => {
    const byFilter = filter === "All" ? all : filter === "Late" ? all.filter(isOverdue) : all.filter(isOpen)
    const q = search.trim().toLowerCase()
    if (!q) return byFilter
    // id AND num AND the product: a marketplace order's id (`etsy-abc`) is not the number
    // anyone reads (`#4099…`), and on the floor an order is just as often looked up by what
    // is in it as by its number.
    return byFilter.filter((o) =>
      plainNum(String(o.id)).toLowerCase().includes(q)
      || String(o.seq ?? "").includes(q)
      || String(o.id).toLowerCase().includes(q)
      || (o.items ?? []).some((it) => lineTitle(it).toLowerCase().includes(q)
        || String(it.sku ?? "").toLowerCase().includes(q)
        || String(it.blank ?? "").toLowerCase().includes(q)))
  }, [all, filter, search])

  const staff = !!me?.role && me.role !== "seller"
  const chosen = useMemo(() => rows.filter((o) => picked.includes(o.id)), [rows, picked])
  // Only the ones that can actually move. A selection of shipped orders must not offer a
  // button that would be refused for every one of them.
  const movable = useMemo(() => chosen.filter((o) => nextStage(o)), [chosen])

  const toggle = useCallback((id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }, [])

  const clearSelection = useCallback(() => { setSelecting(false); setPicked([]) }, [])

  /**
   * Move every selected order ONE step — each to its own next stage.
   *
   * Sequential, not Promise.all: this writes stage changes, reserves stock and can trigger
   * a replenishment per order, and firing twelve of those at a VPS at once is how a batch
   * turns into a timeout that leaves half the selection moved and nobody sure which half.
   *
   * Every refusal is the SERVER's sentence and every one is reported. A batch that says
   * "done" while quietly skipping three orders is worse than no batch at all.
   */
  const advanceSelected = useCallback(async () => {
    if (!movable.length) return
    setMoving(true)
    const failed: string[] = []
    for (const o of movable) {
      const to = nextStage(o)
      if (!to) continue
      try {
        const r = await setOrderStage(String(o.id), to)
        if (r.error) failed.push(`${numOf(o)}: ${r.error}`)
      } catch (e) {
        failed.push(`${numOf(o)}: ${e instanceof Error ? e.message : "failed"}`)
      }
    }
    setMoving(false)
    clearSelection()
    await load()
    if (failed.length) {
      Alert.alert(
        `${movable.length - failed.length} of ${movable.length} moved`,
        failed.slice(0, 6).join("\n\n") + (failed.length > 6 ? `\n\n…and ${failed.length - 6} more.` : ""),
      )
    }
  }, [movable, clearSelection, load])

  // One verb when the batch all agrees, the neutral one when it does not — and the count
  // inside the phrase rather than appended to it ("Start 4", not "Start this line 4").
  const batchStages = new Set(movable.map((o) => nextStage(o)))
  const n = movable.length
  const batchLabel = !n
    ? "Nothing to move"
    : batchStages.size === 1
      ? `${STAGE_VERB[[...batchStages][0] as string] ?? `Move to ${STAGE_LABEL[[...batchStages][0] as string]}`} ${n}`
      : `Move ${n} on`

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 34, fontWeight: "900", color: C.fg, marginTop: 6, letterSpacing: -1.2 }}>Orders</Text>
          {staff && orders !== null && (
            <Pressable
              onPress={() => (selecting ? clearSelection() : setSelecting(true))}
              hitSlop={10}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: selecting ? C.ink : C.accent }}
            >
              <Text style={{ fontSize: 13, fontWeight: "800", color: selecting ? C.lime : C.primary }}>
                {selecting ? "Done" : "Select"}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12,
          height: 46, borderRadius: R.md, paddingHorizontal: 12,
          backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
        }}>
          <Ionicons name="search" size={17} color={C.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Order number, product or SKU"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: C.fg, fontSize: 15 }}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={C.muted} />
            </Pressable>
          )}
        </View>

        {/* THE FILTER, as a segmented control that carries its own numbers. A chip that says
            "Late" tells you a filter exists; one that says "Late 3" is already the answer,
            and most of the time nobody needs to press it at all. */}
        <View style={{
          flexDirection: "row", marginTop: 12, padding: 4, gap: 4,
          borderRadius: R.pill, backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
        }}>
          {FILTERS.map((f) => {
            const on = f === filter
            const n = counts[f]
            const hot = f === "Late" && n > 0
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={{
                  flex: 1, height: 36, borderRadius: R.pill, gap: 6,
                  flexDirection: "row", alignItems: "center", justifyContent: "center",
                  backgroundColor: on ? C.ink : "transparent",
                }}
              >
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: on ? C.onInk : C.muted }}>{f}</Text>
                <Text style={{
                  fontSize: 12, fontWeight: "900",
                  color: on ? C.lime : hot ? C.alert : C.muted,
                }}>
                  {orders === null ? "" : n}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {orders === null && !err ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(o) => o.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + (selecting ? 110 : 24) }}
          ListEmptyComponent={
            /* Says WHICH it is. An empty list that reads the same as a failed one is how a
               broken fetch gets mistaken for a quiet day. */
            <Text style={{ color: err ? C.alert : C.muted, fontSize: 14, marginTop: 24 }}>
              {err ?? (search ? `Nothing matches “${search}”.` : `No ${filter.toLowerCase()} orders.`)}
            </Text>
          }
          renderItem={({ item }) => (
            <OrderRow
              order={item}
              selecting={selecting}
              selected={picked.includes(item.id)}
              onPress={() => (selecting ? toggle(item.id) : router.push(`/order/${encodeURIComponent(item.id)}`))}
              // Long-press opens selection anywhere, with the pressed row already in it —
              // entering a mode and then having to press the same row again is the step
              // everyone forgets to design and everyone notices.
              onLongPress={() => { if (staff) { setSelecting(true); toggle(item.id) } }}
            />
          )}
        />
      )}

      {/* THE BATCH BAR. Floats over the list rather than pushing it, so the rows do not
          jump under the thumb at the moment of choosing. */}
      {selecting && (
        <View style={{
          position: "absolute", left: 14, right: 14, bottom: insets.bottom + 10,
          flexDirection: "row", alignItems: "center", gap: 12,
          backgroundColor: C.ink, borderRadius: R.lg, padding: 12, ...LIFT,
        }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontWeight: "900", color: C.onInk }}>
              {picked.length} selected
            </Text>
            <Text style={{ fontSize: 12, color: C.onInk, opacity: 0.6, marginTop: 1 }}>
              {movable.length === picked.length
                ? "Long-press a row to add more"
                : `${picked.length - movable.length} can’t move from where they are`}
            </Text>
          </View>
          <Pressable
            onPress={advanceSelected}
            disabled={moving || !movable.length}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 8,
              paddingHorizontal: 16, height: 44, borderRadius: R.md,
              backgroundColor: movable.length ? C.lime : "#3a3446",
              opacity: pressed || moving ? 0.7 : 1,
            })}
          >
            {moving
              ? <ActivityIndicator color={C.ink} />
              : <Ionicons name="arrow-forward" size={16} color={movable.length ? C.ink : C.muted} />}
            <Text style={{ fontSize: 15, fontWeight: "900", color: movable.length ? C.ink : C.muted }}>
              {batchLabel}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}
