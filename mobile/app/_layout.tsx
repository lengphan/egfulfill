import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { useFonts } from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { useEffect } from "react"
import * as Notifications from "expo-notifications"
import { router } from "expo-router"
import { routeForHref } from "@/lib/push"
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans"
import { C } from "@/lib/theme"

/**
 * THE APP HAD NO TYPEFACE.
 *
 * Not a light one, not a wrong one — none. There was no useFonts call and assets/fonts was
 * empty, so every screen rendered in the OS default at weight 800, which is precisely what
 * "looks AI-generated" is: system sans, extra-bold, on rounded cards. That is the failure
 * this call exists to prevent, and it is why `F` in lib/theme.ts is the only legal source of
 * a fontFamily anywhere in the app.
 *
 * ONE FACE: PLUS JAKARTA SANS, four weights. It has been three things before this — a
 * Playfair/Inter pair, then Inter alone, then Inter with Anton for display — and each change
 * was made to follow the WEB. This one is not: the phone has its own direction now
 * (lib/theme.ts), and Anton and Inter are gone from it entirely. A title here is a heavier
 * line, never a second alphabet.
 */
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [ready] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  })
  // Hold the splash until the face is in. A frame of system font followed by a reflow into
  // Inter is worse than waiting — it is the flash this app was just fixed for elsewhere.
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}) }, [ready])

  /**
   * A TAP ON A NOTIFICATION OPENS THE THING IT IS ABOUT.
   *
   * Here, not on a screen: this listener has to be mounted for the life of the app, and a
   * screen that unmounts takes its listener with it — which is how a notification tapped
   * from a tab you were not on ends up doing nothing.
   *
   * This covers the app being open or backgrounded. The COLD start is handled in
   * app/index.tsx, because at that moment there is no navigator to push onto yet and the
   * launch screen is already deciding where to go.
   */
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const href = res?.notification?.request?.content?.data?.href
      router.push(routeForHref(typeof href === "string" ? href : null) as never)
    })
    return () => sub.remove()
  }, [])

  /* EVERY HOOK IS ABOVE THIS LINE, and it has to be.
     The notification listener was written below it and crashed the app on launch with
     "Rendered more hooks than during the previous render": this component renders once with
     `ready` false and returns here, so a hook after the return exists on the second render
     and not the first. An early return in a component that owns hooks is a trap, and the
     only safe place for one is under all of them. */
  if (!ready) return null

  return (
    /* GESTURE ROOT, OUTERMOST. react-native-gesture-handler's detectors only receive touches
       inside this view, and a missing root fails SILENTLY — the gestures simply never fire,
       which looks like a bug in the screen rather than a missing provider. It wraps
       everything so any screen can use one without remembering to add it. */
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/* Native stack: real platform transitions and the iOS edge-swipe back, which is the
          single biggest thing a web view cannot give you. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.canvas } }} />
    </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
