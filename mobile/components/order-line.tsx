import { useState } from "react"
import { View, Text, Image, Pressable, ActivityIndicator, Alert, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { assetUrl, setItemStatus, type OrderItem, type OrderDesign } from "@/lib/api"
import {
  designsFor, lineArt, lineListing, lineTitle, lineFacts, nextLineStage, normalizeStage,
  STAGE_LABEL, stageActionLine, KIND_LABEL, isArtwork,
} from "@/lib/orders"
import { C, R, LIFT, toneOf } from "@/lib/theme"
import { ItemPhotos } from "@/components/item-photos"

/**
 * ONE LINE OF AN ORDER — the unit of work, and the unit this screen is built around.
 *
 * A three-line order is three jobs. Collapsing it into "3 pc" is what made the old screen
 * unusable on the floor: the person holding one shirt could not see which artwork was that
 * shirt's, and had no way to record that they had made it.
 *
 * So each line carries its OWN files (matched by line_id, never by sku alone — identical-SKU
 * siblings are routine on Etsy and matching on sku shows one line's artwork under the other)
 * and its OWN button.
 */

/** A stored file, small. Artwork gets a thumbnail because a designer recognises a picture;
 *  a stitch file gets its format in words, because a .pes has nothing to look at. */
function FileChip({ d }: { d: OrderDesign }) {
  const url = d.url || d.data || null
  const art = isArtwork(d.kind)
  const kind = KIND_LABEL[String(d.kind || "raster").toLowerCase()] ?? String(d.kind || "file").toUpperCase()
  const side = d.side && d.side !== "front" ? d.side : null
  // A data: URL is bytes we already have, not an address anything can open. Offering to
  // "open" one produces a failed intent, which reads as a broken file.
  const openable = !!url && /^https?:\/\//i.test(url)

  return (
    <Pressable
      disabled={!openable}
      onPress={() => url && Linking.openURL(url)}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 10,
        paddingVertical: 8, paddingHorizontal: 10, borderRadius: R.md,
        backgroundColor: pressed ? C.accent : "transparent",
      })}
    >
      {art && url ? (
        <Image source={{ uri: assetUrl(url) || undefined }}
          style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.accent }} />
      ) : (
        <View style={{
          width: 34, height: 34, borderRadius: 8, backgroundColor: C.ink,
          alignItems: "center", justifyContent: "center",
        }}>
          <Ionicons name="document-text" size={16} color={C.lime} />
        </View>
      )}
      <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: C.fg }} numberOfLines={1}>
        {kind}{side ? ` · ${side}` : ""}
        {d.name ? <Text style={{ fontWeight: "400", color: C.muted }}>{`  ${d.name}`}</Text> : null}
      </Text>
      {openable && <Ionicons name="open-outline" size={16} color={C.muted} />}
    </Pressable>
  )
}

export function OrderLine({ orderId, order, item, index, designs, canWork, onChanged }: {
  orderId: string
  /** The order this line belongs to — needed ONLY for `factory_order`, which decides
   *  whether `in_review` ("Pending") is on this line's ladder at all. A line cannot tell
   *  on its own; see nextLineStage. */
  order?: { factory_order?: boolean | null } | null
  item: OrderItem
  index: number
  /** EVERY design on the order. The line picks its own out — see designsFor. */
  designs: OrderDesign[]
  /** Staff only. The server refuses a seller outright; a button that always errors is
   *  worse than no button. */
  canWork: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(false)
  const mine = designsFor(item, designs)
  const art = lineArt(item, mine)
  const listing = lineListing(item)
  const stage = normalizeStage(item.factory_status)
  const tone = toneOf(stage)
  const facts = lineFacts(item)
  const to = nextLineStage(item, order)
  // A line with no print method is an undecorated blank. It needs no artwork, so it must
  // not be flagged as missing one — that would deadlock every plain-garment order.
  const needsArt = !!String(item.print_type || "").trim() && !mine.some((d) => isArtwork(d.kind))

  const move = async () => {
    if (!to) return
    setBusy(true)
    try {
      const r = await setItemStatus(orderId, { line_id: item.line_id, sku: item.sku }, to)
      // The refusal sentence is the SERVER's — it names which stages would be skipped, or
      // which blockers stop a ship. Rewriting it here would lose that.
      if (r.error) { Alert.alert("Not moved", r.error); return }
      onChanged()
    } catch (e) {
      Alert.alert("Not moved", e instanceof Error ? e.message : "Try again.")
    } finally { setBusy(false) }
  }

  return (
    <View style={{
      backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.border,
      padding: 14, marginBottom: 12, ...LIFT,
    }}>
      <ItemPhotos
        open={zoom}
        onClose={() => setZoom(false)}
        title={lineTitle(item)}
        art={art}
        listing={listing}
      />
      <View style={{ flexDirection: "row", gap: 14 }}>
        {/* THE ARTWORK, not the listing photo — a photo of the finished product tells the
            floor nothing about what to make. */}
        {/* PRESSABLE. 76pt is enough to recognise a design and not enough to check one,
            and this could not be tapped at all — so the only way to see the artwork full
            size was to open the file in a browser. It opens both pictures, named: the
            artwork we print, and the listing photo the buyer saw. It is pressable even
            with no artwork, because "is there really nothing on this line" is exactly the
            question a blank tile raises. */}
        <Pressable
          onPress={() => setZoom(true)}
          accessibilityLabel={`See the pictures for ${lineTitle(item)}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          {art ? (
            <Image source={{ uri: assetUrl(art) || undefined }}
              style={{ width: 76, height: 76, borderRadius: R.md, backgroundColor: C.accent }} resizeMode="cover" />
          ) : (
            <View style={{
              width: 76, height: 76, borderRadius: R.md, backgroundColor: C.accent,
              alignItems: "center", justifyContent: "center",
            }}>
              <Ionicons name="image-outline" size={22} color={C.primary} />
            </View>
          )}
        </Pressable>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "900", color: C.muted, letterSpacing: 1 }}>
              {String(index + 1).padStart(2, "0")}
            </Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, backgroundColor: tone.bg }}>
              <Text style={{ fontSize: 10, fontWeight: "900", color: tone.fg, letterSpacing: 0.6 }}>
                {(STAGE_LABEL[stage] ?? stage).toUpperCase()}
              </Text>
            </View>
            {Number(item.qty ?? 1) > 1 && (
              <Text style={{ fontSize: 12, fontWeight: "800", color: C.fg }}>×{Number(item.qty)}</Text>
            )}
          </View>

          <Text numberOfLines={2} style={{ fontSize: 17, fontWeight: "800", color: C.fg, marginTop: 5, letterSpacing: -0.3 }}>
            {lineTitle(item)}
          </Text>

          {/* The variant, as separate chips rather than one long dot-joined sentence. Three
              facts on one line read as three facts; strung together they read as a title
              that has overflowed. */}
          {facts.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {facts.map((f) => (
                <View key={f} style={{
                  paddingHorizontal: 8, paddingVertical: 4, borderRadius: R.pill,
                  borderWidth: 1, borderColor: C.border,
                }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: C.fg }}>{f}</Text>
                </View>
              ))}
            </View>
          )}

          {/* The BLANK, quietly and last. It is the stock/purchasing handle, not a name. */}
          {item.blank ? (
            <Text style={{ fontSize: 12, color: C.muted, marginTop: 8, letterSpacing: 0.4 }}>
              BLANK {item.blank}
            </Text>
          ) : null}
        </View>
      </View>

      {/* ── THIS LINE'S FILES ───────────────────────────────────────────────────── */}
      <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }}>
        {mine.length > 0 ? (
          mine.map((d, i) => <FileChip key={`${d.kind}-${d.side}-${i}`} d={d} />)
        ) : (
          /* Says WHICH it is: nothing to print versus nothing uploaded. An empty list that
             reads the same either way is how a missing file reaches the machine. */
          <Text style={{ fontSize: 13, color: needsArt ? C.warn : C.muted, paddingVertical: 8, paddingHorizontal: 10 }}>
            {needsArt ? "No artwork on this line yet." : "No file needed — plain blank."}
          </Text>
        )}
      </View>

      {canWork && to && (
        <Pressable
          onPress={move}
          disabled={busy}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 10, height: 46, borderRadius: R.md,
            backgroundColor: to === "working" ? C.primary : C.ink,
            opacity: pressed || busy ? 0.7 : 1,
          })}
        >
          {/* No glyph. "Start Item" needs no picture of starting, and arrow-forward was the
              second arrow on a card that already had one. */}
          {busy && <ActivityIndicator color={to === "working" ? C.onPrimary : C.lime} />}
          <Text style={{ fontSize: 15, fontWeight: "800", color: to === "working" ? C.onPrimary : C.lime }}>
            {stageActionLine(to)}
          </Text>
        </Pressable>
      )}
    </View>
  )
}
