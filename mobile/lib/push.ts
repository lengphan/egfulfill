import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import Constants from "expo-constants"
import { Platform } from "react-native"
import { registerPushDevice, forgetPushDevice } from "@/lib/api"

/**
 * PUSH — the one thing a factory phone exists for that a browser tab cannot do.
 *
 * The web console reaches people over SSE, which only works while a tab is OPEN. That is
 * exactly the case this app is not: somebody is on the floor with the screen off, and the
 * order that just went overdue is the reason they are carrying the phone at all. Settings
 * used to say, honestly, that there was no push service wired and a toggle that saves nothing
 * is worse than no toggle. This is that service.
 *
 * THE SERVER DECIDES WHAT IS WORTH SENDING, not this file. Push hangs off notify() in
 * server/src/routes/notifications.js — the same call the bell already fans out from, reached
 * from 33 places — so the phone and the bell cannot know about different sets of events. See
 * the note in server/src/routes/push.js for why the wiring is there and not per-event.
 *
 * WHAT THIS FILE OWNS: asking for permission, getting a token, handing it over, giving it
 * back on sign-out, and turning the server's canonical web href into a route this app has.
 */

/**
 * A NOTIFICATION THAT ARRIVES WHILE THE APP IS OPEN STILL SHOWS.
 *
 * The default is to swallow it, on the reasoning that the user can already see the app. That
 * reasoning is wrong on a floor: somebody is looking at ONE order and the alert is about a
 * different one, and the in-app bell is a screen away. A banner is the only thing that
 * reaches them where they are looking.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

/** The last token we handed to the server, so sign-out can give back the right one. */
let current: string | null = null

/**
 * ANDROID NEEDS A CHANNEL OR IT SHOWS NOTHING.
 *
 * Since Android 8 a notification with no channel is dropped silently — no banner, no error,
 * nothing in the log a person would find. The server sends `channelId: 'default'`, so this
 * name has to match it.
 */
async function ensureChannel() {
  if (Platform.OS !== "android") return
  await Notifications.setNotificationChannelAsync("default", {
    name: "Alerts",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  })
}

/**
 * Ask, get a token, hand it over. Returns the token, or null with a reason nobody has to
 * guess at — the caller decides whether that is worth saying on screen.
 *
 * NEVER PROMPTS TWICE. `getPermissionsAsync` first: iOS only shows the system dialog once
 * per install, so a second `request` on an account that said no does nothing at all and
 * would leave the app waiting on a prompt that will never appear.
 */
export async function enablePush(): Promise<{ token: string | null; why?: string }> {
  try {
    /* A SIMULATOR HAS NO PUSH SERVICE. Apple's simulator cannot register with APNs, so this
       fails there for a reason that has nothing to do with the code — worth naming, because
       "push is broken" on a simulator has cost people afternoons. */
    if (!Device.isDevice) return { token: null, why: "Push needs a real device." }

    await ensureChannel()

    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync()
      status = asked.status
    }
    if (status !== "granted") return { token: null, why: "Notifications are off for EGFUL in iOS Settings." }

    /* THE PROJECT ID IS REQUIRED and is not inferred in a production build. Without it
       getExpoPushTokenAsync throws a message about the project, which is the single most
       common reason push works in development and silently does not after a store build. */
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    if (!projectId) return { token: null, why: "This build has no EAS project id." }

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
    if (!data) return { token: null, why: "No push token was issued." }

    await registerPushDevice(data, Platform.OS)
    current = data
    return { token: data }
  } catch (e) {
    return { token: null, why: e instanceof Error ? e.message : "Couldn't turn on notifications." }
  }
}

/**
 * SIGN-OUT GIVES THE DEVICE BACK.
 *
 * A phone is a physical object that changes hands — an operator signs out and a warehouse
 * lead signs in on the same handset. Without this the previous account keeps receiving that
 * device's notifications until someone else registers on it, which on this product means one
 * person's orders and another person's balance on one lock screen. The server keys its
 * registry by TOKEN for the same reason; this is the half that covers signing out and not
 * back in.
 */
export async function disablePush() {
  const t = current
  current = null
  if (!t) return
  try { await forgetPushDevice(t) } catch { /* signing out must not fail on this */ }
}

/**
 * WHERE A NOTIFICATION GOES WHEN IT IS TAPPED.
 *
 * The server sends the WEB's href, because the web is canonical and one address for one
 * event is the point. Mapping it to a route this app actually has is presentation, so it
 * lives here — the server never has to know which screens the phone happens to have.
 *
 * Anything unrecognised lands on Today rather than nowhere: an unknown href means the web
 * grew a page the phone has not, and dropping the tap silently is the worse failure.
 */
export function routeForHref(href?: string | null): string {
  const h = String(href || "").trim()
  if (!h) return "/dashboard"

  const order = h.match(/^\/orders\/([^/?#]+)/)
  if (order) return `/order/${order[1]}`
  /* The operator board addresses an order by query string rather than by path. */
  const opOrder = h.match(/^\/operator\?order=([^&#]+)/)
  if (opOrder) return `/order/${opOrder[1]}`

  const [path] = h.split(/[?#]/)
  switch (path) {
    case "/orders":
    case "/operator":
    case "/designer":       return "/(tabs)/orders"
    case "/wallet":         return "/(tabs)/wallet"
    case "/inventory":      return "/(tabs)/scan"
    case "/settings":       return "/(tabs)/settings"
    case "/chat":           return "/chat"
    /* /notifications and /products have no phone equivalent. Today is where the counts are,
       which is the nearest honest answer to "something changed". */
    default:                return "/dashboard"
  }
}

/**
 * WHAT SETTINGS SHOWS, and why it is four states rather than a boolean.
 *
 * A switch would be a lie in two of these. Once someone declines the iOS prompt, the app
 * cannot ask again — only the person can, in iOS Settings — so a toggle that flips back the
 * instant it is touched is worse than no toggle. And a simulator can never register at all.
 * Naming the state is what lets the screen offer the RIGHT control: ask here, or go there.
 *
 *   on           permission granted and a token is with the server
 *   ask          never asked, or asked and dismissed — this app can still prompt
 *   blocked      declined. Only iOS Settings can undo it.
 *   unsupported  a simulator, which has no push service to register with
 */
export type PushState = "on" | "ask" | "blocked" | "unsupported"

export async function pushState(): Promise<PushState> {
  if (!Device.isDevice) return "unsupported"
  try {
    const p = await Notifications.getPermissionsAsync()
    if (p.status === "granted") return "on"
    /* `canAskAgain` is the whole distinction. iOS reports `denied` both for "declined" and
       for "not decided yet" on some paths; this is the flag that says whether a prompt would
       actually appear, which is what decides between offering the ask and offering the way
       to iOS Settings. */
    return p.canAskAgain ? "ask" : "blocked"
  } catch {
    return "ask"
  }
}
