import { useEffect, useState } from "react"
import { Text, Image, Pressable, Modal, ScrollView, useWindowDimensions, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, interpolate, Extrapolation,
} from "react-native-reanimated"
import { Ionicons } from "@expo/vector-icons"
import { F } from "@/lib/theme"

/**
 * THE PICTURE, FULL SIZE — open it, push it around, throw it away.
 *
 * This began as `Modal animationType="fade"`: a black rectangle cross-fading over the list
 * with the photograph already at full size inside it. Nothing moved, so nothing connected
 * the thumbnail you touched to the picture you got, and a fade across a full-screen dark
 * layer is the one transition a phone cannot do cheaply.
 *
 * It now does what a photo viewer is expected to do, and every part of it runs on the UI
 * thread through Reanimated — the whole point, because a gesture that has to round-trip
 * through JS to move a pixel is exactly what "not smooth" means:
 *
 *   · opens by growing under a spring while the ground fades in;
 *   · PINCH to zoom, up to 6×, anchored where your fingers are rather than the middle of
 *     the screen — zooming to the centre when you are looking at a corner is the thing that
 *     makes people give up and open the file on a laptop;
 *   · DOUBLE-TAP between fit and 2.5×, at the point you tapped;
 *   · pan around once zoomed, bounded so the picture cannot be flung off into grey;
 *   · DRAG DOWN to dismiss when not zoomed — the photo follows your finger, the ground
 *     thins with the pull, and it springs home if you do not commit.
 *
 * SPLIT OUT of order-row.tsx, where it was a 50-line modal that grew into this. Two screens
 * import it and neither has anything to do with an order row.
 */

const MAX_SCALE = 6
const DOUBLE_TAP_SCALE = 2.5
/** Past this, or a fast enough flick, letting go dismisses instead of springing back. */
const DISMISS_PX = 110
const DISMISS_VELOCITY = 0.75

export function ImagePeek({ shots, index, onClose }: {
  shots: { uri: string; title: string }[]
  /** null = closed. Otherwise the picture that was tapped, so the viewer opens on it. */
  index: number | null
  onClose: () => void
}) {
  const { width, height } = useWindowDimensions()
  const open = index != null

  /* The pager is disabled while a picture is zoomed, or a sideways pan would page away
     instead of moving the photo you are looking at. State rather than a shared value
     because ScrollView's prop is a JS prop. */
  const [zoomed, setZoomed] = useState(false)

  const enter = useSharedValue(0)
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)
  const dragY = useSharedValue(0)

  const reset = () => {
    scale.value = 1; savedScale.value = 1
    tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0
    dragY.value = 0
    setZoomed(false)
  }

  useEffect(() => {
    if (!open) return
    reset()
    enter.value = 0
    enter.value = withSpring(1, { damping: 22, stiffness: 260, mass: 0.9 })
    // reset is stable enough for this use and re-running on every render would fight the
    // gesture — the dependency is deliberately just "did this open".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const finish = () => { reset(); onClose() }

  /* ── Gestures ───────────────────────────────────────────────────────────────
     Pinch and pan run SIMULTANEOUSLY so a two-finger move can zoom and reposition in one
     motion, which is how it feels on a photo you are actually inspecting. The taps are
     EXCLUSIVE so a double-tap is never also read as a single one that closes the viewer. */

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale
      scale.value = Math.min(Math.max(next, 0.8), MAX_SCALE)
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        // Snap back to fit rather than leaving it slightly under — a picture resting at
        // 0.94 looks like a rendering fault, not a choice.
        scale.value = withSpring(1, { damping: 20, stiffness: 240 })
        savedScale.value = 1
        tx.value = withSpring(0); ty.value = withSpring(0)
        savedTx.value = 0; savedTy.value = 0
        runOnJS(setZoomed)(false)
      } else {
        savedScale.value = scale.value
        runOnJS(setZoomed)(true)
      }
    })

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        // Bounded by how much picture actually hangs off the screen at this zoom, so it
        // cannot be dragged away into empty grey.
        const limitX = ((scale.value - 1) * width) / 2
        const limitY = ((scale.value - 1) * height) / 2
        tx.value = Math.min(Math.max(savedTx.value + e.translationX, -limitX), limitX)
        ty.value = Math.min(Math.max(savedTy.value + e.translationY, -limitY), limitY)
      } else {
        dragY.value = e.translationY
      }
    })
    .onEnd((e) => {
      if (scale.value > 1) { savedTx.value = tx.value; savedTy.value = ty.value; return }
      if (Math.abs(e.translationY) > DISMISS_PX || Math.abs(e.velocityY) > DISMISS_VELOCITY) {
        dragY.value = withTiming(Math.sign(e.translationY || 1) * height, { duration: 180 }, () => {
          runOnJS(finish)()
        })
      } else {
        dragY.value = withSpring(0, { damping: 20, stiffness: 300 })
      }
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        scale.value = withSpring(1, { damping: 20, stiffness: 240 })
        savedScale.value = 1
        tx.value = withSpring(0); ty.value = withSpring(0)
        savedTx.value = 0; savedTy.value = 0
        runOnJS(setZoomed)(false)
      } else {
        // Zoom toward the point tapped, not the middle: the offset that brings that point
        // to the centre is how far it sits from the centre, times how much bigger it got.
        const dx = (width / 2 - e.x) * (DOUBLE_TAP_SCALE - 1)
        const dy = (height / 2 - e.y) * (DOUBLE_TAP_SCALE - 1)
        const limitX = ((DOUBLE_TAP_SCALE - 1) * width) / 2
        const limitY = ((DOUBLE_TAP_SCALE - 1) * height) / 2
        const cx = Math.min(Math.max(dx, -limitX), limitX)
        const cy = Math.min(Math.max(dy, -limitY), limitY)
        scale.value = withSpring(DOUBLE_TAP_SCALE, { damping: 20, stiffness: 240 })
        savedScale.value = DOUBLE_TAP_SCALE
        tx.value = withSpring(cx); ty.value = withSpring(cy)
        savedTx.value = cx; savedTy.value = cy
        runOnJS(setZoomed)(true)
      }
    })

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => { if (scale.value <= 1) runOnJS(finish)() })

  const gesture = Gesture.Simultaneous(
    Gesture.Exclusive(doubleTap, singleTap),
    Gesture.Simultaneous(pinch, pan),
  )

  const groundStyle = useAnimatedStyle(() => ({
    opacity: enter.value * interpolate(Math.abs(dragY.value), [0, 160, height], [1, 0.72, 0.2], Extrapolation.CLAMP),
  }))

  const contentStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: dragY.value },
      // Shrinking with the pull is what says "letting go puts this back".
      { scale: interpolate(Math.abs(dragY.value), [0, height], [1, 0.86], Extrapolation.CLAMP) * interpolate(enter.value, [0, 1], [0.92, 1]) },
    ],
  }))

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  return (
    /* `none` — the entrance is ours. Modal's own fade on top of it was the double animation
       that made opening feel like two separate events. */
    <Modal visible={open} transparent animationType="none" onRequestClose={finish}>
      <Animated.View style={[{ flex: 1, backgroundColor: "rgba(11,11,12,0.96)" }, groundStyle]} />
      <Animated.View
        style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, contentStyle]}
      >
        <Pressable onPress={finish} style={{ position: "absolute", top: 54, right: 20, zIndex: 2, padding: 6 }} hitSlop={12}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>

        {/* THE WHOLE ORDER, not just the one you tapped — the swipe you used on the strip
            still works in here, which is the difference between a viewer and a dead end.
            Frozen while zoomed, or a sideways drag pages away from the thing you are
            inspecting instead of moving it. */}
        <ScrollView
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          removeClippedSubviews
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (index ?? 0) * width, y: 0 }}
          style={{ flex: 1 }}
        >
          {shots.map((sh, i) => (
            <View key={i} style={{ width, alignItems: "center", justifyContent: "center", padding: 20 }}>
              <GestureDetector gesture={gesture}>
                {/* contain, not cover: a print file cropped to fill is one you cannot check
                    the edges of — the same rule ItemPhotos follows. */}
                <Animated.Image
                  source={{ uri: sh.uri }}
                  style={[{ width: width - 40, aspectRatio: 1 }, imageStyle]}
                  resizeMode="contain"
                />
              </GestureDetector>
              {shots.length > 1 && !zoomed && (
                <Text style={{ marginTop: 6, fontSize: 12, fontFamily: F.body, color: "#fff", opacity: 0.55 }}>
                  {i + 1} of {shots.length}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}
