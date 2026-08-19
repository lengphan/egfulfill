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
          left: 0, right: 0, bottom: 0,
          height: 74,
          // NO PANEL. Not a floating capsule either — the glyphs simply sit on the page and
          // the list runs beneath them, which is what the Threads feed does and what stops
          // the bottom of the screen reading as a second, competing surface. The lists carry
          // enough bottom padding that content comes to rest clear of them.
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
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
