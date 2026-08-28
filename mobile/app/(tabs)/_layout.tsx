import { Tabs } from "expo-router"
import { Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { F, C, R, TAB_BAR } from "@/lib/theme"
import { ChatBubble } from "@/components/chat-bubble"

/**
 * THE UNLIT TABS, on the block.
 *
 * The bar was WHITE, and the unlit glyph was ink at 60% on it — 5.25:1, a real reading. That
 * construction is gone with the bar itself (see tabBarStyle), so this is re-measured against
 * slate rather than carried over: #DDE0E3 at 70% composites to #AAADB1, which is 5.32:1 on
 * the block. The live tab is ink on periwinkle at 11.22:1 — a 2.1x jump, plus a fill, plus a
 * weight change. Three channels, none of them hue, so it survives greyscale and a colourblind
 * operator both.
 */
const INACTIVE = "rgba(221,224,227,0.7)"

/** Keyed by the FILLED glyph name, which is what the focused branch passes. One word each:
 *  a second word does not fit 58pt and a bar is not where you explain anything. */
const LABEL = { today: "Today", cube: "Orders", scan: "Scan", wallet: "Wallet", settings: "Settings" } as const

/**
 * The three things worth opening a phone for: what needs doing, a specific order, and the
 * money. Deliberately not a mirror of the web nav — a tab bar with nine entries is a menu,
 * and the point of the phone app is that it is quick.
 */

/**
 * THE BAR IS THE DARK BLOCK, AND THE LIVE TAB IS THE ONE LIT THING ON IT.
 *
 * Two earlier versions of this control are worth recording, because this is the third and
 * each of the first two was fixing something real.
 *
 * It was a ROSE DISC behind the live glyph. Wrong because a tab indicator is the most
 * PERMANENT element in the app — every screen, same place, always lit — so putting the one
 * bright thing there meant the accent stopped marking anything and simply became what the
 * tab bar looks like. An accent that is always on screen is a background.
 *
 * It then became a WHITE BAR with a light-grey pill. That fixed the accent and introduced a
 * different defect: a light grey on white can only ever reach ~1.2:1, so the pill could not
 * be what tells you which tab is live, and the bar's own edge (C.border, 1.33:1) meant the
 * floating control had no shape against a light screen either. Ink and weight were carrying
 * the whole state on their own.
 *
 * The block solves both at once, and it is not a new idea — it is the web's sidebar. A dark
 * bounded panel carrying the nav, with exactly ONE item lit on it, is what answers "where am
 * I" over there, and the periwinkle exists in the palette for precisely this job. It is
 * 7.18:1 on slate and 1.67:1 on white, so this is the only surface in the app it can sit on
 * at all; the white bar could never have had it.
 *
 * It is also what lets the bar lose its shadow, which Workshop forbids at every level. Slate
 * is 10.88:1 against the page — the control has a shape because of what it IS, not because
 * of a blur underneath it.
 *
 * THE LABELS STAY. Five recognisable glyphs was the argument for dropping them, but `scan`
 * and `today` are not recognisable, they are guesses, and the bar is the one control a new
 * operator meets first. Rendered whole in `tabBarIcon` rather than through
 * `tabBarShowLabel`, because the ground has to enclose the glyph AND its word — the
 * navigator draws those in two separate slots and nothing can span them.
 */
function TabGlyph({ name, label, focused }: {
  name: keyof typeof Ionicons.glyphMap
  label: string
  focused: boolean
}) {
  const ink = focused ? C.onLit : INACTIVE
  return (
    <View style={{ height: TAB_BAR.height, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          minWidth: 58, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 5,
          borderRadius: R.control, gap: 2,
          alignItems: "center", justifyContent: "center",
          backgroundColor: focused ? C.lit : "transparent",
        }}
      >
        <Ionicons name={name} size={21} color={ink} />
        {/* 10.5 rather than 11: five words have to clear their pills at 58pt each without
            the longest of them ("Settings") wrapping or ellipsing. */}
        <Text
          numberOfLines={1}
          style={{
            fontSize: 10.5,
            lineHeight: 13,
            fontFamily: focused ? F.semi : F.medium,
            color: ink,
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  )
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  /* The home indicator (iOS) and the gesture pill (Android) both sit where this bar does,
     so it clears the safe-area inset rather than a hard-coded 16. */
  const bottom = Math.max(insets.bottom, 10)
  /* THE BUBBLE IS A SIBLING OF THE TABS, not a sixth tab.
     The bar holds places you GO; a conversation is something that interrupts you, which
     wants a control that floats over the page and carries a count rather than a slot in a
     row of five. A Fragment so it lands over whichever screen is showing. */
  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        /* TabGlyph inks its own glyph and label, because the ground has to enclose both
           and the navigator's two tint options cannot reach inside one View. These stay
           declared so anything the navigator draws itself agrees with it. */
        tabBarActiveTintColor: C.onLit,
        tabBarInactiveTintColor: INACTIVE,
        tabBarShowLabel: false,
        /*
         * AN OPAQUE BAR, AND NOW A DARK ONE. See the note above TabGlyph for why the white
         * version could not carry a live state, and why nothing lighter would have.
         *
         * NO SHADOW. Workshop's depth model is a change of background value, and the block is
         * 10.88:1 against the page — there is nothing left for a blur to add. The `elevation`
         * and `shadow*` keys that used to sit here are the exact thing lib/theme.ts removed
         * with LIFT, and a floating bar was the case most likely to argue for an exception.
         * It does not need one.
         */
        tabBarStyle: {
          position: "absolute",
          /*
           * INSET 16, NOT 58.
           *
           * 58 a side squeezed five 42pt targets into roughly 274pt on a 390pt phone — under
           * 55pt each, below Apple's 44pt with no space between them, and with nowhere to put
           * a word. The lozenge read as compact, and compact is not the same as legible.
           *
           * A 16pt inset still detaches the bar from the screen edge, which is the whole
           * point of floating it, and gives each of the five ~71pt to sit in.
           */
          left: 16, right: 16, bottom,
          height: TAB_BAR.height,
          // Half the height: still a true lozenge, just a wider one. The pills inside it are
          // R.control, so the shapes nest rather than repeat.
          borderRadius: TAB_BAR.height / 2,
          backgroundColor: C.ink,
          borderTopWidth: 0,
          borderWidth: 0,
          paddingBottom: 0,
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
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "today" : "today-outline"} label={LABEL.today} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "cube" : "cube-outline"} label={LABEL.cube} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "scan" : "scan-outline"} label={LABEL.scan} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "wallet" : "wallet-outline"} label={LABEL.wallet} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name={focused ? "settings" : "settings-outline"} label={LABEL.settings} focused={focused} />
          ),
        }}
      />
    </Tabs>
    <ChatBubble />
    </>
  )
}
