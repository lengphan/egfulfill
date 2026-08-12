/**
 * "THE CART CHANGED" — said out loud, so the badge can hear it.
 *
 * The top bar shows a count of saved to-order lines and refreshes on an `eg-cart-changed`
 * window event. It listened for that event from the day it was written; nothing ever fired
 * it. So the badge only moved on navigation, and adding a blank from a supplier — the exact
 * moment you want to see the number tick — changed nothing on screen.
 *
 * A window event rather than shared state because the two ends are far apart: the cart is
 * written from a dialog deep in the purchasing tabs, and read by a header that is mounted
 * on every page of the app. Threading a store between them would couple a layout component
 * to a feature it otherwise knows nothing about.
 */
export function cartChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event("eg-cart-changed"))
}
