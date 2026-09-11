import { useState, useRef, useEffect } from "react"
import { View, Text, Image, Pressable, Modal, Animated, Easing, PanResponder } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable"
import { assetUrl, type Order } from "@/lib/api"
import { isOverdue, normalizeStage, units, numOf, lineTitle, STAGE_LABEL } from "@/lib/orders"
import { F, C, R } from "@/lib/theme"
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
    <View style={{ backgroundColor: C.surface, borderRadius: R.card, overflow: "hidden", marginTop: 10 }}>
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
            borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.hairline,
            backgroundColor: pressed ? C.hueMist : "transparent",
          })}
        >
          <Text style={{ flex: 1, fontSize: 16.5, fontFamily: a.strong ? F.semi : F.body, color: C.ink }}>{a.label}</Text>
          {/* Icon trailing, as Threads has it: the words are what you read down, and a
              column of glyphs on the left pushes every label away from the edge. */}
          <Ionicons name={a.icon} size={21} color={a.strong ? C.ink : C.muted} />
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
              // A SHEET IS A CARD. It was the page colour held apart from the page by a
              // hairline and a shadow — two near-identical surfaces, which is exactly the
              // construction the white card replaces. White on the tinted page separates on
              // its own, and the border finishes it. The shadow that used to be here is the
              // one Workshop forbids at every level.
              backgroundColor: C.surface,
              borderTopLeftRadius: R.card, borderTopRightRadius: R.card,
              paddingTop: 10, paddingBottom: 40, paddingHorizontal: 14,
              borderTopWidth: 1, borderColor: C.hairline,
            }}
          >
            <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: R.pill, backgroundColor: C.hairline, marginBottom: 14 }} />
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

  /*
   * ONE FACT, RANKED. The row used to carry the stage, an item count and a "No artwork"
   * chip side by side, which is three things claiming the same corner. Only one of them is
   * ever the reason you would stop on this row, so only one is shown, and the order below
   * is the order of urgency: a thing that BLOCKS production outranks a date, which outranks
   * where the job has got to.
   */
  const fact =
    noArt ? { text: "No artwork", color: C.alert } :
    late  ? { text: "Late",       color: C.alert } :
    order.rush ? { text: "Rush",  color: C.warn  } :
    { text: STAGE_LABEL[stage] ?? stage, color: C.muted }

  /* Two pictures and a count, not a strip you slide. The strip was 200pt tall and put two
     orders on a screen; on a queue the job is FINDING the order, and the pictures at this
     size still say which one it is. The full-size check has not moved — tap a thumbnail. */
  const lead = shots.slice(0, 2)
  const rest = shots.length - lead.length

  /*
   * SWIPE TO MOVE IT ON.
   *
   * The stage advance was reachable only through the ellipsis menu — two taps and a sheet
   * for the single most repeated action on the floor. A swipe is the gesture every list on
   * a phone already teaches, and it costs one hand.
   *
   * ONE ACTION, ONE SIDE. A row with an action on each edge makes a person remember which
   * is which; there is nothing here that deserves the second side. It appears only when the
   * order can actually move and the reader is allowed to move it — the same condition the
   * menu item uses, so the gesture can never offer what the sheet would refuse.
   *
   * NOT GATED ON REDUCED MOTION. The setting asks us to stop movement we cause, not movement
   * a finger is causing — the same line the draggable objects on the web band draw.
   */
  const row = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12,
        /* Inset by 8 so the selected FILL is an object with corners, while the content
           still starts at the screen's 18pt gutter — the same line the header and the
           search field sit on. */
        paddingVertical: 11, paddingHorizontal: 10, marginHorizontal: 8, borderRadius: R.chip,
        /* NO BORDER. Selection is a FILL, the way Apple Books does it in edit mode: nothing
           arrives at the edge, the row simply becomes a solid object. A rule between rows
           is drawn by the list, so a selected row is not also cut in half by one. */
        backgroundColor: selected ? C.hueMist : pressed ? C.hueMist : "transparent",
      })}
    >
      {lead.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {lead.map((sh, i) => (
            <Pressable key={i} onPress={() => setPeek(i)}>
              <Image
                source={{ uri: sh.uri }}
                style={{
                  width: 44, height: 44, borderRadius: R.chip, backgroundColor: C.hueMist,
                  marginLeft: i === 0 ? 0 : -14,
                  borderWidth: i === 0 ? 0 : 2, borderColor: C.canvas,
                }}
                resizeMode="cover"
              />
            </Pressable>
          ))}
          {rest > 0 && (
            <View style={{
              width: 44, height: 44, borderRadius: R.chip, marginLeft: -14,
              borderWidth: 2, borderColor: C.canvas, backgroundColor: C.ink,
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontSize: 12, fontFamily: F.medium, color: "#FFFFFF" }}>+{rest}</Text>
            </View>
          )}
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.semi, color: C.ink, letterSpacing: -0.15 }}>
          {numOf(order)}
        </Text>
        {/* The buyer, and the size of the job — the two things that tell one row from the
            next. The platform name is gone: it repeats on every row of a connected shop. */}
        <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.body, color: C.muted, marginTop: 1 }}>
          {[order.customer?.name, units(order) > 1 ? `${units(order)} items` : null].filter(Boolean).join("  ·  ") || "No lines"}
        </Text>
      </View>

      <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.medium, color: fact.color, textAlign: "right" }}>
        {fact.text}
      </Text>

      {selecting ? (
        <View style={{
          width: 20, height: 20, borderRadius: R.pill,
          alignItems: "center", justifyContent: "center",
          backgroundColor: selected ? C.ink : "transparent",
          borderWidth: selected ? 0 : 1.5, borderColor: C.edge,
        }}>
          {selected && <Ionicons name="checkmark" size={12} color={"#FFFFFF"} />}
        </View>
      ) : (
        <Pressable onPress={() => setMenu(true)} hitSlop={12}>
          <Ionicons name="ellipsis-horizontal" size={17} color={C.muted} />
        </Pressable>
      )}

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

  if (!(onAdvance && advanceLabel) || selecting) return row

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={44}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={onAdvance}
          style={{
            width: 132, marginVertical: 2, marginRight: 8, borderRadius: R.chip,
            alignItems: "center", justifyContent: "center", gap: 5,
            backgroundColor: C.hueDeep,
          }}
        >
          <Ionicons name="arrow-forward" size={18} color={"#FFFFFF"} />
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.semi, color: "#FFFFFF" }}>
            {advanceLabel}
          </Text>
        </Pressable>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  )
}
