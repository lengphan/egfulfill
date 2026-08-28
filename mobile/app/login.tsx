import { useState } from "react"
import {
  View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { login } from "@/lib/api"
import { enablePush } from "@/lib/push"
import { Wordmark } from "@/components/wordmark"
import { F, C, R, S, CARD } from "@/lib/theme"

/**
 * SIGN IN — a block and a form, which is the shape the web's auth pages already have.
 *
 * WHAT WAS WRONG. This screen set the word "EGFUL" in Inter Bold at 34pt, put a sentence
 * under it, and stacked two fields and a button down the left of an empty page. Three
 * separate faults, and the first is the one that matters:
 *
 *   1. IT CARRIED NO MARK. The web has had a drawn wordmark on its header, its sidebar, its
 *      auth pages and its favicon for a while. The phone typed the product name out in the
 *      BODY FACE instead — so the one screen whose entire job is to say whose app this is
 *      was the only surface in the product with no logo on it.
 *   2. NOTHING WAS COMPOSED. A form left-aligned on a plain page with three tall gaps is
 *      what "clean" and "unfinished" look like from the same distance. The web hit exactly
 *      this when its auth ground went white, and its answer was to give the form a CARD and
 *      the page an object — see components/auth/auth-shell.tsx.
 *   3. THE FIELDS HAD NO EDGE. C.border measures 1.33:1 on white; both inputs, on the screen
 *      every user meets first, had boundaries that were not visibly there. That is the
 *      defect that split `border` from `edge` in lib/theme.ts.
 *
 * THE BLOCK RATHER THAN A PHOTOGRAPH. The web pairs its form with a picture because it has
 * a half-screen column to fill; a phone does not, and a bundled frame costs real megabytes
 * in the download for one screen. The app's own dark block does the job better here: it is
 * on-palette by construction, it cannot drift the way a photograph's colour does, and it is
 * the SAME surface the tab bar becomes one screen later — so the first thing a person sees
 * is the thing the app is made of.
 *
 * THE MARK IS PERIWINKLE ON IT, which is the one place that pair is allowed: `lit` is 7.18:1
 * on slate and 1.67:1 on white, so this and the tab bar are the only surfaces in the app it
 * can sit on at all.
 */
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
      /* THE PERMISSION PROMPT BELONGS HERE, and not one screen earlier.
         iOS shows the system dialog once per install, so asking before anyone has signed in
         spends the single chance on a person who does not yet know what the app is — and a
         declined prompt cannot be re-shown from inside the app at all. Asked at the moment
         someone has just proved they work here, the question answers itself.
         NOT awaited: a slow APNs registration must not hold the door shut. */
      enablePush().catch(() => {})
      router.replace("/dashboard")
    } catch (e) {
      // The server's own sentence, not a generic one — it distinguishes a wrong password
      // from an account that cannot sign in at all.
      setErr(e instanceof Error ? e.message : "Couldn't sign in.")
    } finally { setBusy(false) }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      {/* SCROLLS, because a 5.4" phone with the keyboard up has about 300pt of room and the
          card must not be the thing that gets clipped. `keyboardShouldPersistTaps` so the
          button is reachable on the first tap rather than after one that only dismisses. */}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* THE BLOCK. Rounded at the BOTTOM only — it runs off the top of the screen, so a
            radius up there would leave two slivers of page above it. */}
        <View
          style={{
            backgroundColor: C.ink,
            /* The mark sits at the BOTTOM of the block, which is what makes it read as a
               masthead rather than as a logo floating in a dark rectangle. The top padding
               is what gives the block its height, and it clears the notch first. */
            paddingTop: insets.top + 92,
            /* 58, against the card's -26 overlap, leaves 32pt between the mark's baseline and
               the card's top edge. At 40 it was 14, and the card looked like it had landed on
               the wordmark rather than under it. */
            paddingBottom: 58,
            /* ALIGNMENT IS SET ONCE (§4). This is the card's own left edge — its 16pt margin
               plus its 20pt padding — so the mark, the heading and both fields all start at
               the same x. At S.xl the mark sat 12pt inside of everything below it, which is
               the "nothing is aligned" defect measured on the inventory toolbar. */
            paddingHorizontal: S.lg + 20,
            borderBottomLeftRadius: R.card,
            borderBottomRightRadius: R.card,
          }}
        >
          <Wordmark height={34} color={C.lit} />
        </View>

        {/* THE CARD OVERLAPS THE BLOCK, and that is what holds the screen together.
            Two earlier arrangements did not. Pinned under the block it left ~450pt of empty
            page beneath it — the "three enormous vertical gaps" the web's auth page hit when
            its ground went white. Centred in the remaining height it drifted into the middle
            of nowhere, touching neither the block above nor anything below.
            Overlapping ties the form to the masthead so they read as one object, and the
            space beneath is never really empty: the keyboard fills it on the first tap. */}
        <View style={{
          marginTop: -26,
          paddingHorizontal: S.lg, paddingBottom: insets.bottom + S.xl,
        }}>
          <View style={{ ...CARD, padding: 20 }}>
            <Text style={{ fontSize: 20, fontFamily: F.displaySemi, letterSpacing: -0.4, color: C.fg }}>
              Sign in
            </Text>

            <View style={{ marginTop: 18, gap: S.md }}>
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
              {err ? <Text style={{ color: C.alert, fontSize: 13.5, fontFamily: F.body }}>{err}</Text> : null}
              <Pressable
                onPress={submit}
                disabled={busy || !ready}
                style={({ pressed }) => ({
                  height: 52, borderRadius: R.control, alignItems: "center", justifyContent: "center",
                  backgroundColor: C.brand,
                  opacity: busy || !ready ? 0.4 : pressed ? 0.85 : 1,
                })}
              >
                {busy ? <ActivityIndicator color={C.onBrand} />
                      : <Text style={{ color: C.onBrand, fontSize: 16, fontFamily: F.semi }}>Sign in</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// A FIELD'S EDGE IS `edge`, NOT `border`. See fault 3 in the note above, and the token's own
// note in lib/theme.ts: C.edge is 3.44:1 on a card, the WCAG 1.4.11 floor for a control.
const input = {
  height: 52,
  borderRadius: R.control,
  borderWidth: 1,
  borderColor: C.edge,
  paddingHorizontal: S.lg,
  fontSize: 16,
  fontFamily: F.body,
  color: C.fg,
  backgroundColor: C.card,
} as const
