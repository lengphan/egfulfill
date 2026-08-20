import { useState } from "react"
import { View, Text, Image, Pressable, ActivityIndicator, Alert, Linking, ScrollView } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { assetUrl, setItemStatus, type OrderItem, type OrderDesign } from "@/lib/api"
import {
  designsFor, lineArt, lineListing, lineTitle, lineFacts, nextLineStage, normalizeStage,
  STAGE_LABEL, stageActionLine, KIND_LABEL, isArtwork, stageDenialReason, isFactoryOrder,
} from "@/lib/orders"
import { F,C, R, LIFT } from "@/lib/theme"
import { ImagePeek } from "@/components/order-row"

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

export function OrderLine({ orderId, order, item, index, designs, canWork, role, onChanged }: {
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
  /** WHICH staff. `canWork` only asks "not a seller", which is true of designers too — the
   *  role decides whether this particular move is theirs. Same gate as the web. */
  role?: string
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const mine = designsFor(item, designs)
  const art = lineArt(item, mine)
  const listing = lineListing(item)
  const stage = normalizeStage(item.factory_status)
  const facts = lineFacts(item)
  const to = nextLineStage(item, order)
  /* Same rules as the web (a port of stageDenialReason), so a line control that is dead on
     the phone is dead on the board too — and the reason is the same sentence. */
  const denial = to ? stageDenialReason(role ?? "", stage, to, isFactoryOrder(order)) : null
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

  const [peek, setPeek] = useState<number | null>(null)

  /*
   * EVERY PICTURE ON THIS LINE, captioned, in the order someone would look at them.
   *
   * The artwork per SIDE first — a front and a back are two different jobs on one garment,
   * and this strip is the only place they can be seen next to each other. The listing photo
   * last and NAMED, because it is what the buyer saw and not what we make; the two being
   * indistinguishable is the exact fault lineArt() exists to prevent.
   *
   * Anything with no picture to show (a .pes has nothing to look at) is not dropped — it
   * falls through to `docs` and stays a named row, because a stitch file that is silently
   * absent is a file that reaches the machine missing.
   */
  const pics = mine
    .filter((d) => isArtwork(d.kind) && (d.url || d.data))
    .map((d) => ({
      uri: assetUrl(d.url || d.data) as string,
      caption: [d.side ? String(d.side) : "Front", KIND_LABEL[String(d.kind || "raster").toLowerCase()] ?? "Artwork"]
        .filter(Boolean).join(" · "),
      title: lineTitle(item),
    }))
  if (!pics.length && art) pics.push({ uri: assetUrl(art) as string, caption: "Artwork", title: lineTitle(item) })
  if (listing) pics.push({ uri: assetUrl(listing) as string, caption: "Listing photo — what the buyer saw", title: lineTitle(item) })
  const docs = mine.filter((d) => !isArtwork(d.kind))

  return (
    <View style={{
      /* A LINE ON THE PAGE. Each line was its own bordered, shadowed card inside the
         order's own card — a box in a box, and the reason nothing on this screen shared a
         left edge. A rule between lines separates them just as clearly. */
      borderTopWidth: 1, borderTopColor: C.border,
      paddingTop: 16, paddingBottom: 16,
    }}>
      <ImagePeek shots={pics} index={peek} onClose={() => setPeek(null)} />
      {/* TITLE → WHAT IT IS → THE PICTURES, in that order.
       *
       * The line used to lead with a 76pt thumbnail beside the text, and then list its files
       * as separate rows underneath — so ONE line showed two pictures (artwork and listing)
       * through a modal, plus a list of file names, and none of it told you what was
       * actually going on the garment. Reading order is the fix: what it is in type, then
       * every image belonging to this line laid out sideways, at a size worth looking at.
       *
       * Per SIDE matters here in a way it never did on the queue — a front and a back are
       * two different jobs on one garment, and the strip is the only place they can be seen
       * next to each other. Each picture is captioned with its side and what kind of file it
       * is, because "front artwork" and "the photo the buyer saw" must never be mistaken for
       * one another. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 11, fontFamily: F.semi, color: C.muted, letterSpacing: 1.2 }}>
          {String(index + 1).padStart(2, "0")}
        </Text>
        {Number(item.qty ?? 1) > 1 && (
          <Text style={{ fontSize: 12.5, fontFamily: F.semi, color: C.fg }}>×{Number(item.qty)}</Text>
        )}
      </View>

      <Text numberOfLines={2} style={{ fontSize: 16.5, fontFamily: F.medium, color: C.fg, marginTop: 5, letterSpacing: -0.2 }}>
        {lineTitle(item)}
      </Text>

      {/* THE BLANK COMES BEFORE THE VARIANTS, because it is what they are variants OF. The
          marketplace title above is a keyword list on an Etsy order and names nothing the
          floor picks; the blank is the garment. */}
      {item.blank ? (
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.semi, color: C.fg, marginTop: 6 }}>
          {item.blank}
        </Text>
      ) : null}

      {facts.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, marginTop: 5 }}>
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

      {/* THE SKU, LAST AND QUIET. It is how a person looks something up, not what the thing
          is — and it carries a print-method suffix the blank does not, so it is deliberately
          not the same string as the line above. */}
      {item.sku ? (
        <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.body, color: C.muted, marginTop: 4 }}>
          {item.sku}
        </Text>
      ) : null}

      {/* EVERY PICTURE ON THIS LINE, sideways. */}
      {pics.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12 }}
          contentContainerStyle={{ gap: 10, paddingRight: 18 }}
        >
          {pics.map((pc, i) => (
            <Pressable key={i} onPress={() => setPeek(i)} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
              <Image
                source={{ uri: pc.uri }}
                style={{
                  width: pics.length === 1 ? 200 : 168,
                  height: pics.length === 1 ? 200 : 168,
                  borderRadius: 10, backgroundColor: C.accent,
                }}
                resizeMode="cover"
              />
              <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: F.medium, color: C.muted, marginTop: 6, maxWidth: 168 }}>
                {pc.caption}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        /* Says WHICH it is: nothing to print versus nothing uploaded. An empty list that
           reads the same either way is how a missing file reaches the machine. */
        <Text style={{ fontSize: 13.5, fontFamily: F.body, color: needsArt ? C.warn : C.muted, marginTop: 12 }}>
          {needsArt ? "No artwork on this line yet." : "No file needed — plain blank."}
        </Text>
      )}

      {/* Files with nothing to show as a picture — a .pes has nothing to look at — stay as
          named rows, so a stitch file is never silently absent just because it cannot be
          previewed. */}
      {docs.length > 0 && (
        <View style={{ marginTop: 10 }}>
          {docs.map((d, i) => <FileChip key={`${d.kind}-${d.side}-${i}`} d={d} />)}
        </View>
      )}

      {canWork && to && denial ? (
        /* NEVER HIDE, EXPLAIN. The move is named and so is whose call it is, rather than
           the card simply stopping — which reads as a control that failed to render. */
        <Text style={{ marginTop: 12, fontSize: 13.5, fontFamily: F.body, color: C.muted, textAlign: "center" }}>
          {denial}
        </Text>
      ) : canWork && to ? (
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
