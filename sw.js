// MIT ADT CampusPool - Service Worker Cache Purge & Clean Uninstaller
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((windows) => {
        windows.forEach((w) => w.navigate(w.url));
      })
  );
});

self.addEventListener('fetch', (event) => {
  // Pass-through: Always fetch directly from network
  event.respondWith(fetch(event.request));
});
