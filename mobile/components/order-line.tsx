import { useState } from "react"
import { View, Text, Image, Pressable, ActivityIndicator, Alert, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { assetUrl, setItemStatus, type OrderItem, type OrderDesign } from "@/lib/api"
import {
  designsFor, lineArt, lineListing, lineTitle, lineFacts, nextLineStage, normalizeStage,
  STAGE_LABEL, stageActionLine, KIND_LABEL, isArtwork,
} from "@/lib/orders"
import { F,C, R, LIFT } from "@/lib/theme"
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
          <Ionicons name="document-text" size={16} color={C.onInk} />
        </View>
      )}
      <Text style={{ flex: 1, fontSize: 14, fontFamily: F.medium, color: C.fg }} numberOfLines={1}>
        {kind}{side ? ` · ${side}` : ""}
        {d.name ? <Text style={{ fontFamily: F.body, color: C.muted }}>{`  ${d.name}`}</Text> : null}
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
      /* A LINE ON THE PAGE. Each line was its own bordered, shadowed card inside the
         order's own card — a box in a box, and the reason nothing on this screen shared a
         left edge. A rule between lines separates them just as clearly. */
      borderTopWidth: 1, borderTopColor: C.border,
      paddingTop: 16, paddingBottom: 16,
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
            <Text style={{ fontSize: 11, fontFamily: F.bold, color: C.muted, letterSpacing: 1 }}>
              {String(index + 1).padStart(2, "0")}
            </Text>
            {/* THE STATUS PILL IS GONE FROM THE LINE. 10pt letters on a pale tint, inside a
                card that already carries a button saying what happens next — it was the
                smallest thing on the card and the hardest to read, and on the common case
                (every line at the same stage) it repeated the order's own badge N times.
                Where a line has no action left, the state is said in words below instead. */}
            {Number(item.qty ?? 1) > 1 && (
              <Text style={{ fontSize: 12, fontFamily: F.bold, color: C.fg }}>×{Number(item.qty)}</Text>
            )}
          </View>

          <Text numberOfLines={2} style={{ fontSize: 17, fontFamily: F.bold, color: C.fg, marginTop: 5, letterSpacing: -0.3 }}>
            {lineTitle(item)}
          </Text>

          {/* THE BLANK COMES BEFORE THE VARIANTS, because it is what they are variants OF.
              It was last — under the colour and size that describe it — so the card read
              "Black, Adjustable, DTG… of what?" and answered on the line after. The
              marketplace title above is a keyword list on an Etsy order and names nothing
              the floor picks; the blank is the garment, and it is the second thing read. */}
          {item.blank ? (
            <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: F.semi, color: C.fg, marginTop: 6 }}>
              {item.blank}
            </Text>
          ) : null}

          {/* THE VARIANT FACTS, still readable — and no longer chips.
              These carry the three things someone picking a garment needs, so they were
              made bigger and filled to stop being the lightest marks on the card. That was
              the right instinct and the wrong instrument: filled blocks are how the screen
              ended up as pills inside pills. Plain type at a readable size does it, and the
              PRINT METHOD keeps its distinction by weight and ink rather than a box — it is
              a different kind of fact (those two describe the blank, this describes the
              work), which is what the separator is there to say. */}
          {facts.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, marginTop: 8 }}>
              {facts.map((f, i) => {
                const method = i === facts.length - 1 && !!String(item.print_type || "").trim()
                return (
                  <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                    {i > 0 && <Text style={{ fontSize: 13, color: C.muted, opacity: 0.6 }}>·</Text>}
                    <Text style={{
                      fontSize: 13.5,
                      fontFamily: method ? F.semi : F.medium,
                      color: method ? C.primary : C.fg,
                      letterSpacing: method ? 0.3 : 0,
                    }}>{f}</Text>
                  </View>
                )
              })}
            </View>
          )}
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

      {canWork && to ? (
        <Pressable
          onPress={move}
          disabled={busy}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 12, height: 44, borderRadius: 12,
            backgroundColor: to === "working" ? C.primary : C.ink,
            opacity: pressed || busy ? 0.7 : 1,
          })}
        >
          {/* No glyph. "Start Item" needs no picture of starting, and arrow-forward was the
              second arrow on a card that already had one. */}
          {busy && <ActivityIndicator color={C.onInk} />}
          <Text style={{ fontSize: 15, fontFamily: F.semi, color: to === "working" ? C.onPrimary : C.onInk, letterSpacing: -0.1 }}>
            {stageActionLine(to)}
          </Text>
        </Pressable>
      ) : stage ? (
        /* NO BUTTON MEANS THE LINE IS SOMEWHERE, and it still has to say where. A card that
           simply stops looks like one whose control failed to render — and this is the case
           the pill above used to cover. In words, full size, rather than 10pt on a tint. */
        <Text style={{ marginTop: 10, fontSize: 15, fontFamily: F.semi, color: C.muted, textAlign: "center" }}>
          {STAGE_LABEL[stage] ?? stage}
        </Text>
      ) : null}
    </View>
  )
}
