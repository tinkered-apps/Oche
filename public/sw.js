// Service worker: lets the app be installed from Chrome and played offline.
//
// Strategy:
//  - the page (navigation): network first, but with a time limit; with a weak
//    signal in the garage we do not wait forever, we take the cached copy;
//  - other files: network first, the cache when there is no network.
// So a new deployment shows up the next time the app is opened,
// and without a signal the app still starts.
//
// CACHE carries the app version (APP_VERSION in js/app.js); bump both together.

const CACHE = 'oche-v1.01';

const SHELL = [
  './',
  './privacy',
  './js/privacy.js',
  './js/boot.js',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/geometry.js',
  './js/i18n.js',
  './js/autocalib.js',
  './js/detect.js',
  './js/watcher.js',
  './js/game.js',
  './js/camera.js',
  './js/overlay.js',
  './js/board.js',
  './js/storage.js',
  './js/oche.bundle.js',
  './fonts/oswald-500-latin.woff2',
  './fonts/oswald-500-latin-ext.woff2',
  './fonts/oswald-600-latin.woff2',
  './fonts/oswald-600-latin-ext.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

/** How long to wait for the network when opening the page before using the cached copy. */
const NAVIGATION_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  // Each file separately: one missing file must not leave the app without offline mode.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function remember(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * The host redirects index.html to ./ and privacy.html to privacy, and a
 * redirected response cannot answer a navigation. So SHELL lists pages by
 * their clean URLs, and an offline visit to the .html form is looked up there.
 */
function cleanUrl(url) {
  const { origin, pathname } = new URL(url);
  return origin + pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const network = fetch(request).then((response) => remember(request, response));
    // A network response that arrives after the limit still refreshes the copy for next time.
    event.waitUntil(network.catch(() => {}));
    event.respondWith(
      withTimeout(network, NAVIGATION_TIMEOUT_MS)
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then((cached) => cached || caches.match(cleanUrl(request.url)))
          .then((cached) => cached || caches.match('./'))
          .then((cached) => cached || network))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => remember(request, response))
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((cached) => cached || Response.error()))
  );
});
