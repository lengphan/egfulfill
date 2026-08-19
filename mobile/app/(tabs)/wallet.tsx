import { useCallback, useEffect, useState } from "react"
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getWallet, type WalletResponse, type LedgerRow } from "@/lib/api"
import { router, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { C } from "@/lib/theme"

/**
 * WALLET — the balance, what moved it, and the way to add more.
 *
 * `low` comes from the SERVER, which owns the threshold. A client picking its own number is
 * how one screen warns while another stays quiet about the same balance.
 */
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

/** node-pg hands numerics back as strings; a ledger that renders "12.00" + "3.00" as text
 *  would sort and sign wrongly, so every row is coerced once, here. */
const delta = (r: LedgerRow) => Number(r.delta) || 0

export default function Wallet() {
  const insets = useSafeAreaInsets()
  const [w, setW] = useState<WalletResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try { setW(await getWallet()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load your wallet.") }
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

  if (w === null && !err) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20 }}>
        <Text style={{ fontSize: 32, fontWeight: "900", color: C.fg, marginTop: 8 }}>Wallet</Text>

        {/* A BALANCE IS READ OFTEN, so it is a quiet card rather than a coloured block —
            and "low" is a chip, not a repaint. Turning the whole panel red made a working
            wallet look broken, and left no louder state for something that IS broken. */}
        <View style={{
          marginTop: 16, borderRadius: 20, padding: 22,
          backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>BALANCE</Text>
            {w?.low && (
              <View style={{ paddingHorizontal: 10, height: 24, borderRadius: 12, justifyContent: "center", backgroundColor: "#fff4e5" }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: C.warn }}>
                  LOW{w.lowBelow != null ? ` · UNDER ${money(w.lowBelow)}` : ""}
                </Text>
              </View>
            )}
          </View>
          <Text style={{ color: C.fg, fontSize: 46, fontWeight: "900", marginTop: 8 }}>
            {err ? "—" : money(w?.balance ?? 0)}
          </Text>
        </View>

        <Pressable
          onPress={() => router.push("/topup")}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 12, height: 52, borderRadius: 14, backgroundColor: C.primary,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="add-circle" size={20} color={C.onPrimary} />
          <Text style={{ color: C.onPrimary, fontWeight: "800", fontSize: 16 }}>Add funds</Text>
        </Pressable>

        {err && <Text style={{ color: C.alert, fontSize: 14, marginTop: 16 }}>{err}</Text>}

        <Text style={{ fontSize: 12, fontWeight: "800", color: C.muted, letterSpacing: 1, marginTop: 24 }}>
          RECENT
        </Text>
      </View>

      <FlatList
        data={w?.ledger ?? []}
        keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <Text style={{ color: C.muted, fontSize: 14, marginTop: 16 }}>
            {err ? "Couldn't load your history." : "Nothing has moved yet."}
          </Text>
        }
        renderItem={({ item }) => {
          const d = delta(item)
          return (
            <View style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
              paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
            }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: C.fg }}>
                  {item.note || item.type}
                </Text>
                <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: "800", color: d < 0 ? C.fg : "#0a7c42" }}>
                {d < 0 ? "−" : "+"}{money(Math.abs(d))}
              </Text>
            </View>
          )
        }}
      />
    </View>
  )
}
