// Drop-in fetch interceptor that auto-attaches the Firebase Auth ID token
// to every RTDB REST call. Pages can keep using plain fetch() — the global
// patch below appends ?auth=<token> when the URL targets firebaseio.com,
// so they pass the rules' `auth != null` check without touching each call.
//
// Usage: load BEFORE the page's main module so fetch is already patched
// when the page starts firing requests:
//   <script type="module" src="./fb-auth-fetch.js?v=1"></script>
//
// 🔒 SECURITY (2026-05-28): 익명 가입 fallback 모두 제거. 외부인이 자동으로
// 익명 토큰 받아 RTDB 접근 시도하던 경로 차단. 인증 안 된 사용자는 토큰 없이
// fetch 호출 → RTDB rules 가 거부 (이제 모든 노드 status='approved' 요구).
// 인증 흐름은 auth.html / auth-gate.js 가 담당.
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const cfg = {
  apiKey: "AIzaSyBwL0Wa1Q8aFhZp5hsn9gTw5aZwXUdAVy4",
  authDomain: "kimchi-mart-order.firebaseapp.com",
  databaseURL: "https://kimchi-mart-order-default-rtdb.firebaseio.com",
  projectId: "kimchi-mart-order"
};
const app = getApps().length ? getApp() : initializeApp(cfg);
const auth = getAuth(app);

// Wait for the very first auth-state callback before letting any RTDB
// fetch fire. Without this guard, page-load fetches race the IndexedDB
// token restore and silently 401 — the user sees an empty page even
// though they're signed in. The promise resolves on the first
// onAuthStateChanged tick (with or without a user) so unauthenticated
// pages aren't blocked indefinitely.
let __authReadyResolve;
const __authReady = new Promise(res => { __authReadyResolve = res; });
let __authResolved = false;

// 🚀 PERF (2026-05-28): 토큰 메모리 캐시 — 매 fetch 마다 SDK 호출 안 함.
// Firebase ID 토큰 유효시간 1시간 — 50분까지 캐시 사용 후 갱신.
// 페이지 새로 로드되면 캐시 사라지지만 SDK 의 currentUser 가 즉시 토큰 발급.
let __tokenCache = null;
let __tokenCacheExp = 0;
function __cacheToken(t){ __tokenCache = t; __tokenCacheExp = Date.now() + 50*60*1000; }

async function getIdToken() {
  // 1. 메모리 캐시 — 즉시 반환 (가장 빠른 path)
  if (__tokenCache && Date.now() < __tokenCacheExp) return __tokenCache;
  // 2. SDK currentUser 가 이미 있으면 즉시 토큰 발급 (대기 안 함)
  try {
    const u = auth.currentUser;
    if (u && !u.isAnonymous) {
      const t = await u.getIdToken();
      if (t) { __cacheToken(t); return t; }
    }
  } catch(_){}
  // 3. currentUser 없음 → onAuthStateChanged 짧게 대기 (1초)
  // 페이지 첫 진입 시 IndexedDB 토큰 복원 대기. 1초 안에 안 풀리면 토큰 없이 진행.
  try {
    if (!__authResolved) await Promise.race([
      __authReady,
      new Promise(res => setTimeout(res, 1000))
    ]);
    const u2 = auth.currentUser;
    if (u2 && !u2.isAnonymous) {
      const t = await u2.getIdToken();
      if (t) { __cacheToken(t); return t; }
    }
  } catch (e) {}
  return null;
}
window.__getAuthToken = getIdToken;

// Monkey-patch fetch so every page automatically picks up auth without
// changing its existing call sites. Only RTDB hostnames are touched.
const originalFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
  let url = (typeof input === 'string') ? input : (input && input.url) || '';
  if (url && url.includes('firebaseio.com')) {
    const tok = await getIdToken();
    if (tok && !url.includes('auth=')) {
      const sep = url.includes('?') ? '&' : '?';
      const newUrl = url + sep + 'auth=' + encodeURIComponent(tok);
      if (typeof input === 'string') {
        input = newUrl;
      } else if (input instanceof Request) {
        input = new Request(newUrl, input);
      }
    }
  }
  return originalFetch(input, init);
};

// Pages can listen for this to retry initial fetches once the token
// has been restored from IndexedDB (auth state isn't ready synchronously).
// Also flips the __authReady gate so any fetch that started early
// can stop waiting and use the now-known auth state.
onAuthStateChanged(auth, async (user) => {
  __authResolved = true;
  if (__authReadyResolve) { __authReadyResolve(); __authReadyResolve = null; }
  // 🚀 PERF: 토큰 즉시 prewarm — 다음 fetch 들이 캐시 사용 → 첫 fetch도 즉시 응답
  if (user && !user.isAnonymous) {
    try { const t = await user.getIdToken(); if (t) __cacheToken(t); } catch(_){}
  } else {
    __tokenCache = null; __tokenCacheExp = 0;
  }
  // 🔒 SECURITY (2026-05-28): 익명 sign-in 자동 호출 모두 제거.
  try { window.dispatchEvent(new Event('fb-auth-ready')); } catch (_) {}
});

// 🍎 iOS PWA revive — 백그라운드 갔다 돌아올 때 / 네트워크 끊겼다 복귀할 때
// Firebase Auth 토큰 만료 + RTDB WebSocket 끊김 + localStorage ITP 만료 등
// "가끔 작동 안 됨" 사건들의 가장 큰 원인. 다음 이벤트들에 자동 재활성화:
//   · visibilitychange (visible)   — 폰 잠금 풀거나 다른 앱에서 돌아왔을 때
//   · focus                          — 다른 탭에서 돌아왔을 때 (PC + iPadOS)
//   · online                         — 네트워크 다시 연결됐을 때
//   · iOS standalone PWA 4분마다 — 토큰 만료 (1시간) 직전 자동 갱신
// throttle: 90초 안에 같은 revive 중복 방지 (한 이벤트가 여러 번 발화해도 1회만)
let __lastRevive = 0;
let __reviveInflight = false;
async function _revive(why){
  const now = Date.now();
  if (__reviveInflight) return;
  if (now - __lastRevive < 90 * 1000) return;   // 90초 throttle
  __lastRevive = now;
  __reviveInflight = true;
  try {
    const u = auth.currentUser;
    if (u && !u.isAnonymous) {
      // 토큰 강제 갱신 — 만료 임박해도 OK + 캐시 갱신
      try { const t = await u.getIdToken(true); if (t) __cacheToken(t); }
      catch (e) { console.warn('[fb-auth] token refresh failed', e); }
    }
    // 🔒 SECURITY (2026-05-28): currentUser 없으면 익명 fallback 안 함.
    // 토큰 만료된 사용자는 auth-gate 가 다음 fetch 401 감지 후 auth.html 로 redirect.
    // SW 업데이트 체크 — 새 코드 있으면 다음 페이지 로드 때 적용
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        try { await reg.update(); } catch (_) {}
      }
    } catch (_) {}
    // 페이지에게 알림 — RTDB onValue 재구독, 데이터 새로고침 등 필요한 작업
    try { window.dispatchEvent(new CustomEvent('fb-auth-revived', { detail: { why, ts: now } })); } catch (_) {}
    console.info('[fb-auth-fetch] revived (' + why + ')');
  } finally {
    __reviveInflight = false;
  }
}

// 이벤트 핸들러
const _isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '');
const _isStandalone = (typeof navigator !== 'undefined' && navigator.standalone === true)
                   || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _revive('visibility');
});
window.addEventListener('focus', () => _revive('focus'));
window.addEventListener('online', () => _revive('online'));
// iOS PWA — 더 적극적으로 4분마다 토큰 갱신 (Firebase 토큰 1시간 만료, 미리 갱신)
if (_isIOS || _isStandalone) {
  setInterval(() => {
    if (document.visibilityState === 'visible') _revive('ios-periodic');
  }, 4 * 60 * 1000);
}

// When the service worker activates a new version it posts {type:'sw-updated'}
// to every open client. Reload the page once so the user sees the new HTML/JS
// immediately instead of having to close + reopen the PWA. Guarded with a
// session flag so two SW activations in a row don't loop.
if ('serviceWorker' in navigator) {
  // 🛑 2026-07-18 — 사용 중 강제 리로드 금지: 입력 중이거나 최근 2분 내 조작이
  // 있으면 리로드를 연기하고 한가해지면 적용. (사장님 신고 — 작업 중 페이지 사라짐)
  let __swReloadPending = false;
  function __swUserBusy(){
    try {
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'file'))) return true;
      const tas = document.querySelectorAll('textarea');
      for (let i = 0; i < tas.length; i++) if (tas[i].value) return true;
      if (window.__kmLastActivity && Date.now() - window.__kmLastActivity < 120000) return true;
    } catch (_) {}
    return false;
  }
  function __swApplyReload(){
    if (!__swReloadPending) return;
    if (__swUserBusy()) { setTimeout(__swApplyReload, 60000); return; }
    try { if (typeof window.__kmSaveResumeState === 'function') window.__kmSaveResumeState(); } catch (_) {}
    location.reload();
  }
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'sw-updated') {
      try {
        if (sessionStorage.getItem('__swReloaded') === '1') return;
        sessionStorage.setItem('__swReloaded', '1');
      } catch (_) {}
      __swReloadPending = true;
      __swApplyReload();
    }
  });
  // 페이지 로드마다 + 5분마다 SW 강제 업데이트 체크 — PWA 가 옛 코드에 갇히는 문제 방지.
  // navigator.serviceWorker.ready 가 resolve 되면 .update() 호출 → 새 sw.js 가 있으면
  // install 이벤트 발생 → skipWaiting → activate → sw-updated 메시지 → location.reload.
  navigator.serviceWorker.ready.then(reg => {
    try { reg.update(); } catch(_){}
    setInterval(() => { try { reg.update(); } catch(_){} }, 5 * 60 * 1000);
  }).catch(() => {});
}
