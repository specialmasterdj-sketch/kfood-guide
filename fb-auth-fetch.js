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
    // chat.me 에 본인 uid 가 있는데도 currentUser 가 null 이면 = Firebase Auth
    // IndexedDB 가 손실됨. auth-gate 가 8초 후 auth.html 로 redirect 함. 그
    // 동안 signInAnonymously 하면 auth-gate 가 익명 사용자를 "pending approval"
    // 로 보고 UI 막힘. 그래서 chat.me uid 있는 케이스는 손대지 않음.
    let hasPriorAuth = false;
    try {
      const me = JSON.parse(localStorage.getItem('chat.me') || 'null');
      hasPriorAuth = !!(me && (me.uid || me.email));
    } catch(_) {}
    const p = (location.pathname || '').toLowerCase();
    const isAuthPage = p.endsWith('/auth.html');
    if (!hasPriorAuth && !isAuthPage) {
      // 진짜 익명 방문자 (rewards 공개 페이지 등) — Firebase Auth SDK 가 토큰
      // 받아야 RTDB onValue/get 호출도 동작.
      signInAnonymously(auth).catch(e => console.warn('[fb-auth-fetch] anon sign-in failed', e));
    }
  }
  try { window.dispatchEvent(new Event('fb-auth-ready')); } catch (_) {}
});

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
