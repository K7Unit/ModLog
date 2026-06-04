/**
 * ModLog — sw.js
 * Service Worker für Offline-Nutzung (PWA).
 *
 * Strategie: Cache-first für den App-Shell (alle src-Dateien), mit
 * Runtime-Caching für weitere same-origin GET-Requests. Bei jeder
 * Änderung am Shell die CACHE-Version hochzählen, damit das activate-
 * Event alte Caches aufräumt.
 */

const CACHE = 'modlog-v2';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          // Same-origin GETs zur Laufzeit nachcachen (offline-fähig).
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
