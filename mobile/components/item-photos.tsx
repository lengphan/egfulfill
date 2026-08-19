import { View, Text, Image, Pressable, Modal, ScrollView } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { assetUrl } from "@/lib/api"
import { F,C, R } from "@/lib/theme"

/**
 * THE LINE'S PICTURES, BIG — and labelled, because they are two different things.
 *
 * The row thumbnail is 76pt, which is enough to recognise a design and not enough to check
 * one, and it could not be pressed at all. Someone holding the garment wants to see the
 * artwork at the size of the screen.
 *
 * TWO PICTURES, NEVER CONFLATED. The artwork is what we print; the listing photo is what
 * the buyer saw on the marketplace. They used to be one slot with the listing photo as a
 * silent fallback, so a line with nothing to print showed a product shot as though it were
 * the file (see lineArt). Here they are separate, each named, and a missing one says it is
 * missing rather than borrowing the other.
 */
export function ItemPhotos({ open, onClose, title, art, listing }: {
  open: boolean
  onClose: () => void
  title: string
  /** What we print. Null is a real state — a plain blank has nothing. */
  art: string | null
  /** What the buyer saw. Null on a factory order, which has no listing. */
  listing: string | null
}) {
  const shots = [
    { key: "art", label: "Artwork — what we print", url: art,
      empty: "No artwork on this line yet." },
    { key: "listing", label: "Listing photo — what the buyer saw", url: listing,
      empty: "No listing photo on this line." },
  ]

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 12,
          paddingHorizontal: 20, paddingVertical: 14,
          borderBottomWidth: 1, borderBottomColor: C.border,
        }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontFamily: F.bold, color: C.fg, letterSpacing: -0.3 }}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityLabel="Close"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="close" size={26} color={C.fg} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>
          {shots.map((s) => (
            <View key={s.key} style={{ gap: 8 }}>
              <Text style={{ fontSize: 11, fontFamily: F.bold, color: C.muted, letterSpacing: 1 }}>
                {s.label.toUpperCase()}
              </Text>
              {s.url ? (
                /* contain, not cover: a print file cropped to fill is a print file you
                   cannot check the edges of. */
                <Image
                  source={{ uri: assetUrl(s.url) || undefined }}
                  style={{ width: "100%", aspectRatio: 1, borderRadius: R.lg, backgroundColor: C.card }}
                  resizeMode="contain"
                />
              ) : (
                <View style={{
                  width: "100%", aspectRatio: 1, borderRadius: R.lg, backgroundColor: C.card,
                  borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", gap: 10,
                }}>
                  <Ionicons name="image-outline" size={30} color={C.muted} />
                  <Text style={{ fontSize: 14, color: C.muted }}>{s.empty}</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}
