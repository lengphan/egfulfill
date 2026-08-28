import { useEffect, useRef, useState } from "react"
import { View, Text, Animated, Easing, AccessibilityInfo } from "react-native"
import { router } from "expo-router"
import * as Notifications from "expo-notifications"
import { getToken } from "@/lib/api"
import { routeForHref } from "@/lib/push"
import { MarkE } from "@/components/wordmark"
import { C, F } from "@/lib/theme"

/**
 * THE LAUNCH SCREEN — the app's own first frame, not a spinner.
 *
 * WHAT THIS REPLACES. The native splash held the logo, then handed over to this route, which
 * rendered a bare ActivityIndicator on an empty page while `getToken()` resolved, and then
 * cut to Today. So the sequence a person actually saw was: mark, blank page with a spinner
 * on it, screen. The middle frame is the "loading dead screen" — it carries no information
 * (nobody can act on a spinner that lasts 80ms), it is the only surface in the app with
 * nothing of the brand on it, and the CUT out of it is what makes a launch feel abrupt.
 *
 * SO THE MARK CONTINUES INSTEAD OF STOPPING. The native splash shows the same mark on the
 * same ground; this screen draws it again and keeps it there while the token is read, so the
 * handover between the two is invisible. Then the whole thing rises and fades as one, and the
 * route replaces underneath it.
 *
 * THE FLOOR IS DELIBERATE. A signed-in launch resolves SecureStore in a few milliseconds, so
 * without a minimum the mark would appear and vanish inside one frame — a flash, which reads
 * worse than either a hold or no screen at all. 620ms is long enough to register and short
 * enough that nobody waits for it; the exit begins at that mark OR when the token lands,
 * whichever is later, so a slow keychain read never gets cut off mid-answer.
 *
 * MOTION IS ALWAYS OPT-OUT (CLAUDE.md §4). Under Reduce Motion the animation is skipped
 * entirely and the route is replaced immediately — the mark still shows, it simply does not
 * move, which is the accessible version of the same screen rather than a different one.
 */
const HOLD_MS = 620
const FADE_MS = 320

export default function Index() {
  const [msg, setMsg] = useState("")
  /* useRef, not useState: these are handed straight to the driver and re-creating them on a
     render would restart the animation from zero. */
  const fade = useRef(new Animated.Value(0)).current
  const rise = useRef(new Animated.Value(10)).current

  useEffect(() => {
    let alive = true
    let entered = false

    /* A PROMISE, NOT AN EFFECT THAT REFETCHES. The condition here is "the app has started",
       which happens exactly once — CLAUDE.md §2.8's rule about an effect whose own result can
       re-satisfy its condition does not apply, and this must never become a poll. */
    const started = Date.now()
    const go = (to: string) => {
      if (!alive) return
      const wait = Math.max(0, HOLD_MS - (Date.now() - started))
      setTimeout(() => {
        if (!alive) return
        if (!entered) { router.replace(to); return }
        Animated.timing(fade, {
          toValue: 0, duration: FADE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true,
        }).start(() => { if (alive) router.replace(to) })
      }, wait)
    }

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (!alive) return
        if (reduced) { fade.setValue(1); rise.setValue(0); return }
        entered = true
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          /* SPATIAL, not a scale-up. The mark settles into place; it does not zoom, which is
             the gesture every template splash makes. */
          Animated.timing(rise, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start()
      })
      /* A device that will not answer the accessibility query still has to launch. Showing
         the mark and skipping the motion is the safe branch. */
      .catch(() => { if (alive) { fade.setValue(1); rise.setValue(0) } })

    /**
     * A COLD START FROM A NOTIFICATION GOES TO THE THING IT IS ABOUT.
     *
     * The live tap listener lives in _layout.tsx, and it cannot cover this case: when the app
     * was not running, the tap IS the launch, and by the time a navigator exists this screen
     * has already decided where to go. So the destination is decided once, here, and the
     * notification wins over Today — otherwise tapping "Order #4099 is overdue" opens the
     * dashboard and leaves you to find it.
     *
     * Only when signed in. A tap that arrives with no session still has to go to /login, or
     * the app would push an order screen that immediately bounces.
     */
    Promise.all([getToken(), Notifications.getLastNotificationResponseAsync().catch(() => null)])
      .then(([t, res]) => {
        if (!t) return go("/login")
        const href = res?.notification?.request?.content?.data?.href
        return go(typeof href === "string" ? routeForHref(href) : "/dashboard")
      })
      /* SAY WHICH STATE THIS IS. A keychain that cannot be read is not the same as being
         signed out, and sending someone to /login would hide a real device fault behind a
         password prompt they do not need to type. */
      .catch(() => { if (alive) setMsg("Couldn't read the saved session.") })

    return () => { alive = false }
  }, [fade, rise])

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}>
      <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
        <MarkE size={56} color={C.fg} />
      </Animated.View>
      {msg ? (
        <Text style={{
          position: "absolute", bottom: 64, paddingHorizontal: 32, textAlign: "center",
          color: C.alert, fontSize: 14, fontFamily: F.body,
        }}>
          {msg}
        </Text>
      ) : null}
    </View>
  )
}
