// Service worker: офлайн-доступ + свежая колода.
// Поднимай VERSION, когда меняешь файлы приложения, чтобы кэш обновился.
const VERSION = 'v7';
const SHELL = `shell-${VERSION}`;
const DATA = 'data';

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/srs.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Манифест и файлы колод — network-first: всегда тянем свежее, офлайн берём из кэша.
  if (url.pathname.endsWith('decks.json') || url.pathname.includes('/decks/')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Всё остальное (оболочка приложения) — cache-first.
  e.respondWith(cacheFirst(e.request));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: 'no-store' });
    // Кэшируем только успешные ответы — иначе офлайн-фолбэк отдавал бы закэшированную ошибку.
    if (res.ok) {
      const cache = await caches.open(DATA);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw new Error('offline and no cached cards');
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    return await fetch(req);
  } catch {
    // Для навигаций без сети отдаём оболочку.
    if (req.mode === 'navigate') return caches.match('./index.html');
    throw new Error('offline');
  }
}
