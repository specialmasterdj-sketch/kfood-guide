#!/usr/bin/env node
// ⏱ 업데이트 전달 체계 회귀 테스트 (2026-08-29 사장님 지시:
//   "어떤 상황에서도 무조건 먼저 열리고, 구버전이 며칠씩 고착되면 안 됨")
// 1) 정적: 각 페이지·공용 스크립트에 hidden 즉시적용 + force 우회가 있는지
// 2) 동작: sw.js 의 캐시/네트워크 레이스 의미를 동일 알고리즘으로 시뮬레이션
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
let fail = 0;
function chk(name, cond, extra){
  if (!cond) fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond ? '' : ' — ' + (extra || '')));
}

console.log('1) hidden 즉시적용 정적 검증');
const PAGES = ['apps.html','barcode-fix.html','expiry.html','hub.html','shifts.html','temp.html','price-audit.html'];
for (const f of PAGES){
  const c = fs.readFileSync(path.join(REPO, f), 'utf8');
  chk(f + ' — __applyBust(force) 시그니처', c.includes('function __applyBust(force){'));
  chk(f + ' — busy 우회(!force &&)', c.includes('if (!force && __busy())'));
  chk(f + " — hidden 리스너 + __applyBust(true)", /visibilityState !== 'hidden' \|\| !__pendingBust/.test(c) && c.includes('__applyBust(true)'));
}
const chat = fs.readFileSync(path.join(REPO, 'chat.html'), 'utf8');
chk('chat.html — applyBustIfIdle(force) + hidden 리스너', chat.includes('function applyBustIfIdle(force){') && chat.includes('applyBustIfIdle(true)'));
const fbA = fs.readFileSync(path.join(REPO, 'fb-auth-fetch.js'), 'utf8');
chk('fb-auth-fetch.js — __swApplyReload(force) + hidden 리스너', fbA.includes('function __swApplyReload(force){') && fbA.includes('__swApplyReload(true)'));
const mp = fs.readFileSync(path.join(REPO, 'me-persist.js'), 'utf8');
chk('me-persist.js — tryPendingReload(force) + hidden 리스너', mp.includes('function tryPendingReload(force){') && mp.includes('tryPendingReload(true)'));
console.log('  (모든 hidden 적용은 textarea 초안 있으면 보류 —', PAGES.length + 3, '곳 공통)');

console.log('2) sw.js 정적 검증');
const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
chk('캐시 有 → 0.8초 레이스', sw.includes('hit ? 800 : 3500'));
chk('네트워크 응답은 백그라운드 캐시 갱신', sw.includes("network.catch(() => {})"));
chk('NET_SLOW/NET_FAIL 레이스 구조', sw.includes("'NET_SLOW'") && sw.includes("'NET_FAIL'"));

console.log('3) 레이스 의미 시뮬레이션 (sw.js 와 동일 알고리즘)');
async function race(netMs, netOk, hasCache, waitFast, waitSlow){
  const network = new Promise((res, rej) => setTimeout(() => netOk ? res('NET') : rej(new Error('down')), netMs));
  const hit = hasCache ? 'CACHE' : null;
  const waitMs = hit ? waitFast : waitSlow;
  const first = await Promise.race([
    network.catch(() => 'NET_FAIL'),
    new Promise(r => setTimeout(() => r('NET_SLOW'), waitMs)),
  ]);
  if (first !== 'NET_FAIL' && first !== 'NET_SLOW') return first;
  if (hit) { network.catch(() => {}); return hit; }
  try { return await network; } catch(_) { return 'FALLBACK'; }
}
(async () => {
  chk('빠른 네트워크(50ms)+캐시 → 최신(NET)', (await race(50, true, true, 80, 350)) === 'NET');
  chk('느린 네트워크(300ms)+캐시 → 캐시 즉시 오픈', (await race(300, true, true, 80, 350)) === 'CACHE');
  chk('네트워크 다운+캐시 → 캐시', (await race(30, false, true, 80, 350)) === 'CACHE');
  chk('첫 방문(캐시 없음)+정상 네트워크 → 기다려서 최신', (await race(200, true, false, 80, 350)) === 'NET');
  chk('첫 방문+네트워크 다운 → 폴백', (await race(30, false, false, 80, 350)) === 'FALLBACK');
  console.log(fail === 0 ? '\n🎉 업데이트 전달 체계 전부 통과' : '\n💥 실패 ' + fail + '건');
  process.exit(fail ? 1 : 0);
})();
