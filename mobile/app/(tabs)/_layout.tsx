import { Tabs } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { F,C } from "@/lib/theme"

/**
 * The three things worth opening a phone for: what needs doing, a specific order, and the
 * money. Deliberately not a mirror of the web nav — a tab bar with nine entries is a menu,
 * and the point of the phone app is that it is quick.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.fg,
        tabBarInactiveTintColor: C.muted,
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
          left: 16, right: 16, bottom: 14,
          height: 62,
          borderRadius: 22,
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
          backgroundColor: "rgba(252,251,248,0.94)",
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: "rgba(11,11,12,0.06)",
          paddingBottom: 0,
          shadowColor: "#0B0B0C",
          shadowOpacity: 0.09,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        },
        tabBarItemStyle: { height: 62, paddingTop: 0 },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "Today",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "today" : "today-outline"} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "cube" : "cube-outline"} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "scan" : "scan-outline"} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "wallet" : "wallet-outline"} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "settings" : "settings-outline"} size={26} color={color} />,
        }}
      />
    </Tabs>
  )
}
