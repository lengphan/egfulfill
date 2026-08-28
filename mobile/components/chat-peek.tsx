import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, View, Text, Animated, Easing, AccessibilityInfo, ActivityIndicator, ScrollView, useWindowDimensions } from "react-native"
import { useRouter, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getMe, getSupportThreads, getOrderMessages, type SupportThread, type ChatEntry } from "@/lib/api"
import { C, F, R, S, TAB_BAR } from "@/lib/theme"

/**
 * THE PEEK — a bubble that opens into the conversation.
 *
 * It replaced a floating disc, and then it replaced ITSELF: the first version rested as a
 * full-width strip across the bottom of every screen, which is the fault it was built to
 * fix wearing a different shape. A strip is 90% of the width and 100% of the attention of
 * a sheet, so a single waiting message looked like something had opened over the page.
 *
 * So it rests as a BUBBLE and grows from it. What the disc got wrong is not roundness —
 * it is these three, and all three still hold:
 *
 *   1. It was PERMANENT CHROME. Every screen, same corner, always there. This one exists
 *      only while somebody is actually waiting; nothing waiting, nothing drawn.
 *   2. It SAT ON the last row of every list. A 56pt circle in the corner still overlaps
 *      the page — but a strip overlapped the full width of it, which is a different order
 *      of borrowed space, and the lists already clear the tab bar.
 *   3. It said nothing. This one still answers "who and what" — it just answers on the
 *      press rather than in the resting state, because the resting state is now small
 *      enough that a name in it would be a truncation.
 *
 * THE COUNT IS "NEEDS YOU", not "unread". The server counts messages since our last HUMAN
 * reply, so an answered thread reports zero however long it is. A badge that counts length
 * teaches you to ignore it.
 *
 * A SELLER NEVER SEES THIS. The threads endpoint is staff-only and 403s for them, which is
 * correct — so a seller's route into chat is the control on the Dashboard header, and that
 * is not optional: it is the only one they have.
 */
/** The resting circle. Its radius is BUBBLE / 2 rather than R.pill because the box has to
 *  ANIMATE to R.card, and 999 interpolating to 26 spends the whole transition as a squircle
 *  nobody asked for. Half the height IS a circle; it is derived, not a fourteenth radius. */
const BUBBLE = 56
const HEAD_H = 58
const OPEN_H = 380

export function ChatPeek() {
  const router = useRouter()
  const { width: winW } = useWindowDimensions()
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

  /* THE PANEL GROWS FROM THE BUBBLE, it does not appear over it. The box is anchored to the
     bottom-right corner, so width and height both grow AWAY from that corner — which is what
     makes the close feel like putting it back rather than dismissing a dialog.
     ONE driver, three interpolations: two Animated.Values for width and height can be
     interrupted at different points and leave the box a shape neither state describes. */
  const scroller = useRef<ScrollView | null>(null)
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const to = open ? 1 : 0
    if (reduced) { t.setValue(to); return }
    const a = Animated.timing(t, {
      toValue: to, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    })
    a.start()
    return () => a.stop()
  }, [open, reduced, t])

  const OPEN_W = winW - S.lg * 2
  const boxW = t.interpolate({ inputRange: [0, 1], outputRange: [BUBBLE, OPEN_W] })
  const boxH = t.interpolate({ inputRange: [0, 1], outputRange: [BUBBLE, OPEN_H] })
  const boxR = t.interpolate({ inputRange: [0, 1], outputRange: [BUBBLE / 2, R.card] })
  /* The two contents CROSS-fade rather than swapping at the midpoint: the bubble is gone
     before the box is wide enough to show a name, and the panel arrives once it is. */
  const bubbleOp = t.interpolate({ inputRange: [0, 0.35], outputRange: [1, 0], extrapolate: "clamp" })
  const panelOp = t.interpolate({ inputRange: [0.45, 1], outputRange: [0, 1], extrapolate: "clamp" })

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

  const initial = (top.seller_name || "?").trim().charAt(0).toUpperCase()

  return (
    /* box-none: the wrapper hugs the bubble, but it is still an absolute layer over the
       page — anything it does not draw has to stay pressable. */
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", right: S.lg, bottom: TAB_BAR.clearance + S.sm, alignItems: "flex-end" }}
    >
      <Animated.View
        style={{ width: boxW, height: boxH, borderRadius: boxR, backgroundColor: C.ink, overflow: "hidden" }}
      >
        {/* THE BUBBLE. Pinned to the bottom-right at its FINAL size rather than filling the
            box: centred content in a box that is growing drifts across the screen while it
            fades, which reads as two objects rather than one opening. */}
        <Animated.View
          pointerEvents={open ? "none" : "auto"}
          style={{ position: "absolute", right: 0, bottom: 0, width: BUBBLE, height: BUBBLE, opacity: bubbleOp }}
        >
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${top.seller_name || "Seller"}, ${waiting} waiting on you`}
            style={({ pressed }) => ({
              flex: 1, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: C.onInk, fontSize: 20, fontFamily: F.semi }}>{initial}</Text>
          </Pressable>
        </Animated.View>

        {/* THE PANEL, laid out at its full size from the first frame and anchored to the same
            corner — so the type does not re-wrap on every frame of the growth. */}
        <Animated.View
          pointerEvents={open ? "auto" : "none"}
          style={{ position: "absolute", right: 0, bottom: 0, width: OPEN_W, height: OPEN_H, opacity: panelOp }}
        >
          {/* THE HEAD — who, and the way back to the bubble. */}
          <Pressable
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close conversation"
            style={({ pressed }) => ({
              height: HEAD_H, paddingHorizontal: S.lg, flexDirection: "row", alignItems: "center", gap: S.md,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{
              width: 30, height: 30, borderRadius: R.pill, backgroundColor: C.inkAccent,
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ color: C.onInk, fontSize: 13, fontFamily: F.semi }}>{initial}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: C.onInk, fontSize: 14, fontFamily: F.semi }}>
                {top.seller_name || "Seller"}
              </Text>
            </View>

            <Ionicons name="close" size={20} color={C.onInk} />
          </Pressable>

          {/* THE CONVERSATION, READ-ONLY. Replying is the full screen — it has the composer, the
              attachments and the six-second poll, and a second composer in here would be a
              weaker copy of it. This answers "what do they want", which is the question that
              makes you decide whether to stop what you are doing. */}
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
        </Animated.View>
      </Animated.View>

      {/* THE COUNT sits OUTSIDE the box, because the box clips — a badge on the corner of a
          circle is half outside it by definition, and moving it inside a 56pt bubble would
          leave the initial and the number fighting for the same centre.
          POP, NOT ALERT — `--pop` means "this is new, and it is for you". Red here said
          something had gone wrong when nothing had, and alert is a reserved status. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute", top: -3, right: -3, opacity: bubbleOp,
          minWidth: 22, height: 22, borderRadius: R.pill, paddingHorizontal: 6,
          backgroundColor: C.pop, alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 11, fontFamily: F.semi, color: C.onPop }}>
          {waiting > 99 ? "99+" : waiting}
        </Text>
      </Animated.View>
    </View>
  )
}
