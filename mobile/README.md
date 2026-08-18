# EGFUL mobile

A native app (Expo / React Native) against the same API as the web console.

## Run it on your phone — no account, no build, no fee

    cd mobile
    npx expo start

Install **Expo Go** (free, App Store or Google Play), then scan the QR:
iPhone — the Camera app. Android — Expo Go's own scanner. Same QR for both;
one dev server can serve an iPhone and an Android at once.

No Expo login is needed for this. Phone and Mac must be on the same wifi.

## What talks to what

`lib/api.ts` is the only place this app calls the server — `https://api.egful.store`,
the same endpoints, the same JWT, the same role gates as the web. One database, no sync
layer: an order started here is on the web the moment it saves.

The token lives in the device keychain (`expo-secure-store`), not AsyncStorage — it is a
bearer credential for a system that moves money.

## The rules are duplicated, on purpose, for now

`lib/orders.ts` ports `normalizeStage` and `isOverdue` from the web so the spike runs
standalone. That is a KNOWN debt: two copies of "what does Working mean" is how two
surfaces start telling different stories about one order. Before this stops being a spike
they move into a package both import. CLAUDE.md already records three files that grew
private copies of these helpers.

## Store builds

Expo Go is development only — the home screen shows Expo Go's icon, not ours. A real
build (`eas build`, or Xcode locally) produces an app with our icon and name, and needs
the Apple/Google accounts. Nothing in this folder waits on that.

`assets/icon.png` is 512x512, which is fine for development. **App Store submission
requires 1024x1024** — regenerate from `brand/` before the first store build.
