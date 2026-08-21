import { Tabs } from "expo-router"
import { Platform, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { F, C, R, TAB_BAR } from "@/lib/theme"
import { ChatBubble } from "@/components/chat-bubble"

/**
 * The unlit tabs. Ink at 60% = 5.25:1 on the bar's white — a real reading, not a hint.
 *
 * It was 55% over a ground that was itself 94% translucent, so its true contrast depended on
 * whatever happened to be scrolling underneath. MEASURED: 4.36:1 even in the best case, with
 * plain white content behind the bar. That is under the 4.5:1 body floor before an order
 * thumbnail is anywhere near it, and in the screenshot that prompted this, one was.
 */
const INACTIVE = "rgba(10,10,10,0.6)"

/** Keyed by the FILLED glyph name, which is what the focused branch passes. One word each:
 *  a second word does not fit 58pt and a bar is not where you explain anything. */
const LABEL = { today: "Today", cube: "Orders", scan: "Scan", wallet: "Wallet", settings: "Settings" } as const

/**
 * The three things worth opening a phone for: what needs doing, a specific order, and the
 * money. Deliberately not a mirror of the web nav — a tab bar with nine entries is a menu,
 * and the point of the phone app is that it is quick.
 */

/**
 * THE ACTIVE TAB IS A NEUTRAL PILL, and there is no colour in this bar at all.
 *
 * It was a rose disc — C.pop, 42px, behind the live glyph. Two things were wrong with it,
 * and the second is the one that matters.
 *
 * lib/theme.ts states the rule for that token itself: it is a fill carrying dark text, and
 * it "earns its keep on the dark blocks and as a small badge". A tab indicator is neither.
 * It is the most PERMANENT element in the app — every screen, same place, always lit — so
 * putting the one bright thing there meant the accent stopped marking anything and simply
 * became what the tab bar looks like. An accent that is always on screen is a background.
 *
 * And the web never does this. `--pop` renders in exactly three places over there: the
 * unread notification dot, the unread row tint, and one badge in studio. Never in chrome —
 * no sidebar, no tab row, no nav. So the disc was a mobile-only rule, which is the thing
 * `web is canonical, mobile extends` exists to stop.
 *
 * What replaces it is a flat neutral ground (C.tabActive) carrying an ink glyph and an ink
 * label. Ink and WEIGHT do the work colour was doing — see that token's note for why the
 * ground itself cannot be the signal and what the two real channels measure.
 *
 * THE LABELS COME BACK. They went on the argument that five recognisable glyphs say it
 * already — but `scan` and `today` are not recognisable, they are guesses, and the bar is
 * the one control a new operator meets first. A word under a glyph is not a caption; it is
 * what makes the second tab findable without opening it.
 *
 * Rendered whole in `tabBarIcon` rather than through `tabBarShowLabel`, because the ground
 * has to enclose the glyph AND its word — the navigator draws those in two separate slots
 * and nothing can span them.
 */
function TabGlyph({ name, label, focused }: {
  name: keyof typeof Ionicons.glyphMap
  label: string
  focused: boolean
}) {
  const ink = focused ? C.fg : INACTIVE
  return (
    <View style={{ height: TAB_BAR.height, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          minWidth: 58, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 5,
          borderRadius: R.md, gap: 2,
          alignItems: "center", justifyContent: "center",
          backgroundColor: focused ? C.tabActive : "transparent",
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
        tabBarActiveTintColor: C.fg,
        tabBarInactiveTintColor: INACTIVE,
        tabBarShowLabel: false,
        /*
         * AN OPAQUE BAR. It floats, but it is a SURFACE.
         *
         * It was rgba(251,251,251,0.94) — the page's own #FBFBFB at 94% — inside a border of
         * rgba(10,10,10,0.06). So the fill was the page and the edge measured about 1.1:1
         * against it: on a white screen the capsule had no shape whatsoever, and the user's
         * report was that the control panel is impossible to see. It was, literally.
         *
         * The translucency was there so the list stayed "faintly visible" underneath. On warm
         * paper with a tinted bar that reads as depth; on white paper with a white bar it just
         * means order thumbnails scroll THROUGH the glyphs, which is the second half of the
         * same complaint. A floating control needs to be opaque or it is not a control.
         *
         * White on the near-white page, held by a measured hairline and a soft shadow — the
         * same construction the login panel uses, and C.card exists for exactly this: a
         * surface that genuinely IS a surface (never a content card — see lib/theme.ts).
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
          // R.md, so the shapes nest rather than repeat.
          borderRadius: TAB_BAR.height / 2,
          backgroundColor: C.card,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: C.border,
          paddingBottom: 0,
          ...Platform.select({
            /*
             * shadow* is iOS-only; Android draws depth from `elevation` and ignores the rest.
             * With the fill now OPAQUE, Android's elevation no longer renders muddy behind a
             * translucent ground — the artefact that forced the two platforms apart is gone,
             * so both can carry a real shadow.
             *
             * The home indicator (iOS) and the gesture pill (Android) both live where this bar
             * sits, which is why `bottom` clears the safe-area inset rather than a fixed 16.
             */
            ios: {
              shadowColor: "#0A0A0A",
              shadowOpacity: 0.10,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 6 },
            },
            android: { elevation: 6 },
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
