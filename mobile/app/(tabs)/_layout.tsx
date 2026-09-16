/**
 * THE TAB BAR — a floating white pill, four places, and nothing else in it.
 *
 * FOUR TABS, AND THAT IS THE CEILING. Five labels in a 375pt-wide bar leaves ~66pt each,
 * which is not enough for a word plus its target, so the fifth thing always becomes a glyph
 * nobody can name. Settings, Chat, Top-up and an order are all reached by PUSHING a screen —
 * from the Home header, from a row, from a notification — because they are things you go and
 * come back from, not places you live.
 *
 * "HOME", NOT "DASHBOARD". Dashboard is nine characters and the longest word in the bar; at
 * 13pt it either wraps, ellipsises or forces every other label narrower to accommodate it.
 * It is also the wrong word: this is the screen you land on, not a console.
 *
 * WHITE, ON THE PAGE'S OWN PALETTE. The bar this replaces was a dark slate lozenge carrying
 * a pale periwinkle pill — the one dark object in a light app, which made the chrome the
 * loudest thing on every screen. Here the live tab is the WORD going heavy and inking up,
 * with a lime dot under it. Lime is 1.19:1 on paper and therefore cannot be a label; as a
 * 6pt dot beneath one it is exactly what it should be — a mark you recognise, not read.
 */
import { Tabs } from "expo-router"
import { Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { F, C, R, S, TYPE, TAB_BAR, LIFT } from "@/lib/theme"
import { ChatPeek } from "@/components/chat-peek"

function TabGlyph({ name, label, focused, width }: {
  name: keyof typeof Ionicons.glyphMap
  label: string
  focused: boolean
  width: number
}) {
  /* `muted` for the inactive state, NOT `ink40`. The kit set inactive labels in a 40% ink
     that measures 2.47:1 — a label you cannot read is not a label, and a tab bar is the one
     piece of chrome that is on screen on every single screen. `muted` is 4.79:1 on white. */
  const ink = focused ? C.ink : C.muted
  return (
    /* WIDTH IS MEASURED, NOT INHERITED. The label is drawn inside `tabBarIcon`, so React
       Navigation sizes this container to the GLYPH — about 21pt — and every word longer than
       four characters ellipsised. "Scan" survived by being four letters; Home, Orders and
       Wallet all read as "Ho…", "Or…", "Wal…" on a bar that had ~87pt per cell to give them.
       Rather than hope a hug resolves, take the cell width the bar actually has. */
    <View style={{ width, height: TAB_BAR.height, alignItems: "center", justifyContent: "center", gap: 3 }}>
      <Ionicons name={name} size={21} color={ink} />
      <Text
        numberOfLines={1}
        style={{
          ...TYPE.small,
          fontSize: 12,
          lineHeight: 14,
          fontFamily: focused ? F.semi : F.medium,
          color: ink,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
      {/* THE LIVE MARK. One of the three places lime is allowed. */}
      <View style={{
        width: 6, height: 6, borderRadius: R.pill,
        backgroundColor: focused ? C.lime : "transparent",
      }} />
    </View>
  )
}

const TAB_COUNT = 4

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  const { width: screenW } = useWindowDimensions()
  /* The bar is inset by S.lg on both sides and carries a 1.5pt border; four cells share
     what is left. Deterministic on every screen rather than dependent on how the icon
     slot happens to size itself. */
  const cellW = Math.max(44, Math.floor((screenW - S.lg * 2 - 3) / TAB_COUNT))
  /* The bar floats, so it clears the safe-area inset rather than a hard-coded 16. */
  const bottom = Math.max(insets.bottom, 10)

  /* CHAT IS NOT IN THE BAR, and that is a decision rather than an omission. The bar holds
     places you GO; a conversation is something that INTERRUPTS you. So it is drawn only
     while someone is waiting, over whichever screen is showing, and it says who and what
     rather than carrying a bare count. */
  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.ink,
        tabBarInactiveTintColor: C.muted,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: "absolute",
          left: S.lg, right: S.lg, bottom,
          height: TAB_BAR.height,
          borderRadius: R.pill,
          backgroundColor: C.surface,
          /* 1.5pt, matching every card. At 1pt a white bar on warm paper has no edge at all,
             and the shadow alone is not a boundary. */
          borderWidth: 1.5,
          borderColor: C.hairline,
          borderTopWidth: 1.5,
          borderTopColor: C.hairline,
          paddingBottom: 0,
          ...LIFT,
        },
        /* The navigator reserves vertical room for a label it is not drawing, which is what
           made every glyph sit high in its slot. Zero it and centre on both axes. */
        tabBarItemStyle: {
          height: TAB_BAR.height,
          justifyContent: "center",
          alignItems: "center",
          paddingTop: 0,
          paddingBottom: 0,
          paddingVertical: 0,
        },
        tabBarIconStyle: { flex: 1, marginTop: 0, marginBottom: 0, justifyContent: "center" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "home" : "home-outline"} label="Home" focused={focused} width={cellW} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "cube" : "cube-outline"} label="Orders" focused={focused} width={cellW} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "scan" : "scan-outline"} label="Scan" focused={focused} width={cellW} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "wallet" : "wallet-outline"} label="Wallet" focused={focused} width={cellW} />
          ),
        }}
      />
      {/* Still a screen, no longer a slot — the fifth thing that would have broken the bar.
          Reached from the Home header and from the notification map. */}
      <Tabs.Screen name="settings" options={{ title: "Settings", href: null }} />
    </Tabs>
    <ChatPeek />
    </>
  )
}
