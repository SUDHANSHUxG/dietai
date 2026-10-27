/* Diet AI service worker — offline-first for the app shell */
var CACHE = 'dietai-v5';
var ASSETS = ['/', '/index.html', '/events.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // best-effort: don't fail install if an icon is missing
      return Promise.all(ASSETS.map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never intercept payments or external calls
  if (url.origin !== location.origin) return;
  // network-first for the page itself (so updates land), cache fallback for offline
  // network-first for pages (so updates land), cache fallback for offline.
  // Each page is cached under its OWN URL. This used to store every navigation
  // as '/index.html', which was harmless with one page and wrong the moment a
  // second page existed: visiting a guide would overwrite the cached app shell,
  // and a 404 would be cached as the app. Only successful responses are stored.
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then(function (r) {
        if (r && r.ok) {
          var copy = r.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return r;
      }).catch(function () {
        return caches.match(e.request, { ignoreSearch: true }).then(function (m) {
          return m || caches.match('/index.html').then(function (x) { return x || caches.match('/'); });
        });
      })
    );
    return;
  }
  // network-first for JS so fixes actually reach users (cache fallback for offline)
  if (url.pathname.endsWith('.js')) {
    e.respondWith(
      fetch(e.request).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return r;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }
  // cache-first for everything else on-origin
  e.respondWith(
    caches.match(e.request).then(function (m) {
      return m || fetch(e.request).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return r;
      });
    })
  );
});
