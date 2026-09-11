/**
 * THE KIT — the primitives every screen is built from.
 *
 * WHY THIS EXISTS. Every screen in this app hand-rolled its own layout out of raw `View`s:
 * its own gutter, its own title size, its own idea of what a row or an empty state looks
 * like. That is why nothing matched, why the same feedback had to be applied six times, and
 * why each round of it cost a full screen rewrite. The web learned this and wrote it down —
 * "a rule with no component is a wish", after the tab rule was violated 14 times across 12
 * files — and mobile never got the lesson.
 *
 * So the rules below are not documented here, they are IMPLEMENTED here. A screen that
 * imports these cannot drift; a screen that hand-rolls a View instead is the thing to catch
 * in review.
 *
 * THE GRID. One gutter (`GUTTER`), one vertical rhythm (`S`), three radii (`R`). A component
 * in this file may set spacing; a screen may not invent its own.
 *
 * THE MOTION. Everything that moves does it through lib/motion.ts, and everything there
 * honours reduced motion by doing NOTHING rather than something slower.
 */
import { ReactNode, useEffect, useRef } from "react"
import {
  View, Text, Pressable, ScrollView, RefreshControl, Animated, Image, ViewStyle, StyleProp,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { TAB_BAR, F, C, R, S, posterTrack } from "@/lib/theme"
import { useCountUp, usePressScale, useReducedMotion } from "@/lib/motion"

/** The one horizontal inset. Everything on every screen starts here. */
export const GUTTER = 20

/* ─────────────────────────────────────────────────────────────────────────────
   SCREEN — safe area, gutter, scroll, refresh, and room for the tab bar.
   Four screens each did this themselves and three of them got the bottom inset
   wrong, which is why content used to end under the tab bar.
   ──────────────────────────────────────────────────────────────────────────── */
export function Screen({ children, onRefresh, refreshing, scroll = true, style }: {
  children: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  /** A screen that owns its own list (FlatList) turns this off and keeps the frame. */
  scroll?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const insets = useSafeAreaInsets()
  const pad = { paddingTop: insets.top + S.sm, paddingBottom: insets.bottom + TAB_BAR.clearance + S.xl }
  if (!scroll) {
    return <View style={[{ flex: 1, backgroundColor: C.bg, paddingTop: pad.paddingTop }, style]}>{children}</View>
  }
  return (
    <ScrollView
      style={[{ flex: 1, backgroundColor: C.bg }, style]}
      contentContainerStyle={pad}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh
        ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        : undefined}
    >
      {children}
    </ScrollView>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   HEAD — the one big title per screen, with room for controls beside it.
   ──────────────────────────────────────────────────────────────────────────── */
export function Head({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <View style={{
      paddingHorizontal: GUTTER, flexDirection: "row", alignItems: "flex-start", gap: S.md,
    }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {sub ? <Text style={{ fontSize: 13, color: C.muted, marginBottom: 2 }}>{sub}</Text> : null}
        {/* THE POSTER FACE. Uppercase because Anton is drawn for capitals, and tracked
            because it is condensed — both rules come from the web's own display class, so a
            title reads the same on the phone as it does on the site. */}
        <Text style={{
          fontSize: 34, lineHeight: 36, fontFamily: F.poster, color: C.fg,
          textTransform: "uppercase", letterSpacing: posterTrack(34),
        }}>{title}</Text>
      </View>
      {right}
    </View>
  )
}

/** A round control beside a Head. Shape says kind: this is something you press. */
export function HeadButton({ icon, label, onPress }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void
}) {
  const reduced = useReducedMotion()
  const press = usePressScale(reduced, 0.9)
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}
        onPressIn={press.onPressIn} onPressOut={press.onPressOut}
        style={{
          width: 40, height: 40, marginTop: 4, borderRadius: R.pill,
          alignItems: "center", justifyContent: "center",
          backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
        }}
      >
        <Ionicons name={icon} size={19} color={C.fg} />
      </Pressable>
    </Animated.View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION HEAD — sentence case, not tracked-out caps. Caps read as technical,
   which is the wrong register for most of this app.
   ──────────────────────────────────────────────────────────────────────────── */
export function SectionHead({ label, action, onPress }: {
  label: string; action?: string; onPress?: () => void
}) {
  return (
    <View style={{
      flexDirection: "row", alignItems: "baseline", justifyContent: "space-between",
      paddingHorizontal: GUTTER, marginTop: S.xl, marginBottom: S.sm,
    }}>
      <Text style={{ fontSize: 15.5, fontFamily: F.displaySemi, color: C.fg, letterSpacing: -0.2 }}>{label}</Text>
      {action ? (
        <Pressable onPress={onPress} hitSlop={8}>
          <Text style={{ fontSize: 12.5, fontFamily: F.medium, color: C.muted }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   TILE — a figure, a word, and a colour that IS the tile.
   A row is for reading a list; a tile is for recognising one thing at a glance.
   The colour is always a large FILL and never type, which is the one thing the
   house rules are strict about.
   ──────────────────────────────────────────────────────────────────────────── */
export function Tile({ n, label, bg, fg, prefix, onPress }: {
  n: number; label: string; bg: string; fg: string; prefix?: string; onPress?: () => void
}) {
  const reduced = useReducedMotion()
  const shown = useCountUp(n, reduced)
  const press = usePressScale(reduced)
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: press.scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={{ borderRadius: R.card, backgroundColor: bg, padding: 16, minHeight: 104, justifyContent: "space-between" }}
      >
        <Text style={{ fontSize: 38, lineHeight: 40, fontFamily: F.poster, color: fg, letterSpacing: posterTrack(38) }}>
          {prefix ?? ""}{Math.round(shown).toLocaleString()}
        </Text>
        <Text style={{ fontSize: 13, fontFamily: F.medium, color: fg, opacity: 0.72 }}>{label}</Text>
      </Pressable>
    </Animated.View>
  )
}

/** Two tiles side by side, at the screen's gutter. */
export function TileRow({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: GUTTER, marginTop: first ? S.lg : 10 }}>
      {children}
    </View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   CARD — the bounded white surface. No shadow, ever: depth here is a change of
   background value plus a border, and there is no token that provides a blur.
   ──────────────────────────────────────────────────────────────────────────── */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{
      marginHorizontal: GUTTER, borderRadius: R.card, backgroundColor: C.card,
      borderWidth: 1, borderColor: C.border, overflow: "hidden",
    }, style]}>
      {children}
    </View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   ROW — one line of a list. The separator belongs to the LIST, not the row, so
   a selected row can be a filled object without being cut in half by its own
   bottom border.
   ──────────────────────────────────────────────────────────────────────────── */
export function Row({ left, title, sub, right, onPress, selected }: {
  left?: ReactNode; title: string; sub?: string; right?: ReactNode
  onPress?: () => void; selected?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingVertical: 11, paddingHorizontal: 10, marginHorizontal: GUTTER - 10,
        borderRadius: R.control,
        backgroundColor: selected || pressed ? C.accent : "transparent",
      })}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.displaySemi, color: C.fg, letterSpacing: -0.15 }}>
          {title}
        </Text>
        {sub ? (
          <Text numberOfLines={1} style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>{sub}</Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  )
}

/** The rule between rows. Inset past whatever leads the row. */
export function Sep({ inset = GUTTER }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: C.border, marginLeft: inset, marginRight: GUTTER }} />
}

/* ─────────────────────────────────────────────────────────────────────────────
   BUTTON — shape says kind, fill says importance.
   ──────────────────────────────────────────────────────────────────────────── */
export function Button({ label, icon, onPress, tone = "primary" }: {
  label: string
  icon?: keyof typeof Ionicons.glyphMap
  onPress: () => void
  /** primary = the one thing this screen is for · bright = the same, when it sits on a
   *  quiet screen and should be the loudest object · ghost = a real but secondary act. */
  tone?: "primary" | "bright" | "ghost"
}) {
  const reduced = useReducedMotion()
  const press = usePressScale(reduced, 0.975)
  const skin = tone === "bright"
    ? { bg: C.acid, fg: C.onAcid, border: "transparent" }
    : tone === "ghost"
      ? { bg: "transparent", fg: C.fg, border: C.edge }
      : { bg: C.ink, fg: C.onInk, border: "transparent" }
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          marginHorizontal: GUTTER, height: 54, borderRadius: R.pill,
          backgroundColor: skin.bg, borderWidth: tone === "ghost" ? 1 : 0, borderColor: skin.border,
        }}
      >
        {icon ? <Ionicons name={icon} size={19} color={skin.fg} /> : null}
        <Text style={{ color: skin.fg, fontFamily: F.bold, fontSize: 16 }}>{label}</Text>
      </Pressable>
    </Animated.View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   EMPTY STATE — THE FOUR PARTS (CLAUDE.md §4): a mark, a line, a note, a way out.
   The mark is a glyph on a filled tile and never a loose outline: a 20pt stroke
   floating in whitespace is decoration the eye reads past, and the same glyph on
   a small filled square is an object it lands on. That single difference is what
   separates a region that reads as a PLACE from one that reads as a GAP.
   ──────────────────────────────────────────────────────────────────────────── */
/**
 * THE OBJECTS — the brand's own motif set, carried over from the web band.
 *
 * Every style with real personality repeats a small ownable graphic: Gumroad's pink coins,
 * PostHog's hedgehogs. EGFUL already has one — the rendered 3D family the marketing site
 * floats through its band — and mobile was drawing grey Ionicons in grey squares instead.
 */
export const OBJ = {
  star: require("../assets/obj/star.webp"),
  torus: require("../assets/obj/torus.webp"),
  blob: require("../assets/obj/blob-lime.webp"),
  bubble: require("../assets/obj/blob-peri.webp"),
  balloon: require("../assets/obj/balloon-peri.webp"),
  squiggle: require("../assets/obj/squiggle.webp"),
} as const

export function EmptyState({ icon, obj, line, note, action, onAction, bad }: {
  icon: keyof typeof Ionicons.glyphMap
  /** One of the brand's objects, in place of the glyph. Preferred wherever the region is a
   *  quiet moment rather than a failure — a failure keeps the icon, because a cheerful
   *  balloon over "couldn't load" is the wrong face for bad news. */
  obj?: keyof typeof OBJ
  line: string
  /** One sentence, and only here: an empty region may carry one because there is nothing
   *  else to read. A populated screen may not. */
  note?: string
  action?: string
  onAction?: () => void
  /** A failure, not an absence. §4 forbids rendering the two the same. */
  bad?: boolean
}) {
  return (
    <View style={{ alignItems: "center", paddingTop: 44, paddingHorizontal: GUTTER + 8 }}>
      {obj && !bad ? (
        <Image source={OBJ[obj]} style={{ width: 84, height: 84 }} resizeMode="contain" />
      ) : (
        <View style={{
          width: 46, height: 46, borderRadius: R.control, alignItems: "center", justifyContent: "center",
          backgroundColor: bad ? C.alert : C.accent,
        }}>
          <Ionicons name={icon} size={22} color={bad ? "#fff" : C.fg} />
        </View>
      )}
      <Text style={{ color: C.fg, fontSize: 15, fontFamily: F.semi, marginTop: 14, textAlign: "center" }}>{line}</Text>
      {note ? (
        <Text style={{ color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 5, textAlign: "center", maxWidth: 280 }}>
          {note}
        </Text>
      ) : null}
      {action && onAction ? (
        <View style={{ alignSelf: "stretch", marginTop: 18 }}>
          <Button label={action} onPress={onAction} tone="ghost" />
        </View>
      ) : null}
    </View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   BUBBLE — a message that arrives.
   ──────────────────────────────────────────────────────────────────────────── */
/**
 * TWO THINGS MAKE A BUBBLE READ AS A MESSAGE rather than a rounded box of text.
 *
 * THE CORNER. All four radii equal is a card. A message is anchored to the side it came
 * from, and the corner nearest that side is drawn tight — that single asymmetry is what
 * every chat app uses to say who is speaking, before colour does.
 *
 * THE ARRIVAL. It springs in from 0.96 rather than being already there. A thread where
 * everything simply exists reads as a transcript; one where the last line lands reads as a
 * conversation. It is one mount-time animation, not a stagger — twenty bubbles cascading on
 * open would be a performance, and only the newest message is news.
 */
export function Bubble({ text, mine, by }: { text: string; mine: boolean; by?: string | null }) {
  const reduced = useReducedMotion()
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current
  useEffect(() => {
    if (reduced) { v.setValue(1); return }
    const a = Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 7 })
    a.start()
    return () => a.stop()
  }, [reduced, v])
  return (
    <Animated.View style={{
      alignItems: mine ? "flex-end" : "flex-start",
      opacity: v,
      transform: [
        { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
      ],
    }}>
      {/* WHO SAID IT, on the other side only. Your own name over your own message is the one
          label nobody needs. */}
      {!mine && !!by && (
        <Text style={{ fontSize: 11.5, fontFamily: F.medium, color: C.muted, marginBottom: 3, marginLeft: 4 }}>
          {by}
        </Text>
      )}
      <View style={{
        maxWidth: "84%", paddingHorizontal: 14, paddingVertical: 10,
        borderRadius: 20,
        borderBottomRightRadius: mine ? 6 : 20,
        borderBottomLeftRadius: mine ? 20 : 6,
        // Ink for yours, the flat well for theirs — the same two surfaces the rest of the app
        // uses, rather than a third palette invented for chat.
        backgroundColor: mine ? C.ink : C.accent,
      }}>
        <Text style={{ fontSize: 15, fontFamily: F.body, color: mine ? C.onInk : C.fg, lineHeight: 21 }}>
          {text}
        </Text>
      </View>
    </Animated.View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   SKELETON — a block in the SHAPE of what is coming.
   A spinner says "something is happening somewhere"; a skeleton says "this is
   what will be here, and it will not move when it lands". The pulse is opacity
   only — a shifting gradient costs a frame budget this list does not have.
   ──────────────────────────────────────────────────────────────────────────── */
export function Skeleton({ w, h, radius = R.control, style }: {
  w?: number | `${number}%`; h: number; radius?: number; style?: StyleProp<ViewStyle>
}) {
  const reduced = useReducedMotion()
  const o = useRef(new Animated.Value(0.55)).current
  useEffect(() => {
    if (reduced) { o.setValue(0.5); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [reduced, o])
  return (
    <Animated.View style={[{
      width: w ?? "100%", height: h, borderRadius: radius, backgroundColor: C.accent, opacity: o,
    }, style]} />
  )
}

/** A list's worth of skeleton rows, shaped like `Row`. */
export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <View style={{ paddingHorizontal: GUTTER, gap: 18, marginTop: S.lg }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Skeleton w={44} h={44} />
          <View style={{ flex: 1, gap: 7 }}>
            <Skeleton w="55%" h={13} radius={R.badge} />
            <Skeleton w="35%" h={11} radius={R.badge} />
          </View>
        </View>
      ))}
    </View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   APPEAR — content that arrives rather than being already there.
   A stagger index turns a screenful of blocks into a sequence, which is most of
   what separates an app that feels built from one that feels assembled. It is
   ONE property (opacity + a 10pt rise), because two properties fighting over one
   element is how an entrance ends up never showing at all.
   ──────────────────────────────────────────────────────────────────────────── */
export function Appear({ children, index = 0, style }: {
  children: ReactNode; index?: number; style?: StyleProp<ViewStyle>
}) {
  const reduced = useReducedMotion()
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current
  useEffect(() => {
    if (reduced) { v.setValue(1); return }
    const a = Animated.timing(v, {
      toValue: 1, duration: 380, delay: index * 70, useNativeDriver: true,
    })
    a.start()
    return () => a.stop()
  }, [index, reduced, v])
  return (
    <Animated.View style={[{
      opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
    }, style]}>
      {children}
    </Animated.View>
  )
}
