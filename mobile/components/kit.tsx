/**
 * THE KIT — the primitives every screen is built from.
 *
 * WHY THIS EXISTS. Every screen in this app once hand-rolled its own layout out of raw
 * `View`s: its own gutter, its own title size, its own idea of what a row or an empty state
 * looks like. That is why nothing matched, why the same feedback had to be applied six
 * times, and why each round of it cost a full screen rewrite. The web learned this and wrote
 * it down — "a rule with no component is a wish", after the tab rule was violated 14 times
 * across 12 files.
 *
 * So the rules are not documented here, they are IMPLEMENTED here. A screen that imports
 * these cannot drift; a screen that hand-rolls a View instead is the thing to catch in
 * review, and `tools/check-mobile-theme.mjs` fails on any colour typed outside the theme.
 *
 * REDRAWN for the aura direction (2026-09-11). The contracts are unchanged on purpose — the
 * point of a primitive is that a new direction is a change HERE and nowhere else.
 */
import { ReactNode, useEffect, useRef, useState } from "react"
import {
  View, Text, Pressable, ScrollView, RefreshControl, Animated, Image, ViewStyle, StyleProp,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { TAB_BAR, F, C, R, S, TYPE, LIFT, CARD } from "@/lib/theme"
import { useCountUp, usePressScale, useReducedMotion } from "@/lib/motion"
import { Aura } from "@/components/aura"
import { MomentIcon, type Moment } from "@/components/moment-icon"

/** The one horizontal inset. Everything on every screen starts here. */
export const GUTTER = 20

/* ─────────────────────────────────────────────────────────────────────────────
   SCREEN — safe area, gutter, scroll, refresh, and room for the tab bar.
   Four screens each did this themselves and three of them got the bottom inset
   wrong, which is why content used to end under the tab bar.
   ──────────────────────────────────────────────────────────────────────────── */
export function Screen({ children, onRefresh, refreshing, scroll = true, aura, style }: {
  children: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  /** A screen that owns its own list (FlatList) turns this off and keeps the frame. */
  scroll?: boolean
  /** A MOMENT screen puts the wash behind everything — a welcome, a success, a first run.
   *  A screen that is mostly a list or a form must not: see the note on `Aura`. */
  aura?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const insets = useSafeAreaInsets()
  const pad = { paddingTop: insets.top + S.sm, paddingBottom: insets.bottom + TAB_BAR.clearance + S.xl }
  const body = !scroll
    ? <View style={[{ flex: 1, paddingTop: pad.paddingTop }, style]}>{children}</View>
    : (
      <ScrollView
        style={[{ flex: 1 }, style]}
        contentContainerStyle={pad}
        showsVerticalScrollIndicator={false}
        refreshControl={onRefresh
          ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.hueDeep} />
          : undefined}
      >
        {children}
      </ScrollView>
    )
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      {aura ? <Aura intensity={0.75} /> : null}
      {body}
    </View>
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
        {sub ? (
          <Text style={{ ...TYPE.small, fontFamily: F.medium, color: C.muted, marginBottom: 2 }}>{sub}</Text>
        ) : null}
        {/* ONE ALPHABET. A title is a HEAVIER LINE than the list under it, never a second
            face — the uppercase poster face this replaces was a whole other voice on a
            screen that already had one. */}
        <Text style={{ ...TYPE.h1, fontFamily: F.bold, color: C.ink }}>{title}</Text>
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
          width: 42, height: 42, marginTop: 4, borderRadius: R.pill,
          alignItems: "center", justifyContent: "center",
          backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.hairline,
        }}
      >
        <Ionicons name={icon} size={19} color={C.ink} />
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
      <Text style={{ ...TYPE.h3, fontFamily: F.semi, color: C.ink }}>{label}</Text>
      {action ? (
        <Pressable onPress={onPress} hitSlop={8}>
          {/* Periwinkle as TYPE is `hueDeep`'s job — 4.98:1 on the page. The identity hue
              is 3.38:1 and would be a link you cannot read. */}
          <Text style={{ ...TYPE.small, fontFamily: F.semi, color: C.hueDeep }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   TILE — a figure, a word, and a colour that IS the tile.
   A row is for reading a list; a tile is for recognising one thing at a glance.
   The colour is always a large FILL and never type.
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
        <Text style={{ fontSize: 34, lineHeight: 38, fontFamily: F.bold, color: fg, letterSpacing: -0.8 }}>
          {prefix ?? ""}{Math.round(shown).toLocaleString()}
        </Text>
        <Text style={{ ...TYPE.small, fontFamily: F.medium, color: fg, opacity: 0.72 }}>{label}</Text>
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
   CARD — the bounded white surface. The hairline is what draws it; the only two
   things in this app with a shadow are the primary button and the tab bar.
   ──────────────────────────────────────────────────────────────────────────── */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ ...CARD, marginHorizontal: GUTTER, overflow: "hidden" }, style]}>
      {children}
    </View>
  )
}

/**
 * A CARD THAT IS A MOMENT — the wash sits inside it, under the content. One per screen.
 *
 * IT MEASURES ITSELF, and it has to. `Aura` defaults its blob geometry to the WINDOW, so a
 * 168pt card clipped the top sliver off a wash scaled for 844pt and came out looking like a
 * plain grey card — the colour was there and almost none of it was inside the frame. The
 * blobs are laid out against the card's own height instead, so a short card gets a whole
 * composition rather than a corner of one.
 */
export function AuraCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [h, setH] = useState(0)
  return (
    <View
      onLayout={(e) => {
        const next = Math.round(e.nativeEvent.layout.height)
        /* Only on a real change: setState in a layout handler that fires on every pass is
           the effect-loop shape §2.8 is about, one render removed. */
        setH((prev) => (prev === next ? prev : next))
      }}
      style={[{ ...CARD, marginHorizontal: GUTTER, overflow: "hidden" }, style]}
    >
      {h > 0 ? <Aura height={h} intensity={0.9} palette={[C.auraPeri, C.auraLime, C.auraLilac]} /> : null}
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
        borderRadius: R.row,
        backgroundColor: selected || pressed ? C.hueMist : "transparent",
      })}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ ...TYPE.value, fontFamily: F.semi, color: C.ink }}>
          {title}
        </Text>
        {sub ? (
          <Text numberOfLines={1} style={{ ...TYPE.small, fontFamily: F.body, color: C.muted, marginTop: 1 }}>{sub}</Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  )
}

/** The rule between rows. Inset past whatever leads the row. */
export function Sep({ inset = GUTTER }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: C.hairline, marginLeft: inset, marginRight: GUTTER }} />
}

/* ─────────────────────────────────────────────────────────────────────────────
   BUTTON — shape says kind, fill says importance.

   A PILL, and this is the phone's own decision: the web's `Button` is
   `rounded-lg` and reserves `rounded-full` for things that are genuinely round.
   That rule was written for a dense app screen full of controls; a phone screen
   has one or two actions and the pill is the direction's signature.
   ──────────────────────────────────────────────────────────────────────────── */
export function Button({ label, icon, onPress, tone = "primary", loading, disabled, style }: {
  label: string
  icon?: keyof typeof Ionicons.glyphMap
  onPress: () => void
  /** primary = the one thing this screen is for · soft = a real but secondary action ·
   *  ghost = minor · etsy/shopify/tiktok = a store, which keeps its OWN colour so a
   *  connected shop is recognisable and never borrows the action hue. */
  tone?: "primary" | "soft" | "ghost" | "etsy" | "shopify" | "tiktok"
  loading?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const reduced = useReducedMotion()
  const press = usePressScale(reduced, 0.975)
  const skin = {
    primary: { bg: C.hueDeep, fg: "#FFFFFF", border: "transparent", lift: true },
    soft: { bg: C.hueMist, fg: C.hueDeep, border: "transparent", lift: false },
    ghost: { bg: "transparent", fg: C.ink, border: C.edge, lift: false },
    etsy: { bg: C.etsyWash, fg: C.etsy, border: "transparent", lift: false },
    shopify: { bg: C.shopifyWash, fg: C.shopify, border: "transparent", lift: false },
    tiktok: { bg: C.tiktokWash, fg: C.tiktok, border: "transparent", lift: false },
  }[tone]
  const off = !!disabled || !!loading
  const paint = off ? { bg: C.hueMist, fg: C.muted, border: "transparent", lift: false } : skin
  return (
    <Animated.View style={[{ transform: [{ scale: press.scale }] }, paint.lift ? LIFT : null, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: !!loading }}
        disabled={off}
        onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          marginHorizontal: GUTTER, height: 56, borderRadius: R.pill,
          backgroundColor: paint.bg,
          borderWidth: tone === "ghost" && !off ? 1.5 : 0, borderColor: paint.border,
        }}
      >
        {icon ? <Ionicons name={icon} size={19} color={paint.fg} /> : null}
        <Text style={{ color: paint.fg, fontFamily: F.bold, fontSize: 16 }}>
          {loading ? "…" : label}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   EMPTY STATE — THE FOUR PARTS (CLAUDE.md §4): a mark, a line, a note, a way out.
   ──────────────────────────────────────────────────────────────────────────── */
/**
 * THE OBJECTS — the brand's own motif set, carried over from the web band.
 *
 * Every style with real personality repeats a small ownable graphic. EGFUL already has one —
 * the rendered 3D family the marketing site floats through its band.
 */
export const OBJ = {
  star: require("../assets/obj/star.webp"),
  torus: require("../assets/obj/torus.webp"),
  blob: require("../assets/obj/blob-lime.webp"),
  bubble: require("../assets/obj/blob-peri.webp"),
  balloon: require("../assets/obj/balloon-peri.webp"),
  squiggle: require("../assets/obj/squiggle.webp"),
} as const

export function EmptyState({ icon, obj, moment, line, note, action, onAction, bad }: {
  icon: keyof typeof Ionicons.glyphMap
  /** One of the brand's rendered objects. */
  obj?: keyof typeof OBJ
  /** A drawn moment mark — the kit's own hand, and the default for an absence. */
  moment?: Moment
  line: string
  /** One sentence, and ONLY here: an empty region may carry one because there is nothing
   *  else to read. A populated screen may not (§4, "prose under a control is a defect"). */
  note?: string
  action?: string
  onAction?: () => void
  /** A FAILURE, not an absence. §4 forbids rendering the two the same — a cheerful drawn
   *  mark over "couldn't load" is the wrong face for bad news, so a failure keeps the flat
   *  glyph on an alert tile. */
  bad?: boolean
}) {
  return (
    <View style={{ alignItems: "center", paddingTop: 44, paddingHorizontal: GUTTER + 8 }}>
      {bad ? (
        <View style={{
          width: 48, height: 48, borderRadius: R.chip, alignItems: "center", justifyContent: "center",
          backgroundColor: C.alertTint,
        }}>
          <Ionicons name={icon} size={22} color={C.alert} />
        </View>
      ) : obj ? (
        <Image source={OBJ[obj]} style={{ width: 84, height: 84 }} resizeMode="contain" />
      ) : (
        <MomentIcon kind={moment ?? "empty"} size={96} />
      )}
      <Text style={{ ...TYPE.value, fontFamily: F.semi, color: C.ink, marginTop: 14, textAlign: "center" }}>{line}</Text>
      {note ? (
        <Text style={{ ...TYPE.small, lineHeight: 19, fontFamily: F.body, color: C.muted, marginTop: 5, textAlign: "center", maxWidth: 280 }}>
          {note}
        </Text>
      ) : null}
      {action && onAction ? (
        <View style={{ alignSelf: "stretch", marginTop: 18 }}>
          <Button label={action} onPress={onAction} tone="soft" />
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
 * THE ARRIVAL. It springs in from 0.96 rather than being already there. One mount-time
 * animation, not a stagger — twenty bubbles cascading on open would be a performance, and
 * only the newest message is news.
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
        <Text style={{ ...TYPE.small, fontFamily: F.medium, color: C.muted, marginBottom: 3, marginLeft: 4 }}>
          {by}
        </Text>
      )}
      <View style={{
        maxWidth: "84%", paddingHorizontal: 14, paddingVertical: 10,
        borderRadius: R.row,
        borderBottomRightRadius: mine ? 6 : R.row,
        borderBottomLeftRadius: mine ? R.row : 6,
        /* YOURS is the action hue, THEIRS is the card — the same two surfaces the rest of
           the app uses, rather than a third palette invented for chat. */
        backgroundColor: mine ? C.hueDeep : C.surface,
        borderWidth: mine ? 0 : 1.5,
        borderColor: C.hairline,
      }}>
        <Text style={{ ...TYPE.body, fontFamily: F.body, color: mine ? "#FFFFFF" : C.ink }}>
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
export function Skeleton({ w, h, radius = R.chip, style }: {
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
      width: w ?? "100%", height: h, borderRadius: radius, backgroundColor: C.hueMist, opacity: o,
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
            <Skeleton w="55%" h={13} />
            <Skeleton w="35%" h={11} />
          </View>
        </View>
      ))}
    </View>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   APPEAR — content that arrives rather than being already there.
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
