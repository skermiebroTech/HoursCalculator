/*
 * Weekly Hours — service worker.
 * Precaches the app shell so the site loads with no connection, and serves
 * cache-first with a background refresh so updates arrive on the next visit.
 *
 * Bump CACHE_NAME whenever you change any of the files below so returning
 * visitors pick up the new version.
 */

var CACHE_NAME = 'weekly-hours-v6';
var ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      var refresh = fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        // Offline and not in the cache: fall back to the app shell for pages.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return cached;
      });
      return cached || refresh;
    })
  );
});
