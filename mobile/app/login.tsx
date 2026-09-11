/**
 * SIGN IN — the first thing anyone sees, so it is the one screen that has to have a face.
 *
 * WHAT WAS WRONG WITH THE LAST ONE. A white card centred on a gradient, two fields and a
 * button. Every part of it was on-palette and correctly measured, and it still read as a
 * template, because nothing on it was OURS — swap the wordmark and it is any SaaS sign-in.
 * "Correct" and "designed" are not the same test, and only the second one is passed here.
 *
 * WHAT MAKES IT OURS, in four decisions:
 *
 *   1. THE OBJECT. `balloon-peri` is the brand's own rendered motif — periwinkle with a lime
 *      rim, which is this palette in one picture — and it BLEEDS off the top-right corner.
 *      A motif fully inside the frame is an illustration sitting on a page; one cropped by
 *      the edge is an object the page is a window onto. It is also the reason the screen
 *      needs no card: there is already something to look at.
 *   2. THE TYPE IS THE LAYOUT. "Welcome back." is set at 44pt over two lines, hard left on
 *      the gutter. The old screen's biggest element was a 22pt heading inside a box; here
 *      the words carry the composition and the fields sit underneath them.
 *   3. ONE LIME MARK, and it is a SHAPE rather than a colour on type — lime is 1.19:1 on
 *      paper and can never be lettering. It is a rule under the second word, which is the
 *      one place the palette's highlight belongs on a screen with no chrome.
 *   4. NO CARD. The fields sit on the paper. A card inside a screen that is already a
 *      composition is a second container for no reason, and boxing a form is exactly the
 *      move that made the last version anonymous.
 *
 * IT STILL SCROLLS. A 5.4" phone with the keyboard up has ~300pt of room, and the fields
 * must never be what gets clipped.
 */
import { useState } from "react"
import {
  View, Text, TextInput, Image, KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { router } from "expo-router"
import { login } from "@/lib/api"
import { enablePush } from "@/lib/push"
import { Wordmark } from "@/components/wordmark"
import { Aura } from "@/components/aura"
import { Button, GUTTER, OBJ } from "@/components/kit"
import { F, C, R, S, TYPE } from "@/lib/theme"

export default function Login() {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [focus, setFocus] = useState<"email" | "password" | null>(null)
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

  /* Sized off the viewport so the crop is the same gesture on a 5.4" and a 6.7" — a fixed
     280 is a third of the width on one phone and half of it on another. */
  const obj = Math.round(width * 1.02)

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      {/* The wash is TOP-WEIGHTED: it belongs to the object and the headline, and it has no
          business behind the fields, where it would be texture under something you type. */}
      <Aura height={620} intensity={0.85} palette={[C.auraPeri, C.auraLime, C.auraLilac]} />

      {/* THE OBJECT, CROPPED. Negative offsets on two sides — a motif that only leaves the
          frame on one edge reads as badly positioned rather than as deliberately cropped. */}
      <Image
        source={OBJ.balloon}
        style={{
          position: "absolute",
          /* LOW ENOUGH TO CLOSE THE GAP. At a smaller size and a higher offset the object
             finished around a third of the way down and left ~250pt of empty wash between
             it and the headline — a void reads as a layout that did not finish, and it is
             worse on a 6.7" screen than on the one it was drawn against. It now runs into
             the space the headline rises out of. */
          top: -obj * 0.10,
          right: -obj * 0.34,
          width: obj,
          height: obj,
          /* It sits UNDER the type. At full strength the highlight on the foil competes with
             a 44pt headline for the brightest thing on screen, and the headline must win. */
          opacity: 0.92,
        }}
        resizeMode="contain"
        /* Decorative: it carries no information a screen reader needs, and "balloon" read
           aloud before "Welcome back" is noise on the one screen that must be quick. */
        accessible={false}
      />

      {/* THE SECOND MOTIF, small and on the OTHER side.
          The set is meant to repeat — that is what an ownable motif set is for — and two
          objects on one diagonal is what turns a picture in a corner into a composition:
          balloon top-right, this bottom-left, headline under it. One object alone left a
          soft void across the middle of the screen that no amount of wash filled.
          It is also where the palette's lime gets to be an OBJECT rather than a rule. */}
      <Image
        source={OBJ.blob}
        style={{
          position: "absolute",
          top: obj * 0.52,
          left: -obj * 0.12,
          width: obj * 0.42,
          height: obj * 0.42,
          /* Quieter than the balloon on purpose: two objects at equal strength is two
             subjects, and this one is scenery. */
          opacity: 0.55,
        }}
        resizeMode="contain"
        accessible={false}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + S.lg,
            paddingBottom: insets.bottom + S.xl,
            paddingHorizontal: GUTTER,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Wordmark height={28} color={C.ink} />

          {/* THE HEADLINE CARRIES THE SCREEN. Two lines, hard left, tight — and it is pushed
              down rather than centred so the object above it has somewhere to be. */}
          <View style={{ marginTop: "auto", paddingTop: S.lg }}>
            <Text style={{ fontSize: 44, lineHeight: 46, fontFamily: F.bold, color: C.ink, letterSpacing: -1.4 }}>
              Welcome
            </Text>
            <View style={{ alignSelf: "flex-start" }}>
              <Text style={{ fontSize: 44, lineHeight: 46, fontFamily: F.bold, color: C.ink, letterSpacing: -1.4 }}>
                back.
              </Text>
              {/* THE ONE LIME MARK. A rule, not lettering — see the note at the top. It is
                  inset from the full stop so it underlines the word rather than the
                  punctuation, which is the difference between a swash and a strikethrough. */}
              <View style={{
                height: 6, borderRadius: R.pill, backgroundColor: C.lime,
                marginTop: 6, marginRight: 22,
              }} />
            </View>
          </View>

          <View style={{ marginTop: S.xl, gap: S.sm }}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocus("email")}
              onBlur={() => setFocus(null)}
              placeholder="Email or username"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              keyboardType="email-address"
              returnKeyType="next"
              style={[field, focus === "email" && lit]}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocus("password")}
              onBlur={() => setFocus(null)}
              placeholder="Password"
              placeholderTextColor={C.muted}
              autoComplete="current-password"
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={submit}
              style={[field, focus === "password" && lit]}
            />
            {/* A REFUSAL CARRIES ITS REASON — that is the answer, not a subtitle (§4). */}
            {err ? (
              <Text style={{ ...TYPE.small, fontFamily: F.medium, color: C.alert, marginTop: 2 }}>{err}</Text>
            ) : null}
          </View>

          {/* The kit's Button carries the screen gutter itself; this screen has already
              applied it, so it is taken back off rather than paid twice. */}
          <View style={{ marginTop: S.lg, marginHorizontal: -GUTTER }}>
            <Button label="Sign in" onPress={submit} disabled={!ready} loading={busy} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

/** A FIELD IS A FIELD (§4): normal weight, no fill beyond white, and a boundary that clears
 *  the 3:1 floor WCAG 1.4.11 puts under anything you have to FIND. */
const field = {
  height: 56,
  borderRadius: R.chip,
  borderWidth: 1.5,
  borderColor: C.edge,
  paddingHorizontal: S.md,
  ...TYPE.body,
  fontFamily: F.body,
  color: C.ink,
  backgroundColor: C.surface,
} as const

/** FOCUS IS THE ACTION COLOUR, and it is the only state change on the screen. Two fields
 *  that never acknowledge a tap is the other half of why the last version felt inert. */
const lit = { borderColor: C.hueDeep, borderWidth: 2 } as const
