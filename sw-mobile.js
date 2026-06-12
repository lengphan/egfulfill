/* EG Floor service worker.
   App-shell caching only: HTML/manifest/icons are cached so the PWA launches
   offline and shows the last screen. API calls (/api/*) are NEVER cached —
   they go straight to the network so inventory/orders are always live; the
   page itself falls back to its in-memory data when the network is down. */
const SHELL = 'eg-floor-shell-v1';
const ASSETS = [
  'mobile.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept API or cross-origin or non-GET — always live.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.origin !== self.location.origin) return;

  // Network-first for the shell so updates land immediately; cache is the offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('mobile.html')))
  );
});
