const CACHE_NAME = 'nex-estate-media-studio-v2-2-duration-karaoke-fix';
const APP_SHELL = [
  './',
  './index.html',
  './studio-upgrade.css',
  './studio-upgrade.js',
  './photo-engine.js',
  './vendor/webm-duration.js',
  './vendor/webm-duration-LICENSE.txt',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/marks/A_dark.svg',
  './assets/marks/A_light.svg',
  './assets/marks/B_dark.svg',
  './assets/marks/B_light.svg',
  './assets/marks/C_dark.svg',
  './assets/marks/C_light.svg',
  './assets/marks/D_dark.svg',
  './assets/marks/D_light.svg',
  './assets/marks/E_dark.png',
  './assets/marks/E_light.png',
  './assets/marks/F_dark.svg',
  './assets/marks/F_light.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({
      ok: false,
      offline: true,
      error: 'Локальный медиакодировщик недоступен без соединения с сервером приложения.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    })));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
