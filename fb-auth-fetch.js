// Drop-in fetch interceptor that auto-attaches the Firebase Auth ID token
// to every RTDB REST call. Pages can keep using plain fetch() — the global
// patch below appends ?auth=<token> when the URL targets firebaseio.com,
// so they pass the rules' `auth != null` check without touching each call.
//
// Usage: load BEFORE the page's main module so fetch is already patched
// when the page starts firing requests:
//   <script type="module" src="./fb-auth-fetch.js?v=1"></script>
//
// Pages that already explicitly append ?auth=<token> stay compatible —
// the patch's "auth=" check skips re-appending.
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

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

// 🛡️ 익명 토큰 fallback — Firebase Auth 사용자가 없을 때도 RTDB 쓰기 가능하게.
// 2026-05-15: top500 재고/사진 저장이 401 silent fail 로 사라진 사건 후 추가.
// auth.currentUser 가 null 이면 익명 가입 → 그 토큰으로 RTDB 호출.
// 토큰 1시간 캐싱.
let __anonTokenCache = null;
async function __getAnonToken() {
  if (__anonTokenCache && __anonTokenCache.expires > Date.now() + 60000) return __anonTokenCache.token;
  try {
    const r = await originalFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ returnSecureToken: true })
    });
    if (!r.ok) return null;
    const d = await r.json();
    __anonTokenCache = { token: d.idToken, expires: Date.now() + (parseInt(d.expiresIn,10)||3600)*1000 };
    return d.idToken;
  } catch(_) { return null; }
}

async function getIdToken() {
  try {
    if (!__authResolved) await Promise.race([
      __authReady,
      new Promise(res => setTimeout(res, 3000))   // 3s safety net
    ]);
    const u = auth.currentUser;
    if (u) return await u.getIdToken();
  } catch (e) {}
  // 사용자 인증 없으면 익명 토큰 fallback — 그래야 RTDB 쓰기 silent fail 안 함.
  return await __getAnonToken();
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
//
// 🛡️ 2026-05-15: tasks.html / top500.html 의 Firebase SDK 호출 (onValue 등)
// 이 빈 결과 받는 사건 — REST fetch 는 monkey-patch 로 토큰 첨부했지만
// SDK 의 WebSocket 채널은 별도. SDK 는 auth.currentUser 의 토큰을 자동 사용.
// 사용자 currentUser 가 null 이면 SDK 도 토큰 없이 통신 → 401 silent fail.
// 해결: currentUser 없을 때 signInAnonymously() 트리거 → SDK 가 익명 토큰 사용.
onAuthStateChanged(auth, (user) => {
  __authResolved = true;
  if (__authReadyResolve) { __authReadyResolve(); __authReadyResolve = null; }
  if (!user) {
    const p = (location.pathname || '').toLowerCase();
    const isAuthPage = p.endsWith('/auth.html');
    // auth-gate 면제 페이지 — lookup.html 처럼 매니저 인증 없이 매장 직원/손님 모두
    // 쓸 수 있는 공개 페이지. 여기서는 Firebase SDK 가 토큰 받아야 RTDB onValue 동작.
    const isExempt = p.endsWith('/lookup.html');
    if (isAuthPage) {
      // 명시적 로그인 페이지 — 손대지 않음
    } else if (isExempt) {
      // 공개 페이지: SDK 토큰 필요. chat.me 상태 무관하게 익명 sign-in.
      signInAnonymously(auth).catch(e => console.warn('[fb-auth-fetch] anon sign-in failed', e));
    } else {
      // auth-gate 가 도는 페이지 — chat.me uid 있으면 auth-gate 가 redirect 처리.
      // chat.me 없으면 진짜 익명 방문자 → 익명 sign-in.
      let hasPriorAuth = false;
      try {
        const me = JSON.parse(localStorage.getItem('chat.me') || 'null');
        hasPriorAuth = !!(me && (me.uid || me.email));
      } catch(_) {}
      if (!hasPriorAuth) {
        signInAnonymously(auth).catch(e => console.warn('[fb-auth-fetch] anon sign-in failed', e));
      }
    }
  }
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
    if (u) {
      // 토큰 강제 갱신 — 만료 임박해도 OK
      try { await u.getIdToken(true); } catch (e) { console.warn('[fb-auth] token refresh failed', e); }
    } else {
      // currentUser 잃었으면 익명 가입 fallback (auth.html 제외)
      const p = (location.pathname || '').toLowerCase();
      if (!p.endsWith('/auth.html')) {
        let hasPriorAuth = false;
        try {
          const me = JSON.parse(localStorage.getItem('chat.me') || 'null');
          hasPriorAuth = !!(me && (me.uid || me.email));
        } catch (_) {}
        if (!hasPriorAuth || p.endsWith('/lookup.html')) {
          try { await signInAnonymously(auth); } catch (e) { console.warn('[fb-auth] anon sign-in failed', e); }
        }
      }
    }
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
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'sw-updated') {
      try {
        if (sessionStorage.getItem('__swReloaded') === '1') return;
        sessionStorage.setItem('__swReloaded', '1');
      } catch (_) {}
      location.reload();
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
