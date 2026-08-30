#!/usr/bin/env node
// 📦 채팅 '사람별 하루 보고 묶음' 회귀 테스트 (2026-08-29 사장님 지시)
// chat.html 에서 실제 _isAutoReportMsg / _computeReportGroups 소스를 추출해 실행하고,
// renderMessages 의 재배치(마지막 보고 위치로 모으기) 알고리즘을 동일 로직으로 검증한다.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'chat.html'), 'utf8');

function extractFn(name){
  const re = new RegExp('function ' + name + '\\(list\\)\\{[\\s\\S]*?\\n\\}', 'm');
  const re1 = new RegExp('function ' + name + '\\(m\\)\\{[\\s\\S]*?\\n\\}', 'm');
  const m = src.match(re) || src.match(re1);
  if (!m) { console.error('FAIL: chat.html 에서 ' + name + ' 추출 실패'); process.exit(1); }
  return m[0];
}
/* eslint-disable no-eval */
const _isAutoReportMsg = eval('(' + extractFn('_isAutoReportMsg') + ')');
const _computeReportGroups = eval('(' + extractFn('_computeReportGroups') + ')');

// renderMessages 의 재배치와 동일 알고리즘 (변경 시 이 테스트도 함께 갱신)
if (!src.includes('_lastIdxByKey')) { console.error('FAIL: renderMessages 재배치 코드(_lastIdxByKey) 없음'); process.exit(1); }
function reorder(list, groups){
  if (!Object.keys(groups).length) return list.slice();
  const byId = {}; list.forEach(m => { byId[m.id] = m; });
  const lastIdx = {}; list.forEach((m, i) => { const g = groups[m.id]; if (g) lastIdx[g.key] = i; });
  const out = [];
  list.forEach((m, i) => {
    const g = groups[m.id];
    if (!g) { out.push(m); return; }
    if (i === lastIdx[g.key]) groups[g.key].ids.forEach(id => { if (byId[id]) out.push(byId[id]); });
  });
  return out;
}

const DAY = 86400000;
const T0 = 1756400000000;   // 고정 기준 시각
let seq = 0;
function msg(sender, branch, text, tsOffset, photos){
  return { id: 'm' + (++seq), sender, senderBranch: branch, text, ts: T0 + tsOffset, photos: photos || [] };
}
let fail = 0;
function chk(name, cond, extra){
  if (!cond) fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond ? '' : (' — ' + (extra || ''))));
}

// 시나리오: 같은 날, Anderson(할리우드) 발송 보고 4건이 다른 메시지 사이에 흩어짐
const list = [
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] 🥩 Fresh pork belly (8) → HOLLYWOOD', 1000),
  msg('Maria', 'MIAMI', '오늘 야채 진열 사진입니다. 전체적으로 신선도 좋고 정리 완료했습니다.', 2000, ['p1.jpg']),
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] 🥩 Beef ribeye (10) → HOLLYWOOD', 3000),
  msg('Jose', 'CORAL_SPRINGS', '✅ Task complete — meat daily checklist', 4000),
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] 🥩 Outside skirt (6) → HOLLYWOOD', 5000),
  msg('DJ', 'MIAMI', '수고했어요 모두', 6000),
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] 🍣 Unagi (8) → HOLLYWOOD', 7000),
];
const groups = _computeReportGroups(list);

console.log('1) 묶음 계산');
const andersonIds = [list[0].id, list[2].id, list[4].id, list[6].id];
const g0 = groups[andersonIds[0]];
chk('Anderson 4건이 한 묶음 (head=첫 보고)', !!g0 && g0.head && g0.count === 4, JSON.stringify(g0));
chk('멤버 id 목록 시간순', !!g0 && JSON.stringify(g0.ids) === JSON.stringify(andersonIds), g0 && g0.ids.join(','));
chk('Jose 1건은 묶음 없음 (2건 미만)', !groups[list[3].id]);
chk('Maria 긴 텍스트+사진 평가글은 묶이지 않음 (다른 지점 참조용 유지)', !_isAutoReportMsg(list[1]));
chk('DJ 일반 대화는 자동보고 아님', !_isAutoReportMsg(list[5]));

console.log('2) 재배치 (마지막 보고 위치로 모음)');
const out = reorder(list, groups);
const ids = out.map(m => m.id);
chk('총 개수 보존', out.length === list.length, ids.join(','));
chk('일반 메시지 순서 보존 (Maria→Jose→DJ)',
  ids.indexOf(list[1].id) < ids.indexOf(list[3].id) && ids.indexOf(list[3].id) < ids.indexOf(list[5].id));
const posA = andersonIds.map(id => ids.indexOf(id));
chk('Anderson 4건이 연속 배치', posA[1] === posA[0]+1 && posA[2] === posA[1]+1 && posA[3] === posA[2]+1, posA.join(','));
chk('묶음이 DJ 인사말 뒤(그 사람 마지막 보고 위치)', posA[0] > ids.indexOf(list[5].id));
chk('묶음 내부 시간순', posA[0] < posA[1] && posA[1] < posA[2] && posA[2] < posA[3]);

console.log('3) 날짜 경계 — 다른 날은 별도 묶음');
const list2 = [
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] a → H', 1000),
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] b → H', 2000),
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] c → H', DAY + 1000),
  msg('Anderson', 'HOLLYWOOD', '🚚 [Enviado] d → H', DAY + 2000),
];
const g2 = _computeReportGroups(list2);
chk('1일차 2건 + 2일차 2건 = 묶음 2개',
  g2[list2[0].id] && g2[list2[0].id].count === 2 && g2[list2[2].id] && g2[list2[2].id].count === 2);

console.log('4) 같은 이름 다른 지점은 분리');
const list3 = [
  msg('Kim', 'MIAMI', '🚚 [Enviado] a → M', 1000),
  msg('Kim', 'HOLLYWOOD', '🚚 [Enviado] b → H', 2000),
  msg('Kim', 'MIAMI', '🚚 [Enviado] c → M', 3000),
  msg('Kim', 'HOLLYWOOD', '🚚 [Enviado] d → H', 4000),
];
const g3 = _computeReportGroups(list3);
chk('마이애미 Kim / 할리우드 Kim 각각 묶음',
  g3[list3[0].id] && g3[list3[0].id].count === 2 && g3[list3[1].id] && g3[list3[1].id].count === 2);

console.log(fail === 0 ? '\n🎉 보고 묶음 전부 통과' : '\n💥 실패 ' + fail + '건');
process.exit(fail ? 1 : 0);
