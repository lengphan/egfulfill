import { Tabs } from "expo-router"
import { Platform, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { F,C, TAB_BAR } from "@/lib/theme"

/**
 * The three things worth opening a phone for: what needs doing, a specific order, and the
 * money. Deliberately not a mirror of the web nav — a tab bar with nine entries is a menu,
 * and the point of the phone app is that it is quick.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  /*
   * BOTH PLATFORMS, AND THEY DISAGREE ON EVERY PART OF THIS.
   *
   * - shadow* is iOS-only; Android draws depth from `elevation` and ignores the rest.
   * - Android's elevation shadow behind a TRANSLUCENT fill renders muddy, and on several
   *   versions it is painted as a rectangle that ignores borderRadius entirely — which is
   *   exactly the boxy artefact under a rounded bar. So Android takes a near-opaque fill and
   *   a modest elevation; iOS keeps the softer translucency and a real soft shadow.
   * - The home indicator (iOS) and the gesture pill (Android) both live where this bar sits,
   *   so it has to clear the safe-area inset rather than a hard-coded 16.
   */
  const bottom = Math.max(insets.bottom, 10)
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.fg,
        /* HARDER TO SPOT because the inactive tint was C.muted — a warm grey drawn to sit
           quietly under body copy, which is the opposite of what a control needs. A tab you
           cannot find is not restraint. Ink at 55% keeps the live one clearly ahead while
           leaving the rest legible at arm's length. */
        tabBarInactiveTintColor: "rgba(11,11,12,0.55)",
        /*
         * A FLOATING BAR, ICONS ONLY.
         *
         * It was a full-width panel welded to the bottom edge with a top border and a label
         * under every icon — five words repeating what five recognisable glyphs already say,
         * and a hard rule cutting the paper off. Detaching it lets the list run underneath,
         * which is what makes a phone app feel like it has depth rather than panels.
         *
         * The labels go because the icons are the standard ones and the bar is five items
         * wide; a label under a house is a caption on a photograph of a house. Bigger glyphs
         * and a real touch target do the work instead.
         */
        tabBarShowLabel: false,
        tabBarStyle: {
          position: "absolute",
          // CONDENSED, AND A REAL CAPSULE. At 16pt insets with a 22pt radius this was still
          // a full-width slab with softened corners — the icons pushed out to the screen
          // edges, which is what makes a bar read as fixed furniture rather than as
          // something floating on top of the page. Pulled in so the five glyphs sit as a
          // GROUP, and rounded to half its height so the shape is a lozenge rather than a
          // rectangle pretending. This is the one place a fully-round shape is right: it is
          // not a chip, it is the bar itself.
          left: 58, right: 58, bottom,
          height: TAB_BAR.height,
          borderRadius: TAB_BAR.height / 2,
          /*
           * TRANSLUCENT PAPER, not a panel and not nothing.
           *
           * Fully transparent was worse than the panel it replaced: rows scrolled straight
           * through the glyphs and the bar stopped reading as a control at all. The floating
           * shape needs a ground — it just must not be a second opaque surface welded to the
           * bottom of the page.
           *
           * 94% of the page's own paper. Enough to carry the icons over anything scrolling
           * beneath, little enough that the list is still faintly there and the bar reads as
           * sitting ABOVE the page rather than ending it. A solid colour rather than a real
           * blur on purpose: expo-blur is a native module and would need a fresh dev build
           * before anyone could see it.
           */
          backgroundColor: Platform.OS === "android" ? "rgba(252,251,248,0.985)" : "rgba(252,251,248,0.94)",
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: "rgba(11,11,12,0.06)",
          paddingBottom: 0,
          ...Platform.select({
            ios: {
              shadowColor: "#0B0B0C",
              shadowOpacity: 0.09,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 8 },
            },
            android: { elevation: 4 },
            default: {},
          }),
        },
        /* CENTRED, AND MEANT IT. With the labels hidden the item keeps the padding the
           navigator reserves for a label, so every glyph sat high in the capsule rather than
           in the middle of it. Zero the padding and centre on both axes. */
        tabBarItemStyle: {
          height: TAB_BAR.height,
          justifyContent: "center",
          alignItems: "center",
          paddingTop: 0,
          paddingBottom: 0,
          paddingVertical: 0,
        },
        /* The icon slot is given the bar's FULL height and centres its own content, so the
           glyph no longer floats against space the (hidden) label used to occupy — that is
           what made every icon sit high in the capsule. */
        tabBarIconStyle: { flex: 1, marginTop: 0, marginBottom: 0, justifyContent: "center" },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "Today",
          tabBarIcon: ({ color, focused }) => (
            <View style={{ height: TAB_BAR.height, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={focused ? "today" : "today-outline"} size={27} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, focused }) => (
            <View style={{ height: TAB_BAR.height, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={focused ? "cube" : "cube-outline"} size={27} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ color, focused }) => (
            <View style={{ height: TAB_BAR.height, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={focused ? "scan" : "scan-outline"} size={27} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, focused }) => (
            <View style={{ height: TAB_BAR.height, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={focused ? "wallet" : "wallet-outline"} size={27} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <View style={{ height: TAB_BAR.height, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={focused ? "settings" : "settings-outline"} size={27} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  )
}
