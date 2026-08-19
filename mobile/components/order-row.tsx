import { View, Text, Image, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { assetUrl, type Order, type OrderItem } from "@/lib/api"
import { isOverdue, normalizeStage, units, numOf, platformOf, lineTitle, STAGE_LABEL } from "@/lib/orders"
import { F,C, R, LIFT, toneOf } from "@/lib/theme"

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
function ItemStrip({ items }: { items: OrderItem[] }) {
  const shown = items.slice(0, 4)
  const rest = items.length - shown.length
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
      {shown.map((it, i) => {
        const uri = assetUrl(it.img_ref || it.img || it.design_src)
        return uri ? (
          <Image key={it.line_id || it.id || i} source={{ uri }}
            style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.accent }} />
        ) : (
          <View key={it.line_id || it.id || i} style={{
            width: 34, height: 34, borderRadius: 8, backgroundColor: C.accent,
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="shirt-outline" size={15} color={C.primary} />
          </View>
        )
      })}
      {rest > 0 && (
        <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.muted, marginLeft: 2 }}>+{rest}</Text>
      )}
    </View>
  )
}

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
  const uri = assetUrl(first?.img_ref || first?.img || first?.design_src)

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
      /* A ROW ON THE PAGE, not a tile floating over it.
       *
       * This was a white card on warm paper with a border and a shadow, inset from the
       * screen margin — so the title sat at one left edge, the card at a second, its padding
       * at a third and the thumbnail pushed the text to a fourth. Four margins down one
       * screen is what reads as "no alignment", and white-on-beige is what reads as
       * stuck-on rather than seamless.
       *
       * Now it is paper all the way down: rows separated by a hairline, sharing ONE left
       * margin with the screen title. Selection tints instead of drawing a second border. */
      style={({ pressed }) => ({
        flexDirection: "row", gap: 13, paddingVertical: 14, paddingHorizontal: 18,
        borderBottomWidth: 1, borderBottomColor: C.border,
        backgroundColor: selected ? C.accent : pressed ? C.accent : "transparent",
      })}
    >
      {/* THE ARTWORK, so a row is recognisable before it is read. The thumbnail route is
          unauthenticated by design — an <img> cannot carry a bearer header — and guarded by
          a 122-bit row id instead. */}
      <View>
        {uri ? (
          <Image source={{ uri }} style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: C.accent }} resizeMode="cover" />
        ) : (
          <View style={{
            width: 64, height: 64, borderRadius: R.md, backgroundColor: C.accent,
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="shirt-outline" size={22} color={C.primary} />
          </View>
        )}
        {selecting && (
          <View style={{
            position: "absolute", left: -5, top: -5,
            width: 22, height: 22, borderRadius: 11,
            alignItems: "center", justifyContent: "center",
            backgroundColor: selected ? C.primary : C.card,
            borderWidth: 1.5, borderColor: selected ? C.primary : C.border,
          }}>
            {selected && <Ionicons name="checkmark" size={13} color={C.onPrimary} />}
          </View>
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        {/* The IDENTIFIER, small and above — it is how you find the order, not what the
            order is. `o.id` is not `o.num`: numOf keeps a marketplace order reading as the
            number the buyer and the packing slip say. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 12.5, fontFamily: F.medium, color: C.muted, letterSpacing: 0 }} numberOfLines={1}>
            {numOf(order)}
          </Text>
          <Text style={{ fontSize: 12, color: C.muted }}>·</Text>
          <Text style={{ fontSize: 12, color: C.muted, flex: 1 }} numberOfLines={1}>{platformOf(order)}</Text>
          {order.rush && <Chip solid label="RUSH" fg="#fff" bg={C.warn} />}
          {late && <Chip solid label="LATE" fg="#fff" bg={C.alert} />}
        </View>

        {/* THE PRODUCT — the one thing to read. */}
        <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: F.medium, color: C.fg, marginTop: 3, letterSpacing: -0.2 }}>
          {first ? lineTitle(first) : "No lines"}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
          <Chip label={STAGE_LABEL[stage] ?? stage} fg={tone.fg} bg={tone.bg} />
          {/* "items", matching the order screen. One phrasing across both, and "pc" was
              abbreviating a word that is barely long. */}
          <Chip label={`${units(order)} ${units(order) === 1 ? "item" : "items"}`} fg={C.muted} />
          {items.length > 1 && <Chip label={`${items.length} lines`} fg={C.muted} />}
        </View>

        {items.length > 1 && <ItemStrip items={items.slice(1)} />}
      </View>
    </Pressable>
  )
}
