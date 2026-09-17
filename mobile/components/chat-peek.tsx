import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, View, Text, Animated, Easing, AccessibilityInfo, ActivityIndicator, ScrollView, TextInput, Keyboard, Platform, useWindowDimensions } from "react-native"
import { useRouter, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getMe, getSupportThreads, getOrderMessages, postOrderMessage, type SupportThread, type ChatEntry } from "@/lib/api"
import { C, F, R, S, TAB_BAR, LIFT } from "@/lib/theme"

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

/**
 * THE SMALLEST THING THAT STOPS ASTERISKS REACHING THE SCREEN.
 *
 * The factory brief is written as markdown and was printed verbatim, so a message opened with
 * a literal `**Blocking Issues:**` and a `- ` in front of every line. That is not a rendering
 * style, it is an unrendered document.
 *
 * NOT A MARKDOWN LIBRARY. A dependency for two constructs is weight on a screen that has to
 * open in one frame, and the phone's rule about native modules applies to JS ones too: the
 * peek is READ-ONLY and answers one question — what do they want — so it needs bold and it
 * needs bullets. Anything richer belongs on the chat screen, which is one tap away.
 *
 * Unmatched asterisks are left alone rather than swallowed: a stray `*` in a seller's message
 * is a character they typed, and eating it would be a second, quieter kind of wrong.
 */
function rich(text: string | null | undefined): { text: string; bold: boolean }[][] {
  return String(text ?? "").split("\n").map((raw) => {
    const line = raw.replace(/^\s*[-*\u2022]\s+/, "\u2022  ")
    const parts = line.split(/\*\*(.+?)\*\*/g)
    // split() with one capture group alternates: plain, captured, plain, captured…
    return parts.map((piece, i) => ({ text: piece, bold: i % 2 === 1 })).filter((p) => p.text !== "")
  }).filter((l) => l.length > 0)
}

export function ChatPeek() {
  const router = useRouter()
  const { width: winW } = useWindowDimensions()
  const [threads, setThreads] = useState<SupportThread[]>([])
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<ChatEntry[] | null>(null)
  /** WHY it could not be read, when that is what happened. Null on a thread that simply
   *  has no messages yet — a different answer, and the one the panel used to give for both. */
  const [msgsErr, setMsgsErr] = useState<string | null>(null)
  const [reduced, setReduced] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState<string | null>(null)
  /* WHO IS WRITING. The poll below already fetches this to decide whether to run at all; it
     was thrown away each tick. The composer needs it to stamp the role, and asking twice for
     one answer is how two call sites start disagreeing about what a staffer is. */
  const [meRole, setMeRole] = useState<string>("")
  const [meName, setMeName] = useState<string>("")

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
        if (!alive) return
        setMeRole(me?.role ?? ""); setMeName(me?.name ?? "")
        if (!me?.role || me.role === "seller") return
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

  /*
   * THE PANEL GROWS FROM THE BUBBLE — ON THE NATIVE THREAD.
   *
   * It used to animate `width`, `height` and `borderRadius`, and NONE of those three can be
   * driven natively, which is why the call carried `useNativeDriver: false`. So every frame
   * of the open crossed the JS bridge and was re-laid-out in JavaScript — and the peek opens
   * precisely when a screen is busy fetching, which is when the JS thread has least to give.
   * That is the whole of "the motion is not smooth": it was not a curve that needed tuning,
   * it was three properties that can only be animated in the wrong place.
   *
   * TRANSFORM AND OPACITY ONLY, therefore. The panel is laid out ONCE at its full size and
   * scaled down to the bubble's footprint at rest, so nothing re-measures and nothing
   * re-wraps mid-flight — the old version reflowed the type on every single frame.
   *
   * THE CORNER IS PINNED WITH ARITHMETIC, NOT `transformOrigin`. A transform scales about the
   * centre, so shrinking by `s` pulls the bottom-right corner inward by (1-s)·W/2 and
   * (1-s)·H/2; translating by exactly that puts it back. Listing the translates BEFORE the
   * scale is what makes it true — the centre moves by the translation and the scale then
   * happens about the moved centre. `transformOrigin` would say the same thing in one line,
   * but this composes to a plain matrix on any version and cannot silently stop being
   * native-driver-safe.
   *
   * A SPRING, NOT A CURVE, for the open. A 320ms ease-out is a distance travelled in a fixed
   * time; a spring is a thing with weight arriving, which is what "smooth" means when people
   * say it about a panel. The close is a short timing — putting something back should not
   * take as long as taking it out, and it should not bounce.
   */
  const scroller = useRef<ScrollView | null>(null)
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const to = open ? 1 : 0
    if (reduced) { t.setValue(to); return }
    const a = open
      ? Animated.spring(t, {
          toValue: 1, useNativeDriver: true,
          /* Mild, and deliberately not bouncy: a panel that overshoots reads as a toy. */
          stiffness: 190, damping: 22, mass: 0.9,
          restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01,
        })
      : Animated.timing(t, {
          toValue: 0, duration: 170, easing: Easing.in(Easing.cubic), useNativeDriver: true,
        })
    a.start()
    return () => a.stop()
  }, [open, reduced, t])

  const OPEN_W = winW - S.lg * 2
  /* The resting scale is the bubble's width as a fraction of the panel's, so the shrunken
     panel occupies almost exactly the bubble's footprint and the cross-fade has nothing to
     hide. The height lands within a few points of BUBBLE at the same scale, which is why one
     uniform scale is enough and a second axis is not. */
  const REST = BUBBLE / OPEN_W
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [REST, 1] })
  const panTX = t.interpolate({ inputRange: [0, 1], outputRange: [(1 - REST) * OPEN_W / 2, 0] })
  const panTY = t.interpolate({ inputRange: [0, 1], outputRange: [(1 - REST) * OPEN_H / 2, 0] })
  /* The two contents CROSS-fade rather than swapping at the midpoint: the bubble is gone
     before the panel is wide enough to show a name, and the panel arrives once it is. */
  const bubbleOp = t.interpolate({ inputRange: [0, 0.3], outputRange: [1, 0], extrapolate: "clamp" })
  const bubbleSc = t.interpolate({ inputRange: [0, 0.3], outputRange: [1, 1.25], extrapolate: "clamp" })
  const panelOp = t.interpolate({ inputRange: [0.12, 0.55], outputRange: [0, 1], extrapolate: "clamp" })

  /* The conversation is fetched only when it is actually opened. A peek that pre-loads every
     waiting thread is a poll with extra steps. */
  useEffect(() => {
    if (!open || !top?.order_id) return
    let alive = true
    setMsgs(null); setMsgsErr(null)
    getOrderMessages(top.order_id)
      /* Thirty, not six. Six was chosen when the panel could not scroll, so it was a cap
         standing in for a scrollbar; with one, the only reason to cut is the payload. */
      .then((rows) => { if (alive) setMsgs(rows.slice(-30)) })
      /* THE FAILURE IS RECORDED, not folded into an empty list. Setting msgs to [] made a
         thread that could not be READ indistinguishable from one with nothing IN it, and
         §4 forbids exactly that: if a thing can't be read versus doesn't exist, say which. */
      .catch((e) => { if (alive) { setMsgs([]); setMsgsErr(e instanceof Error && e.message ? e.message : "Couldn’t load this conversation.") } })
    return () => { alive = false }
  }, [open, top?.order_id])

  /*
   * THE KEYBOARD LIFTS THE WHOLE PEEK.
   *
   * KeyboardAvoidingView is for a screen that owns its layout; this is an absolutely
   * positioned overlay pinned above the tab bar, so there is no flex container to squeeze and
   * the keyboard would simply cover the box you are typing into. Listening and translating is
   * the shape that fits — and translateY is one of the two properties the native driver can
   * take, so the lift runs on the same thread as the open.
   *
   * It rises by the keyboard's height LESS the room the peek already sits above the bottom,
   * clamped at zero: the peek is already clear of the tab bar, and lifting by the full
   * height would leave a gap the size of that clearance.
   */
  const kb = useRef(new Animated.Value(0)).current
  useEffect(() => {
    /* `Will` on iOS so the lift starts with the keyboard rather than after it; Android only
       emits `Did`, and its own windowSoftInputMode has usually done the work already. */
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"
    const rest = TAB_BAR.clearance + S.sm
    const show = Keyboard.addListener(showEvt, (e) => {
      const h = Math.max(0, (e?.endCoordinates?.height ?? 0) - rest)
      Animated.timing(kb, {
        toValue: h, duration: e?.duration || 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start()
    })
    const hide = Keyboard.addListener(hideEvt, (e) => {
      Animated.timing(kb, {
        toValue: 0, duration: e?.duration || 200,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start()
    })
    return () => { show.remove(); hide.remove() }
  }, [kb])

  /* Closing the peek must put the keyboard away with it — a keyboard left up over a screen
     with nothing to type into is the state people report as "it froze". */
  useEffect(() => { if (!open) { Keyboard.dismiss(); setSendErr(null) } }, [open])

  const send = useCallback(async () => {
    const body = draft.trim()
    if (!body || sending || !top?.order_id) return
    setSending(true); setSendErr(null)
    try {
      await postOrderMessage(top.order_id, body, {
        /* The role the SERVER stamps on the row — the same expression the full screen uses.
           A staffer writing in a seller's thread writes as staff. */
        role: meRole && meRole !== "seller" ? "staff" : "seller",
        by: meName || undefined,
        clientId: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      setDraft("")
      const rows = await getOrderMessages(top.order_id)
      setMsgs(rows.slice(-30))
    } catch (e) {
      setSendErr(e instanceof Error && e.message ? e.message : "That didn't send.")
    } finally { setSending(false) }
  }, [draft, sending, top?.order_id, meRole, meName])

  /* NOTHING IS WAITING, NOTHING IS DRAWN. */
  if (!top || waiting === 0) return null

  const initial = (top.seller_name || "?").trim().charAt(0).toUpperCase()

  return (
    /* box-none: the wrapper hugs the bubble, but it is still an absolute layer over the
       page — anything it does not draw has to stay pressable. */
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: "absolute", right: S.lg, bottom: TAB_BAR.clearance + S.sm, alignItems: "flex-end",
        transform: [{ translateY: Animated.multiply(kb, -1) }],
      }}
    >
      {/* The wrapper is now the size of the OPEN panel and draws nothing. The bubble and the
          panel are siblings inside it, each with its own transform — the box that used to
          grow between them was the thing that could not be animated natively. */}
      <View style={{ width: OPEN_W, height: OPEN_H, justifyContent: "flex-end", alignItems: "flex-end" }} pointerEvents="box-none">
        {/* THE BUBBLE. Pinned to the bottom-right at its FINAL size rather than filling the
            box: centred content in a box that is growing drifts across the screen while it
            fades, which reads as two objects rather than one opening. */}
        <Animated.View
          pointerEvents={open ? "none" : "auto"}
          style={{
            position: "absolute", right: 0, bottom: 0, width: BUBBLE, height: BUBBLE,
            borderRadius: BUBBLE / 2, backgroundColor: C.hueDeep,
            opacity: bubbleOp, transform: [{ scale: bubbleSc }],
            ...LIFT,
          }}
        >
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${top.seller_name || "Seller"}, ${waiting} waiting on you`}
            style={({ pressed }) => ({
              flex: 1, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 20, fontFamily: F.semi }}>{initial}</Text>
          </Pressable>
        </Animated.View>

        {/* THE PANEL, laid out at its full size from the first frame and anchored to the same
            corner — so the type does not re-wrap on every frame of the growth. */}
        <Animated.View
          pointerEvents={open ? "auto" : "none"}
          style={{
            position: "absolute", right: 0, bottom: 0, width: OPEN_W, height: OPEN_H,
            /* A CARD, NOT A PLATE OF THE ACTION COLOUR.
               The panel was a solid `hueDeep` rectangle — the largest painted object on any
               screen it opened over, in the one hue this app reserves for things you PRESS.
               It is not a thing you press; it is a surface you read on, and the phone's rule
               for that is one line long: warm paper, white card, 1.5pt hairline, large
               radius. Periwinkle stays where it means something — the resting bubble, the
               count, your own messages and the Reply button — and by not being everywhere it
               can go back to meaning "act on this". */
            borderRadius: R.card, backgroundColor: C.surface, overflow: "hidden",
            borderWidth: 1.5, borderColor: C.hairline,
            opacity: panelOp,
            /* Translate BEFORE scale: the centre moves by the translation and the scale then
               happens about the moved centre, which is what pins the bottom-right corner. */
            transform: [{ translateX: panTX }, { translateY: panTY }, { scale }],
            ...LIFT,
          }}
        >
          {/* THE HEAD — who, and the way back to the bubble. */}
          {/* TWO TARGETS, NOT ONE. The whole head used to close the peek, which was fine when
              the only other control was a button that left anyway. Now that you can answer
              here, the name has a job — it is the way through to the full thread, where the
              attachments and the poll live — and closing belongs to the cross alone. */}
          <View
            style={{
              height: HEAD_H, paddingHorizontal: S.lg, flexDirection: "row", alignItems: "center", gap: S.md,
              borderBottomWidth: 1, borderBottomColor: C.hairline,
            }}
          >
          <Pressable
            onPress={() => {
              setOpen(false)
              router.push(`/chat/${encodeURIComponent(top.order_id)}`)
            }}
            accessibilityRole="button"
            accessibilityLabel={`Open the full conversation with ${top.seller_name || "this seller"}`}
            style={({ pressed }) => ({
              flex: 1, flexDirection: "row", alignItems: "center", gap: S.md,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{
              width: 30, height: 30, borderRadius: R.pill, backgroundColor: C.hueMist,
              alignItems: "center", justifyContent: "center",
            }}>
              {/* Same pair, same fault: an initial in white on the mist wash. `hueDeep` is
                  the value that reads on its own wash — 4.51:1, and the only periwinkle that
                  does both jobs a hue has to do. */}
              <Text style={{ color: C.hueDeep, fontSize: 13, fontFamily: F.semi }}>{initial}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: C.ink, fontSize: 14, fontFamily: F.semi }}>
                {top.seller_name || "Seller"}
              </Text>
              <Text numberOfLines={1} style={{ color: C.muted, fontSize: 11.5, fontFamily: F.body }}>
                Open full thread
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close conversation"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
          >
            <Ionicons name="close" size={20} color={C.muted} />
          </Pressable>
          </View>

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
                <ActivityIndicator color={C.ink} />
              ) : msgsErr ? (
                /* A refusal carries its reason — that IS the answer (§4). With a deadline on
                   every request this is now reachable at all: it used to spin for ever. */
                <Text style={{ color: C.alert, fontSize: 13 }}>{msgsErr}</Text>
              ) : msgs.length === 0 ? (
                <Text style={{ color: C.muted, fontSize: 13 }}>No messages yet.</Text>
              ) : (
                msgs.map((m) => (
                  <View
                    key={String(m.id)}
                    style={{
                      alignSelf: m.me ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      backgroundColor: m.me ? C.hueDeep : C.hueMist,
                      borderRadius: R.chip, paddingHorizontal: 11, paddingVertical: 7,
                    }}
                  >
                    {/* A TERNARY RETURNING THE SAME VALUE ON BOTH BRANCHES is what shipped
                        here, which is proof the intent was two colours and only one was ever
                        written. So an incoming message was white on the `hueMist` wash —
                        1.15:1, invisible — while the bubble underneath it looked perfectly
                        fine, which is why it survived. Ink on that ground is 14.75:1.
                        The gate already DECLARED the right pair — ink on the action wash —
                        and still missed this, because it measures the palette rather than
                        what a component paints with, and a bare "#FFFFFF" is allow-listed
                        everywhere for the good reason that it usually is fine. The inverse
                        is asserted in the gate's SHAPE half now. */}
                    <Text style={{ fontSize: 13.5, color: m.me ? "#FFFFFF" : C.ink }}>
                      {rich(m.text).map((line, li) => (
                        <Text key={li}>
                          {li > 0 ? "\n" : ""}
                          {line.map((piece, pi) => (
                            <Text key={pi} style={{ fontFamily: piece.bold ? F.semi : F.body }}>
                              {piece.text}
                            </Text>
                          ))}
                        </Text>
                      ))}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>

            {/*
              * YOU ANSWER FROM HERE (owner, 2026-09-17).
              *
              * This was a button that closed the peek and pushed the full screen, under a
              * comment arguing that a second composer would be "a weaker copy" of the one
              * there. That argument was about FEATURES — attachments, the six-second poll —
              * and it answered the wrong question. The peek exists to stop you losing your
              * place; a control whose whole behaviour is to take you somewhere else is the
              * one thing it must not be. Two words back to a seller should not cost the
              * screen you were on.
              *
              * SO IT IS DELIBERATELY NOT THE FULL COMPOSER. One line of text and send.
              * Attachments, history beyond thirty and the live poll stay on the thread
              * screen, which the name in the header still opens — and that is the split the
              * old comment was right about, once it is a door rather than the only door.
              */}
            {sendErr && (
              <Text style={{ fontSize: 12, color: C.alert, marginBottom: 2 }}>{sendErr}</Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <TextInput
                value={draft}
                onChangeText={(v) => { setDraft(v); if (sendErr) setSendErr(null) }}
                placeholder="Write a reply"
                placeholderTextColor={C.muted}
                multiline
                /* Grows to four lines and then scrolls. A composer that grows without a
                   ceiling eats the conversation it is answering. */
                style={{
                  flex: 1, minHeight: 40, maxHeight: 96, paddingHorizontal: 12, paddingTop: 10,
                  paddingBottom: 10, borderRadius: R.chip, borderWidth: 1, borderColor: C.edge,
                  backgroundColor: C.canvas, color: C.ink, fontSize: 14, fontFamily: F.body,
                }}
                onSubmitEditing={() => { void send() }}
                editable={!sending}
              />
              <Pressable
                onPress={() => { void send() }}
                disabled={!draft.trim() || sending}
                accessibilityRole="button"
                accessibilityLabel="Send reply"
                style={({ pressed }) => ({
                  width: 40, height: 40, borderRadius: R.pill,
                  alignItems: "center", justifyContent: "center",
                  /* Disabled is the MIST, not the deep at low alpha: an action you cannot take
                     should stop looking like the action, rather than looking like it is loading. */
                  backgroundColor: draft.trim() && !sending ? C.hueDeep : C.hueMist,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                {sending
                  ? <ActivityIndicator color={C.hueDeep} size="small" />
                  : <Ionicons name="arrow-up" size={19} color={draft.trim() ? "#FFFFFF" : C.hueDeep} />}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* THE COUNT sits OUTSIDE the box, because the box clips — a badge on the corner of a
          circle is half outside it by definition, and moving it inside a 56pt bubble would
          leave the initial and the number fighting for the same centre.
          POP, NOT ALERT — `--pop` means "this is new, and it is for you". Red here said
          something had gone wrong when nothing had, and alert is a reserved status. */}
      <Animated.View
        pointerEvents="none"
        style={{
          /* ON THE BUBBLE'S CORNER, not the wrapper's. The wrapper used to hug the bubble, so
             top/right -3 landed on it; it is the open panel's size now, and the same two
             values would have parked the count at the top of an invisible 380pt box. Measured
             off BUBBLE so it cannot drift if that changes. */
          position: "absolute", bottom: BUBBLE - 19, right: -3, opacity: bubbleOp,
          minWidth: 22, height: 22, borderRadius: R.pill, paddingHorizontal: 6,
          backgroundColor: C.hueDeep, alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 11, fontFamily: F.semi, color: "#FFFFFF" }}>
          {waiting > 99 ? "99+" : waiting}
        </Text>
      </Animated.View>
    </Animated.View>
  )
}
