/**
 * SIGN IN — the first moment, and the only screen most people judge the app by.
 *
 * THE AURA IS THE PAGE. The dark masthead block this replaces was the app's identity under
 * the old direction; here the identity is the wash, and the form sits on it as one white
 * card. That is also why the card is CENTRED rather than pinned under a block: with no block
 * to tie itself to, a card hanging from the top of the page leaves a large dead area beneath
 * it — the "three enormous vertical gaps" defect. Centred on a wash, the space around it is
 * the design.
 *
 * IT STILL SCROLLS. A 5.4" phone with the keyboard up has about 300pt of room, and the card
 * must not be the thing that gets clipped.
 */
import { useState } from "react"
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { login } from "@/lib/api"
import { enablePush } from "@/lib/push"
import { Wordmark } from "@/components/wordmark"
import { Aura } from "@/components/aura"
import { Button, GUTTER } from "@/components/kit"
import { F, C, R, S, TYPE, CARD } from "@/lib/theme"

export default function Login() {
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ready = !!email.trim() && !!password

  const submit = async () => {
    if (busy || !ready) return
    setBusy(true); setErr(null)
    try {
      await login(email.trim(), password)
      /* ASK FOR NOTIFICATIONS HERE, not on first launch.
         iOS shows the system dialog once per install, so asking before anyone has signed in
         spends the single chance on a person who does not yet know what the app is — and a
         declined prompt cannot be re-shown from inside the app at all. Asked at the moment
         someone has just proved they work here, the question answers itself.
         NOT awaited: a slow APNs registration must not hold the door shut. */
      enablePush().catch(() => {})
      router.replace("/home")
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't sign in.")
    } finally { setBusy(false) }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <Aura />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1, justifyContent: "center",
            paddingTop: insets.top + S.xl, paddingBottom: insets.bottom + S.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* THE MARK SITS ON THE WASH, not on a card — the wash is the brand here, and a
              logo boxed inside the form would read as the form's title instead. */}
          <View style={{ paddingHorizontal: GUTTER, marginBottom: S.xl, alignItems: "center" }}>
            <Wordmark height={36} color={C.ink} />
          </View>

          <View style={{ paddingHorizontal: GUTTER }}>
            <View style={{ ...CARD, padding: S.lg + 2 }}>
              <Text style={{ ...TYPE.h2, fontFamily: F.bold, color: C.ink }}>
                Sign in
              </Text>

              <View style={{ marginTop: 18, gap: S.sm + 2 }}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email or username"
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  keyboardType="email-address"
                  returnKeyType="next"
                  style={input}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor={C.muted}
                  autoComplete="current-password"
                  secureTextEntry
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  style={input}
                />
                {/* A REFUSAL CARRIES ITS REASON — that is the answer, not a subtitle (§4). */}
                {err ? (
                  <Text style={{ ...TYPE.small, fontFamily: F.medium, color: C.alert }}>{err}</Text>
                ) : null}
              </View>

              {/* The kit's Button carries the screen gutter, which is wrong inside a card —
                  the negative margin puts it back on the card's own padding. */}
              <View style={{ marginTop: S.lg, marginHorizontal: -GUTTER }}>
                <Button
                  label="Sign in"
                  onPress={submit}
                  disabled={!ready}
                  loading={busy}
                />
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

/** A FIELD IS A FIELD (§4): the control radius, the `edge` boundary at a 3:1 floor, normal
 *  weight, no fill beyond the card it sits on. It is something you SET, not something you
 *  press — which is exactly what separates it from the pill beneath it. */
const input = {
  height: 54,
  borderRadius: R.chip,
  borderWidth: 1.5,
  borderColor: C.edge,
  paddingHorizontal: S.md,
  ...TYPE.body,
  fontFamily: F.body,
  color: C.ink,
  backgroundColor: C.surface,
} as const
