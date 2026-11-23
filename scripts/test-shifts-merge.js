// 스케줄(shifts.html) 동시 수정 검증 — 2026-11-23
// 사건: 전무님이 넣은 SUYOUNG CHOI 스케줄이 다음 날 다르게 나옴. 저장 때마다 지점 스케줄 전체를
//       통째로 덮어써서, 옛 화면을 띄워 둔 다른 매니저가 한 칸만 고쳐도 남이 넣은 칸이 사라졌다.
// 기대: 각 기기는 "자기가 바꾼 칸만" 보낸다 → 두 매니저가 어떤 순서로 저장해도 서로의 칸이 남는다.
// shifts.html 에서 함수를 그대로 꺼내 쓴다.
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'shifts.html'), 'utf8');
function grab(name){
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('shifts.html 에 ' + name + ' 함수가 없습니다');
  let i = html.indexOf('{', html.indexOf(')', start)), depth = 0;
  for (; i < html.length; i++){
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
}
const { buildSyncPatch, _canonSync } = new Function(
  ['_canonSync', 'buildSyncPatch'].map(grab).join('\n') + '\nreturn { buildSyncPatch, _canonSync };')();

let fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? '✅' : '❌') + ' ' + name + (ok ? '' : ' — 받은 값: ' + JSON.stringify(got) + ' / 기대: ' + JSON.stringify(want)));
}
const clone = (x) => JSON.parse(JSON.stringify(x));
// 클라우드 흉내: 경로 묶음(update/PATCH)을 적용. null 은 삭제.
function applyPatch(cloud, patch){
  const c = clone(cloud);
  for (const p of Object.keys(patch)){
    const seg = p.split('/'); let o = c;
    for (let i = 0; i < seg.length - 1; i++){ if (!o[seg[i]] || typeof o[seg[i]] !== 'object') o[seg[i]] = {}; o = o[seg[i]]; }
    if (patch[p] === null) delete o[seg[seg.length - 1]]; else o[seg[seg.length - 1]] = clone(patch[p]);
  }
  return c;
}
const sh = (start, end) => ({ start, end, position: 'cashier/stocker', note: '' });
const start = {
  roles: ['CASHIER/STOCKER'], publishedAt: 0, lastChangedAt: 100,
  employees: [{ id: 'eSU', name: 'SUYOUNG CHOI' }, { id: 'eRO', name: 'ROMAN' }],
  shifts: { 'eRO@2026-11-24': sh('16:00', '22:00') },
};

// ── 시나리오 1 (신고 재현): 전무님이 SUYOUNG 5일치를 넣음 → 옛 화면의 다른 매니저가 ROMAN 한 칸 수정 ──
{
  let cloud = clone(start);
  const A = clone(start), B = clone(start);          // 두 기기 모두 같은 화면에서 시작
  const baseA = clone(start), baseB = clone(start);
  ['25', '26', '27', '28', '29'].forEach(d => { A.shifts['eSU@2026-11-' + d] = sh('09:00', '17:00'); });
  A.lastChangedAt = 200;
  B.shifts['eRO@2026-11-26'] = sh('16:00', '19:00'); // B 는 A 의 저장을 아직 못 받은 옛 화면
  B.lastChangedAt = 300;

  const oldWay = clone(B);                           // 옛 방식: A 저장 뒤 B 가 통째로 덮어씀
  check('옛 방식(통째 덮어쓰기)은 전무님 입력이 사라진다 — 버그 재현', Object.keys(oldWay.shifts).filter(k => k.startsWith('eSU@')).length, 0);

  const patchB = buildSyncPatch(baseB, B, true);
  check('옛 화면 기기는 자기가 고친 칸 + 수정 시각만 보낸다', Object.keys(patchB).sort(), ['lastChangedAt', 'shifts/eRO@2026-11-26']);
  cloud = applyPatch(cloud, buildSyncPatch(baseA, A, true));
  cloud = applyPatch(cloud, patchB);
  check('새 방식: SUYOUNG 5일치가 그대로 남는다', Object.keys(cloud.shifts).filter(k => k.startsWith('eSU@')).length, 5);
  check('새 방식: 다른 매니저의 ROMAN 수정도 남는다', cloud.shifts['eRO@2026-11-26'].end, '19:00');
  check('새 방식: 손대지 않은 칸은 그대로', cloud.shifts['eRO@2026-11-24'].start, '16:00');

  // 저장 순서를 뒤집어도 결과가 같다
  let cloud2 = applyPatch(applyPatch(clone(start), patchB), buildSyncPatch(baseA, A, true));
  check('저장 순서가 바뀌어도 두 사람 것 모두 남는다', Object.keys(cloud2.shifts).length, 7);
}

// ── 시나리오 2: 같은 칸을 둘이 고치면 그 칸만 나중 저장이 이긴다 (다른 칸 피해 없음) ──
{
  const A = clone(start), B = clone(start);
  A.shifts['eSU@2026-11-25'] = sh('09:00', '17:00'); A.shifts['eSU@2026-11-26'] = sh('09:00', '17:00');
  B.shifts['eSU@2026-11-25'] = sh('14:00', '20:00');
  let cloud = applyPatch(applyPatch(clone(start), buildSyncPatch(start, A, true)), buildSyncPatch(start, B, true));
  check('같은 칸 → 나중 저장', cloud.shifts['eSU@2026-11-25'].start, '14:00');
  check('옆 칸은 그대로', cloud.shifts['eSU@2026-11-26'].start, '09:00');
}

// ── 시나리오 3: 한 칸 삭제는 그 칸만 지운다 ──
{
  const A = clone(start), B = clone(start);
  A.shifts['eSU@2026-11-25'] = sh('09:00', '17:00');
  delete B.shifts['eRO@2026-11-24'];
  const patchB = buildSyncPatch(start, B, true);
  check('삭제 묶음', patchB, { 'shifts/eRO@2026-11-24': null });
  const cloud = applyPatch(applyPatch(clone(start), buildSyncPatch(start, A, true)), patchB);
  check('삭제 뒤 남은 칸', Object.keys(cloud.shifts), ['eSU@2026-11-25']);
}

// ── 시나리오 4: 클라우드가 돌려준 모양(키 가나다순·빈 값 빠짐)과 비교해도 "바뀐 것 없음" ──
{
  const local = { roles: ['A'], employees: [{ id: 'e1', name: 'X', color: '#fff' }], deletedEmp: {}, extra: [],
                  shifts: { 'e1@2026-11-25': { start: '09:00', end: '17:00', position: 'p', note: '' } }, publishedAt: 0, lastChangedAt: 5 };
  const fromCloud = { employees: [{ color: '#fff', id: 'e1', name: 'X' }], lastChangedAt: 5, publishedAt: 0, roles: ['A'],
                      shifts: { 'e1@2026-11-25': { end: '17:00', note: '', position: 'p', start: '09:00' } } };
  check('모양만 다르면 보낼 것이 없다', buildSyncPatch(fromCloud, local, true), {});
  check('키 순서 무시', _canonSync({ b: 1, a: 2 }) === _canonSync({ a: 2, b: 1 }), true);
}

// ── 시나리오 5: 기준점이 없으면 지우는 것은 보내지 않는다 ──
{
  const patch = buildSyncPatch(null, { lastChangedAt: 9, shifts: { 'e1@2026-11-25': sh('09:00', '17:00') } }, false);
  check('기준점 없음 → 추가만', Object.keys(patch).sort(), ['lastChangedAt', 'shifts/e1@2026-11-25']);
  check('기준점 없음 → 삭제(null) 없음', Object.values(buildSyncPatch({ shifts: { x: sh('1', '2') } }, { shifts: {} }, false)), []);
}

// ── 시나리오 6: 직원 목록을 고친 기기가 시프트를 덮어쓰지 않는다 ──
{
  const A = clone(start), B = clone(start);
  A.shifts['eSU@2026-11-25'] = sh('09:00', '17:00');
  B.employees.push({ id: 'eNEW', name: 'NEW HIRE' });
  const patchB = buildSyncPatch(start, B, true);
  check('직원 추가는 employees 항목만 보낸다', Object.keys(patchB), ['employees']);
  const cloud = applyPatch(applyPatch(clone(start), buildSyncPatch(start, A, true)), patchB);
  check('직원 추가 뒤에도 남의 시프트가 남는다', [cloud.employees.length, !!cloud.shifts['eSU@2026-11-25']], [3, true]);
}

// ── 시나리오 7: 화면 코드가 통째 덮어쓰기를 더 이상 쓰지 않는다 ──
check("set(…'schedules/' + BRANCH…) 통째 저장 없음", /set\(ref\(db, 'schedules\/' \+ BRANCH\)/.test(html), false);
check('지점 스케줄 PUT 없음', /schedules\/' \+ (push\.)?branch \+ '\.json'[\s\S]{0,80}method: 'PUT'/.test(html), false);

if (fail){ console.error('\n💥 ' + fail + '건 실패'); process.exit(1); }
console.log('\n🎉 스케줄 동시 수정 검증 전체 통과');
