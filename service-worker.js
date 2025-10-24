const ROOT = '/webkiosk-app/';
const CACHE = 'wk-shell-v3';
const PRECACHE = [
  ROOT + 'index.html',
  ROOT + 'style.css',
  ROOT + 'app.js',
  ROOT + 'manifest.webmanifest',
  ROOT + 'assets/icon-192.png',
  ROOT + 'assets/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Kun "shell" caches; A/B-HTML går direkte til netværk (for at undgå stale indlejrede sider)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isShell = PRECACHE.some(p => url.pathname === new URL(p, location.origin).pathname);
  if (!isShell) return;
  e.respondWith(
    fetch(e.request).then(res => {
      caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
