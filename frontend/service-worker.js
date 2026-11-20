const CACHE_NAME = 'jyf-wms-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/style.css',
  '/app.js',
  '/theme.js'
];

// Install Service Worker
self.addEventListener('install', event => {
  self.skipWaiting(); // pakai versi baru segera agar tampilan terbaru langsung aktif
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch dari Cache jika offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Kembalikan dari cache
        }
        return fetch(event.request); // Jika tidak ada di cache, ambil dari internet
      })
  );
});

// Update Service Worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});