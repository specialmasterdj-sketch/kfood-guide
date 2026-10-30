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
  projectId: "kimchi-mart-order",
  // 🔴 2026-09-20 필수 — 이 파일이 페이지보다 먼저 앱을 초기화하는데 버킷이 빠져 있어서
  //   tasks.html 등의 getStorage(app) 가 storage/no-default-bucket 으로 죽었다.
  //   그래서 사진이 전부 base64 로 RTDB 에 박혀 하루치 노드가 30~45MB (폰이 못 버팀).
  storageBucket: "kimchi-mart-order.firebasestorage.app"
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

// 🖐 마지막 조작 시각 — "사용 중이면 리로드 미루기" 판정의 근거.
//   2026-09-20: 이 값을 chat.html 만 기록하고 있었다 → 다른 앱(업무지시·스케줄·매대…)에서는
//   userBusy() 가 늘 false 라, 새 버전이 올라오는 즉시 작업 중에도 화면이 리로드됐다
//   (전무님 신고: "저장됐다고 떴다 사라진다", "스케줄 화면이 자꾸 바뀐다").
//   공통으로 실리는 이 파일에서 기록해 전 앱에 적용한다.
try {
  if (typeof window !== 'undefined') {
    window.__kmLastActivity = Date.now();
    ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input', 'change'].forEach((ev) => {
      window.addEventListener(ev, () => { window.__kmLastActivity = Date.now(); }, { passive: true, capture: true });
    });
  }
} catch (_) {}

// 🏠 2026-10-30 — 이 창은 이미 앱 안에 있다(앱 모음·HUB 를 메뉴로 열면 '내 업무'로 되돌리지 않게)
try { sessionStorage.setItem('km_session_started', '1'); } catch (_) {}

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
  // 🔔 새 버전 알림 띠 — 보고 있는 동안에는 이것만 띄우고 새로고침은 하지 않는다
  function __swBanner(){
    try {
      if (document.getElementById('__kmNewVer')) return;
      let L = 'ko'; try { L = localStorage.getItem('km.lang') || 'ko'; } catch (_) {}
      const T = ({ ko: ['새 버전이 있습니다', '지금 새로고침', '나중에'],
                   en: ['A new version is ready', 'Refresh now', 'Later'],
                   es: ['Hay una versión nueva', 'Actualizar', 'Luego'] })[L]
                || ['새 버전이 있습니다', '지금 새로고침', '나중에'];
      const b = document.createElement('div');
      b.id = '__kmNewVer';
      b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;'
        + 'background:#1f2937;color:#fff;border-radius:12px;padding:10px 12px;display:flex;'
        + 'align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 6px 20px rgba(0,0,0,.25);'
        + 'font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      const t = document.createElement('span');
      t.textContent = '🔄 ' + T[0];
      t.style.cssText = 'flex:1 1 150px';
      const go = document.createElement('button');
      go.textContent = T[1];
      go.style.cssText = 'background:#22c55e;color:#06240f;border:0;border-radius:9px;padding:7px 12px;font:inherit;cursor:pointer';
      go.onclick = () => __swApplyReload(true);
      // 🔄 2026-10-30 사장님: "모든 사용자가 반드시 업데이트하도록 유도" — '나중에'로 닫지 못하게. 띠는 누를 때까지 남는다.
      b.appendChild(t); b.appendChild(go);
      (document.body || document.documentElement).appendChild(b);
    } catch (_) {}
  }
  function __swApplyReload(force){
    if (!__swReloadPending) return;
    /* 🔴 2026-10-13 — 보고 있는 화면은 절대 새로고침하지 않는다.
       DJ(마이애미) 신고: "모든 페이지가 열리고 난 뒤 계속 깜빡입니다."
       전에는 "2분간 손을 안 댔으면" 새로고침했는데, 화면을 들여다보기만 하는 동안에도
       그 조건이 참이 되어 눈앞에서 페이지가 다시 그려졌다. 새 버전을 올릴 때마다 그랬다.
       → 보고 있을 땐 띠로 알리기만 하고, 안 보일 때(아래 hidden) 조용히 적용한다. */
    if (!force && document.visibilityState === 'visible') { __swBanner(); return; }
    if (!force && __swUserBusy()) { setTimeout(__swApplyReload, 60000); return; }
    try { if (typeof window.__kmSaveResumeState === 'function') window.__kmSaveResumeState(); } catch (_) {}
    location.reload();
  }
  // 2026-08-29 — hidden(앱 전환·화면 꺼짐) 시 대기 중 SW 업데이트 즉시 적용
  //   (계속 쓰는 기기에 구버전 며칠씩 고착 방지). textarea 초안 있으면 보류.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !__swReloadPending) return;
    try { const tas = document.querySelectorAll('textarea'); for (let i = 0; i < tas.length; i++) if (tas[i].value) return; } catch (_) {}
    __swApplyReload(true);
  });
  // 새 버전 적용은 이 파일이 혼자 맡는다 — me-persist.js 도 여기로 넘긴다
  // (둘이 따로 새로고침해서 한 번 올릴 때 두 번 깜빡일 수 있었다)
  try { window.__kmUpdateReady = function(){ __swReloadPending = true; __swApplyReload(); }; } catch (_) {}
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'sw-updated') {
      try {
        // 2026-10-30 — 예전엔 한 번 새로고침한 창은 그 뒤 업데이트를 영영 무시했다(하루 종일 켜 둔 폰은 구버전 고착).
        //   이제는 '방금(60초 안)' 새로고침한 경우만 건너뛴다 — 연속 루프만 막는다.
        const __last = +(sessionStorage.getItem('__swReloadedAt') || 0);
        if (Date.now() - __last < 60000) return;
        sessionStorage.setItem('__swReloadedAt', String(Date.now()));
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
    // 2026-10-30 — 폰은 앱을 내려 두면 타이머가 멈춘다 → 다시 화면에 올라올 때마다 바로 확인
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { try { reg.update(); } catch(_){} }
    });
    window.addEventListener('focus', () => { try { reg.update(); } catch(_){} });
  }).catch(() => {});
}

// 📞 2026-10-30 사장님: "직원을 클릭만 하면 상대에게 즉시 비디오 룸 접속 창이 뜨고, 나는 바로 기다렸다 대화."
//   meet.html 에서 통화를 걸면 inventory/meet/ring/{받는 사람 uid}/{통화id} 에 적힌다.
//   이 파일은 앱의 거의 모든 화면(58곳)에 들어 있어서, 받는 사람이 어느 화면에 있든 여기서 바로 창을 띄운다.
//   앱이 보일 때 8초마다 + 화면에 다시 올라올 때 즉시 확인. 3분 지난 부름은 띄우지 않는다(부재중).
(function(){
  if (window.__kmRingWatch) return; window.__kmRingWatch = true;
  const RING = 'https://kimchi-mart-order-default-rtdb.firebaseio.com/inventory/meet';
  const FRESH = 3 * 60 * 1000;
  const seen = new Set();
  let open = false;
  const L = () => { try { const v = localStorage.getItem('km.lang'); return ['ko','en','es'].includes(v) ? v : 'ko'; } catch (_) { return 'ko'; } };
  const TX = {
    ko: { t: '📹 화상 통화 초대', b: '%s 님이 지금 화상 통화로 부릅니다.', go: '📹 지금 참가', no: '나중에 / 거절',
          n: '참가하면 이름과 시각이 기록됩니다. 녹화할 때는 시작하며 알려 드립니다.' },
    en: { t: '📹 Video call', b: '%s is calling you on video now.', go: '📹 Join now', no: 'Decline',
          n: 'Your name and time are recorded. If the call is recorded you will be told.' },
    es: { t: '📹 Videollamada', b: '%s le está llamando por video.', go: '📹 Entrar', no: 'Rechazar',
          n: 'Su nombre y hora quedan registrados. Si se graba, se le avisará.' },
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function withAcct(u){
    let a = ''; try { a = localStorage.getItem('km.meet.gacct') || ''; } catch (_) {}
    if (!a || !u || /[?&]authuser=/.test(u)) return u;
    return u + (u.indexOf('?') < 0 ? '?' : '&') + 'authuser=' + encodeURIComponent(a);
  }
  function beep(){
    try { navigator.vibrate && navigator.vibrate([300, 120, 300, 120, 500]); } catch (_) {}
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const c = new C(); const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(c.destination); o.start();
      setTimeout(() => { o.frequency.value = 660; }, 250);
      setTimeout(() => { try { o.stop(); c.close(); } catch (_) {} }, 700);
    } catch (_) {}
  }
  async function patch(path, body){
    try { await window.fetch(RING + path + '.json', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (_) {}
  }
  function show(uid, id, v){
    open = true;
    const T = TX[L()];
    const ov = document.createElement('div');
    ov.id = '__kmRing';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(10,15,22,.62);display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div style="background:#fff;color:#18202a;border-radius:18px;max-width:380px;width:100%;padding:20px 18px;box-shadow:0 18px 50px rgba(0,0,0,.35);font:15px/1.5 -apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Malgun Gothic\',sans-serif;text-align:center">'
      + '<div style="font-size:2.4em;line-height:1;margin-bottom:8px">📹</div>'
      + '<div style="font-weight:800;font-size:1.08em;margin-bottom:6px">' + esc(T.t) + '</div>'
      + '<div style="font-weight:700;margin-bottom:4px">' + esc(T.b.replace('%s', v.from || '')) + '</div>'
      + (v.fromBranch ? '<div style="color:#64748b;font-size:.85em;margin-bottom:10px">' + esc(v.fromBranch) + '</div>' : '')
      + '<div style="color:#64748b;font-size:.78em;margin-bottom:14px">' + esc(T.n) + '</div>'
      + '<button id="__kmRingGo" style="display:block;width:100%;background:#16a34a;color:#fff;border:0;border-radius:12px;padding:14px;font:inherit;font-weight:800;font-size:1.05em;cursor:pointer;margin-bottom:8px">' + esc(T.go) + '</button>'
      + '<button id="__kmRingNo" style="display:block;width:100%;background:#f1f5f9;color:#334155;border:0;border-radius:12px;padding:11px;font:inherit;font-weight:700;cursor:pointer">' + esc(T.no) + '</button>'
      + '</div>';
    (document.body || document.documentElement).appendChild(ov);
    beep();
    const close = () => { try { ov.remove(); } catch (_) {} open = false; };
    ov.querySelector('#__kmRingGo').onclick = () => {
      // 새 창은 반드시 누른 그 순간에 연다 (기다렸다 열면 폰 브라우저가 막는다)
      if (v.url) window.open(withAcct(v.url), '_blank', 'noopener');
      const at = Date.now();
      patch('/ring/' + uid + '/' + id, { state: 'accepted', at });
      patch('/calls/' + id + '/inv/' + uid, { state: 'accepted', at });
      close();
    };
    ov.querySelector('#__kmRingNo').onclick = () => {
      const at = Date.now();
      patch('/ring/' + uid + '/' + id, { state: 'declined', at });
      patch('/calls/' + id + '/inv/' + uid, { state: 'declined', at });
      close();
    };
  }
  async function poll(){
    if (open || document.visibilityState !== 'visible') return;
    let uid = '';
    try { uid = (auth.currentUser && auth.currentUser.uid) || ''; } catch (_) {}
    if (!uid) return;
    try {
      const r = await window.fetch(RING + '/ring/' + uid + '.json', { cache: 'no-store' });
      if (!r.ok) return;
      const m = (await r.json()) || {};
      const now = Date.now();
      for (const id of Object.keys(m)) {
        const v = m[id];
        if (!v) continue;
        // 하루 지난 부름은 내가 정리한다 (거는 사람은 남의 칸을 지우지 않는다)
        if (now - (v.ts || 0) > 86400000) { window.fetch(RING + '/ring/' + uid + '/' + id + '.json', { method: 'DELETE' }).catch(() => {}); continue; }
        if (v.state !== 'ringing' || now - (v.ts || 0) > FRESH) continue;
        const key = id + '@' + v.ts;          // '다시 부르기'(ts 갱신)는 다시 띄운다
        if (seen.has(key)) continue;
        seen.add(key);
        show(uid, id, v);
        break;
      }
    } catch (_) {}
  }
  setTimeout(poll, 2500);
  setInterval(poll, 8000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(poll, 400); });
  window.__kmRingPoll = poll;
})();
