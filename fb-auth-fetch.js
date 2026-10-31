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
// 🔔 2026-10-30 사장님: "초청된 사람이 전화 알림 받듯이 소리나 진동이 와야 하는데"
//   · 창이 떠 있는 동안 전화벨처럼 '따르릉' 소리 + 진동을 3초마다 되풀이 (받거나·거절하거나·60초까지)
//   · 앱을 내려 둔(백그라운드) 상태면 폰 알림(소리·진동)을 띄우고, 울리는 동안 몇 번 더 울린다
//   · 거는 사람이 [회의 끝] 을 누르거나 다른 기기에서 받으면 벨이 멈추고 창이 닫힌다
//   ⚠ 앱을 완전히 끈 폰은 울리지 않는다 — 완전 종료 푸시(FCM)는 사장님 정책으로 꺼 둠(PUSH-SETUP.md).
//   ⚠ 브라우저는 그 화면을 한 번이라도 누른 뒤에만 소리·진동을 허락한다 → 첫 터치 때 미리 열어 둔다.
//      아이폰은 웹 진동이 없다(소리·알림만).
(function(){
  if (window.__kmRingWatch) return; window.__kmRingWatch = true;
  // 회의 화면 주소 — 하위 폴더 페이지(floorplan/)에서도 맞게 이 스크립트 위치 기준으로 잡는다
  const MEET = (() => { try { return new URL('meet.html', import.meta.url).href; } catch (_) { return './meet.html'; } })();   // 모듈이라 import.meta.url = 이 스크립트 위치 (floorplan/ 에서도 맞음)
  const onMeet = () => /\/meet\.html$/.test(location.pathname);
  const RING = 'https://kimchi-mart-order-default-rtdb.firebaseio.com/inventory/meet';
  const FRESH = 3 * 60 * 1000;
  const seen = new Set();
  let open = false;
  const L = () => { try { const v = localStorage.getItem('km.lang'); return ['ko','en','es'].includes(v) ? v : 'ko'; } catch (_) { return 'ko'; } };
  const TX = {
    ko: { t: '📹 화상 회의 초대', b: '%s 님이 지금 화상 회의로 부릅니다.', go: '📹 지금 참가', no: '나중에 / 거절',
          mt: '📋 회의록이 올라왔습니다', mb: '%s 님 회의의 참석자·자료·메모가 정리되었습니다.', mgo: '📋 회의록 보기', mno: '닫기',
          n: '참가하면 이름과 시각이 기록됩니다. 녹화할 때는 시작하며 알려 드립니다.' },
    en: { t: '📹 Video meeting', b: '%s is calling you into a video meeting.', go: '📹 Join now', no: 'Decline',
          mt: '📋 Meeting minutes are ready', mb: 'Attendees, files and notes from %s’s meeting are filed.', mgo: '📋 View minutes', mno: 'Close',
          n: 'Your name and time are recorded. If the call is recorded you will be told.' },
    es: { t: '📹 Videorreunión', b: '%s le llama a una reunión por video.', go: '📹 Entrar', no: 'Rechazar',
          mt: '📋 Acta de la reunión', mb: 'Se guardó el acta de la reunión de %s.', mgo: '📋 Ver acta', mno: 'Cerrar',
          n: 'Su nombre y hora quedan registrados. Si se graba, se le avisará.' },
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function withAcct(u){
    let a = ''; try { a = localStorage.getItem('km.meet.gacct') || ''; } catch (_) {}
    if (!a || !u || /[?&]authuser=/.test(u)) return u;
    return u + (u.indexOf('?') < 0 ? '?' : '&') + 'authuser=' + encodeURIComponent(a);
  }
  // ── 벨소리 ── 소리 장치는 하나만 만들어 두고, 화면을 처음 누를 때 깨워 둔다(브라우저 자동재생 규칙)
  let AC = null;
  function ac(){
    try { if (!AC) { const C = window.AudioContext || window.webkitAudioContext; if (C) AC = new C(); }
          if (AC && AC.state === 'suspended') AC.resume().catch(() => {}); } catch (_) {}
    return AC;
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(ev => document.addEventListener(ev, ac, { once: true, passive: true, capture: true }));
  // 전화벨 한 번 = 440+480Hz 두 소리를 0.4초 · 쉼 0.2초 · 0.4초 (북미 전화 벨 모양)
  function ringOnce(){
    try { navigator.vibrate && navigator.vibrate([500, 200, 500, 200, 900]); } catch (_) {}
    const c = ac(); if (!c || c.state !== 'running') return;
    try {
      const g = c.createGain(); g.gain.value = 0; g.connect(c.destination);
      [440, 480].forEach(f => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(); o.stop(c.currentTime + 1.05); });
      const t0 = c.currentTime;
      g.gain.setValueAtTime(0.22, t0);        g.gain.setValueAtTime(0, t0 + 0.4);
      g.gain.setValueAtTime(0.22, t0 + 0.6);  g.gain.setValueAtTime(0, t0 + 1.0);
    } catch (_) {}
  }
  let ringT = null, ringStop = null;
  function startRing(){
    stopRing();
    ringOnce();
    ringT = setInterval(ringOnce, 3000);
    ringStop = setTimeout(stopRing, 60000);   // 60초 울리고 멈춤 (창은 그대로 남는다)
  }
  function stopRing(){
    if (ringT) clearInterval(ringT); if (ringStop) clearTimeout(ringStop);
    ringT = ringStop = null;
    try { navigator.vibrate && navigator.vibrate(0); } catch (_) {}
  }
  // ── 폰 알림 (앱이 백그라운드일 때) ── 서비스워커 알림이 폰 알림창·잠금화면에 뜨고 소리·진동이 난다
  const notified = {};   // 통화id@ts → 알린 횟수
  async function sysNotify(id, v){
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const T = TX[L()];
      const opt = { body: T.b.replace('%s', v.from || '') + (v.fromBranch ? ' · ' + v.fromBranch : ''),
                    tag: 'km-ring-' + id, renotify: true, requireInteraction: true,
                    vibrate: [700, 300, 700, 300, 700, 300, 1200],
                    icon: new URL('pwa-assets/icon-192.png', MEET).href, badge: new URL('pwa-assets/icon-192.png', MEET).href,
                    data: { url: MEET + '#ring-' + id } };
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      const ttl = v.kindLabel || T.t;
      if (reg && reg.showNotification) await reg.showNotification(ttl, opt);
      else new Notification(ttl, opt);
    } catch (_) {}
  }
  // 알림 허락을 아직 안 물었으면, 벨 창의 버튼을 누르는 순간(사용자 동작) 한 번 묻는다
  function askNotifyOnce(){
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') pushRegister(); }).catch(() => {}); } catch (_) {}
  }
  let cur = null;   // 지금 떠 있는 벨 창 { uid, id }
  async function patch(path, body){
    try { await window.fetch(RING + path + '.json', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (_) {}
  }
  function show(uid, id, v){
    open = true;
    const T0 = TX[L()];
    const MIN = v.state === 'minutes';
    // 📋 회의록 알림은 같은 창 모양에 글만 바꾼다
    const T = MIN ? { t: T0.mt, b: T0.mb, go: T0.mgo, no: T0.mno, n: '' } : (v.kindLabel ? Object.assign({}, T0, { t: v.kindLabel }) : T0);
    const URG = !MIN && v.kind === 'urgent';   // 🚨 긴급 회의 — 빨간 창
    const ov = document.createElement('div');
    ov.id = '__kmRing';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:' + (URG ? 'rgba(127,29,29,.78)' : 'rgba(10,15,22,.62)') + ';display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div style="background:#fff;color:#18202a;border-radius:18px;max-width:380px;width:100%;padding:20px 18px;box-shadow:0 18px 50px rgba(0,0,0,.35);font:15px/1.5 -apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Malgun Gothic\',sans-serif;text-align:center">'
      + '<div style="font-size:2.4em;line-height:1;margin-bottom:8px">' + (MIN ? '📋' : URG ? '🚨' : '📹') + '</div>'
      + '<div style="font-weight:800;font-size:1.08em;margin-bottom:6px' + (URG ? ';color:#dc2626' : '') + '">' + esc(T.t) + '</div>'
      + '<div style="font-weight:700;margin-bottom:4px">' + esc(T.b.replace('%s', v.from || '')) + '</div>'
      + (v.fromBranch ? '<div style="color:#64748b;font-size:.85em;margin-bottom:10px">' + esc(v.fromBranch) + '</div>' : '')
      + '<div style="color:#64748b;font-size:.78em;margin-bottom:14px">' + esc(T.n) + '</div>'
      + '<button id="__kmRingGo" style="display:block;width:100%;background:#16a34a;color:#fff;border:0;border-radius:12px;padding:14px;font:inherit;font-weight:800;font-size:1.05em;cursor:pointer;margin-bottom:8px">' + esc(T.go) + '</button>'
      + '<button id="__kmRingNo" style="display:block;width:100%;background:#f1f5f9;color:#334155;border:0;border-radius:12px;padding:11px;font:inherit;font-weight:700;cursor:pointer">' + esc(T.no) + '</button>'
      + '</div>';
    (document.body || document.documentElement).appendChild(ov);
    if (!MIN) { startRing(); cur = { uid, id }; }
    // 이 화면을 아직 한 번도 안 누른 상태면 브라우저가 소리·진동을 막는다 → 폰 알림으로도 같이 울린다
    try { if (!MIN && navigator.userActivation && !navigator.userActivation.hasBeenActive) sysNotify(id, v); } catch (_) {}
    const close = () => { stopRing(); cur = null; try { ov.remove(); } catch (_) {} open = false; };
    ov.__close = close;
    ov.querySelector('#__kmRingGo').onclick = () => {
      askNotifyOnce();
      if (MIN) {
        patch('/ring/' + uid + '/' + id, { state: 'seen', at: Date.now() });
        close();
        const to = MEET + '#min-' + (v.min || '');
        if (onMeet()) location.hash = 'min-' + (v.min || ''); else location.href = to;
        return;
      }
      // 새 창은 반드시 누른 그 순간에 연다 (기다렸다 열면 폰 브라우저가 막는다)
      if (v.url) window.open(withAcct(v.url), '_blank', 'noopener');
      const at = Date.now();
      patch('/ring/' + uid + '/' + id, { state: 'accepted', at });
      patch('/calls/' + id + '/inv/' + uid, { state: 'accepted', at });
      close();
      // 이 화면은 회의 화면으로 — 거기서 회의 자료·메모를 같이 본다 (영상은 새 창의 Meet)
      setTimeout(() => { if (onMeet()) location.hash = 'call-' + id; else location.href = MEET + '#call-' + id; }, 600);
    };
    ov.querySelector('#__kmRingNo').onclick = () => {
      askNotifyOnce();
      const at = Date.now();
      if (MIN) { patch('/ring/' + uid + '/' + id, { state: 'seen', at }); close(); return; }
      patch('/ring/' + uid + '/' + id, { state: 'declined', at });
      patch('/calls/' + id + '/inv/' + uid, { state: 'declined', at });
      close();
    };
  }
  async function poll(){
    const hidden = document.visibilityState !== 'visible';
    let uid = '';
    try { uid = (auth.currentUser && auth.currentUser.uid) || ''; } catch (_) {}
    if (!uid) return;
    try {
      const r = await window.fetch(RING + '/ring/' + uid + '.json', { cache: 'no-store' });
      if (!r.ok) return;
      const m = (await r.json()) || {};
      const now = Date.now();
      // 떠 있는 벨 창 — 거는 쪽이 끝냈거나 다른 기기에서 받았으면 벨을 멈추고 닫는다
      if (open) {
        if (cur) { const v = m[cur.id]; if (!v || v.state !== 'ringing') { const ov = document.getElementById('__kmRing'); if (ov && ov.__close) ov.__close(); } }
        return;
      }
      // 앱을 내려 둔 동안 — 폰 알림으로 울린다 (창은 화면에 돌아오면 띄운다)
      if (hidden) {
        for (const id of Object.keys(m)) {
          const v = m[id];
          if (!v || v.state !== 'ringing' || now - (v.ts || 0) > 60000) continue;
          const k = id + '@' + v.ts;
          if ((notified[k] || 0) >= 4) continue;           // 한 번 부를 때 최대 4번 울림
          notified[k] = (notified[k] || 0) + 1;
          sysNotify(id, v);
        }
        return;
      }
      for (const id of Object.keys(m)) {
        const v = m[id];
        if (!v) continue;
        // 하루 지난 부름은 내가 정리한다 (거는 사람은 남의 칸을 지우지 않는다)
        if (now - (v.ts || 0) > 86400000) { window.fetch(RING + '/ring/' + uid + '/' + id + '.json', { method: 'DELETE' }).catch(() => {}); continue; }
        const isMin = v.state === 'minutes';   // 📋 회의록 알림은 하루 동안 띄운다 (볼 때까지)
        if (!isMin && (v.state !== 'ringing' || now - (v.ts || 0) > FRESH)) continue;
        const key = id + '@' + v.ts;          // '다시 부르기'(ts 갱신)는 다시 띄운다
        if (seen.has(key)) continue;
        seen.add(key);
        show(uid, id, v);
        break;
      }
    } catch (_) {}
  }
  /* 📲 2026-10-30 사장님: "핸드폰이 일반 대기 화면에서도 이 요청이 오면 알 수 있도록"
     = 앱을 완전히 끈 폰도 울려야 한다 → FCM 푸시. **화상 회의 초대에만** 쓴다.
     (8/30 정책 "앱을 꺼 두면 방해하지 않는다" 는 채팅에는 그대로 — 채팅 푸시는 fcmTokens/<이름> 을 쓰고
      여기는 users/{uid}/fcm 에만 적어서 채팅 발송 서버(chatPush)는 이 토큰을 보지 않는다.)
     · 알림 허락이 '허용' 인 기기만, 7일에 한 번 기기 토큰을 users/{내uid}/fcm/{토큰} 에 적는다
       (본인 기록이라 규칙상 본인이 쓸 수 있다 — status·role·branch 는 안 건드림)
     · 발송은 functions/index.js 의 meetRingPush 가 ring/{uid}/{통화id} 가 'ringing' 이 될 때 한다
     · VAPID 키는 Firebase 기본 키를 쓴다(getToken 에 vapidKey 를 안 주면 SDK 기본값) — 콘솔 작업 불필요 */
  async function pushRegister(){
    try {
      if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
      const u = auth.currentUser; if (!u) return;
      const K = 'km.meetPush.' + u.uid;
      let last = null; try { last = JSON.parse(localStorage.getItem(K) || 'null'); } catch (_) {}
      if (last && Date.now() - (last.at || 0) < 7 * 86400000) return;
      const A = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      const M = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js');
      if (!(await M.isSupported())) return;
      // 페이지가 먼저 만든 기본 앱에는 발신자 ID 가 없을 수 있어 푸시 전용 앱을 따로 둔다
      const pcfg = Object.assign({}, cfg, { messagingSenderId: '640942647201', appId: '1:640942647201:web:1e3421fb55c89155230de0' });
      const papp = A.getApps().find(a => a.name === 'km-push') || A.initializeApp(pcfg, 'km-push');
      const reg = await navigator.serviceWorker.ready;   // sw.js 의 push 핸들러가 알림을 띄운다
      const tok = await M.getToken(M.getMessaging(papp), { serviceWorkerRegistration: reg });
      if (!tok) return;
      const idt = await u.getIdToken();
      const r = await window.fetch('https://kimchi-mart-order-default-rtdb.firebaseio.com/users/' + u.uid + '/fcm/' + encodeURIComponent(tok).replace(/\./g, '%2E') + '.json?auth=' + encodeURIComponent(idt),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at: Date.now(), ua: (navigator.userAgent || '').slice(0, 90) }) });
      if (r.ok) localStorage.setItem(K, JSON.stringify({ at: Date.now() }));
    } catch (e) { try { console.warn('[meet-push]', (e && e.message) || e); } catch (_) {} }
  }
  setTimeout(pushRegister, 6000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(pushRegister, 2000); });

  setTimeout(poll, 2500);
  setInterval(poll, 8000);
  // 벨 창이 떠 있을 때는 더 자주 본다 — 거는 쪽이 끝내면 벨이 바로 멈추게
  setInterval(() => { if (open && cur) poll(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(poll, 400); });
  window.__kmRingPoll = poll;
})();
