import { useState, useRef, useEffect } from "react"
import { View, Text, Image, Pressable, Modal, ScrollView, useWindowDimensions, Animated, Easing, PanResponder } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { assetUrl, type Order } from "@/lib/api"
import { isOverdue, normalizeStage, units, numOf, platformOf, lineTitle, lineFacts, STAGE_LABEL } from "@/lib/orders"
import { F,C, R, LIFT, toneOf } from "@/lib/theme"
/* ImagePeek moved to its own file once it grew pinch-zoom and a dismiss gesture — it
   is a photo viewer, and two screens use it. Re-exported so importers are unchanged. */
import { ImagePeek } from "@/components/image-peek"
export { ImagePeek }

/**
 * THE ARTWORK, FULL SIZE, on a long press.
 *
 * A 60pt thumbnail is enough to recognise a design and not enough to CHECK one — the same
 * finding that put ItemPhotos on the detail screen. On the queue the check has to be
 * reachable without leaving the list, because the question ("is this the right artwork?")
 * arrives while you are scrolling, not after you have committed to an order.
 *
 * Long-press, because tap already opens the order and long-press on the ROW already starts
 * a selection — the image claims the gesture only over itself, so both survive.
 */
type Action = { label: string; icon: keyof typeof Ionicons.glyphMap; run: () => void; strong?: boolean } | null

/**
 * A SHEET OF WHAT YOU CAN DO TO THIS ORDER.
 *
 * Rises from the bottom because that is where the thumb is, and closes on anything — the
 * backdrop, an action, the hardware back. Actions are grouped as one block of plain rows
 * rather than buttons: this is a menu, and a menu of five buttons reads as five decisions
 * of equal weight. Only the stage advance is set in ink, because it is the one that changes
 * the order rather than just showing it to you.
 */
function RowMenu({ open, onClose, title, actions }: {
  open: boolean; onClose: () => void; title: string; actions: Action[]
}) {
  const live = actions.filter(Boolean) as Exclude<Action, null>[]
  /*
   * SLID BY HAND, not by Modal's animationType.
   *
   * `animationType="slide"` has one fixed speed and no way to soften it, and it arrived too
   * fast to read as a panel rising — it read as a jump. An Animated value gives a duration
   * and an easing curve, and it has to stay mounted through the way OUT as well, which is
   * what `shown` is for: unmounting on `open` going false would cut the exit animation off
   * at frame one.
   *
   * NO SCRIM. Threads puts nothing behind its sheet, and the reason it works is that the
   * sheet is opaque and lands against the page rather than over a dimmed copy of it.
   * Dimming also implies modality this menu does not have — every action here is a small
   * one, and none of them stops you carrying on down the queue.
   */
  const slide = useRef(new Animated.Value(1)).current
  const [shown, setShown] = useState(open)

  useEffect(() => {
    if (open) setShown(true)
    Animated.timing(slide, {
      toValue: open ? 0 : 1,
      duration: open ? 340 : 220,   // slower in, quicker out — an exit that lingers reads as lag
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !open) setShown(false) })
  }, [open, slide])

  if (!shown) return null

  /* GROUPED. The look actions in one block, the ones that CHANGE the order in another.
     A single list of five makes five equal-looking decisions out of one that matters and
     four that don't. */
  const look = live.filter((a) => !a.strong)
  const change = live.filter((a) => a.strong)

  const Block = ({ items }: { items: Exclude<Action, null>[] }) => (
    <View style={{ backgroundColor: C.card, borderRadius: 16, overflow: "hidden", marginTop: 10 }}>
      {items.map((a, i) => (
        <Pressable
          key={a.label}
          onPress={() => { onClose(); a.run() }}
          /* 60pt tall. The rows were 15pt of padding around 16pt type and split by
             hairlines — a small target on a hand that is also holding a garment, and
             hairlines between touchables read as decoration rather than as edges. A filled
             block with real height says "press anywhere in here". */
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 12,
            paddingHorizontal: 18, height: 60,
            borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border,
            backgroundColor: pressed ? C.accent : "transparent",
          })}
        >
          <Text style={{ flex: 1, fontSize: 16.5, fontFamily: a.strong ? F.semi : F.body, color: C.fg }}>{a.label}</Text>
          {/* Icon trailing, as Threads has it: the words are what you read down, and a
              column of glyphs on the left pushes every label away from the edge. */}
          <Ionicons name={a.icon} size={21} color={a.strong ? C.fg : C.muted} />
        </Pressable>
      ))}
    </View>
  )

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      {/* Catches the tap OUTSIDE the sheet, and draws nothing. */}
      <Pressable onPress={onClose} style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View
          style={{
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 620] }) }],
          }}
        >
          {/* Stops a tap INSIDE the sheet from reaching the backdrop above. */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: C.bg,
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              paddingTop: 10, paddingBottom: 40, paddingHorizontal: 14,
              // With no scrim behind it the sheet carries its own separation, or its top
              // edge dissolves into paper of exactly the same colour.
              borderTopWidth: 1, borderColor: C.border,
              shadowColor: "#0B0B0C", shadowOpacity: 0.13, shadowRadius: 22,
              shadowOffset: { width: 0, height: -6 }, elevation: 16,
            }}
          >
            <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 14 }} />
            <Text style={{ fontSize: 12, fontFamily: F.semi, color: C.muted, letterSpacing: 1.2, paddingHorizontal: 4 }}>
              {title.toUpperCase()}
            </Text>
            {change.length > 0 && <Block items={change} />}
            {look.length > 0 && <Block items={look} />}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  )
}

/**
 * ONE ORDER IN THE LIST.
 *
 * The old row stacked three lines of text of nearly equal weight under a thumbnail, so the
 * product's name had the order number above it and a dot-joined string of platform, stage
 * and piece count crammed underneath — everything present, nothing legible at a glance.
 *
 * Here there is ONE thing to read (the product), one thing to identify it by (the number,
 * set small and above, where an identifier belongs), and the rest as separated chips with
 * air between them. An order with more than one line shows those lines' pictures, because
 * "3 pc" does not tell anyone what is in the parcel.
 *
 * Its own component, not a closure inside renderItem: FlatList remounts rows constantly and
 * a component defined during render is a new type on every pass, which defeats recycling.
 */

/** The order's OTHER lines, up to four. The first line's picture is already the row's
 *  thumbnail, so repeating it here reads as a duplicate rather than as a second item.
 *  Beyond four the strip stops being scannable and starts being a texture, so the rest are
 *  counted instead. */
function Chip({ label, fg, bg, solid }: { label: string; fg: string; bg?: string; solid?: boolean }) {
  /* NOT A PILL ANY MORE.
   *
   * Every row carried two of these and the filter rows carried eight more, so a screen
   * opened with ~20 lozenges on it and the eye had nowhere to land. The reserved stage
   * colour is the information; the capsule around it never was. A 6pt dot in that exact
   * colour beside plain type says the same thing and stops competing with the product name,
   * which is the one line anyone is actually reading.
   *
   * RUSH and LATE keep a fill, because they are the two states that SHOULD interrupt. That
   * is the whole point of reserving a shape: it means something when almost nothing has it.
   */
  if (solid) {
    return (
      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: bg }}>
        <Text style={{ fontSize: 10.5, fontFamily: F.bold, color: fg, letterSpacing: 0.6 }}>{label}</Text>
      </View>
    )
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {bg ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} /> : null}
      <Text style={{ fontSize: 12.5, fontFamily: F.medium, color: bg ? C.fg : C.muted }}>{label}</Text>
    </View>
  )
}

export function OrderRow({ order, selecting, selected, onPress, onLongPress, onAdvance, advanceLabel }: {
  order: Order
  selecting: boolean
  selected: boolean
  onPress: () => void
  onLongPress: () => void
  /** Move this one order on a stage. Absent for a seller, who may not. */
  onAdvance?: () => void
  /** The verb for that move ("Start", "Mark packed") — supplied by the queue, which already
   *  derives it from nextStage/STAGE_VERB, so the vocabulary is not re-invented here. */
  advanceLabel?: string | null
}) {
  const items = order.items ?? []
  const first = items[0]
  const stage = normalizeStage(order.factory_status)
  const tone = toneOf(stage)
  const late = isOverdue(order)
  const [peek, setPeek] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)

  /*
   * EVERY PICTURE IN THE ORDER, in a strip you slide.
   *
   * The row used to be a 84pt thumbnail on the left with the text beside it, which is a
   * directory listing: it tells you an order exists. This is the shape a Threads post uses —
   * who/what in type, then the pictures at a size you can actually judge, then the state.
   * For a factory queue that is the right trade, because the question being asked of this
   * screen is "what am I making", and that question is answered by a picture.
   *
   * THE LISTING PHOTO, ALWAYS — the product as the buyer bought it.
   *
   * This showed the ARTWORK first and fell back to the listing photo. The argument was that
   * a seller with one product gives every row the same rail of aprons, so the file is what
   * distinguishes them. On a queue that is the wrong trade: a bare design on white says
   * almost nothing about WHICH job this is, while the product shot is the thing anyone
   * recognises at a glance — and a print file out of context reads as a different order
   * from the product it belongs to.
   *
   * The artwork has not gone anywhere. It is on the LINE inside the order, beside the
   * listing photo and captioned per side, which is where someone is actually about to make
   * it (order-line.tsx). This row is for finding the order; that screen is for doing it.
   *
   * `art` still reports whether a file EXISTS, independent of which picture is shown, so
   * the "no artwork yet" state below stays true.
   */
  const shots = items
    .map((it) => {
      const a = assetUrl(it.design_src)
      const l = assetUrl(it.img_ref || it.img)
      return (l || a) ? { uri: (l || a) as string, title: lineTitle(it), art: !!a } : null
    })
    .filter(Boolean) as { uri: string; title: string; art: boolean }[]

  /* NO ARTWORK IS A FACT THE FLOOR NEEDS, not a badge on a picture.
   * Every image carried a LISTING tag, and because none of these orders has a file yet the
   * exception became the rule — a marker on every row marks nothing. It belongs in the state
   * line instead, where it reads as what it actually means: this cannot be produced yet. */
  const noArt = shots.length > 0 && !shots.some((s) => s.art)

  /* WHAT MAKES THIS ROW DIFFERENT FROM THE ONE ABOVE IT. A seller with one product gives
     every row the same truncated title; the variant is the part that differs. */
  const facts = first ? lineFacts(first) : []

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
      style={({ pressed }) => ({
        paddingTop: 14, paddingBottom: 14, paddingHorizontal: 18,
        borderBottomWidth: 1, borderBottomColor: C.border,
        backgroundColor: selected ? C.accent : pressed ? C.accent : "transparent",
      })}
    >
      {/* WHO — the identifier, small and above, where an identifier belongs. The tick moved
          here when the thumbnail stopped being the leading element. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        {selecting && (
          <View style={{
            width: 19, height: 19, borderRadius: 9.5, marginRight: 1,
            alignItems: "center", justifyContent: "center",
            backgroundColor: selected ? C.primary : "transparent",
            borderWidth: 1.5, borderColor: selected ? C.primary : C.border,
          }}>
            {selected && <Ionicons name="checkmark" size={12} color={C.onPrimary} />}
          </View>
        )}
        <Text style={{ fontSize: 13, fontFamily: F.medium, color: C.muted }} numberOfLines={1}>
          {numOf(order)}
        </Text>
        <Text style={{ fontSize: 12, color: C.muted }}>·</Text>
        <Text style={{ fontSize: 13, fontFamily: F.body, color: C.muted, flex: 1 }} numberOfLines={1}>
          {platformOf(order)}
        </Text>
        {order.rush && <Chip solid label="RUSH" fg="#fff" bg={C.warn} />}
        {late && <Chip solid label="LATE" fg="#fff" bg={C.alert} />}
        {/* THE QUIET WAY IN. Everything here is reachable by opening the order, which on a
            queue of 800 means losing your place to do one thing and coming back. A sheet
            keeps the scroll position and the hands where they are. */}
        <Pressable onPress={() => setMenu(true)} hitSlop={12} style={{ paddingLeft: 6, paddingVertical: 2 }}>
          <Ionicons name="ellipsis-horizontal" size={17} color={C.muted} />
        </Pressable>
      </View>

      {/* WHAT — the one line to read. */}
      <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: F.medium, color: C.fg, marginTop: 4, letterSpacing: -0.2 }}>
        {first ? lineTitle(first) : "No lines"}
      </Text>
      {facts.length > 0 && (
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.body, color: C.muted, marginTop: 2 }}>
          {facts.join("  ·  ")}
        </Text>
      )}

      {/* THE PICTURES. Slide for the rest; TAP one to see it full size — tap, not long-press,
          because on a picture a tap is the obvious gesture and the row already owns
          long-press for selection. It is a Pressable so the tap does NOT fall through and
          open the order underneath. */}
      {shots.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 10, marginHorizontal: -18 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 18 }}
        >
          {shots.map((sh, i) => (
            <Pressable key={i} onPress={() => setPeek(i)}>
              <Image
                source={{ uri: sh.uri }}
                /* THE SAME SIZES THE ORDER PAGE USES, deliberately. A lone picture ran the
                   full row width here, which on a QUEUE is too much: a feed wants one post
                   to fill the view, a work list wants several rows visible at once so you
                   can compare them without scrolling. Square, and the same square in both
                   places, so an order does not change shape when you open it. */
                style={{
                  width: shots.length === 1 ? 200 : 168,
                  height: shots.length === 1 ? 200 : 168,
                  borderRadius: 10, backgroundColor: C.accent,
                }}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* THE STATE. */}
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
        <Chip label={STAGE_LABEL[stage] ?? stage} fg={tone.fg} bg={tone.bg} />
        <Chip label={`${units(order)} ${units(order) === 1 ? "item" : "items"}`} fg={C.muted} />
        {noArt && <Chip label="No artwork" fg={C.muted} />}
      </View>

      <ImagePeek shots={shots} index={peek} onClose={() => setPeek(null)} />
      <RowMenu
        open={menu}
        onClose={() => setMenu(false)}
        title={numOf(order)}
        actions={[
          shots.length > 0 ? { label: shots.length > 1 ? `See all ${shots.length} pictures` : "See the picture", icon: "image-outline", run: () => setPeek(0) } : null,
          { label: "Open the order", icon: "open-outline", run: onPress },
          advanceLabel && onAdvance ? { label: advanceLabel, icon: "play-outline", run: onAdvance, strong: true } : null,
          { label: selected ? "Deselect" : "Select this order", icon: "checkmark-circle-outline", run: onLongPress },
        ]}
      />
    </Pressable>
  )
}
