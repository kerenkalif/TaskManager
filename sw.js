/* Service Worker — network-first, bypassing HTTP cache for same-origin assets
   so updates roll out reliably. */
const CACHE = 'taskmanager-v7';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    const sameOrigin = url.origin === self.location.origin;
    // Same-origin: bypass HTTP cache so we always get fresh app code.
    // Cross-origin (fonts, etc.): use default browser cache.
    const fetchOpts = sameOrigin ? { cache: 'reload' } : undefined;
    e.respondWith(
        fetch(e.request, fetchOpts)
            .then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
