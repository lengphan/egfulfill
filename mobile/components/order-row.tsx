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

function Chip({ label, fg, bg }: { label: string; fg: string; bg?: string }) {
  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 5,
      paddingHorizontal: 9, paddingVertical: 4, borderRadius: R.pill,
      backgroundColor: bg ?? "transparent",
      borderWidth: bg ? 0 : 1, borderColor: C.border,
    }}>
      {/* NO DOT. The chip is already the colour the dot was — a 6pt disc of the same
          hue beside its own coloured word is the value stated twice, and at that size it
          reads as a rendering speck rather than a mark. */}
      <Text style={{ fontSize: 11.5, fontFamily: F.bold, color: fg, letterSpacing: 0.2 }}>{label}</Text>
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
      style={({ pressed }) => ({
        flexDirection: "row", gap: 13, padding: 13, marginBottom: 10,
        backgroundColor: C.card, borderRadius: R.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? C.primary : C.border,
        opacity: pressed ? 0.75 : 1,
        ...LIFT,
      })}
    >
      {/* THE ARTWORK, so a row is recognisable before it is read. The thumbnail route is
          unauthenticated by design — an <img> cannot carry a bearer header — and guarded by
          a 122-bit row id instead. */}
      <View>
        {uri ? (
          <Image source={{ uri }} style={{ width: 64, height: 64, borderRadius: R.md, backgroundColor: C.accent }} resizeMode="cover" />
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
          <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.muted, letterSpacing: 0.3 }} numberOfLines={1}>
            {numOf(order)}
          </Text>
          <Text style={{ fontSize: 12, color: C.muted }}>·</Text>
          <Text style={{ fontSize: 12, color: C.muted, flex: 1 }} numberOfLines={1}>{platformOf(order)}</Text>
          {order.rush && <Chip label="RUSH" fg="#fff" bg={C.warn} />}
          {late && <Chip label="LATE" fg="#fff" bg={C.alert} />}
        </View>

        {/* THE PRODUCT — the one thing to read. */}
        <Text numberOfLines={1} style={{ fontSize: 17, fontFamily: F.bold, color: C.fg, marginTop: 3, letterSpacing: -0.3 }}>
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
