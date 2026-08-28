import { useCallback, useState } from "react"
import { View, Text, ScrollView, Pressable, Alert, Linking } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import Constants from "expo-constants"
import * as Updates from "expo-updates"
import { Ionicons } from "@expo/vector-icons"
import { getMe, clearToken, type User } from "@/lib/api"
import { enablePush, disablePush, pushState, type PushState } from "@/lib/push"
import { useFocusEffect } from "expo-router"
import { TAB_BAR,F,C, R, CARD } from "@/lib/theme"

/**
 * SETTINGS — deliberately short.
 *
 * What is here: who you are signed in as, the way out, and the version (the first thing
 * anyone asks when a phone behaves differently from a desk).
 *
 * What is NOT here, and why:
 *  - A notifications TOGGLE. There is a push service now (lib/push.ts), so the old reason for
 *    having nothing here is gone — but a switch would still be a lie: once iOS has been told
 *    no, only iOS Settings can undo it, and a toggle that flips back the moment it is touched
 *    is worse than no toggle. So this states the state and offers the control that can
 *    actually change it, which is a different one in each case.
 *  - Theme. The palette is one house style shared with the web; a per-device override is how
 *    two surfaces start disagreeing about what "overdue" looks like.
 *  - Anything an admin sets. Prices, hours and permissions belong on one screen, on the web,
 *    where they are audited — not duplicated onto a phone where they can be changed by
 *    accident in a pocket.
 */
function Line({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", gap: 16,
      paddingVertical: 15, paddingHorizontal: 16,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.border,
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
  const [push, setPush] = useState<PushState | null>(null)
  const [pushWhy, setPushWhy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setMe(await getMe()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load your account.") }
  }, [])
  /* RELOAD WHEN YOU COME BACK TO IT, not once and never again.
   *
   * This ran on mount only — and a tab screen mounts once and then stays mounted for the
   * life of the app, so a name or a role changed anywhere else (the web, an admin promoting
   * you) never appeared here. It read as "settings don't update", and it was: nothing was
   * ever asked for again. The wallet already reloads on focus for the same reason. */
  /* ON FOCUS, because this can change OUTSIDE the app: someone switches notifications off in
     iOS Settings and comes back, and a value read once at mount would still say "On". */
  useFocusEffect(useCallback(() => { load(); pushState().then(setPush).catch(() => {}) }, [load]))

  const signOut = () => {
    // Confirmed, because on a phone this is one mis-tap away from the tab bar and signing
    // back in means finding a password.
    Alert.alert("Sign out?", "You'll need to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive",
        onPress: async () => {
          /* BEFORE clearing the token, because forgetting the device is an authenticated
             call — after, it has no credential to make it with and the handset would keep
             receiving this account's notifications until someone else signed in on it. */
          await disablePush()
          await clearToken()
          router.replace("/login")
        },
      },
    ])
  }

  const version = Constants.expoConfig?.version ?? "—"
  /**
   * WHICH JS IS ACTUALLY RUNNING.
   *
   * The app version alone cannot answer that. Everything shipped over the air shares a
   * runtime version with the build it lands on, so 1.0.1 is 1.0.1 whether the phone is
   * running the bundle baked into the build or an update published an hour ago — and
   * "seems like no changes" is unanswerable without this line. `updateId` is null when the
   * embedded bundle is what is running, which is itself the answer.
   */
  const build = String(Updates.updateId ?? "").slice(0, 8)
  const jsVersion = Updates.isEmbeddedLaunch || !build ? "built in" : build

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + TAB_BAR.clearance + 8 }}
    >
      <Text style={{ fontSize: 30, fontFamily: F.display, color: C.fg, letterSpacing: -0.5 }}>Settings</Text>

      <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4, marginTop: 28 }}>ACCOUNT</Text>
      <View style={{ ...CARD, marginTop: 8, overflow: "hidden" }}>
        {err
          ? <Text style={{ color: C.alert, fontSize: 15, padding: 16 }}>{err}</Text>
          : (
            <>
              {/* Name and Username only appear when there IS one. A row of dashes is not
                  an account summary — it reads as a screen that failed to load, which is
                  exactly how this looked while /api/me was answering with the token. */}
              {me?.name ? <Line label="Name" value={me.name} /> : null}
              {me?.username ? <Line label="Username" value={me.username} /> : null}
              <Line label="Email" value={me?.email || "—"} />
              <Line label="Role" value={me?.role || "—"} last />
              {/* An account whose stored email is really a username predates signup
                  validation, and it is worth saying so rather than labelling it Email —
                  that person cannot reset a password, because nothing can be sent. */}
              {me?.email && !/.+@.+\..+/.test(String(me.email)) ? (
                <Text style={{ fontSize: 13, color: C.warn, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 }}>
                  That is a username in the email field, so password reset can&apos;t reach you.
                  Add a real email on the web to fix it.
                </Text>
              ) : null}
            </>
          )}
      </View>

      <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4, marginTop: 28 }}>ALERTS</Text>
      <View style={{ ...CARD, marginTop: 8, overflow: "hidden" }}>
        <Line
          label="Notifications"
          value={
            push === "on" ? "On"
            : push === "blocked" ? "Off"
            : push === "unsupported" ? "Not on a simulator"
            : push === "ask" ? "Not set up"
            : "—"
          }
          last={push === "on" || push === "unsupported" || push === null}
        />
        {/* THE CONTROL THAT CAN ACTUALLY CHANGE IT, which is a different one in each state.
            Offering "Turn on" to somebody who has already declined would do nothing at all —
            iOS will not show the prompt a second time — so that case gets the way OUT of the
            app instead, which is the only thing that works. */}
        {push === "ask" ? (
          <Pressable
            onPress={async () => {
              const r = await enablePush()
              setPushWhy(r.token ? null : r.why ?? null)
              setPush(await pushState())
            }}
            style={({ pressed }) => ({
              height: 48, alignItems: "center", justifyContent: "center",
              borderTopWidth: 1, borderTopColor: C.border,
              backgroundColor: pressed ? C.accent : "transparent",
            })}
          >
            <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.fg }}>Turn on notifications</Text>
          </Pressable>
        ) : push === "blocked" ? (
          <Pressable
            onPress={() => Linking.openSettings()}
            style={({ pressed }) => ({
              height: 48, alignItems: "center", justifyContent: "center",
              borderTopWidth: 1, borderTopColor: C.border,
              backgroundColor: pressed ? C.accent : "transparent",
            })}
          >
            <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.fg }}>Open iOS Settings</Text>
          </Pressable>
        ) : null}
      </View>
      {/* A REFUSAL CARRIES ITS REASON (§4). This is the answer to a press, not a subtitle. */}
      {pushWhy ? (
        <Text style={{ fontSize: 13, color: C.warn, marginTop: 8, paddingHorizontal: 4 }}>{pushWhy}</Text>
      ) : null}

      <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4, marginTop: 28 }}>APP</Text>
      <View style={{ ...CARD, marginTop: 8, overflow: "hidden" }}>
        <Line label="Version" value={version} />
        <Line label="Update" value={jsVersion} last />
      </View>

      <Pressable
        onPress={() => Linking.openURL("https://app.egful.store")}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          marginTop: 28, height: 50, borderRadius: R.control, borderWidth: 1, borderColor: C.edge,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="open-outline" size={18} color={C.fg} />
        <Text style={{ fontSize: 16, fontFamily: F.medium, color: C.fg }}>Open the full app</Text>
      </Pressable>

      <Pressable
        onPress={signOut}
        style={({ pressed }) => ({
          marginTop: 12, height: 50, borderRadius: R.control, alignItems: "center", justifyContent: "center",
          borderWidth: 1, borderColor: C.edge, opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontSize: 16, fontFamily: F.semi, color: C.alert }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  )
}
