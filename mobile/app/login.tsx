import { useState } from "react"
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { login } from "@/lib/api"
import { F,C, S } from "@/lib/theme"

export default function Login() {
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (busy || !email.trim() || !password) return
    setBusy(true); setErr(null)
    try {
      await login(email.trim(), password)
      router.replace("/today")
    } catch (e) {
      // The server's own sentence, not a generic one — it distinguishes a wrong password
      // from an account that cannot sign in at all.
      setErr(e instanceof Error ? e.message : "Couldn't sign in.")
    } finally { setBusy(false) }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + S.xl, paddingHorizontal: S.xl }}
    >
      <Text style={{ fontSize: 34, fontFamily: F.bold, letterSpacing: -0.8, color: C.fg }}>EGFUL</Text>
      <Text style={{ marginTop: S.xs, fontSize: 15, color: C.muted }}>Sign in to your factory account.</Text>

      <View style={{ marginTop: S.xl * 1.4, gap: S.md }}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email or username"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="next"
          style={input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={C.muted}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={submit}
          style={input}
        />
        {err ? <Text style={{ color: C.alert, fontSize: 13 }}>{err}</Text> : null}
        <Pressable
          onPress={submit}
          disabled={busy || !email.trim() || !password}
          style={({ pressed }) => ({
            height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center",
            backgroundColor: C.primary,
            opacity: busy || !email.trim() || !password ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          {busy ? <ActivityIndicator color={C.onPrimary} />
                : <Text style={{ color: C.onPrimary, fontSize: 16, fontFamily: F.semi }}>Sign in</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const input = {
  height: 52,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: C.border,
  paddingHorizontal: S.lg,
  fontSize: 16,
  color: C.fg,
  backgroundColor: C.card,
} as const
