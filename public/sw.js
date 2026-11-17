// FlatFit service worker: the app keeps working in a store with no signal.
// - Pages: network first, the last copy when offline (a new deploy is picked up as soon as there is a network).
// - Hashed build files (assets/…): cache first, they never change under the same name.
// - Everything else from this site (models, denoiser weights, price history): the cached copy at once, refreshed
//   in the background.
// Requests to other sites (IKEA's price check, an AI service reading a plan) are never touched.
const CACHE = 'flatfit-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('flatfit-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match(new URL('./', self.registration.scope).href))),
    );
    return;
  }
  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        hit =>
          hit ||
          fetch(req).then(res => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(c =>
      c.match(req).then(hit => {
        const net = fetch(req)
          .then(res => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit || Response.error());
        if (hit) {
          e.waitUntil(net.catch(() => undefined));
          return hit;
        }
        return net;
      }),
    ),
  );
});
