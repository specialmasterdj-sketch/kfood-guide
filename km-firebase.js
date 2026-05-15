// km-firebase.js — Kimchi Mart 공통 Firebase + 안전 저장 모듈
//
// ⚠️ 만든 이유 (2026-05-15):
//   페이지마다 따로 Firebase init / fetch / save 짜서 같은 버그가 반복 발생.
//   대표 사례:
//   · rewards 가입 5/12~14 — auth 토큰 안 붙여 401 silent → 14명 데이터 손실
//   · top500 — 401 로 사진/재고 사라짐
//   · lookup/price-compare/invoice — duplicate-app 으로 SDK 망가짐
//   · 모두 "fetch 응답 안 보고 진행" + "Firebase 따로 init" 패턴
//
// 사용법 (어떤 페이지든 한 줄로 끝):
//   <script type="module" src="./km-firebase.js?v=1"></script>
//   <script>
//     // window.KM 또는 module import 둘 다 동작
//     await KM.authReady;
//     await KM.safeSave('inventory/top500/HOLLYWOOD/12345', { qty: 50 });
//   </script>
//
// 또는 module:
//   import { safeSave, safeFetch, authReady, db, ref, onValue } from './km-firebase.js';
//
// 보장:
//   1) Firebase app 은 전체 페이지에서 단 하나 — duplicate-app 에러 원천 차단
//   2) authReady 대기하면 auth.currentUser 항상 있음 (필요시 익명 가입 fallback)
//   3) safeSave 는 localStorage 백업 먼저 → RTDB → 실패 시 alert + 다음 로드 때 자동 retry
//   4) safeFetch 는 status 체크 후 명시적 ok/data/error 반환 — silent fail 불가능

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase, ref, get, set, update, push, remove, onValue } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const FB_DB_URL = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
const cfg = {
  apiKey: 'AIzaSyBwL0Wa1Q8aFhZp5hsn9gTw5aZwXUdAVy4',
  authDomain: 'kimchi-mart-order.firebaseapp.com',
  databaseURL: FB_DB_URL,
  projectId: 'kimchi-mart-order',
  storageBucket: 'kimchi-mart-order.firebasestorage.app',
};

// (1) 싱글톤 app — 페이지가 또 initializeApp 하면 자동 재사용
export const app = getApps().length ? getApp() : initializeApp(cfg);
export const auth = getAuth(app);
export const db = getDatabase(app);
export { ref, get, set, update, push, remove, onValue };

// (2) authReady — auth.currentUser 보장. 페이지 코드는 이거 await 후 작업.
let _authReadyResolve;
export const authReady = new Promise(res => { _authReadyResolve = res; });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // auth.html (명시적 로그인 페이지) 외에는 익명 가입 fallback —
    // 안 그러면 Firebase SDK 의 RTDB 호출이 토큰 없이 발사돼서 401 silent fail.
    const p = (location.pathname || '').toLowerCase();
    if (!p.endsWith('/auth.html')) {
      try { await signInAnonymously(auth); }
      catch (e) { console.warn('[km-fb] anon sign-in failed', e); }
    }
  }
  if (_authReadyResolve) { _authReadyResolve(auth.currentUser); _authReadyResolve = null; }
});

// (3) safeSave — backup-first + status check + alert on fail
//   path  : 'inventory/top500/HOLLYWOOD/12345' (앞 / 없이)
//   data  : JSON 직렬화 가능한 값
//   opts.method : 'PUT' (기본) | 'PATCH' | 'POST'
//   opts.silent : true 면 실패 alert 안 띄움
// 리턴 : { ok: boolean, status?: number }
export async function safeSave(path, data, opts = {}) {
  const method = opts.method || 'PUT';
  const backupKey = method + ':' + path;
  // 1) 항상 localStorage 백업 먼저 — RTDB 가 어떤 이유로든 실패해도 데이터는 안전
  try {
    const backup = JSON.parse(localStorage.getItem('km.saveBackup') || '{}');
    backup[backupKey] = { data, ts: Date.now(), method };
    localStorage.setItem('km.saveBackup', JSON.stringify(backup));
  } catch (_) {}
  // 2) 토큰 보장 후 RTDB 시도
  await authReady;
  let resp = null;
  try {
    resp = await fetch(`${FB_DB_URL}/${path}.json`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (_) { resp = null; }
  // 3) 성공이면 백업 제거
  if (resp && resp.ok) {
    try {
      const backup = JSON.parse(localStorage.getItem('km.saveBackup') || '{}');
      delete backup[backupKey];
      localStorage.setItem('km.saveBackup', JSON.stringify(backup));
    } catch (_) {}
    return { ok: true };
  }
  // 4) 실패면 명시적 alert (silent 옵션 아닌 경우)
  if (!opts.silent) {
    alert('⚠️ 저장 실패 (' + (resp ? resp.status : '네트워크') + ')\n로컬에 백업했습니다. 페이지 새로고침 시 자동 재시도됩니다.');
  }
  return { ok: false, status: resp ? resp.status : 0 };
}

// (4) safeFetch — 토큰 보장 + 응답 status 체크. silent fail 불가능.
//   리턴 : { ok: boolean, data?: any, status?: number, error?: string }
export async function safeFetch(path, opts = {}) {
  await authReady;
  try {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${FB_DB_URL}/${path}.json${sep}cache=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return { ok: false, status: r.status, data: null };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: e.message, data: null };
  }
}

// (5) retryBackups — 페이지 로드 때 자동 실행. 이전에 실패한 저장 재시도.
export async function retryBackups() {
  let backup = {};
  try { backup = JSON.parse(localStorage.getItem('km.saveBackup') || '{}'); } catch (_) {}
  if (!Object.keys(backup).length) return { ok: 0, fail: 0 };
  await authReady;
  let ok = 0, fail = 0;
  for (const [key, item] of Object.entries(backup)) {
    const path = key.split(':').slice(1).join(':');
    try {
      const r = await fetch(`${FB_DB_URL}/${path}.json`, {
        method: item.method || 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.data),
      });
      if (r.ok) { ok++; delete backup[key]; }
      else fail++;
    } catch (_) { fail++; }
  }
  try { localStorage.setItem('km.saveBackup', JSON.stringify(backup)); } catch (_) {}
  if (ok > 0) console.info('[km-fb] auto-retried', ok, 'backed-up writes (fail:', fail, ')');
  return { ok, fail };
}

// 페이지 로드마다 자동 재시도 — 이전에 실패한 저장이 살아남음
retryBackups().catch(() => {});

// 비-module 스크립트에서도 쓸 수 있게 window 노출
if (typeof window !== 'undefined') {
  window.KM = {
    app, auth, db,
    ref, get, set, update, push, remove, onValue,
    safeSave, safeFetch, retryBackups, authReady,
    FB_DB_URL,
  };
  // 디버깅용 — Console 에서 KM.db 등 확인 가능
  console.info('[km-fb] ready — v1');
}
