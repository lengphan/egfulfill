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
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
} from "@expo-google-fonts/inter"
import { C } from "@/lib/theme"

/**
 * THE APP HAD NO TYPEFACE.
 *
 * Not a light one, not a wrong one — none. There was no useFonts call and assets/fonts was
 * empty, so every screen rendered in the OS default at weight 800, which is precisely what
 * "looks AI-generated" is: system sans, extra-bold, on rounded cards.
 *
 * ONE FACE NOW. It shipped as a PAIR — Playfair Display for titles, Inter for the rest,
 * matching the web at the time. The web has since resolved both display tokens to the body
 * stack, and this did not follow: three Playfair weights were still being downloaded and
 * still setting every screen title, so the two halves of one product had different
 * letterforms in the place a seller looks first.
 *
 * Dropping them also drops three font files from the bundle and three from the boot path,
 * which is the splash this file holds open.
 */
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [ready] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  })
  // Hold the splash until the face is in. A frame of system font followed by a reflow into
  // Inter is worse than waiting — it is the flash this app was just fixed for elsewhere.
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}) }, [ready])
  if (!ready) return null

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
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />
    </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
