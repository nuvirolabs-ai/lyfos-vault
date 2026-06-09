// Cache name is rewritten per build by vite.config.js (serviceWorkerBuildIdPlugin).
// On each deploy the constant changes, the old cache is purged in 'activate',
// and clients.claim() takes over open tabs so they see the new bundle without
// requiring a hard refresh.
const CACHE_NAME = "lyfos-vault-202606091725-e7o3a8";
const APP_SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Network-first for HTML to make sure people pick up the new index.html
  // (which points at the new hashed asset filenames) ASAP. Cache-first would
  // strand returning visitors on the old version until they hard-refresh.
  const isHTML = event.request.mode === "navigate" || event.request.destination === "document";
  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Static assets: cache-first, then network.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
