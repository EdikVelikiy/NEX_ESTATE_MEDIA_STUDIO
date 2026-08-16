const CACHE_PREFIX = 'nex-estate-media-studio-';
const CACHE_NAME = `${CACHE_PREFIX}unified-v10-three-bug-fixes`;
const OCR_RUNTIME_CACHE = `${CACHE_PREFIX}ocr-runtime-v1`;
const OCR_RUNTIME_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'tessdata.projectnaptha.com'
]);
const APP_SHELL = [
  './',
  './index.html',
  './pwa-shell.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './apps/media/',
  './apps/media/index.html',
  './apps/media/studio-upgrade.css',
  './apps/media/studio-upgrade.js',
  './apps/media/photo-engine.js',
  './apps/media/photo-tools.js',
  './apps/media/vendor/webm-duration.js',
  './apps/media/vendor/webm-duration-LICENSE.txt',
  './apps/media/assets/marks/A_dark.svg',
  './apps/media/assets/marks/A_light.svg',
  './apps/media/assets/marks/B_dark.svg',
  './apps/media/assets/marks/B_light.svg',
  './apps/media/assets/marks/C_dark.svg',
  './apps/media/assets/marks/C_light.svg',
  './apps/media/assets/marks/D_dark.svg',
  './apps/media/assets/marks/D_light.svg',
  './apps/media/assets/marks/E_dark.png',
  './apps/media/assets/marks/E_light.png',
  './apps/media/assets/marks/F_dark.svg',
  './apps/media/assets/marks/F_light.svg',
  './apps/presentation/',
  './apps/presentation/index.html',
  './apps/presentation/vendor/pdfjs/pdf.min.js',
  './apps/presentation/vendor/pdfjs/pdf.worker.min.js',
  './apps/presentation/vendor/pdfjs/LICENSE.txt'
];

const APP_SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));

function navigationFallback(requestUrl) {
  const scopePath = new URL(self.registration.scope).pathname;
  const relativePath = requestUrl.pathname.startsWith(scopePath)
    ? requestUrl.pathname.slice(scopePath.length).replace(/^\/+/, '')
    : '';

  if (relativePath === 'apps/media' || relativePath.startsWith('apps/media/')) {
    return new URL('./apps/media/index.html', self.registration.scope).href;
  }
  if (relativePath === 'apps/presentation' || relativePath.startsWith('apps/presentation/')) {
    return new URL('./apps/presentation/index.html', self.registration.scope).href;
  }
  return new URL('./index.html', self.registration.scope).href;
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
    APP_SHELL.map(url => new Request(url, { cache: 'reload' }))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== OCR_RUNTIME_CACHE)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (OCR_RUNTIME_HOSTS.has(url.hostname)) {
    event.respondWith(
      caches.open(OCR_RUNTIME_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(request, response.clone());
        }
        return response;
      })
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(navigationFallback(url)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok && response.type === 'basic' && APP_SHELL_URLS.has(request.url)) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
