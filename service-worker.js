/* webkiosk: SW-killer – gør intet, afregistrerer sig selv, rydder caches */
self.addEventListener('install', (e) => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try { await self.registration.unregister(); } catch {}
    try {
      const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      all.forEach((c) => c.navigate(c.url));
    } catch {}
  })());
});

// Ingen caching/blokering
self.addEventListener('fetch', () => {});
