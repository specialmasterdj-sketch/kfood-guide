// 상품조회(lookup.html) POS 업로드 검증 — 2026-11-21
// 사건: POS 목록이 9만 줄(약 15MB)을 넘자 "저장 실패 (용량 초과 가능) … exceeded the quota" 가 뜨고
//       클라우드에도 올라가지 않았다. localStorage 저장 실패에서 그대로 return 했기 때문.
// 기대: ① 이 기기 캐시가 넘쳐도 멈추지 않는다 ② 나눠 올린 묶음을 합치면 원본과 똑같다
//       ③ VELA 머리말(CODE,CATGRY,NAME,PRICE,PLU,ITM#,VENDOR,VDCODE,COST)을 제대로 읽는다
// lookup.html 에서 함수를 그대로 꺼내 쓴다 (복사본이 낡는 일을 막으려고).
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'lookup.html'), 'utf8');

function grab(name){
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('lookup.html 에 ' + name + ' 함수가 없습니다');
  let i = html.indexOf('{', html.indexOf(')', start)), depth = 0;
  for (; i < html.length; i++){
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(name + ' 끝을 못 찾음');
}
const BRANCHES = [{ id:'MIAMI', ko:'마이애미', en:'Miami' }, { id:'HOLLYWOOD', ko:'할리우드', en:'Hollywood' }];
const quiet = { warn(){}, info(){}, log(){} };
const api = new Function('BRANCHES', 'console',
  ['kmSaveOverrideLocal', 'kmChunkRows', 'autoMapColumns', 'mapRowToProduct', 'kmSnapshotTruncated'].map(grab).join('\n') +
  '\nreturn { kmSaveOverrideLocal, kmChunkRows, autoMapColumns, mapRowToProduct, kmSnapshotTruncated };')(BRANCHES, quiet);

let fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? '✅' : '❌') + ' ' + name + (ok ? '' : ' — 받은 값: ' + JSON.stringify(got) + ' / 기대: ' + JSON.stringify(want)));
}

// ── 시나리오 1: 용량 초과 — 예외를 던지지 않고 false, 낡은 캐시는 지운다 ──
const full = {
  data: { k: '옛 자료' },
  setItem(){ const e = new Error("Setting the value of 'k' exceeded the quota."); e.name = 'QuotaExceededError'; throw e; },
  removeItem(k){ delete this.data[k]; },
};
let threw = false, r1;
try { r1 = api.kmSaveOverrideLocal('k', { rows: [1, 2, 3] }, full); } catch(e){ threw = true; }
check('용량 초과여도 예외 없이 계속 진행', threw, false);
check('용량 초과면 false 를 돌려준다', r1, false);
check('용량 초과 때 낡은 캐시는 지운다', 'k' in full.data, false);

// ── 시나리오 2: 용량이 넉넉하면 그대로 저장 ──
const roomy = { data: {}, setItem(k, v){ this.data[k] = v; }, removeItem(k){ delete this.data[k]; } };
check('넉넉하면 true', api.kmSaveOverrideLocal('k', { count: 2 }, roomy), true);
check('넉넉하면 내용이 저장된다', roomy.data.k, '{"count":2}');

// ── 시나리오 3: 9만 8천 줄을 5,000줄씩 — 합치면 원본과 같고 줄번호가 0 부터 이어진다 ──
const rows = Array.from({ length: 98365 }, (_, i) => ({ CODE: 'C' + i }));
const parts = api.kmChunkRows(rows, 5000);
check('묶음 수 (98,365줄 ÷ 5,000)', parts.length, 20);
check('묶음 하나는 5,000줄을 넘지 않는다', Math.max(...parts.map(p => Object.keys(p).length)), 5000);
const merged = Object.assign({}, ...parts);
const keys = Object.keys(merged);
check('합친 줄 수가 원본과 같다', keys.length, rows.length);
check('줄번호가 0 부터 빠짐없이 이어진다', keys.every((k, i) => +k === i), true);
check('줄 내용이 제자리에 있다', [merged[0].CODE, merged[4999].CODE, merged[5000].CODE, merged[98364].CODE], ['C0', 'C4999', 'C5000', 'C98364']);
check('빈 목록이면 묶음 없음', api.kmChunkRows([], 5000).length, 0);
check('딱 떨어지는 줄 수', api.kmChunkRows(rows.slice(0, 10000), 5000).length, 2);

// ── 시나리오 4: 올라가는 도중(일부 묶음만 도착)에는 다른 기기가 받지 않는다 ──
const meta = { count: rows.length };
check('묶음 3개만 도착 → 덜 올라온 목록으로 본다', api.kmSnapshotTruncated(meta, Object.values(Object.assign({}, ...parts.slice(0, 3)))), true);
check('전부 도착 → 받는다', api.kmSnapshotTruncated(meta, Object.values(merged)), false);

// ── 시나리오 5: VELA EXPORT DATA 머리말 ──
const headers = ['CODE', 'CATGRY', 'NAME', 'PRICE', 'PLU', 'ITM#', 'VENDOR', 'VDCODE', 'PRC TYP', 'COST', 'DCRULE', '__EMPTY'];
const km = api.autoMapColumns(headers);
check('CODE 컬럼', km.CODE, 'CODE');
check('CATGRY → 카테고리', km.CATEGORY, 'CATGRY');
check('ITM# → 아이템번호', km.ITEM_NUMBER, 'ITM#');
check('VDCODE → 벤더코드', km.VENDOR_CODE, 'VDCODE');
const p = api.mapRowToProduct({ CODE: '0880913028094', CATGRY: 'SNACKS (F)', NAME: 'TEST', PRICE: '3.99', PLU: '', 'ITM#': '09462K', VENDOR: 'HANMI', VDCODE: 'H1', COST: '2.10' }, km);
check('한 줄 변환', [p.CODE, p.CATEGORY, p.NAME, p.PRICE, p.COST, p.VENDOR, p.ITEM_NUMBER, p.VENDOR_CODE],
      ['0880913028094', 'SNACKS (F)', 'TEST', 3.99, 2.1, 'HANMI', '09462K', 'H1']);
const p2 = api.mapRowToProduct({ CODE: '123', CATGRY: 'X', NAME: 'N', PRICE: 1, 'ITM#': '', VDCODE: '' }, km);
check('빈 아이템번호·벤더코드는 붙이지 않는다', ['ITEM_NUMBER' in p2, 'VENDOR_CODE' in p2], [false, false]);

if (fail){ console.error('\n💥 ' + fail + '건 실패'); process.exit(1); }
console.log('\n🎉 상품조회 업로드 검증 전체 통과');
