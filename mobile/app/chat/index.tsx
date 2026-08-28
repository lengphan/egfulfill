import { useCallback, useState } from "react"
import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useFocusEffect, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getMe, getSupportThreads, type SupportThread } from "@/lib/api"
import { F, C, R, SECTION, TAB_BAR } from "@/lib/theme"

/**
 * CHAT — the two rooms, and nothing else.
 *
 *   Team          `staff-general`, the internal room. Any non-seller, designers included.
 *   A seller      `support-<sellerId>`, one seller's conversation with EGFULFILL. A seller
 *                 sees only their own; staff read all of them as an inbox.
 *
 * NO AI HERE, deliberately and by instruction. The assistant, the private Workbench and
 * image generation are web features — they cost real money per press and belong on a desk,
 * not on a phone carried around a factory. So there is no reply draft, no generate button
 * and no `desk-` channel on this platform. People talking to people, over the same
 * `order_messages` table the web uses, so a conversation started on either is one thread.
 */
const when = (ms?: number | null) => {
  if (!ms) return ""
  const d = Math.floor((Date.now() - ms) / 60000)
  if (d < 1) return "now"
  if (d < 60) return `${d}m`
  if (d < 1440) return `${Math.floor(d / 60)}h`
  return `${Math.floor(d / 1440)}d`
}

export default function ChatIndex() {
  const router = useRouter()
  const [role, setRole] = useState<string | null>(null)
  const [threads, setThreads] = useState<SupportThread[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const insets = useSafeAreaInsets()

  const load = useCallback(async () => {
    setErr(null)
    try {
      const me = await getMe()
      const r = String(me?.role ?? "")
      setRole(r)
      if (r && r !== "seller") {
        setThreads(await getSupportThreads())
      } else {
        /*
         * A SELLER HAS ONE CONVERSATION, so there is no list to draw — this screen would be
         * a page containing a single row. Straight into it, replacing rather than pushing so
         * Back does not land on the empty list they never asked for.
         */
        setThreads([])
        router.replace({ pathname: "/chat/[id]", params: { id: `support-${me?.sub ?? ""}`, title: "EGFULFILL Support" } })
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load chat.")
      setThreads([])
    }
  }, [router])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const isStaff = !!role && role !== "seller"

  /* ITS OWN HEADER. The root Stack runs headerShown:false, so every pushed screen in this
     app draws its own back row — see app/order/[id].tsx, which this matches deliberately
     rather than turning the native header on for one route and having two idioms. */
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 }}>
        <Text style={{ fontSize: 30, fontFamily: F.display, color: C.fg }}>Chat</Text>
      </View>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.bg }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: TAB_BAR.clearance }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.primary} />}
      >
        {threads === null && !err ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={C.primary} /></View>
        ) : err ? (
          <Text style={{ fontSize: 14, fontFamily: F.body, color: C.alert, marginTop: 16 }}>{err}</Text>
        ) : isStaff && threads ? (
          <>
            {/* THE INTERNAL ROOM FIRST. It is the one every staffer has a reason to open, and
                it is not a seller — so it is not a row in the list of sellers below. */}
            <Pressable
              onPress={() => router.push({ pathname: "/chat/[id]", params: { id: "staff-general", title: "Team" } })}
              style={({ pressed }) => ({ ...SECTION, marginTop: 8, opacity: pressed ? 0.7 : 1 })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{
                  width: 40, height: 40, borderRadius: R.pill, backgroundColor: C.ink,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="people" size={19} color={C.onInk} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontFamily: F.semi, color: C.fg }}>Team</Text>
                  <Text style={{ fontSize: 13, fontFamily: F.body, color: C.muted, marginTop: 1 }}>
                    Everyone on the floor
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.muted} />
              </View>
            </Pressable>

            <View style={{ ...SECTION }}>
              <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4 }}>
                SELLERS
              </Text>
              {threads.length === 0 ? (
                <Text style={{ fontSize: 14, fontFamily: F.body, color: C.muted, marginTop: 12 }}>
                  No seller has written yet.
                </Text>
              ) : threads.map((t) => (
                <Pressable
                  key={t.order_id}
                  onPress={() => router.push({ pathname: "/chat/[id]", params: { id: t.order_id, title: t.seller_name || "Seller" } })}
                  style={({ pressed }) => ({
                    borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 14,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 15.5, fontFamily: F.semi, color: C.fg }} numberOfLines={1}>
                      {t.seller_name || "Seller"}
                    </Text>
                    {/* UNANSWERED, not unread. The server counts messages since our last HUMAN
                        reply, so this means "needs you" rather than "is long" — which is the
                        only version of this number worth putting a colour on. */}
                    {!!t.unanswered && t.unanswered > 0 && (
                      <View style={{
                        minWidth: 20, height: 20, borderRadius: R.pill, paddingHorizontal: 6,
                        backgroundColor: C.pop, alignItems: "center", justifyContent: "center",
                      }}>
                        <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.onPop }}>{t.unanswered}</Text>
                      </View>
                    )}
                    <Text style={{ fontSize: 12.5, fontFamily: F.body, color: C.muted }}>{when(t.last_at)}</Text>
                  </View>
                  {!!t.last && (
                    <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.body, color: C.muted, marginTop: 3 }}>
                      {t.last}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}
