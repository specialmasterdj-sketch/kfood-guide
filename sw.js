// Kimchi Mart tools — service worker
// Strategy: network-first for HTML/JS/CSS so the user always gets the latest
// deploy when online; cache-fallback lets the app open when offline. Static
// assets (icons, manifest) are cache-first since they never change in-place.
const CACHE = 'kmtools-v915';   // 🚀 chat 첫 페인트 12건 — 오늘 정보 최우선 (2026-08-30)
// 버전 고정(불변) 크로스오리진 의존성 전용 — 앱 버전 바뀌어도 지우지 않음.
// firebasejs 10.14.1 / pretendard@v1.3.9 처럼 URL 에 버전이 박힌 파일만 담는다.
const CDN_CACHE = 'kmtools-cdn-v1';

const CORE = [
  './',
  './km-design.css',
  './km-firebase.js',
  './km-storage.js',
  './km-chat-queue.js',
  './fb-auth-fetch.js',
  './admin-task-cleanup.html',
  './admin-chat-edit.html',
  './admin-top500-recover.html',
  './admin-join-pins.html',
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
  './daily-report.html',
  './store-map.html',
  './expiry.html',
  './temp.html',
  './receiving-scan.html',
  './voice-stock.html',
  './expense-log.html',
  './top500.html',
  './top500/CORAL_SPRINGS.json',
  './top500/HOLLYWOOD.json',
  './top500/LASOLAS.json',
  './top500/PEMBROKE_PINES.json',
  './top500/MIAMI.json',
  './auth.html',
  './approve.html',
  './leaderboard.html',
  './price-audit.html',
  './barcode-fix.html',
  './planogram.html',
  './nav-sidebar.js',
  './back-nav.js',
  './me-persist.js',
  './recv-persist.js',
  './lang-sync.js',
  './km-floor-plan.js',
  './floorplan/floorplan-data.json',
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        // Notify newer pages (v565+) so they can reload themselves.
        // Older pages without the listener stay put — they'll pick up
        // the new SW on their next manual reload. (navigate() removed
        // because it caused blank-image flashes when the cache was
        // cleared mid-flight.)
        for (const c of clients) {
          try { c.postMessage({ type: 'sw-updated' }); } catch (_) {}
        }
      })
  );
});

// 📬 Push notification handler — FCM 또는 Web Push 서비스에서 보낸 푸시 메시지 수신.
// 현재는 sender 측 (FCM 서버/Cloud Function) 미설정이라 실제로는 안 옴.
// 단, 추후 FCM 도입 시 이 핸들러가 그대로 동작하도록 준비.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(_) { try { data = { title: e.data.text() }; } catch(__){} }
  const title = data.title || '📨 새 업무 지시';
  const body  = data.body  || data.message || '확인해 주세요.';
  const tag   = data.tag   || 'kimchi-push';
  const url   = data.url   || './tasks.html';
  e.waitUntil(
    self.registration.showNotification(title, {
      body, tag, renotify: true,
      icon: './pwa-assets/icon-192.png',
      badge: './pwa-assets/icon-192.png',
      data: { url },
      vibrate: [200, 80, 200, 80, 400],
    })
  );
});

// 푸시 알림 클릭 → 해당 페이지로 이동 (이미 열려있으면 focus)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || './tasks.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes(targetUrl) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 📦 2026-08-29 — 버전 고정 크로스오리진 의존성(Firebase SDK ~473KB, 폰트)은
  // 기기에 영구 캐시. 한 번 받으면 다시는 네트워크 안 탐 → 구형폰·느린망 콜드
  // 로딩에서 인증/데이터 시작이 즉시 가능. (URL 에 버전 박힌 불변 파일만!)
  const isPinnedCdn = (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
                   || url.hostname === 'cdn.jsdelivr.net'
                   || url.hostname === 'fonts.googleapis.com'
                   || url.hostname === 'fonts.gstatic.com';
  if (e.request.method === 'GET' && isPinnedCdn) {
    e.respondWith(
      caches.open(CDN_CACHE).then(c => c.match(e.request).then(hit =>
        hit || fetch(e.request).then(res => {
          if (res && (res.ok || res.type === 'opaque')) c.put(e.request, res.clone());
          return res;
        })
      ))
    );
    return;
  }

  // Only handle same-origin GET requests
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Never intercept Firebase Realtime DB traffic — needs live streaming
  if (url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('firebasedatabase.app')) return;

  const isStatic = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i.test(url.pathname)
                || url.pathname.endsWith('.webmanifest');

  if (isStatic){
    // Cache-first for static assets. 네트워크 실패 시 invoice-to-excel.html 폴백을 주면
    // <img> 요소가 HTML 을 이미지로 디코드 못해 깨진 아이콘. 이미지 요청은 그냥 404 빈 응답을 돌려
    // 클라이언트의 onerror 핸들러가 깨끗하게 처리하도록.
    e.respondWith(
      caches.match(e.request).then(hit =>
        hit || fetch(e.request).then(res => {
          if (res && res.ok){
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        }).catch(() => new Response('', { status: 404, statusText: 'offline' }))
      )
    );
    return;
  }

  // Network-first for HTML/JS so deploys are picked up immediately.
  // ⏱ 2026-08-29 사장님 신고 "며칠 만에 열면 로딩이 엄청 걸림" — 타임아웃 없는
  // network-first 는 느린 매장 와이파이에서 캐시가 있어도 하염없이 기다렸음.
  // 변경: 3.5초 안에 네트워크 응답 없으면 캐시로 즉시 열고, 네트워크 응답은
  // 백그라운드로 마저 받아 캐시 갱신 → 다음 로드는 최신. (버전 따라잡기는
  // 페이지의 BUST 폴링 + sw-updated 리로드가 담당)
  e.respondWith((async () => {
    const cacheable = url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname.endsWith('.js');
    const network = fetch(e.request).then(res => {
      if (res && res.ok && cacheable){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    });
    // 사장님 원칙 "어떤 상황에서도 무조건 먼저 열려야": 캐시가 있으면 0.8초만
    // 네트워크에 기회를 주고(빠른 와이파이면 최신이 이김) 아니면 캐시로 즉시 오픈.
    // 캐시가 없으면(첫 방문) 네트워크를 3.5초까지 기다림.
    const hit = await caches.match(e.request);
    const waitMs = hit ? 800 : 3500;
    const first = await Promise.race([
      network.catch(() => 'NET_FAIL'),
      new Promise(r => setTimeout(() => r('NET_SLOW'), waitMs)),
    ]);
    if (first !== 'NET_FAIL' && first !== 'NET_SLOW') return first;
    if (hit) {
      // 네트워크는 백그라운드에서 계속 → 도착하면 캐시 갱신 (위 then 에서), 실패는 무시
      network.catch(() => {});
      return hit;
    }
    // 캐시도 없음 — 네트워크를 끝까지 기다리고, 완전 실패 시 기존 폴백 유지
    try { return await network; }
    catch(_) { return (await caches.match('./invoice-to-excel.html')) || new Response('', { status: 504, statusText: 'offline' }); }
  })());
});
