# EGFUL mobile

A native app (Expo / React Native) against the same API as the web console.

## Run it on your phone — no account, no build, no fee

    cd mobile
    npx expo start

Install **Expo Go** (free, App Store or Google Play), then scan the QR:
iPhone — the Camera app. Android — Expo Go's own scanner. Same QR for both;
one dev server can serve an iPhone and an Android at once.

No Expo login is needed for this. Phone and Mac must be on the same wifi.

## When you are NOT on the same wifi — tunnel

    cd mobile
    npm run tunnel          # expo start --tunnel

`--tunnel` publishes Metro through ngrok (`@expo/ngrok`, already a devDependency) at a
public `https://<hash>-<user>-8081.exp.direct`, so the phone reaches the bundle over ANY
connection — hotel wifi, a phone hotspot, cellular data. Nothing else has to change:
`lib/api.ts` already talks to `https://api.egful.store`, which is public either way, so
only the JS bundle ever needed the LAN.

Use it when the QR scan hangs on "Downloading JavaScript bundle" or times out — that is
almost always the two devices being on networks that cannot see each other (guest wifi
with client isolation, a VPN on the Mac, or simply different networks). Tunnel is slower
than LAN; keep `npm start` for the same-wifi case.

`npm run tunnel:clear` adds `--clear` to wipe the Metro cache when a stale bundle is the
suspect.

**Opening it without rescanning a QR.** The tunnel hostname is derived from the project
and the Expo account, not randomised per session — restarting the server twice here gave
the same host both times, so the link below can be saved and reused:

    exp://1bfixyk-lengphan-8081.exp.direct

Paste it into Expo Go → *Enter URL manually*. It only resolves while the tunnel is
actually running. Expect it to change if the repo moves to a different path, the port
isn't 8081, or a different Expo account signs in — so treat it as durable, not permanent,
and re-read it from `curl -s http://127.0.0.1:4040/api/tunnels` if it ever 404s.

Better still: this Mac is signed in to Expo as `lengphan` (`npx expo whoami`). Sign in to
the **same account inside Expo Go** and every dev server this machine is running lists
itself on Expo Go's home screen — tap it, no scan, no URL at all. Works over the tunnel.

Expo Go can only run a dev server that is live, so the Mac has to be awake with the
command running. There is no publish-once-and-open-forever path for Expo Go: classic
`expo publish` is gone, and EAS Update needs a real build, which is the `eas build` route
below.

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
