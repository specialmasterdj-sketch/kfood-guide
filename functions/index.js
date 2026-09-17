// =============================================================================
// 🔔 KIMCHI MART 푸시 발송 서버 (Cloud Functions, 2026-08-30)
// chat/messages 에 새 메시지가 오면 → 받을 사람의 FCM 토큰(fcmTokens/<이름>)으로
// 푸시 발송. 앱이 완전히 종료된 폰에도 도착.
//
// 발송 규칙:
//   · 1:1 방(dm__A__B): 보낸 사람이 아닌 상대에게. 사장님(DJ/SUN KIM) 발신이면
//     제목 "👑 Owner's Message" — 즉시 반응 유도.
//   · managers 방: 오너에게만 발송 (사장님 지시 2026-08-30 — 오너 한테만).
//   · 그 외 방은 발송 안 함 (도배 방지).
// 배포: PUSH-SETUP.md 참조 (firebase deploy --only functions)
// =============================================================================
const { onValueCreated } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');
admin.initializeApp();

const OWNER_NAMES = ['DJ', 'SUN_KIM', 'SUNKIM', 'SUN(ACCOUNTING_DEP)_KIM'];
const norm = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_가-힣]/g, '').toUpperCase();
const isOwner = (n) => OWNER_NAMES.includes(norm(n));

exports.chatPush = onValueCreated(
  { ref: '/chat/messages/{roomId}/{msgId}', region: 'us-central1' },
  async (event) => {
    const roomId = event.params.roomId;
    const m = event.data.val();
    if (!m || !m.sender) return;
    const senderKey = norm(m.sender);

    // 받을 사람 결정
    let targets = [];   // normName 키 목록
    let title = '';
    if (roomId.startsWith('dm__')) {
      const parts = roomId.slice(4).split('__');
      targets = parts.filter((p) => p && p !== senderKey);
      title = isOwner(m.sender) ? "👑 Owner's Message" : '💬 ' + m.sender;
    } else if (roomId === 'managers') {
      targets = OWNER_NAMES.filter((n) => n !== senderKey);
      title = '👔 Managers: ' + m.sender;
    } else {
      return;   // 다른 방은 푸시 안 함 (도배 방지)
    }
    if (!targets.length) return;

    const body = String(m.text || '📷 사진').split('\n')[0].slice(0, 90);
    const db = admin.database();
    const sends = [];
    for (const t of targets) {
      const snap = await db.ref('fcmTokens/' + t).get().catch(() => null);
      const tokens = snap && snap.val() ? Object.keys(snap.val()) : [];
      for (const tok of tokens) {
        sends.push(
          admin.messaging().send({
            token: decodeURIComponent(tok),
            notification: { title, body },
            data: { url: './chat.html?room=' + roomId },
            webpush: { fcmOptions: { link: 'https://specialmasterdj-sketch.github.io/kfood-guide/chat.html?room=' + roomId } },
          }).catch((e) => {
            // 만료/무효 토큰 청소
            if (e && e.code && String(e.code).includes('registration-token')) {
              return db.ref('fcmTokens/' + t + '/' + tok).remove().catch(() => {});
            }
          })
        );
      }
    }
    await Promise.all(sends);
  }
);

// =============================================================================
// 🌐 개선 요청(ideas) 자동 번역 — 2026-09-14
// 직원이 올린 글을 한/영/스페인어로 번역해 ideas/{branch}/{id}/tr 에 붙인다.
// 히스패닉 직원 80% · 한국인 2% 라 원문 그대로 두면 서로 못 읽고,
// 그러면 "나도!" 투표(= 중복 신호)가 언어별로 갈려 기능의 의미가 없어진다.
//
// 설계 의도:
//   · 클라이언트가 아니라 RTDB 트리거 — API 키가 브라우저 근처에 가지 않는다.
//   · 글 저장 "후"에 붙는다. 번역이 실패해도 원문은 이미 저장돼 있어 안전.
//   · 작성 시 1회만. 읽을 때는 저장된 걸 쓰므로 조회는 공짜.
//   · 원문 언어는 번역하지 않고 그대로 넣는다 (토큰 낭비 방지).
//
// 비용: 글 1건당 약 $0.0014 (Haiku 4.5). 하루 20건이어도 월 $1 미만.
// 키: firebase functions:secrets:set ANTHROPIC_API_KEY  (Secret Manager)
// 배포: firebase deploy --only functions
// =============================================================================
const { defineSecret } = require('firebase-functions/params');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const LANG_NAME = { ko: 'Korean', en: 'English', es: 'Spanish' };

exports.ideaTranslate = onValueCreated(
  { ref: '/ideas/{branch}/{ideaId}', region: 'us-central1', secrets: [ANTHROPIC_API_KEY] },
  async (event) => {
    const rec = event.data.val();
    if (!rec || !rec.text) return;
    if (rec.tr) return;                        // 이미 번역됨 (재실행 방지)

    const text = String(rec.text).slice(0, 500);
    const src = ['ko', 'en', 'es'].includes(rec.lang) ? rec.lang : 'ko';
    const targets = ['ko', 'en', 'es'].filter((l) => l !== src);

    let out = null;
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const res = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system:
          'You translate short messages written by grocery store employees about problems ' +
          'they hit at work. Keep it plain and natural — the way a coworker would say it, ' +
          'not formal business writing. Keep store jargon (aisle numbers, product names, ' +
          'brand names, department names) as-is. Do not add, explain, or soften anything. ' +
          'Reply with ONLY a JSON object, no markdown fence, no commentary.',
        messages: [{
          role: 'user',
          content:
            'Translate this ' + LANG_NAME[src] + ' message into ' +
            targets.map((l) => LANG_NAME[l]).join(' and ') + '.\n' +
            'Reply as JSON with exactly these keys: ' + targets.map((l) => '"' + l + '"').join(', ') + '\n\n' +
            'Message:\n' + text,
        }],
      });
      const raw = (res.content || [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(raw);
      out = { [src]: text };
      for (const l of targets) {
        if (typeof parsed[l] === 'string' && parsed[l].trim()) out[l] = parsed[l].trim();
      }
      // 한 개도 못 건졌으면 저장하지 않는다 (원문만 남는 게 낫다)
      if (Object.keys(out).length < 2) out = null;
    } catch (e) {
      console.warn('[ideaTranslate] failed', event.params.branch, event.params.ideaId, e && e.message);
      return;                                   // 조용히 포기 — 원문은 그대로 살아 있다
    }

    if (!out) return;
    await admin.database()
      .ref('ideas/' + event.params.branch + '/' + event.params.ideaId + '/tr')
      .set(out)
      .catch((e) => console.warn('[ideaTranslate] save', e && e.message));
  }
);

// =============================================================================
// 🤖 매장 어시스턴트 — 직원 질문에 답하는 함수 (2026-09-14)
// 월마트 AX 사례 ②"업무 흐름에 녹아든 AI". 사장님 승인 2026-09-14.
//
// 직원이 모르는 게 생기면 매니저를 찾아야 하고, 매니저가 바쁘면 그냥 기다린다.
// 그 대기를 없애는 게 목적. 답은 "우리 데이터"로만 한다.
//
// 설계 원칙 (이게 전부):
//   1. 모르면 모른다고 한다. 데이터에 없는 걸 지어내면 직원이 그대로 따라 하고
//      돈이 틀어진다. 없으면 "매니저에게 물어보세요" 로 고정.
//   2. API 키는 서버에만. 클라이언트는 ID 토큰만 보낸다.
//   3. 본인 것만 본다. 남의 스케줄·다른 지점 업무는 컨텍스트에 넣지 않는다.
//   4. 쿼터·로그는 admin 권한으로 서버만 읽고 쓴다 → RTDB 규칙 추가 불필요.
//
// 1차 범위 (실제로 데이터가 있는 것만):
//   · 내 근무 일정      schedules/{지점}  (employees + shifts)
//   · 오늘 내 업무      tasks/{지점}/{날짜}
//   · 앱 36개 안내      아래 APP_GUIDE (정적)
//   ⚠️ 매대 위치는 헐리우드에만 데이터가 있어(floorplan/matdae-hollywood) 1차 제외.
//   ⚠️ 반품 등 업무 정책은 어디에도 문서화돼 있지 않아 답할 근거가 없다 → 모른다고 답함.
//
// 비용: 질문당 약 $0.005 (Haiku 4.5). 직원당 하루 20건 한도 + 콘솔 월 한도 $50.
// 배포: IDEAS-TRANSLATE-SETUP.md 와 같은 키를 쓴다 (ANTHROPIC_API_KEY).
// =============================================================================

const ASK_MODEL = 'claude-haiku-4-5';
const ASK_DAILY_LIMIT = 20;          // 직원 1인당 하루 질문 수
const ASK_MAX_LEN = 300;             // 질문 길이 상한

// 앱 안내 — "그 기능 어느 앱이지?" 를 없애기 위한 정적 지식.
// 앱을 추가하면 여기 한 줄 추가할 것.
const APP_GUIDE = [
  ['업무 지시 (tasks.html)', '오늘 내 업무 확인·완료 처리, 사진 보고, 개선 요청'],
  ['채팅 (chat.html)', '지점별 작업방·1:1 대화'],
  ['근무 스케줄 (shifts.html)', '주간 근무표 확인'],
  ['활동 순위 (leaderboard.html)', '개인·부서 점수와 순위'],
  ['온도 점검 (temp.html)', '냉장·냉동·핫푸드 온도 측정 기록'],
  ['가격표 감사 (price-audit.html)', '매대 QR 스캔 후 가격표 점검·수정 보고'],
  ['매대 관리 (store-map.html)', '통로·베이·냉동 진열대 배치와 고정 진열 (헐리우드)'],
  ['음성 재고 (voice-stock.html)', '말로 재고 기록 — "양파 3박스" 식'],
  ['재고 확인 (stock-check.html)', '부서별 재고 점검표'],
  ['입고 검수 (receiving-scan.html)', '입고 물품 스캔 검수'],
  ['유통기한 (expiry.html)', '유통기한 임박 상품 관리'],
  ['상품 조회 (lookup.html)', '상품명·바코드·가격 검색'],
  ['바코드 복원 (barcode-fix.html)', '끊긴 바코드 자동 완성'],
  ['가격 비교 (kimchi-price-compare.html)', '인보이스 원가와 POS 판매가 비교'],
  ['인보이스 → 엑셀 (invoice-to-excel.html)', '인보이스 PDF 를 엑셀로 변환'],
  ['벤더 주문 (vendor-order-center.html)', '벤더별 발주'],
  ['지출 기록 (expense-log.html)', '지출 내역 입력'],
  ['급여 (payroll.html)', '급여 확인 — 오너·매니저 이상만'],
  ['공지 (updates.html)', '전사 공지 읽기'],
  ['화장실 점검 (bathroom-schedule.html)', '화장실 청소 점검표'],
  ['부서 점검 (dept-check.html)', '부서별 체크리스트'],
  ['직원 전화 (staff-phones.html)', '직원 연락처·사전 등록'],
];

const ASK_SYSTEM = [
  'You are the in-store assistant for Kimchi Mart, a Korean grocery chain in South Florida.',
  'You answer questions from store employees (cashiers, stockers, department staff, supervisors).',
  '',
  'ABSOLUTE RULE — never invent an answer.',
  'You may ONLY use the facts in <context>. If the answer is not there, say you do not know',
  'and tell them to ask their manager. Do NOT guess at return policies, prices, discounts,',
  'product locations, procedures, or anything else that is not in the context.',
  'A confidently wrong answer costs the store real money. "I don\'t know, ask your manager"',
  'is always the correct fallback.',
  '',
  'Style: short and plain. Two or three sentences is usually enough. Talk like a helpful',
  'coworker, not a manual. No bullet lists unless you are listing several items.',
  'Write PLAIN TEXT only — no markdown. The app shows your answer as-is, so **bold**',
  'and *italics* just show up as literal asterisks. Use a plain dash for list items.',
  'Answer in the SAME language the employee wrote in (Korean, English, or Spanish).',
  '',
  'You know only about this store chain. If asked something unrelated to work, say briefly',
  'that you only help with store work.',
].join('\n');

// ---- 컨텍스트 수집 -----------------------------------------------------------
function ymd(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function normName(s){ return String(s||'').trim().replace(/\s+/g,' ').toUpperCase(); }

// 내 근무 — 오늘부터 7일. 남의 근무는 넣지 않는다.
async function myShifts(db, branch, myName){
  try {
    const snap = await db.ref('schedules/' + branch).get();
    const d = snap.val();
    if (!d || !d.employees || !d.shifts) return null;
    const emps = Array.isArray(d.employees) ? d.employees : Object.values(d.employees);
    const me = emps.find((e) => e && normName(e.name) === normName(myName));
    if (!me) return null;
    const out = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const dt = new Date(today.getTime() + i*86400000);
      const key = me.id + '@' + ymd(dt);
      const sh = d.shifts[key];
      if (!sh || sh._draft) continue;
      const day = ['일','월','화','수','목','금','토'][dt.getDay()];
      if (sh.unavail) out.push(ymd(dt) + '(' + day + ') 근무 없음');
      else out.push(ymd(dt) + '(' + day + ') ' + (sh.start||'?') + '~' + (sh.end||'?') +
                    (sh.position ? ' / ' + sh.position : '') + (sh.note ? ' / ' + sh.note : ''));
    }
    return out.length ? out : null;
  } catch (e) { console.warn('[ask] myShifts', e && e.message); return null; }
}

// 오늘 내 업무 — 본인에게 배정됐거나 전체 대상인 것만.
async function myTasks(db, branch, myName){
  try {
    const snap = await db.ref('tasks/' + branch + '/' + ymd(new Date())).get();
    const d = snap.val();
    if (!d) return null;
    const mine = [];
    for (const id of Object.keys(d)) {
      const t = d[id];
      if (!t || !t.name) continue;
      const to = normName(t.assignee || t.to || '');
      if (to && to !== normName(myName)) continue;      // 남에게 배정된 건 제외
      const done = !!t.completedAt;
      mine.push((done ? '[완료] ' : '[미완료] ') + String(t.name).slice(0, 70));
      if (mine.length >= 25) break;
    }
    return mine.length ? mine : null;
  } catch (e) { console.warn('[ask] myTasks', e && e.message); return null; }
}

// 한국어·스페인어로 물어도 영어 상품명에 걸리게 하는 최소 사전.
// 상품명은 전부 영어 대문자인데(HSE TOFU FIRM LARGE) 직원은 "두부 어디 있어?",
// "donde esta la cebolla?" 로 묻는다. 완전한 번역 사전은 없어도 되고, 한인마트에서
// 실제로 많이 찾는 것만 있으면 된다 — 없으면 "모른다"로 떨어지니 위험하지도 않다.
// 빠진 낱말은 aiLog 를 보고 채운다.
const ASK_GLOSSARY = {
  // 두부·콩
  '두부':['tofu'], '순두부':['tofu'], '유부':['fried','tofu'], '콩나물':['bean','sprout'],
  '두유':['soy','milk'], '된장':['soybean','paste','doenjang'], '고추장':['gochujang','pepper','paste'],
  '간장':['soy','sauce'], '쌈장':['ssamjang'],
  // 김치·반찬
  '김치':['kimchi'], '깍두기':['kkakdugi','radish'], '단무지':['pickled','radish'],
  '김':['seaweed','laver','gim'], '미역':['seaweed','wakame'], '멸치':['anchovy'],
  // 채소
  '양파':['onion'], '마늘':['garlic'], '파':['green','onion','scallion'], '대파':['green','onion'],
  '배추':['cabbage','napa'], '무':['radish','daikon'], '오이':['cucumber'], '당근':['carrot'],
  '감자':['potato'], '고구마':['sweet','potato'], '호박':['squash','zucchini'], '버섯':['mushroom'],
  '고추':['pepper','chili'], '상추':['lettuce'], '시금치':['spinach'], '깻잎':['perilla'],
  // 고기·해산물
  '소고기':['beef'], '쇠고기':['beef'], '차돌':['brisket','chadol'], '갈비':['galbi','rib'],
  '불고기':['bulgogi'], '돼지':['pork'], '돼지고기':['pork'], '삼겹살':['pork','belly'],
  '닭':['chicken'], '닭고기':['chicken'], '계란':['egg'], '달걀':['egg'],
  '새우':['shrimp'], '생선':['fish'], '오징어':['squid'], '고등어':['mackerel'], '연어':['salmon'],
  // 곡물·면
  '쌀':['rice'], '현미':['brown','rice'], '라면':['ramen','noodle'], '국수':['noodle'],
  '당면':['glass','noodle','vermicelli'], '떡':['rice','cake','tteok'], '만두':['dumpling'],
  '밀가루':['flour'], '빵':['bread'],
  // 양념·기름
  '참기름':['sesame','oil'], '식용유':['oil'], '설탕':['sugar'], '소금':['salt'],
  '식초':['vinegar'], '후추':['pepper'], '깨':['sesame'],
  // 유제품·음료
  '우유':['milk'], '치즈':['cheese'], '버터':['butter'], '요구르트':['yogurt'],
  '물':['water'], '주스':['juice'], '커피':['coffee'], '차':['tea'],
  '맥주':['beer'], '소주':['soju'], '막걸리':['makgeolli'], '와인':['wine'],
  // 기타
  '어묵':['fish','cake'], '스팸':['spam'], '참치':['tuna'], '아이스크림':['ice','cream'],
  '과자':['snack','cracker'], '사과':['apple'], '바나나':['banana'], '딸기':['strawberry'],

  // ---- 스페인어 (직원 다수) ----
  'cebolla':['onion'], 'ajo':['garlic'], 'arroz':['rice'], 'pollo':['chicken'],
  'carne':['beef','meat'], 'res':['beef'], 'cerdo':['pork'], 'puerco':['pork'],
  'leche':['milk'], 'huevo':['egg'], 'huevos':['egg'], 'pan':['bread'], 'queso':['cheese'],
  'aceite':['oil'], 'azucar':['sugar'], 'sal':['salt'], 'vinagre':['vinegar'],
  'camaron':['shrimp'], 'camarones':['shrimp'], 'pescado':['fish'], 'atun':['tuna'],
  'fideos':['noodle'], 'tallarines':['noodle'], 'papa':['potato'], 'papas':['potato'],
  'zanahoria':['carrot'], 'pepino':['cucumber'], 'lechuga':['lettuce'], 'repollo':['cabbage'],
  'hongo':['mushroom'], 'hongos':['mushroom'], 'manzana':['apple'], 'platano':['banana'],
  'cerveza':['beer'], 'vino':['wine'], 'agua':['water'], 'jugo':['juice'], 'cafe':['coffee'],
  'mantequilla':['butter'], 'helado':['ice','cream'], 'harina':['flour'], 'salsa':['sauce'],
  'frijol':['bean'], 'frijoles':['bean'], 'maiz':['corn'], 'pimiento':['pepper'],
};
function glossaryHits(term){
  if (ASK_GLOSSARY[term]) return ASK_GLOSSARY[term];
  // 한국어는 조사가 붙는다("두부가", "양파는") — 사전 낱말로 시작하면 같은 것으로 본다.
  for (const k of Object.keys(ASK_GLOSSARY)) {
    if (k.length >= 2 && term.indexOf(k) === 0) return ASK_GLOSSARY[k];
  }
  return null;
}

// ---- 질문에서 검색어 뽑기 -----------------------------------------------------
// 상품명은 영어 대문자("HSE TOFU FIRM LARGE 4PC 19OZ")인데 직원은 한국어·스페인어로
// 묻는다. 완전한 번역 사전은 없으므로 ① 질문에 든 낱말을 그대로 상품명에서 찾고
// ② 음성재고가 쌓아 둔 한국어→영어 별칭(inventory/voiceAlias)으로 한 번 더 찾는다.
// 못 찾으면 아무것도 넣지 않는다 — 억지로 끼워 넣으면 엉뚱한 상품을 답하게 된다.
const ASK_STOP = new Set([
  '어디','있어','있나','있어요','뭐','무엇','얼마나','남았','남았어','언제','유통기한',
  '재고','매대','위치','알려줘','알려','주세요','오늘','내일','지금','개수','수량',
  'where','is','are','the','a','an','how','many','much','what','when','left','stock',
  'location','shelf','expire','expiry','date','today','tomorrow','my','me','do','does',
  'donde','esta','estan','cuanto','cuantos','hay','que','el','la','los','las','de','en',
  'fecha','caducidad','ubicacion','estante','hoy','manana',
]);
function askTerms(q){
  const raw = String(q || '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    if (w.length < 2 || ASK_STOP.has(w)) continue;
    if (out.indexOf(w) < 0) out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}
// 한국어로 물으면 영어 상품명에 안 걸린다. 음성재고 별칭이 유일하게 있는 다리라
// 그걸 태워 검색어를 넓힌다 (별칭은 작아서 통째로 읽어도 부담 없다).
async function expandTerms(db, terms){
  if (!terms.length) return terms;
  const out = terms.slice();
  for (const t of terms) {
    const g = glossaryHits(t);
    if (g) for (const w of g) if (out.indexOf(w) < 0) out.push(w);
  }
  try {
    const al = (await db.ref('inventory/voiceAlias').get()).val() || {};
    for (const dept of Object.keys(al)) {
      const m = al[dept] || {};
      for (const k of Object.keys(m)) {
        const from = String(k || '').toLowerCase();
        if (!terms.some((t) => from.indexOf(t) >= 0)) continue;
        const to = String((m[k] && m[k].t) || '').toLowerCase();
        for (const w of to.split(/[^0-9a-z가-힣]+/)) {
          if (w.length >= 2 && out.indexOf(w) < 0) out.push(w);
        }
      }
    }
  } catch (e) { console.warn('[ask] alias', e && e.message); }
  return out.slice(0, 12);
}
function hitsTerms(name, terms){
  if (!terms.length) return false;
  const n = String(name || '').toLowerCase();
  return terms.some((t) => n.indexOf(t) >= 0);
}
// 오너·임원은 branch 가 '*' 라 지점 자료를 못 고른다. 본사가 있는 헐리우드를 기본으로
// 삼되, 어느 지점 자료인지 컨텍스트에 밝혀 오해가 없게 한다.
function branchFor(profile){
  const b = profile && profile.branch;
  return (!b || b === '*') ? 'HOLLYWOOD' : b;
}

// ---- 유통기한: 임박 목록 + 질문에 걸린 상품 ------------------------------------
// 한 번만 읽어서 둘 다 만든다 (지점당 수백 건이라 두 번 읽을 이유가 없다).
// bay 는 유통기한 앱에서 찍은 매대 위치 — "그 상품 어디 있어?" 의 유일한 근거다.
async function expiryInfo(db, branch, terms){
  const res = { soon: null, hits: null, total: 0 };
  try {
    const d = (await db.ref('expiry/' + branch + '/products').get()).val();
    if (!d) return res;
    const today = ymd(new Date());
    const cut = ymd(new Date(Date.now() + 14 * 86400000));
    const rows = [];
    for (const id of Object.keys(d)) {
      const p = d[id];
      if (!p || !p.name) continue;
      if (p.status && p.status !== 'active') continue;
      rows.push(p);
    }
    res.total = rows.length;
    const line = (p) => {
      const bits = [String(p.name).slice(0, 60)];
      if (p.expiry) bits.push('유통기한 ' + p.expiry + (p.expiry < today ? ' (지남)' : ''));
      bits.push('수량 ' + (p.qty != null ? p.qty : 1));
      if (p.bay) bits.push('매대 ' + p.bay);
      return '- ' + bits.join(' | ');
    };
    const soon = rows.filter((p) => p.expiry && p.expiry <= cut)
                     .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)))
                     .slice(0, 20);
    if (soon.length) res.soon = soon.map(line);
    const hits = rows.filter((p) => hitsTerms(p.name, terms)).slice(0, 8);
    if (hits.length) res.hits = hits.map(line);
  } catch (e) { console.warn('[ask] expiryInfo', e && e.message); }
  return res;
}

// ---- 헐리우드 매대: 지금 품절로 보고된 자리 ------------------------------------
async function oosInfo(db, branch, terms){
  const res = { count: 0, hits: null };
  if (branch !== 'HOLLYWOOD') return res;          // 도면이 헐리우드에만 있다
  try {
    const d = (await db.ref('floorplan/matdae-hollywood/outOfStock').get()).val();
    if (!d) return res;
    const rows = Object.keys(d).map((k) => d[k]).filter((r) => r && r.name);
    res.count = rows.length;
    const hits = rows.filter((r) => hitsTerms(r.name, terms))
                     .sort((a, b) => (b.ts || 0) - (a.ts || 0))
                     .slice(0, 8);
    if (hits.length) {
      res.hits = hits.map((r) => '- ' + String(r.name).slice(0, 60) +
        ' | 매대 ' + (r.bay || '?') +
        ' | ' + (r.qty === 0 ? '품절' : ('남은 수량 ' + r.qty)) +
        ' | 보고 ' + (r.at || ''));
    }
  } catch (e) { console.warn('[ask] oosInfo', e && e.message); }
  return res;
}

// ---- 음성 재고: 마지막으로 센 수량 ---------------------------------------------
// ⚠️ 날짜를 반드시 함께 준다. 음성재고 앱이 거의 안 쓰여 자료가 몇 달씩 묵는데,
//    이걸 현재 재고로 오해하면 발주가 틀어진다.
async function countsInfo(db, branch, terms){
  const res = { date: null, hits: null };
  if (!terms.length) return res;
  try {
    const snap = await db.ref('inventory/voice/' + branch).orderByKey().limitToLast(1).get();
    const byDate = snap.val();
    if (!byDate) return res;
    const date = Object.keys(byDate)[0];
    res.date = date;
    const rows = [];
    const depts = byDate[date] || {};
    for (const dept of Object.keys(depts)) {
      const recs = depts[dept] || {};
      for (const id of Object.keys(recs)) {
        const r = recs[id];
        if (r && r.item && hitsTerms(r.item, terms)) {
          rows.push('- ' + String(r.item).slice(0, 60) + ' | ' + r.qty + ' ' + (r.unit || '') +
                    ' | 부서 ' + dept);
        }
      }
      if (rows.length >= 8) break;
    }
    if (rows.length) res.hits = rows.slice(0, 8);
  } catch (e) { console.warn('[ask] countsInfo', e && e.message); }
  return res;
}

// 네 가지를 한꺼번에 — 서로 독립이라 같이 읽는다.
async function gatherExtra(db, branch, q){
  const base = askTerms(q);
  const terms = await expandTerms(db, base);
  const [exp, oos, cnt] = await Promise.all([
    expiryInfo(db, branch, terms),
    oosInfo(db, branch, terms),
    countsInfo(db, branch, terms),
  ]);
  return { branch, terms, exp, oos, cnt };
}

function buildContext(profile, shifts, tasks, extra){
  const now = new Date();
  const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const parts = [];
  parts.push('## Who is asking');
  parts.push('Name: ' + profile.name + ' | Store: ' + profile.branch + ' | Role: ' + (profile.role || '(not set)'));
  parts.push('Today: ' + ymd(now) + ' (' + day + ')');
  if (extra && extra.branch && extra.branch !== profile.branch) {
    parts.push('Store data below is for ' + extra.branch + ' (they cover all stores, so we default to the HQ store).');
  }
  parts.push('');
  parts.push('## Their work schedule (next 7 days)');
  parts.push(shifts ? shifts.join('\n') : '(no schedule found for this person — tell them to check with their manager)');
  parts.push('');
  parts.push('## Their tasks today');
  parts.push(tasks ? tasks.join('\n') : '(no tasks assigned to them today)');

  const e = extra || {};
  const exp = e.exp || {}, oos = e.oos || {}, cnt = e.cnt || {};

  // 유통기한 임박 — 질문과 상관없이 늘 넣는다. 가장 자주 묻고 가장 돈이 걸린 것.
  parts.push('');
  parts.push('## Items expiring within 14 days (' + (e.branch || '') + ')');
  if (exp.soon) {
    parts.push(exp.soon.join('\n'));
    parts.push('(Registered in the expiry app. ' + exp.total + ' items tracked in total.)');
  } else {
    parts.push('(none registered as expiring soon)');
  }

  // 질문에 걸린 상품 — 위치·유통기한·수량이 여기 다 들어 있다.
  if (exp.hits) {
    parts.push('');
    parts.push('## Products matching their question');
    parts.push(exp.hits.join('\n'));
    parts.push('The shelf location code looks like R4-D03. In Korean call it 매대 (never 매체);');
    parts.push('in Spanish, estante. It comes from the expiry app,');
    parts.push('so it is where that item was last registered — good enough to send someone to,');
    parts.push('but say it may have moved.');
  }

  // 헐리우드 품절 보고
  if (oos.count) {
    parts.push('');
    parts.push('## Out-of-stock reports right now (Hollywood shelves)');
    parts.push(oos.count + ' spots are reported empty or low.');
    if (oos.hits) parts.push(oos.hits.join('\n'));
  }

  // 음성 재고 — 날짜를 반드시 붙여 말하게 한다.
  if (cnt.hits) {
    parts.push('');
    parts.push('## Last counted quantities');
    parts.push('These were counted on ' + cnt.date + ' with the voice-stock app. This may be old.');
    parts.push('ALWAYS say the count date when you use these numbers. Never present them as');
    parts.push('current stock on hand.');
    parts.push(cnt.hits.join('\n'));
  }

  parts.push('');
  parts.push('## Which app does what');
  parts.push(APP_GUIDE.map((a) => '- ' + a[0] + ' — ' + a[1]).join('\n'));
  parts.push('');
  parts.push('## Not available');
  parts.push('You do NOT have: prices, discounts, return/exchange policy, other people\'s');
  parts.push('schedules, other stores\' data, or any product that is not listed above.');
  parts.push('Shelf locations exist ONLY for items registered in the expiry app — if an item');
  parts.push('is not in the lists above, you do not know where it is. Say so and tell them to');
  parts.push('ask a manager. Never guess an aisle or bay code.');
  return parts.join('\n');
}

// ---- 함수 본체 ---------------------------------------------------------------
// 🔁 2026-09-17 HTTPS → DB 트리거로 전환.
//   조직 정책 'Domain Restricted Sharing'(constraints/iam.allowedPolicyMemberDomains)이
//   Cloud Run 의 allUsers 호출 허용을 막아서, 공개 HTTPS 함수를 아예 쓸 수 없다.
//   정책을 푸는 쪽(= 이 프로젝트의 어떤 자원이든 외부 공개가 가능해짐)은 5개 매장
//   데이터가 걸린 곳이라 택하지 않았다. 대신 chatPush·ideaTranslate 와 같은
//   "DB 쓰기에 반응하는" 구조로 바꾼다 — 공개 엔드포인트가 생기지 않는다.
//
//   흐름: 직원이 aiAsk/{uid}/{askId} 에 {q, ts} 를 쓴다
//        → 이 함수가 같은 노드의 a (실패면 err) 에 답을 쓴다
//        → 직원 화면이 그 노드를 잠깐 폴링해 답을 띄운다.
//
//   uid 는 경로에서 온다. 남의 uid 로 쓰는 것은 RTDB 규칙이 막는다
//   (aiAsk/$uid 는 auth.uid === $uid 만 읽고 쓸 수 있음).
//   a·err·used 는 규칙의 $other validate:false 로 클라이언트가 못 쓴다 →
//   직원이 답을 위조할 수 없다. 함수는 admin 이라 규칙을 지나친다.
exports.aiAskAnswer = onValueCreated(
  { ref: '/aiAsk/{uid}/{askId}', region: 'us-central1', secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 120, memory: '512MiB' },
  async (event) => {
    const uid = event.params.uid;
    const askId = event.params.askId;
    const rec = event.data.val();
    if (!rec || rec.a || rec.err) return;          // 빈 노드 / 이미 처리됨
    console.log('[ask] 1 start', uid, askId);

    const db = admin.database();
    const node = db.ref('aiAsk/' + uid + '/' + askId);
    const fail = (code) => node.child('err').set(code).catch(() => {});

    const q = String(rec.q || '').trim().slice(0, ASK_MAX_LEN);
    if (!q) { await fail('empty'); return; }

    // 1) 승인된 직원인지 + 프로필 (규칙이 이미 막지만 서버에서 한 번 더 본다)
    let profile;
    try {
      const u = (await db.ref('users/' + uid).get()).val();
      if (!u || u.status !== 'approved') { await fail('not_approved'); return; }
      profile = { name: u.name || '', branch: u.branch || '', role: u.role || '' };
      console.log('[ask] 2 profile', profile.name, profile.branch);
      if (!profile.name) { await fail('no_name'); return; }
    } catch (e) {
      console.error('[ask] profile', e && e.message);
      await fail('fail'); return;
    }

    // 2) 하루 한도 — admin 권한이라 규칙 없이 서버만 읽고 쓴다
    const qKey = 'aiQuota/' + ymd(new Date()) + '/' + uid;
    let used = 0;
    try {
      const tx = await db.ref(qKey).transaction((cur) => (cur || 0) + 1);
      used = (tx.snapshot && tx.snapshot.val()) || 1;
    } catch (e) { console.warn('[ask] quota', e && e.message); }
    console.log('[ask] 3 quota', used);
    if (used > ASK_DAILY_LIMIT) {
      await node.update({ err: 'quota', limit: ASK_DAILY_LIMIT }).catch(() => {});
      return;
    }

    // 3) 컨텍스트 — 본인 지점·본인 것만
    let context;
    try {
      const branch = branchFor(profile);
      const [shifts, tasks, extra] = await Promise.all([
        myShifts(db, profile.branch, profile.name),
        myTasks(db, profile.branch, profile.name),
        gatherExtra(db, branch, q),          // 유통기한·매대 위치·품절·마지막 재고
      ]);
      context = buildContext(profile, shifts, tasks, extra);
      console.log('[ask] 4 context', context.length, 'chars');
    } catch (e) {
      console.error('[ask] context', e && e.message);
      await fail('fail'); return;
    }

    // 4) Claude
    let answer = '';
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const k = ANTHROPIC_API_KEY.value();
      console.log('[ask] 5 key len', k ? k.length : 0);
      const client = new Anthropic({ apiKey: k });
      const r = await client.messages.create({
        model: ASK_MODEL,
        max_tokens: 600,
        system: ASK_SYSTEM,
        messages: [{ role: 'user', content: '<context>\n' + context + '\n</context>\n\nQuestion: ' + q }],
      });
      answer = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    } catch (e) {
      console.error('[ask] anthropic', e && e.message);
      // 실패 이유를 노드에 같이 남긴다 — 로그 조회가 막혀도 원인이 보인다.
      await node.update({ err: 'upstream', msg: String((e && e.message) || e).slice(0, 250) }).catch(function(){});
      return;
    }
    console.log('[ask] 6 answer', answer.length, 'chars');
    if (!answer) { await fail('empty_answer'); return; }

    await node.update({ a: answer, used, limit: ASK_DAILY_LIMIT })
      .catch((e) => console.error('[ask] save', e && e.message));

    // 5) 로그 — 무엇을 많이 묻는지가 다음 개발 우선순위가 된다
    db.ref('aiLog').push({
      uid, name: profile.name, branch: profile.branch,
      q, a: answer.slice(0, 500), ts: Date.now(),
    }).catch(() => {});

    // 6) 우편함 정리 — 기록은 aiLog 에 남으므로 여기 쌓아둘 이유가 없다.
    try {
      const cut = Date.now() - 24 * 3600 * 1000;
      const old = await db.ref('aiAsk/' + uid).orderByChild('ts').endAt(cut).limitToFirst(50).get();
      const upd = {};
      old.forEach((c) => { if (c.key !== askId) upd[c.key] = null; });
      if (Object.keys(upd).length) await db.ref('aiAsk/' + uid).update(upd);
    } catch (e) { console.warn('[ask] trim', e && e.message); }
  }
);
