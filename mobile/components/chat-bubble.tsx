import { useCallback, useState } from "react"
import { Pressable, View, Text } from "react-native"
import { useRouter, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getMe, getSupportThreads } from "@/lib/api"
import { C, F, TAB_BAR } from "@/lib/theme"

/**
 * THE WAY INTO CHAT, from wherever you are.
 *
 * Chat is not a tab. The bar holds five glyphs already, and the four it holds are places you
 * GO — today's work, the orders, the scanner, the money. A conversation is something that
 * interrupts you, which is a different kind of thing and wants a different control: it sits
 * over the page, it carries a count, and it does not cost a sixth of the bar.
 *
 * It rides ABOVE the tab bar rather than beside it, using the same clearance the screens use
 * for their own bottom padding — so it never lands on the home indicator or covers the last
 * row of a list.
 *
 * THE COUNT IS "NEEDS YOU", not "unread". The server counts messages since our last HUMAN
 * reply, so an answered thread reports zero however long it is. A badge that counts length
 * teaches you to ignore it.
 *
 * A SELLER gets no count — the threads endpoint is staff-only and 403s for them, which is
 * correct and not an error worth showing. They get the bubble, which opens their one
 * conversation.
 */
export function ChatBubble() {
  const router = useRouter()
  const [waiting, setWaiting] = useState(0)

  useFocusEffect(useCallback(() => {
    let alive = true
    const tick = async () => {
      try {
        const me = await getMe()
        if (!alive || !me?.role || me.role === "seller") return
        const rows = await getSupportThreads()
        if (!alive) return
        setWaiting(rows.reduce((n, t) => n + (Number(t.unanswered) || 0), 0))
      } catch {
        /* A seller 403s here by design, and a phone with no signal should not paint an error
           over the page. Silence is the honest outcome: the bubble still opens chat. */
      }
    }
    void tick()
    // Slow on purpose. This is a badge, not the conversation — the thread screen polls at
    // six seconds while you are reading it, and this one has no reason to.
    const t = setInterval(() => { void tick() }, 45000)
    return () => { alive = false; clearInterval(t) }
  }, []))

  return (
    <Pressable
      onPress={() => router.push("/chat")}
      accessibilityLabel={waiting > 0 ? `Chat, ${waiting} waiting on you` : "Chat"}
      style={({ pressed }) => ({
        position: "absolute", right: 18, bottom: TAB_BAR.clearance + 8,
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: C.ink, alignItems: "center", justifyContent: "center",
        // iOS draws the soft shadow; Android ignores it and uses elevation. Both, or it is
        // a flat disc on one of the two platforms.
        shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
        elevation: 6,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name="chatbubble-ellipses" size={22} color={C.onInk} />
      {waiting > 0 && (
        <View style={{
          position: "absolute", top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10,
          paddingHorizontal: 5, backgroundColor: C.alert,
          alignItems: "center", justifyContent: "center",
          borderWidth: 2, borderColor: C.bg,
        }}>
          <Text style={{ fontSize: 11, fontFamily: F.semi, color: "#fff" }}>{waiting > 99 ? "99+" : waiting}</Text>
        </View>
      )}
    </Pressable>
  )
}
