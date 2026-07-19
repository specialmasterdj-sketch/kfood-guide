// 채팅 메시지 순서 로직 검증 — chat.html 의 msgsFromObj 를 그대로 복사해
// 실제 도착 시나리오(빠른 30개 먼저 → 전체 200개 나중 → 새 메시지 → 옛 메시지에 댓글)를 재현.
// 기대: 어떤 시나리오에서도 화면 맨 아래(배열 마지막) = 가장 최신 메시지.

// ── chat.html 에서 그대로 복사 (2026-07-19 order_fix 버전) ──
let __roomOrderMap = {};
function msgsFromObj(d){
  if (!d) return [];
  const arr = Object.entries(d).map(([id, m]) => {
    const obj = Object.assign({ id }, m);
    let latest = obj.ts || 0;
    if (obj.replies) {
      for (const r of Object.values(obj.replies)) {
        if (r && r.ts && r.ts > latest) latest = r.ts;
      }
    }
    obj._latestActivity = latest;
    return obj;
  });
  for (const m of arr) if (!(m.id in __roomOrderMap)) __roomOrderMap[m.id] = m._latestActivity || 0;
  arr.sort((a,b) => (__roomOrderMap[a.id] - __roomOrderMap[b.id]) || ((a.ts||0) - (b.ts||0)));
  return arr;
}
// ── 여기까지 복사 ──

// 헬퍼: 200개 메시지 생성 (id=m1..m200, ts 1시간 간격, m200 이 최신)
function makeMsgs(from, to){
  const o = {};
  for (let i = from; i <= to; i++) o['m' + String(i).padStart(3,'0')] = { ts: 1000000 + i * 3600000, text: 'msg' + i };
  return o;
}
let fail = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? '✅' : '❌') + ' ' + name + ' — 맨 아래: ' + got + (ok ? '' : ' (기대: ' + want + ')'));
}

// 시나리오 1: 새로고침 재현 — 최신 30개 먼저 도착 → 전체 200개 나중 도착
__roomOrderMap = {};
let MSGS = msgsFromObj(makeMsgs(171, 200));            // fast-first 30 (최신)
check('1a. 빠른 30개만', MSGS[MSGS.length-1].id, 'm200');
MSGS = msgsFromObj(makeMsgs(1, 200));                  // 전체 200 도착
check('1b. 전체 도착 후에도 최신이 맨 아래 (어제 버그 재현 지점)', MSGS[MSGS.length-1].id, 'm200');
check('1c. 맨 위 = 가장 오래된 것', MSGS[0].id, 'm001');

// 시나리오 2: 캐시 40개 먼저 → 전체 200개
__roomOrderMap = {};
const cached = msgsFromObj(makeMsgs(161, 200));        // 지난 세션 캐시에 해당
MSGS = msgsFromObj(makeMsgs(1, 200));
check('2. 캐시 후 전체 도착', MSGS[MSGS.length-1].id, 'm200');

// 시나리오 3: 새 메시지 도착 → 항상 맨 아래
const withNew = makeMsgs(1, 201);
MSGS = msgsFromObj(withNew);
check('3. 새 메시지 m201', MSGS[MSGS.length-1].id, 'm201');

// 시나리오 4: 옛 메시지(m050)에 방금 댓글 — 순간이동 없이 제자리 유지
const withReply = makeMsgs(1, 201);
withReply.m050.replies = { r1: { ts: Date.now(), text: 'new reply' } };
MSGS = msgsFromObj(withReply);
const idx050 = MSGS.findIndex(m => m.id === 'm050');
check('4a. 댓글 달린 m050 위치 유지 (49번째)', String(idx050), '49');
check('4b. 맨 아래는 여전히 m201', MSGS[MSGS.length-1].id, 'm201');

// 시나리오 5: 방 새로 열기(맵 초기화) — 댓글 달린 옛 메시지는 이때만 아래로 (의도된 동작)
__roomOrderMap = {};
MSGS = msgsFromObj(withReply);
check('5. 방 새로 열면 댓글 달린 m050 이 맨 아래 (활동순)', MSGS[MSGS.length-1].id, 'm050');

// 시나리오 6: 어제 버그 버전(seq 카운터) 재현 — 실패해야 정상 (버그 증명)
let seqMap = {}, seq = 0;
function buggyFromObj(d){
  const arr = Object.entries(d).map(([id,m]) => Object.assign({id, _la: m.ts}, m)).sort((a,b)=>a._la-b._la);
  for (const m of arr) if (!(m.id in seqMap)) seqMap[m.id] = seq++;
  arr.sort((a,b) => seqMap[a.id]-seqMap[b.id]);
  return arr;
}
buggyFromObj(makeMsgs(171,200));
const buggy = buggyFromObj(makeMsgs(1,200));
console.log((buggy[buggy.length-1].id !== 'm200' ? '✅' : '❌') + ' 6. 어제 버그 재현 확인 — 옛 버전은 맨 아래가 ' + buggy[buggy.length-1].id + ' (m170, 과거 메시지 = 사장님이 본 증상)');

console.log(fail === 0 ? '\n🎉 신버전 전체 시나리오 통과' : '\n💥 실패 ' + fail + '건');
process.exit(fail === 0 ? 0 : 1);
