const CACHE_NAME = 'score-viewer-v1';
const urlsToCache = [
  '/',
  '/static/css/style.css',
  '/static/js/main.js',
  '/static/js/editing.js',
  '/static/js/interact.min.js',
  '/static/js/opensheetmusicdisplay.min.js',
  '/static/fonts/BravuraText.otf',
  '/static/images/logo.png',
  '/static/images/background.png',
  '/static/manifest.json',
  // CDNs importantes
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/theme/material-darker.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/mode/python/python.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/addon/display/placeholder.min.js',
  'https://cdn.jsdelivr.net/npm/soundfont-player@0.12.0/dist/soundfont-player.min.js',
  'https://unpkg.com/@tonejs/midi'
];

// Instalación - cachear archivos
self.addEventListener('install', event => {
  console.log('[SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando archivos');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('[SW] Error cacheando:', err);
      })
  );
  self.skipWaiting();
});

// Activación - limpiar cachés viejos
self.addEventListener('activate', event => {
  console.log('[SW] Activando Service Worker...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Eliminando caché viejo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch - estrategia de caché
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Para API requests (POST), siempre usar red
  if (request.method === 'POST') {
    event.respondWith(fetch(request));
    return;
  }

  // Para assets estáticos, usar Cache First
  if (
    url.pathname.startsWith('/static/') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('unpkg.com')
  ) {
    event.respondWith(
      caches.match(request)
        .then(response => {
          if (response) {
            return response;
          }
          return fetch(request).then(response => {
            // Cachear nuevos archivos estáticos
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, responseClone);
              });
            }
            return response;
          });
        })
        .catch(() => {
          console.log('[SW] Offline, no se pudo obtener:', request.url);
        })
    );
    return;
  }

  // Para HTML y API, usar Network First
  event.respondWith(
    fetch(request)
      .then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseClone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

console.log('[SW] Service Worker cargado');
