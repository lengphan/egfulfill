import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, View, Text, Animated, Easing, AccessibilityInfo, ActivityIndicator, ScrollView } from "react-native"
import { useRouter, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getMe, getSupportThreads, getOrderMessages, type SupportThread, type ChatEntry } from "@/lib/api"
import { C, F, R, S, TAB_BAR } from "@/lib/theme"

/**
 * THE PEEK — what replaced the floating disc.
 *
 * The disc was the most templated pattern on mobile, and it had three faults that are worth
 * writing down because each one is a rule elsewhere in this app:
 *
 *   1. It was PERMANENT CHROME. Every screen, same corner, always there — and it carried the
 *      one bright colour in the palette on its badge. An accent that is always on screen is
 *      a background, which is the same argument that moved the tab indicator off rose.
 *   2. It SAT ON the last row of every list. A control that covers content it does not
 *      belong to is borrowed space.
 *   3. It said nothing. A disc with a count tells you a number and makes you open a screen
 *      to learn what the number is about.
 *
 * So it only exists while somebody is waiting, it says WHO and WHAT, and it expands in place
 * into the conversation rather than navigating away from what you were doing. Its presence
 * IS the notification — the same reasoning as the batch bar: a signal, not chrome.
 *
 * THE COUNT IS "NEEDS YOU", not "unread". The server counts messages since our last HUMAN
 * reply, so an answered thread reports zero however long it is. A badge that counts length
 * teaches you to ignore it.
 *
 * A SELLER NEVER SEES THIS. The threads endpoint is staff-only and 403s for them, which is
 * correct — so a seller's route into chat is the control on the Dashboard header, and that
 * is not optional: it is the only one they have.
 */
const PEEK_H = 58
const OPEN_H = 380

export function ChatPeek() {
  const router = useRouter()
  const [threads, setThreads] = useState<SupportThread[]>([])
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<ChatEntry[] | null>(null)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduced(!!v) })
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(!!v))
    return () => { alive = false; sub?.remove?.() }
  }, [])

  useFocusEffect(useCallback(() => {
    let alive = true
    const tick = async () => {
      try {
        const me = await getMe()
        if (!alive || !me?.role || me.role === "seller") return
        const rows = await getSupportThreads()
        if (!alive) return
        setThreads(rows.filter((t) => (Number(t.unanswered) || 0) > 0))
      } catch {
        /* A seller 403s here by design, and a phone with no signal should not paint an error
           over the page. Silence is the honest outcome — the header control still opens chat. */
      }
    }
    void tick()
    // Slow on purpose. This is a signal, not the conversation — the thread screen polls at
    // six seconds while you are reading it, and this one has no reason to.
    const t = setInterval(() => { void tick() }, 45000)
    return () => { alive = false; clearInterval(t) }
  }, []))

  const top = threads[0]
  const waiting = threads.reduce((n, t) => n + (Number(t.unanswered) || 0), 0)

  /* THE PANEL GROWS FROM THE PEEK, it does not appear over it. The peek is anchored to the
     bottom, so growing the height upward reads as the same object opening — which is what
     makes the close feel like putting it back rather than dismissing a dialog. */
  const scroller = useRef<ScrollView | null>(null)
  const h = useRef(new Animated.Value(PEEK_H)).current
  useEffect(() => {
    const to = open ? OPEN_H : PEEK_H
    if (reduced) { h.setValue(to); return }
    const a = Animated.timing(h, {
      toValue: to, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    })
    a.start()
    return () => a.stop()
  }, [open, reduced, h])

  /* The conversation is fetched only when it is actually opened. A peek that pre-loads every
     waiting thread is a poll with extra steps. */
  useEffect(() => {
    if (!open || !top?.order_id) return
    let alive = true
    setMsgs(null)
    getOrderMessages(top.order_id)
      /* Thirty, not six. Six was chosen when the panel could not scroll, so it was a cap
         standing in for a scrollbar; with one, the only reason to cut is the payload. */
      .then((rows) => { if (alive) setMsgs(rows.slice(-30)) })
      .catch(() => { if (alive) setMsgs([]) })
    return () => { alive = false }
  }, [open, top?.order_id])

  /* NOTHING IS WAITING, NOTHING IS DRAWN. */
  if (!top || waiting === 0) return null

  return (
    <Animated.View
      style={{
        position: "absolute", left: 16, right: 16, bottom: TAB_BAR.clearance + 8,
        height: h, borderRadius: R.card, backgroundColor: C.ink, overflow: "hidden",
      }}
    >
      {/* THE HEAD — who, and the line they sent. Pressing it opens; pressing it again closes,
          so the same object is the handle both ways. */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? "Close conversation" : `${top.seller_name || "Seller"}, ${waiting} waiting on you`}
        style={({ pressed }) => ({
          height: PEEK_H, paddingHorizontal: S.lg, flexDirection: "row", alignItems: "center", gap: S.md,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View style={{
          width: 30, height: 30, borderRadius: R.pill, backgroundColor: C.inkAccent,
          alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ color: C.onInk, fontSize: 13, fontFamily: F.semi }}>
            {(top.seller_name || "?").trim().charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: C.onInk, fontSize: 14, fontFamily: F.semi }}>
            {top.seller_name || "Seller"}
          </Text>
          {!open && top.last ? (
            <Text numberOfLines={1} style={{ color: C.onInk, opacity: 0.7, fontSize: 12.5, fontFamily: F.body }}>
              {top.last}
            </Text>
          ) : null}
        </View>

        {open ? (
          <Ionicons name="close" size={20} color={C.onInk} />
        ) : (
          <View style={{
            minWidth: 22, height: 22, borderRadius: R.pill, paddingHorizontal: 6,
            /* POP, NOT ALERT — `--pop` means "this is new, and it is for you". Red here said
               something had gone wrong when nothing had, and alert is a reserved status. */
            backgroundColor: C.pop, alignItems: "center", justifyContent: "center",
          }}>
            <Text style={{ fontSize: 11, fontFamily: F.semi, color: C.onPop }}>
              {waiting > 99 ? "99+" : waiting}
            </Text>
          </View>
        )}
      </Pressable>

      {/* THE CONVERSATION, READ-ONLY. Replying is the full screen — it has the composer, the
          attachments and the six-second poll, and a second composer in here would be a
          weaker copy of it. This answers "what do they want", which is the question that
          makes you decide whether to stop what you are doing. */}
      {open ? (
        <View style={{ flex: 1, paddingHorizontal: S.lg, paddingBottom: S.lg, gap: S.sm }}>
          {/* IT HAS TO SCROLL, and this shipped without doing so. The messages sat in a
              fixed box pinned to the bottom, so a long message was CLIPPED by the panel's
              edge with no way to reach the rest of it — a conversation you cannot read is
              worse than the disc that at least sent you to a screen where you could.
              Anchored to the end on open, because the newest line is the one you came for. */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 6, flexGrow: 1, justifyContent: "flex-end" }}
            showsVerticalScrollIndicator
            ref={(r) => { scroller.current = r }}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
          >
            {msgs === null ? (
              <ActivityIndicator color={C.onInk} />
            ) : msgs.length === 0 ? (
              <Text style={{ color: C.onInk, opacity: 0.7, fontSize: 13 }}>Couldn’t load this conversation.</Text>
            ) : (
              msgs.map((m) => (
                <View
                  key={String(m.id)}
                  style={{
                    alignSelf: m.me ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    backgroundColor: m.me ? C.lit : C.inkAccent,
                    borderRadius: R.control, paddingHorizontal: 11, paddingVertical: 7,
                  }}
                >
                  <Text style={{ fontSize: 13.5, fontFamily: F.body, color: m.me ? C.onLit : C.onInk }}>
                    {m.text}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>

          <Pressable
            onPress={() => {
              setOpen(false)
              router.push(`/chat/${encodeURIComponent(top.order_id)}`)
            }}
            style={({ pressed }) => ({
              height: 42, borderRadius: R.control, backgroundColor: C.lit,
              alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ fontSize: 14.5, fontFamily: F.semi, color: C.onLit }}>Reply</Text>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  )
}
