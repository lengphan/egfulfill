import { useState } from "react"
import { View, Text, Image, Pressable, Modal, ScrollView, useWindowDimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { assetUrl, type Order } from "@/lib/api"
import { isOverdue, normalizeStage, units, numOf, platformOf, lineTitle, lineFacts, STAGE_LABEL } from "@/lib/orders"
import { F,C, R, LIFT, toneOf } from "@/lib/theme"

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
function ImagePeek({ shots, index, onClose }: {
  shots: { uri: string; title: string }[]
  /** null = closed. Otherwise the picture that was tapped, so the viewer opens on it. */
  index: number | null
  onClose: () => void
}) {
  const { width } = useWindowDimensions()
  const open = index != null
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(11,11,12,0.95)" }}>
        <Pressable onPress={onClose} style={{ position: "absolute", top: 54, right: 20, zIndex: 2, padding: 6 }} hitSlop={12}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        {/* THE WHOLE ORDER, not just the one you tapped. Paged, so it swipes exactly the way
            the strip in the row does — the gesture you just used still works once you are in
            here, which is the difference between a viewer and a dead end. */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (index ?? 0) * width, y: 0 }}
          style={{ flex: 1 }}
        >
          {shots.map((sh, i) => (
            <Pressable key={i} onPress={onClose} style={{ width, alignItems: "center", justifyContent: "center", padding: 20 }}>
              {/* contain, not cover: a print file cropped to fill is one you cannot check the
                  edges of — the same rule ItemPhotos follows. */}
              <Image source={{ uri: sh.uri }} style={{ width: width - 40, aspectRatio: 1 }} resizeMode="contain" />
              <Text numberOfLines={2} style={{ marginTop: 18, fontSize: 14, fontFamily: F.medium, color: "#fff", textAlign: "center" }}>{sh.title}</Text>
              {shots.length > 1 && (
                <Text style={{ marginTop: 6, fontSize: 12, fontFamily: F.body, color: "#fff", opacity: 0.55 }}>
                  {i + 1} of {shots.length}
                </Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>
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

export function OrderRow({ order, selecting, selected, onPress, onLongPress }: {
  order: Order
  selecting: boolean
  selected: boolean
  onPress: () => void
  onLongPress: () => void
}) {
  const items = order.items ?? []
  const first = items[0]
  const stage = normalizeStage(order.factory_status)
  const tone = toneOf(stage)
  const late = isOverdue(order)
  const [peek, setPeek] = useState<number | null>(null)

  /*
   * EVERY PICTURE IN THE ORDER, in a strip you slide.
   *
   * The row used to be a 84pt thumbnail on the left with the text beside it, which is a
   * directory listing: it tells you an order exists. This is the shape a Threads post uses —
   * who/what in type, then the pictures at a size you can actually judge, then the state.
   * For a factory queue that is the right trade, because the question being asked of this
   * screen is "what am I making", and that question is answered by a picture.
   *
   * ARTWORK FIRST, per line. `img_ref`/`img` are the marketplace LISTING photo and
   * design_src is the buyer's file — reading them the other way round (as this did) makes a
   * seller with one product show the same rail of aprons on every row, which is what made
   * the queue unscannable.
   */
  const shots = items
    .map((it) => {
      const a = assetUrl(it.design_src)
      const l = assetUrl(it.img_ref || it.img)
      return (a || l) ? { uri: (a || l) as string, title: lineTitle(it), art: !!a } : null
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
                style={{
                  width: shots.length === 1 ? 268 : 152, height: 152,
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
    </Pressable>
  )
}
