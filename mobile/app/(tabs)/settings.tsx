import { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, Alert, Linking } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import Constants from "expo-constants"
import { Ionicons } from "@expo/vector-icons"
import { getMe, clearToken, type User } from "@/lib/api"
import { TAB_BAR,F,C } from "@/lib/theme"

/**
 * SETTINGS — deliberately short.
 *
 * What is here: who you are signed in as, the way out, and the version (the first thing
 * anyone asks when a phone behaves differently from a desk).
 *
 * What is NOT here, and why:
 *  - Notifications. There is no push service wired, and a toggle that saves nothing is worse
 *    than no toggle — someone turns it on and then trusts alerts that never come.
 *  - Theme. The palette is one house style shared with the web; a per-device override is how
 *    two surfaces start disagreeing about what "overdue" looks like.
 *  - Anything an admin sets. Prices, hours and permissions belong on one screen, on the web,
 *    where they are audited — not duplicated onto a phone where they can be changed by
 *    accident in a pocket.
 */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", gap: 16,
      paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.border,
    }}>
      <Text style={{ fontSize: 15, color: C.muted }}>{label}</Text>
      <Text style={{ fontSize: 15, fontFamily: F.medium, color: C.fg, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  )
}

export default function Settings() {
  const insets = useSafeAreaInsets()
  const [me, setMe] = useState<User | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setMe(await getMe()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load your account.") }
  }, [])
  useEffect(() => { load() }, [load])

  const signOut = () => {
    // Confirmed, because on a phone this is one mis-tap away from the tab bar and signing
    // back in means finding a password.
    Alert.alert("Sign out?", "You'll need to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive",
        onPress: async () => { await clearToken(); router.replace("/login") },
      },
    ])
  }

  const version = Constants.expoConfig?.version ?? "—"

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + TAB_BAR.clearance + 8 }}
    >
      <Text style={{ fontSize: 32, fontFamily: F.bold, color: C.fg }}>Settings</Text>

      <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.muted, letterSpacing: 1, marginTop: 28 }}>ACCOUNT</Text>
      <View style={{ marginTop: 8 }}>
        {err
          ? <Text style={{ color: C.alert, fontSize: 15, paddingVertical: 14 }}>{err}</Text>
          : (
            <>
              {/* Name and Username only appear when there IS one. A row of dashes is not
                  an account summary — it reads as a screen that failed to load, which is
                  exactly how this looked while /api/me was answering with the token. */}
              {me?.name ? <Line label="Name" value={me.name} /> : null}
              {me?.username ? <Line label="Username" value={me.username} /> : null}
              <Line label="Email" value={me?.email || "—"} />
              <Line label="Role" value={me?.role || "—"} />
              {/* An account whose stored email is really a username predates signup
                  validation, and it is worth saying so rather than labelling it Email —
                  that person cannot reset a password, because nothing can be sent. */}
              {me?.email && !/.+@.+\..+/.test(String(me.email)) ? (
                <Text style={{ fontSize: 13, color: C.warn, paddingTop: 12 }}>
                  That is a username in the email field, so password reset can&apos;t reach you.
                  Add a real email on the web to fix it.
                </Text>
              ) : null}
            </>
          )}
      </View>

      <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.muted, letterSpacing: 1, marginTop: 28 }}>APP</Text>
      <View style={{ marginTop: 8 }}>
        <Line label="Version" value={version} />
      </View>

      <Pressable
        onPress={() => Linking.openURL("https://app.egful.store")}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          marginTop: 28, height: 50, borderRadius: 14, borderWidth: 1, borderColor: C.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="open-outline" size={18} color={C.fg} />
        <Text style={{ fontSize: 16, fontFamily: F.medium, color: C.fg }}>Open the full app</Text>
      </Pressable>

      <Pressable
        onPress={signOut}
        style={({ pressed }) => ({
          marginTop: 12, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center",
          borderWidth: 1, borderColor: C.border, opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontSize: 16, fontFamily: F.semi, color: C.alert }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  )
}
