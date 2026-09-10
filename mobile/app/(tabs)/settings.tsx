import { useCallback, useState } from "react"
import { View, Text, ScrollView, Pressable, Alert, Linking } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import Constants from "expo-constants"
import * as Updates from "expo-updates"
import { Ionicons } from "@expo/vector-icons"
import { getMe, clearToken, getConnections, type User, type StoreConnection } from "@/lib/api"
import { enablePush, disablePush, pushState, type PushState } from "@/lib/push"
import { useFocusEffect } from "expo-router"
import { TAB_BAR,F,C, R, CARD } from "@/lib/theme"

/** The channels the product supports, in the order the web lists them. A channel with no
 *  connection still gets a row: "we don't do TikTok" and "you haven't connected TikTok" are
 *  different sentences, and a missing row says neither. */
const STORES = [
  { key: "etsy", label: "Etsy" },
  { key: "shopify", label: "Shopify" },
  { key: "tiktok", label: "TikTok Shop" },
] as const

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
  const [upd, setUpd] = useState<"idle" | "checking" | "fetching" | "current">("idle")
  const [updWhy, setUpdWhy] = useState<string | null>(null)
  /* null means "not asked yet" and [] means "asked, none connected" — the row reads
     differently for each, because a screen still loading and an account with no shops must
     not look the same. */
  const [conns, setConns] = useState<StoreConnection[] | null>(null)

  const load = useCallback(async () => {
    try { setMe(await getMe()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load your account.") }
    /* Its own try: a connections failure must not blank the account block above it, which
       is the more important of the two and answered fine. */
    try { setConns(await getConnections()) } catch { setConns([]) }
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

  /**
   * PULL THE UPDATE NOW, rather than on the second cold start.
   *
   * expo-updates checks on launch, keeps running what it already has, and swaps to the new
   * bundle the NEXT time the app opens. That is the right default — nobody should have a
   * screen replaced under them mid-tap — but it means "force-quit it twice" is the only way
   * to see a change, and that is folklore for anyone reviewing a build rather than using it.
   *
   * So: ask, fetch, reload, in one press. The line above already says which bundle is
   * running; this is the control that changes it.
   */
  const checkForUpdate = async () => {
    setUpdWhy(null)
    /* A refusal carries its reason. In Expo Go and on a dev client there is no update to
       fetch and the call throws — saying so is the answer, and it is not the same as
       being up to date. */
    if (!Updates.isEnabled) { setUpdWhy("This build reads its JS from the dev server, so there is nothing to fetch."); return }
    setUpd("checking")
    try {
      const found = await Updates.checkForUpdateAsync()
      if (!found.isAvailable) { setUpd("current"); return }
      setUpd("fetching")
      await Updates.fetchUpdateAsync()
      /* No success state: the app restarts into the new bundle, so anything set here is
         drawn for a frame and then thrown away with the JS context that drew it. */
      await Updates.reloadAsync()
    } catch (e) {
      setUpd("idle")
      setUpdWhy(e instanceof Error ? e.message : "Couldn't reach the update server.")
    }
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

      {/* STORES. A channel with no row says so and says where to fix it. OAuth runs through a
          redirect_uri registered with Etsy, Shopify and TikTok that points at the web
          origin, so Connect genuinely cannot happen on the phone — §4 says explain, never
          hide, so the row names the reason rather than offering a button that would fail. */}
      <Text style={{ fontSize: 11.5, fontFamily: F.semi, color: C.muted, letterSpacing: 1.4, marginTop: 28 }}>STORES</Text>
      <View style={{ ...CARD, marginTop: 8, overflow: "hidden" }}>
        {STORES.map((st, i) => {
          const mine = conns?.filter((c) => c.platform === st.key) ?? []
          const synced = mine
            .map((c) => c.last_sync_at).filter(Boolean)
            .sort().reverse()[0] as string | undefined
          /* A shop whose token has died keeps its row and keeps its orders — it just stops
             syncing. That is the one state on this screen worth colouring, because it is
             the only one a person has to go and fix. */
          const dead = mine.find((c) => c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now())
          return (
            <View
              key={st.key}
              style={{
                paddingHorizontal: 16, paddingVertical: 13,
                borderBottomWidth: i === STORES.length - 1 ? 0 : 1, borderBottomColor: C.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 15, fontFamily: F.semi, color: C.fg, flex: 1 }}>{st.label}</Text>
                <Text style={{ fontSize: 13, fontFamily: F.medium, color: dead ? C.alert : mine.length ? C.fg : C.muted }}>
                  {conns === null ? "…" : dead ? "Reconnect" : mine.length ? "Connected" : "Not connected"}
                </Text>
              </View>
              {conns !== null && (
                <Text style={{ fontSize: 12.5, fontFamily: F.body, color: C.muted, marginTop: 3 }}>
                  {mine.length
                    ? [mine.map((c) => c.shop_name || c.shop_id).join(", "),
                       dead
                         ? `token expired ${new Date(dead.token_expires_at as string).toLocaleDateString()} — orders not syncing`
                         : synced ? `synced ${new Date(synced).toLocaleDateString()}` : "never synced"]
                        .filter(Boolean).join("  ·  ")
                    : "Connect this channel on the web"}
                </Text>
              )}
            </View>
          )
        })}
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
        <Pressable
          onPress={checkForUpdate}
          disabled={upd === "checking" || upd === "fetching"}
          style={({ pressed }) => ({
            height: 48, alignItems: "center", justifyContent: "center",
            borderTopWidth: 1, borderTopColor: C.border,
            backgroundColor: pressed ? C.accent : "transparent",
          })}
        >
          <Text style={{ fontSize: 15, fontFamily: F.semi, color: upd === "current" ? C.muted : C.fg }}>
            {upd === "checking" ? "Checking…"
              : upd === "fetching" ? "Downloading…"
              : upd === "current" ? "Already the newest"
              : "Check for updates"}
          </Text>
        </Pressable>
      </View>
      {updWhy ? (
        <Text style={{ fontSize: 13, color: C.warn, marginTop: 8, paddingHorizontal: 4 }}>{updWhy}</Text>
      ) : null}

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
