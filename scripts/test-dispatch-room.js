// 🚚 dispatch.html 발송 보고 방 라우팅 회귀 테스트
// 버그(2026-07-26): REPORT_KW.other 에 '평가' 키워드가 있어 이름에 '평가' 들어간
// 아무 방(알파벳순 첫 방 = bakery_eval)에 기타 발송 보고가 꽂힘.
// 수정: REPORT_ROOM_IDS 정확 매핑 1순위 + 광범위 키워드('평가','기타') 제거.
// 실행: node scripts/test-dispatch-room.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'dispatch.html'), 'utf8');
let pass = 0, fail = 0;
function ok(cond, label){
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}

console.log('1) 소스 정적 검증');
ok(/var REPORT_ROOM_IDS\s*=/.test(src), 'REPORT_ROOM_IDS 정확 매핑 존재');
ok(src.includes("meat:['meat_evalution_room']"), 'meat → meat_evalution_room');
ok(src.includes("fish:['seafood_evalution_room']"), 'fish → seafood_evalution_room');
ok(src.includes("other:['grocery_eval']"), 'other → grocery_eval');
// 광범위 키워드가 REPORT_KW 에 다시 들어오면 버그 재발
const kwLine = (src.match(/var REPORT_KW=\{[^\n]*\}/) || [''])[0];
ok(kwLine !== '', 'REPORT_KW 라인 존재');
ok(!kwLine.includes("'평가'"), "REPORT_KW 에 광범위 키워드 '평가' 없음 (버그 원인)");
ok(!kwLine.includes("'기타'"), "REPORT_KW 에 광범위 키워드 '기타' 없음");
ok(/dm__/.test(src), '폴백 검색에서 1:1 DM 방 제외');

console.log('2) 라우팅 시뮬레이션 (dispatch.html 의 실제 var 를 추출해 실행)');
// dispatch.html 에서 두 var 정의를 그대로 뽑아 eval — 코드와 테스트가 어긋나지 않게.
const idsSrc = (src.match(/var REPORT_ROOM_IDS=\{[^\n]*\};/) || [''])[0];
const kwSrc  = (src.match(/var REPORT_KW=\{[^\n]*\};/) || [''])[0];
let REPORT_ROOM_IDS, REPORT_KW;
eval(idsSrc.replace('var REPORT_ROOM_IDS', 'REPORT_ROOM_IDS'));
eval(kwSrc.replace('var REPORT_KW', 'REPORT_KW'));

// reportToChat 의 방 선택 로직 복제 (dispatch.html 과 동일 동작)
function route(type, rooms){
  const wantIds = REPORT_ROOM_IDS[type] || REPORT_ROOM_IDS.other;
  const kws = REPORT_KW[type] || REPORT_KW.other;
  let roomId = null;
  for (let w = 0; w < wantIds.length; w++){ if (rooms[wantIds[w]]) { roomId = wantIds[w]; break; } }
  if (!roomId){
    Object.keys(rooms).forEach(function(rid){
      if (roomId || rid.indexOf('dm__') === 0) return;
      const nm = ((rooms[rid] && rooms[rid].name) || '').toLowerCase();
      for (let i = 0; i < kws.length; i++){ if (nm.indexOf(kws[i].toLowerCase()) >= 0){ roomId = rid; break; } }
    });
  }
  return roomId;
}

// Firebase 는 키 알파벳순 반환 — bakery_eval 이 grocery_eval 보다 앞 (버그 조건 재현)
const ROOMS = {
  bakery_eval: { name: '베이커리 평가' },
  closing: { name: '마감 보고' },
  'dm__ANA__DJ': { name: 'Ana 평가' },   // DM 방 이름에 키워드 있어도 제외돼야 함
  general: { name: '전체 공지' },
  grocery_eval: { name: '그로서리 평가' },
  kfood_eval: { name: 'K-FOOD 평가' },
  meat_evalution_room: { name: '정육 평가' },
  seafood_evalution_room: { name: '해산물 평가' },
  sushi: { name: '스시 평가' },
};
ok(route('other', ROOMS) === 'grocery_eval', "기타(other) → grocery_eval (버그였던 케이스: bakery_eval 금지)");
ok(route('meat', ROOMS) === 'meat_evalution_room', '고기(meat) → meat_evalution_room');
ok(route('fish', ROOMS) === 'seafood_evalution_room', '생선(fish) → seafood_evalution_room');
ok(route('other', ROOMS) !== 'bakery_eval', '기타 보고가 베이커리 평가방으로 가지 않음');

// 폴백: 정확 ID 방이 DB 에 없을 때 — 키워드로 찾되 '평가'만으로는 못 찾아야 함
const NO_ID_ROOMS = { bakery_eval: { name: '베이커리 평가' }, warehouse: { name: '그로서리 창고' } };
ok(route('other', NO_ID_ROOMS) === 'warehouse', '폴백: 그로서리 키워드 방 선택 (bakery_eval 아님)');
const ONLY_EVAL = { bakery_eval: { name: '베이커리 평가' } };
ok(route('other', ONLY_EVAL) === null, '매칭 방 없으면 null (아무 평가방에나 쏘지 않음)');

console.log('');
console.log(fail === 0 ? '🎉 전부 통과 (' + pass + ')' : '❌ 실패 ' + fail + '건 / 통과 ' + pass + '건');
process.exit(fail === 0 ? 0 : 1);
