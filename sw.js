/* Service Worker - Master Crazy Radio PWA
   Estrategia: cache-first para la app shell (carga instantánea y offline),
   network-first para datos dinámicos (news.json, status.json). */
const CACHE_NAME = 'master-crazy-radio-v2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './logo_circular.jpg',
  './radio_background.png',
  './favicon.ico'
];

// Instalar: precachear la app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar cachés viejas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: servir de caché primero, actualizar en segundo plano
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // No cachear streams de audio/video ni iframes externos
  if (url.hostname !== location.hostname) return;
  if (/\.(m3u8|mp4|webm|mp3|aac|ts|m4a)$/i.test(url.pathname)) return;

  // Datos dinámicos: red primero (siempre frescos), caché como respaldo
  if (/news\.json|status\.json/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell y assets: red primero (los cambios llegan al instante),
  // caché como respaldo cuando no hay conexión.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => cached)
  );
});
