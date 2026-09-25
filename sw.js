/**
 * Salvis Service Worker — Cache-first offline shell.
 * Caches core app assets on install, then serves them offline.
 */

const CACHE_NAME = 'salvis-v3';
const CORE_ASSETS = [
  './',
  './Salvis.html',
  './manifest.json',
  './css/variables.css',
  './css/layout.css',
  './css/components.css',
  './css/animations.css',
  './js/utils.js',
  './js/storage.js',
  './js/calculator.js',
  './js/chart.js',
  './js/auth.js',
  './js/notifications.js',
  './js/ui.js',
  './js/app.js',
  './js/router.js',
  './js/modals.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Never cache cross-origin / Google SDK requests.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'document')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('./Salvis.html'))
  );
});