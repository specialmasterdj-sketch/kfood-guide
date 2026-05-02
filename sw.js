// Kimchi Mart tools — service worker
// Strategy: network-first for HTML/JS/CSS so the user always gets the latest
// deploy when online; cache-fallback lets the app open when offline. Static
// assets (icons, manifest) are cache-first since they never change in-place.
const CACHE = 'kmtools-v256';

const CORE = [
  './',
  './invoice-to-excel.html',
  './kimchi-price-compare.html',
  './lookup.html',
  './pos-cost-filter.html',
  './apps.html',
  './hub.html',
  './shifts.html',
  './payroll.html',
  './chat.html',
  './updates.html',
  './tasks.html',
  './expiry.html',
  './temp.html',
  './receiving-scan.html',
  './expense-log.html',
  './auth.html',
  './approve.html',
  './nav-sidebar.js',
  './back-nav.js',
  './me-persist.js',
  './recv-persist.js',
  './lang-sync.js',
  './pwa-assets/manifest.webmanifest',
  './pwa-assets/icon-192.png',
  './pwa-assets/icon-512.png',
  './pwa-assets/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE).catch(() => {})) // don't fail install on one missing
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin GET requests
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Never intercept Firebase Realtime DB traffic — needs live streaming
  if (url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('firebasedatabase.app')) return;

  const isStatic = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i.test(url.pathname)
                || url.pathname.endsWith('.webmanifest');

  if (isStatic){
    // Cache-first for static assets
    e.respondWith(
      caches.match(e.request).then(hit =>
        hit || fetch(e.request).then(res => {
          if (res && res.ok){
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        }).catch(() => caches.match('./invoice-to-excel.html'))
      )
    );
    return;
  }

  // Network-first for HTML/JS so deploys are picked up immediately
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok && (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname.endsWith('.js'))){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./invoice-to-excel.html')))
  );
});
