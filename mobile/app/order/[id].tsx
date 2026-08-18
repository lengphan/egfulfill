import { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useLocalSearchParams, router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getOrder, getOrderMessages, getMe, type Order, type ChatEntry, type User } from "@/lib/api"
import { normalizeStage, units, isOverdue, numOf, platformOf } from "@/lib/orders"
import { C } from "@/lib/theme"
import { PackagePhoto, ActivityRow } from "@/components/package-photo"

/**
 * ONE ORDER — mainly so a tracking number can be read, and followed, from a phone.
 *
 * Tracking is the reason this screen exists on a phone at all: it is the question asked
 * away from a desk. Everything else here is context for it.
 */

/** Carrier tracking pages. Only carriers we actually ship with — a guessed URL that 404s is
 *  worse than showing the bare number, because it looks like the order is untraceable. */
const TRACK_URL: Record<string, (code: string) => string> = {
  usps: (c) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(c)}`,
  ups: (c) => `https://www.ups.com/track?tracknum=${encodeURIComponent(c)}`,
  fedex: (c) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(c)}`,
  dhl: (c) => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(c)}`,
}

function trackingLink(carrier?: string | null, code?: string | null) {
  if (!code) return null
  const key = String(carrier || "").trim().toLowerCase()
  const make = TRACK_URL[key]
  return make ? make(code) : null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", gap: 16,
      paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border,
    }}>
      <Text style={{ fontSize: 14, color: C.muted }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: "600", color: C.fg, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  )
}

export default function OrderDetail() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [o, setO] = useState<Order | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activity, setActivity] = useState<ChatEntry[] | null>(null)
  const [me, setMe] = useState<User | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try { setO(await getOrder(String(id))); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load this order.") }
  }, [id])

  // Separate from the order fetch: a failing activity thread should not blank the tracking
  // number, which is what the screen is actually opened for.
  const loadActivity = useCallback(async () => {
    if (!id) return
    try { setActivity(await getOrderMessages(String(id))) } catch { setActivity([]) }
  }, [id])

  useEffect(() => { load(); loadActivity() }, [load, loadActivity])
  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)) }, [])

  const code = o?.tracking ?? null
  const link = trackingLink(o?.carrier, code)

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Pressable
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={C.primary} />
        <Text style={{ color: C.primary, fontSize: 16 }}>Orders</Text>
      </Pressable>

      {!o && !err ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : err ? (
        <Text style={{ color: C.alert, fontSize: 14, paddingHorizontal: 20, marginTop: 12 }}>{err}</Text>
      ) : o ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
          <Text style={{ fontSize: 34, fontWeight: "900", color: C.fg }}>{numOf(o)}</Text>
          <Text style={{ fontSize: 16, color: C.muted, marginTop: 4 }}>
            {platformOf(o)} · {normalizeStage(o.factory_status)}{isOverdue(o) ? " · late" : ""}
          </Text>

          {/* TRACKING FIRST — the thing this screen is opened for. */}
          <View style={{ marginTop: 20, borderRadius: 16, padding: 18, backgroundColor: C.accent }}>
            <Text style={{ fontSize: 12, fontWeight: "800", color: C.muted, letterSpacing: 1 }}>TRACKING</Text>
            {code ? (
              <>
                <Text selectable style={{ fontSize: 19, fontWeight: "800", color: C.fg, marginTop: 8 }}>{code}</Text>
                {o.carrier ? <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{o.carrier}</Text> : null}
                {link && (
                  <Pressable
                    onPress={() => Linking.openURL(link)}
                    style={({ pressed }) => ({
                      marginTop: 14, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center",
                      backgroundColor: C.primary, opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={{ color: C.onPrimary, fontWeight: "800", fontSize: 15 }}>Track shipment</Text>
                  </Pressable>
                )}
              </>
            ) : (
              /* Not shipped is a FACT, not a blank. An empty panel here would be
                 indistinguishable from a screen that failed to load it. */
              <Text style={{ fontSize: 15, color: C.muted, marginTop: 8 }}>
                Not shipped yet — no tracking number.
              </Text>
            )}
          </View>

          <View style={{ marginTop: 24 }}>
            <Row label="Pieces" value={`${units(o)}`} />
            {o.status ? <Row label="Status" value={String(o.status)} /> : null}
            {o.ship_by ? <Row label="Ship by" value={new Date(o.ship_by).toLocaleDateString()} /> : null}
            {o.created_at ? <Row label="Placed" value={new Date(o.created_at).toLocaleDateString()} /> : null}
            {o.total != null ? <Row label="Total" value={`$${(Number(o.total) || 0).toFixed(2)}`} /> : null}
          </View>

          {/* THE PROOF SHOT. Lives on the order screen because that is where the parcel is
              when the photo is worth taking. */}
          <View style={{ marginTop: 28 }}>
            <PackagePhoto
              orderId={String(o.id)}
              role={me?.role}
              by={me?.name}
              onPosted={loadActivity}
            />
          </View>

          <Text style={{ fontSize: 12, fontWeight: "800", color: C.muted, letterSpacing: 1, marginTop: 28 }}>
            ACTIVITY
          </Text>
          <View style={{ marginTop: 4 }}>
            {activity === null
              ? <ActivityIndicator style={{ marginTop: 16 }} color={C.primary} />
              : activity.length === 0
                ? <Text style={{ fontSize: 15, color: C.muted, paddingVertical: 14 }}>Nothing logged yet.</Text>
                : activity.slice().reverse().map((e) => <ActivityRow key={String(e.id)} e={e} />)}
          </View>
        </ScrollView>
      ) : null}
    </View>
  )
}
