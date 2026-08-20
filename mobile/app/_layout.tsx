import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { useFonts } from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { useEffect } from "react"
import {
  PlayfairDisplay_500Medium, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold,
} from "@expo-google-fonts/playfair-display"
import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
} from "@expo-google-fonts/inter"
import { C } from "@/lib/theme"

/**
 * THE APP HAD NO TYPEFACE.
 *
 * Not a light one, not a wrong one — none. There was no useFonts call and assets/fonts was
 * empty, so every screen rendered in the OS default at weight 800, which is precisely what
 * "looks AI-generated" is: system sans, extra-bold, on rounded cards. Meanwhile the web has
 * carried Playfair Display since the marketing rebuild (web/app/layout.tsx), so the two
 * halves of one product did not share a letterform.
 *
 * Playfair is the vintage half — a high-contrast transitional serif whose thick/thin stroke
 * reads as PRINTED rather than rendered. Inter is the modern half and does the work: body
 * copy at 400, not 800. Same pairing as the web, so a seller who sees both sees one product.
 */
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [ready] = useFonts({
    PlayfairDisplay_500Medium, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  })
  // Hold the splash until the faces are in. A frame of system font followed by a reflow into
  // Playfair is worse than waiting — it is the flash this app was just fixed for elsewhere.
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}) }, [ready])
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
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />
    </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
