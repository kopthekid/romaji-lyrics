// Offline cache. App files: network first (so updates show up), cached copy when offline.
// Libraries and the Japanese dictionary: cache first (they never change for a given version).
const VERSION = 'v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'romanize.js', 'manifest.webmanifest',
  'vendor/libs.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open('shell-' + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // APIs go straight to the network
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open('vendor-' + VERSION).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) caches.open('shell-' + VERSION).then(c => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
