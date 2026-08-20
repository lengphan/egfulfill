import { useCallback, useRef, useState } from "react"
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native"
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getMe, getOrderMessages, postOrderMessage, type ChatEntry } from "@/lib/api"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { F, C, R } from "@/lib/theme"

/**
 * ONE CONVERSATION.
 *
 * The channel id arrives in the route — `staff-general` for the internal room, or
 * `support-<sellerId>` for one seller's thread — and the server decides who may read it
 * (canSeeThread in routes/orders.js). Nothing about permissions is repeated here: a client
 * that guesses would be a second, weaker copy of a rule that already exists.
 *
 * NO AI. No reply draft, no assistant, no generate — those are web features by instruction,
 * and their absence is why this screen is a text box and a list rather than a composer with
 * four modes.
 *
 * POLLED, not pushed. A phone on factory wifi loses a socket every time it walks past a
 * wall, and a chat that silently stops updating is worse than one that is a few seconds
 * behind. Only while the screen is FOCUSED — a timer left running in the background is how
 * an app eats a battery for a conversation nobody is reading.
 */
export default function ChatThread() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>()
  const channel = String(id ?? "")
  const [msgs, setMsgs] = useState<ChatEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [role, setRole] = useState<string>("seller")
  const [name, setName] = useState<string>("")
  const scroller = useRef<ScrollView | null>(null)
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const load = useCallback(async () => {
    try {
      const rows = await getOrderMessages(channel)
      setMsgs(rows)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load this conversation.")
      setMsgs([])
    }
  }, [channel])

  useFocusEffect(useCallback(() => {
    let alive = true
    void (async () => {
      try {
        const me = await getMe()
        if (!alive) return
        setRole(String(me?.role ?? "seller"))
        setName(String(me?.name ?? me?.email ?? ""))
      } catch { /* the thread still reads; only the outgoing role would default */ }
    })()
    void load()
    // Six seconds: fast enough that a reply feels live, slow enough that a phone left open
    // on this screen is not making ten requests a minute.
    const t = setInterval(() => { void load() }, 6000)
    return () => { alive = false; clearInterval(t) }
  }, [load]))

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      await postOrderMessage(channel, body, {
        // The role the SERVER stamps on the row. A staffer writing in a seller's thread is
        // writing as staff; a seller is writing as themselves.
        role: role && role !== "seller" ? "staff" : "seller",
        by: name || undefined,
        clientId: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      setText("")
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't send.")
    } finally { setSending(false) }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      {/* The app's own back row — the root Stack runs headerShown:false, so a native title
          bar here would be the only one in the app. */}
      <Pressable
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={C.primary} />
        <Text style={{ color: C.primary, fontSize: 16, fontFamily: F.medium }} numberOfLines={1}>
          {String(title ?? "Chat")}
        </Text>
      </Pressable>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: C.bg }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 18, gap: 10 }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {msgs === null && !err ? (
            <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={C.primary} /></View>
          ) : msgs && msgs.length === 0 ? (
            /* An empty thread and a broken one must never look the same. */
            <Text style={{ fontSize: 14, fontFamily: F.body, color: C.muted, textAlign: "center", marginTop: 40 }}>
              Nothing here yet — say something.
            </Text>
          ) : (msgs ?? []).map((m) => {
            const mine = !!m.me
            return (
              <View key={String(m.id)} style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                {/* WHO SAID IT, on the other side only. Your own name over your own message
                    is the one label nobody needs. */}
                {!mine && !!m.by && (
                  <Text style={{ fontSize: 11.5, fontFamily: F.medium, color: C.muted, marginBottom: 3, marginLeft: 4 }}>
                    {m.by}
                  </Text>
                )}
                <View style={{
                  maxWidth: "84%", borderRadius: R.md, paddingHorizontal: 13, paddingVertical: 9,
                  // Ink for yours, the warm well for theirs — the same two surfaces the rest of
                  // the app uses, rather than a third palette invented for chat.
                  backgroundColor: mine ? C.ink : C.accent,
                }}>
                  <Text style={{ fontSize: 15, fontFamily: F.body, color: mine ? C.onInk : C.fg, lineHeight: 21 }}>
                    {m.text}
                  </Text>
                </View>
              </View>
            )
          })}
          {!!err && (
            <Text style={{ fontSize: 13, fontFamily: F.body, color: C.alert, textAlign: "center" }}>{err}</Text>
          )}
        </ScrollView>

        <View style={{
          flexDirection: "row", alignItems: "flex-end", gap: 10,
          paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14,
          borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg,
        }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={C.muted}
            multiline
            style={{
              flex: 1, maxHeight: 120, minHeight: 42, borderRadius: R.md,
              backgroundColor: C.accent, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11,
              fontSize: 15, fontFamily: F.body, color: C.fg,
            }}
          />
          <Pressable
            onPress={send}
            disabled={!text.trim() || sending}
            style={({ pressed }) => ({
              width: 42, height: 42, borderRadius: 21, backgroundColor: C.ink,
              alignItems: "center", justifyContent: "center",
              opacity: !text.trim() || sending ? 0.4 : pressed ? 0.75 : 1,
            })}
          >
            {sending ? <ActivityIndicator color={C.onInk} /> : <Ionicons name="arrow-up" size={20} color={C.onInk} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}
