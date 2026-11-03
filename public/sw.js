// Service worker: de app zelf werkt ook zonder netwerk. Gegevens (GitHub, PDOK) gaan altijd over het netwerk.
const CACHE = 'skwirl-__VERSION__';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon.svg', 'js/app.js', 'js/deals.js', 'js/rhythm.js', 'js/unit.js', 'js/github.js', 'js/art.js', 'js/geo.js', 'js/parse.js', 'js/util.js', 'js/notify.js'];

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
  // no-cache: altijd even bij de server navragen, anders blijft GitHub Pages tot 10 minuten een oude versie geven
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

// Meldingen van de ander (verstuurd door de workflow in skwirl-data, zie scripts/stuur-melding.mjs)
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Skwirl', { body: m.body || '', icon: 'icons/icon-192.png', data: { url: m.url || './#lijstje' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs[0];
    return c ? c.navigate(url).then((w) => (w || c).focus()).catch(() => c.focus()) : self.clients.openWindow(url);
  }));
});
