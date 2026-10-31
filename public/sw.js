// Service worker: de app zelf werkt ook zonder netwerk. Gegevens (GitHub, PDOK) gaan altijd over het netwerk.
const CACHE = 'skwirl-__VERSION__';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon.svg', 'js/app.js', 'js/github.js', 'js/art.js', 'js/geo.js', 'js/parse.js', 'js/util.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub, PDOK en fonts niet cachen
  // eerst netwerk, zodat een nieuwe versie direct zichtbaar is; zonder netwerk uit de cache
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
