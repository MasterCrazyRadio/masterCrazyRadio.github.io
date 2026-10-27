/* Service Worker - Master Crazy Radio PWA
   Estrategia: red primero para TODO lo propio del sitio (asi los cambios llegan
   al instante) con la cache como respaldo cuando no hay conexion. */
const CACHE_NAME = 'master-crazy-radio-v109';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './logo_circular.png',
  './radio-player.html',
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

// Activar: limpiar cachÃ©s viejas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: servir de cachÃ© primero, actualizar en segundo plano
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // No cachear streams de audio/video ni iframes externos
  if (url.hostname !== location.hostname) return;
  if (/\.(m3u8|mp4|webm|mp3|aac|ts|m4a)$/i.test(url.pathname)) return;

  // Datos dinÃ¡micos: red primero (siempre frescos), cachÃ© como respaldo
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

  // App shell y assets: red primero, SIN cache HTTP para los archivos de
  // codigo (asi los cambios llegan SIEMPRE), cache como respaldo sin conexion.
  const esCodigo = /\.(html|js|css|json)$/i.test(url.pathname) || url.pathname === '/' || url.pathname.slice(-1) === '/';
  event.respondWith(
    fetch(request, esCodigo ? { cache: 'no-store' } : undefined)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
