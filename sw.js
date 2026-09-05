/* PokeScan service worker: app shell cache-first, data stale-while-revalidate, everything else network. */
const VERSION = 'pokescan-v9.7';
const SHELL = ['./', 'index.html', 'pvp.js', 'planner.js', 'sync.js', 'sources.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const DATA = ['data/app-great.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.concat(DATA))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VERSION + '-vendor').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  const path = url.pathname.replace(/^.*\//, '') || './';
  if (url.pathname.includes('/vendor/')) {
    // big, immutable recogniser files: cache-first, fetched once
    e.respondWith(caches.open(VERSION + '-vendor').then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.pathname.includes('/data/')) {
    // stale-while-revalidate: serve cached data at once, refresh in the background
    e.respondWith(caches.open(VERSION).then(async c => {
      const cached = await c.match(e.request, {ignoreSearch: true});
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }
  // app shell: network first so deploys show up, cache as fallback for offline
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone()));
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
