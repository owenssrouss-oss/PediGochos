// Service worker to make Cocina DeliverCity KDS PWA Installable
const CACHE_NAME = 'pedigochos-v1';
const ASSETS = [
  '/kitchen.html',
  '/css/common.css',
  '/css/kitchen.css',
  '/js/sound.js',
  '/js/kitchen.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
