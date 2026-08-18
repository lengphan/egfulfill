import { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { getOrders, type Order } from "@/lib/api"
import { isOpen, isOverdue, normalizeStage, units } from "@/lib/orders"
import { C } from "@/lib/theme"

/**
 * ORDERS — a searchable list, and the way into one order.
 *
 * FlatList rather than a ScrollView of rows: this list is the length of the floor (237 open
 * on the day it was built), and mounting every row is how a phone list starts dropping
 * frames. It virtualises.
 *
 * Numbers and stage words come from lib/orders, the same rules Today counts with, so a row
 * here cannot describe an order differently from the tile that led you to it.
 */
const FILTERS = ["Open", "Overdue", "All"] as const
type Filter = (typeof FILTERS)[number]

export default function Orders() {
  const insets = useSafeAreaInsets()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>("Open")
  const [search, setSearch] = useState("")

  const load = useCallback(async () => {
    try { setOrders(await getOrders()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load orders.") }
  }, [])
  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false)
  }, [load])

  const rows = useMemo(() => {
    const all = orders ?? []
    const byFilter = filter === "All" ? all : filter === "Overdue" ? all.filter(isOverdue) : all.filter(isOpen)
    const q = search.trim().toLowerCase()
    if (!q) return byFilter
    // id AND num: a marketplace order's id (`etsy-abc`) is not the number anyone reads
    // (`#4099…`), so searching only one of them finds nothing for half the floor.
    return byFilter.filter((o) =>
      String(o.num ?? "").toLowerCase().includes(q) || String(o.id).toLowerCase().includes(q))
  }, [orders, filter, search])

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ fontSize: 32, fontWeight: "900", color: C.fg, marginTop: 8 }}>Orders</Text>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search order number"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            marginTop: 12, height: 44, borderRadius: 12, paddingHorizontal: 14,
            backgroundColor: C.accent, color: C.fg, fontSize: 15,
          }}
        />

        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          {FILTERS.map((f) => {
            const on = f === filter
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={{
                  paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: "center",
                  backgroundColor: on ? C.primary : C.accent,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: on ? C.onPrimary : C.muted }}>{f}</Text>
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
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            /* Says WHICH it is. An empty list that reads the same as a failed one is how a
               broken fetch gets mistaken for a quiet day. */
            <Text style={{ color: err ? C.alert : C.muted, fontSize: 14, marginTop: 24 }}>
              {err ?? (search ? `Nothing matches “${search}”.` : `No ${filter.toLowerCase()} orders.`)}
            </Text>
          }
          renderItem={({ item }) => {
            const late = isOverdue(item)
            return (
              <Pressable
                onPress={() => router.push(`/order/${encodeURIComponent(item.id)}`)}
                style={({ pressed }) => ({
                  paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "700", color: C.fg }}>
                      {item.num ?? item.id}
                    </Text>
                    <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                      {normalizeStage(item.factory_status)} · {units(item)} pc
                    </Text>
                  </View>
                  {late && (
                    <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: "center", backgroundColor: "#fdeaee" }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: C.alert }}>LATE</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            )
          }}
        />
      )}
    </View>
  )
}
