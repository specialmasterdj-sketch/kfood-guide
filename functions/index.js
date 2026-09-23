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
const { onValueCreated, onValueWritten } = require('firebase-functions/v2/database');
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
  // 💲 원가·벤더 질문 낱말 (2026-09-19)
  '얼마','얼마야','얼마에','원가','원가가','원가는','가격','가격은','벤더','밴더','벤더는','밴더는','어디서','어느',
  '들어와','들어오','들어오는지','들어와요','들어오나','들어','와','사와','사','들여와','공급','싼','싸','싸게','제일',
  'cost','price','vendor','from','who','sells','supplier','cheapest','cheaper','buy','which',
  'precio','costo','proveedor','quien','vende','barato','mas',
]);
const ASK_STOP_KO = Array.from(ASK_STOP).filter((w) => w.length >= 2 && /[가-힣]/.test(w));
function askTerms(q){
  const raw = String(q || '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    if (w.length < 2 || ASK_STOP.has(w)) continue;
    // 한국어는 조사가 붙는다(벤더에서·원가는) — 멈춤말로 시작하면 같은 멈춤말로 본다
    if (/[가-힣]/.test(w) && ASK_STOP_KO.some((sw) => w.indexOf(sw) === 0)) continue;
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

// ---- 사진에서 읽어낸 매대 상품 (bayIndex 가 만든 목록) --------------------------
// 유통기한 앱의 bay 는 "등록된 상품"만 커버한다. 이건 그 자리에 실제로 진열된 것
// 전부가 대상이라 훨씬 넓고, 포장지 한국어가 그대로 들어 있어 한국어 질문에도
// 사전 없이 걸린다. 다만 AI 가 사진에서 읽은 것이라 틀린 이름이 섞인다 →
// "사진으로 확인한 것"이라고 밝히고, 확실치 않으면 그렇게 말하도록 한다.
async function bayItemInfo(db, branch, terms){
  const res = { hits: null, bays: 0 };
  if (branch !== 'HOLLYWOOD' || !terms.length) return res;   // 도면이 헐리우드에만 있다
  try {
    const d = (await db.ref('floorplan/matdae-hollywood/bayItems').get()).val();
    if (!d) return res;
    const found = [];
    for (const bayId of Object.keys(d)) {
      const rec = d[bayId];
      if (!rec || !rec.items) continue;
      res.bays++;
      for (const it of rec.items) {
        const hay = String((it && it.n) || '') + ' ' + String((it && it.e) || '');
        if (hitsTerms(hay, terms)) {
          found.push('- ' + String(it.n).slice(0, 60) +
                     (it.e ? ' (' + String(it.e).slice(0, 40) + ')' : '') +
                     ' | 매대 ' + bayId);
          break;                       // 한 자리에서 한 줄이면 충분하다
        }
      }
      if (found.length >= 10) break;
    }
    if (found.length) res.hits = found;
  } catch (e) { console.warn('[ask] bayItemInfo', e && e.message); }
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

// ---- 💲 원가·벤더 — 매니저 이상만 (2026-09-19 전무님 지시) --------------------
// "여기서 매니저 급들에게만 제품을 물어보면 어느 벤더에서 얼마에 들어오는지."
// 원가는 돈이 걸린 민감 정보라 **서버에서** 거른다 — 매니저가 아니면 원가 자료를
// 컨텍스트에 아예 넣지 않는다(프롬프트로 "말하지 마"라고만 하면 새어 나갈 수 있다).
// 매니저 판정은 채팅 매니저 룸과 같은 기준(슈퍼바이저·직원 제외, 임원 이름 인정).
//   근거 ① products/{지점} — pos-cost-filter 가 올린 벨라포스 스냅샷(VENDOR·COST·PRICE)
//        ② costHistory/{바코드}/{벤더} — 가격 비교 앱이 인보이스에서 쌓은 벤더별 낱개 원가
//        ③ shareOrders/_items — 🏬 헐리우드 경유 품목이면 알려 준다(벤더 직접 주문 금지)
const MGR_ROLE_TOKENS = ['OWNER','BOSS','오너','사장','대표','DUEÑO','DUENO','PROPIETARIO',
  'EXECUTIVE','전무','상무','이사','DIRECTOR','VICE PRESIDENT',
  'MANAGER','GERENTE','매니저','점장','부매니저'];
const STAFF_ROLE_TOKENS = ['SUPERVISOR','STAFF','EMPLOYEE','STOCKER','CASHIER','직원','스태프','캐셔','스토커'];
const EXEC_NAMES = ['BHK','SUNKIM','DJ'];
function isManagerUp(profile){
  const nm = String((profile && profile.name) || '').toUpperCase().replace(/[\s.]/g, '');
  if (EXEC_NAMES.indexOf(nm) >= 0) return true;
  const r = String((profile && profile.role) || '').toUpperCase().trim();
  if (!r) return false;
  if (STAFF_ROLE_TOKENS.some((t) => r === t)) return false;
  return MGR_ROLE_TOKENS.some((t) => r.indexOf(t) >= 0);
}
// 벨라포스 스냅샷은 지점당 수천 줄 — 질문마다 읽지 않게 함수 인스턴스에 10분 캐시.
const _posCache = {};
async function posRows(db, branch){
  const c = _posCache[branch];
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c;
  const d = (await db.ref('products/' + branch).get()).val() || {};
  let rows = d.rows || [];
  if (!Array.isArray(rows)) rows = Object.values(rows);
  const out = { at: Date.now(), date: d.date || '', rows };
  _posCache[branch] = out;
  return out;
}
function bcCore(v){ return String(v || '').replace(/\D/g, '').replace(/^0+/, ''); }
function money(n){ const x = +n; return x > 0 ? '$' + (Math.round(x * 100) / 100).toFixed(2) : '?'; }
// mgr=false 면 판매가만 (원가·벤더·인보이스 원가는 아예 읽지도 넣지도 않는다)
async function costInfo(db, branch, terms, mgr){
  const res = { hits: null, more: 0, date: '' };
  if (!terms.length) return res;
  try {
    const pos = await posRows(db, branch);
    res.date = pos.date;
    const nums = terms.filter((t) => /^\d{4,}$/.test(t));
    const scored = [];
    for (const r of pos.rows) {
      if (!r || !r.NAME) continue;
      const n = String(r.NAME).toLowerCase();
      let sc = 0;
      for (const t of terms) if (n.indexOf(t) >= 0) sc++;
      for (const d of nums) {
        if (bcCore(r.FULL_BARCODE).indexOf(d.replace(/^0+/, '')) >= 0) sc += 3;
        if ([r.CODE, r.VENDOR_CODE, r.ITEM_NUMBER].some((x) => String(x || '').toLowerCase() === d)) sc += 3;
      }
      if (sc) scored.push([sc, r]);
    }
    if (!scored.length) return res;
    scored.sort((a, b) => b[0] - a[0]);
    const top = scored.slice(0, 8).map((x) => x[1]);
    res.more = Math.max(0, scored.length - top.length);
    // 인보이스 원가·경유 품목은 걸린 상품 것만 읽는다
    if (!mgr) {
      res.hits = top.map((r) => '- ' + String(r.NAME).slice(0, 60) + ' | selling price ' + money(r.PRICE) +
        (r.FULL_BARCODE ? ' | barcode ' + r.FULL_BARCODE : ''));
      return res;
    }
    let hub = {};
    try { hub = (await db.ref('shareOrders/_items').get()).val() || {}; } catch (e) {}
    const hubBc = {};
    for (const k of Object.keys(hub)) {
      const it = hub[k]; if (!it || it.active === false) continue;
      const b = bcCore(it.barcode); if (b.length >= 7) { hubBc[b] = it; hubBc[b.slice(0, -1)] = it; }
    }
    const lines = await Promise.all(top.map(async (r) => {
      const bc = bcCore(r.FULL_BARCODE);
      const bits = [String(r.NAME).slice(0, 60)];
      bits.push('POS vendor ' + (r.VENDOR || '(blank)'));
      bits.push('POS cost ' + money(r.COST) + ' each');
      if (+r.PRICE > 0) bits.push('selling price ' + money(r.PRICE));
      if (r.VENDOR_CODE || r.ITEM_NUMBER) bits.push('vendor item# ' + (r.VENDOR_CODE || r.ITEM_NUMBER));
      if (bc) bits.push('barcode ' + r.FULL_BARCODE);
      let line = '- ' + bits.join(' | ');
      if (bc.length >= 6) {
        try {
          const ch = (await db.ref('costHistory/' + bc).get()).val();
          if (ch) {
            const inv = Object.keys(ch).map((v) => ch[v]).filter((x) => x && x.ea > 0)
              .sort((a, b) => a.ea - b.ea)
              .map((x) => (x.v || '?') + ' ' + money(x.ea) + ' each (invoice ' + (x.d || '?') + (x.cs ? ', case ' + money(x.cs) : '') + ')');
            if (inv.length) line += '\n    invoice costs, cheapest first: ' + inv.join('; ');
          }
        } catch (e) {}
      }
      const h = hubBc[bc] || hubBc[bc.slice(0, -1)];
      if (h) line += '\n    HUB ITEM: stores other than Hollywood must NOT order this from the vendor — request it from Hollywood in the shared-order app (case of ' + (h.caseSize || '?') + ').';
      return line;
    }));
    res.hits = lines;
  } catch (e) { console.warn('[ask] costInfo', e && e.message); }
  return res;
}

// 네 가지를 한꺼번에 — 서로 독립이라 같이 읽는다. (매니저 이상이면 원가·벤더까지)
async function gatherExtra(db, branch, q, mgr){
  const base = askTerms(q);
  const terms = await expandTerms(db, base);
  const [exp, oos, cnt, shelf, cost] = await Promise.all([
    expiryInfo(db, branch, terms),
    oosInfo(db, branch, terms),
    countsInfo(db, branch, terms),
    bayItemInfo(db, branch, terms),
    costInfo(db, branch, terms, !!mgr),     // 판매가는 모두, 원가·벤더는 매니저 이상만
  ]);
  return { branch, terms, exp, oos, cnt, shelf, cost, mgr: !!mgr };
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

  // 사진에서 읽어낸 자리 — 유통기한 앱에 없는 상품의 위치는 이것뿐이다
  const shelf = e.shelf || {};
  if (shelf.hits) {
    parts.push('');
    parts.push('## Shelf spots matching their question (read from shelf photos)');
    parts.push(shelf.hits.join('\n'));
    parts.push('These came from AI reading photos of the shelves, so a name can be slightly');
    parts.push('off and stock may have moved since the photo. Give the bay code, but say it');
    parts.push('is from the shelf photo and they should look around that spot.');
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

  // 🏷️ 판매가 — 모든 직원 (원가·벤더는 아래 매니저 절에만)
  if (!e.mgr && e.cost && e.cost.hits) {
    parts.push('');
    parts.push('## Selling prices (VelaPOS export for ' + (e.branch || '') + ' dated ' + (e.cost.date || '?') + ')');
    parts.push(e.cost.hits.join('\n'));
    if (e.cost.more) parts.push('(' + e.cost.more + ' more products also matched — if the one they meant is not above, ask for a more specific name.)');
    parts.push('This is the regular shelf price from the POS export. Sales or recent changes may differ —');
    parts.push('say the export date and that the shelf tag or register is the final word.');
  }
  // 💲 원가·벤더 — 매니저 이상일 때만 이 절이 생긴다
  if (e.mgr) {
    const cost = e.cost || {};
    parts.push('');
    parts.push('## Cost and vendor (manager-only — the person asking IS a manager)');
    if (cost.hits) {
      parts.push('From the VelaPOS product export for ' + (e.branch || '') + ' dated ' + (cost.date || '?') + '. POS cost is per unit (each).');
      parts.push(cost.hits.join('\n'));
      if (cost.more) parts.push('(' + cost.more + ' more products also matched — if the one they meant is not above, ask them for a more specific name or the barcode.)');
      parts.push('Invoice costs come from vendor invoices uploaded in the price-compare app, per unit, with the invoice date.');
      parts.push('When more than one vendor is listed, say which is cheapest. Always say the POS export date or invoice date.');
      parts.push('If POS vendor is blank, say the vendor is not filled in VelaPOS.');
    } else {
      parts.push('(no product in the POS export matched their question — say you could not find it and ask for the exact name or barcode)');
    }
  }

  parts.push('');
  parts.push('## Which app does what');
  parts.push(APP_GUIDE.map((a) => '- ' + a[0] + ' — ' + a[1]).join('\n'));
  parts.push('');
  parts.push('## Not available');
  if (e.mgr) {
    parts.push('You do NOT have: discounts, return/exchange policy, other people\'s schedules,');
    parts.push('or cost/vendor for any product that is not listed above.');
  } else {
    parts.push('You do NOT have: costs, vendors, discounts, return/exchange policy, other people\'s');
    parts.push('schedules, other stores\' data, or any product that is not listed above.');
    parts.push('You MAY give the selling price of products listed above. But COST (what the store pays)');
    parts.push('and which VENDOR it comes from are for managers only — if asked, say that is');
    parts.push('manager-only information.');
  }
  parts.push('Shelf locations come ONLY from the two lists above (expiry app registrations and');
  parts.push('shelf photos). If an item is in neither, you do not know where it is. Say so and');
  parts.push('tell them to ask a manager. Never guess an aisle or bay code.');
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
        gatherExtra(db, branch, q, isManagerUp(profile)),   // 유통기한·매대 위치·품절·마지막 재고 (+매니저면 원가·벤더)
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

// =============================================================================
// 📷 베이 사진 → 상품 목록 (2026-09-17)
// 직원이 매대관리 앱으로 찍어 올린 베이 전체 사진 250장이 이미 DB 에 있다.
// 그 사진을 읽어 "이 자리에 무엇이 있는지" 목록으로 만들어 두면, 어시스턴트가
// "신라면 어디 있어?" 에 자리 번호로 답할 수 있다.
//
// 지금까지 위치를 아는 근거는 유통기한 앱에 등록된 상품의 bay 뿐이라 매대에
// 있는 것의 일부만 커버됐다. 사진은 그 자리에 실제로 진열된 것 전부가 찍혀 있다.
// 포장지에 한국어가 그대로 적혀 있어 한국어 질문에도 사전 없이 걸린다.
//
// 한 장씩 처리한다 — 250장을 한 번에 돌리면 한 건이 터졌을 때 어디서 멈췄는지
// 알 수 없고, 함수 시간 제한에도 걸린다. 요청 노드에 베이 코드를 쓰면 그 한 장만
// 처리하고 요청을 지운다. 진행 상황은 bayItems 를 보면 그대로 보인다.
//
// 비용: 사진 1장당 약 $0.012 (Sonnet, 960x1280 기준). 250장 전체 약 $3.
// 한 번만 하면 되고, 진열이 바뀐 자리만 다시 돌리면 된다.
// =============================================================================
const BAY_INDEX_MODEL = 'claude-sonnet-5';
const BAY_INDEX_MAX = 40;          // 한 자리에서 뽑을 상품 수 상한

const BAY_INDEX_SYSTEM = [
  'You look at a photo of one shelf section in a Korean grocery store and list the',
  'products you can actually read on the packaging.',
  '',
  'Rules:',
  '1. ONLY list what you can genuinely read or clearly recognize. This list is used to',
  '   send employees to a shelf — a made-up product sends them to the wrong place.',
  '   If a package is blurry, turned away, or too small to read, leave it out.',
  '2. Write the name as printed in "n". Korean packaging -> Korean. English packaging -> English.',
  '   In "e" put the OTHER-language name people actually use, not a romanization:',
  '   홈런볼 -> "Homerun Ball", 새우깡 -> "Saewookkang Shrimp Cracker", TOFU -> "두부".',
  '   Employees ask in Korean, Spanish and English, so both spellings must be there.',
  '   Leave "e" empty rather than guessing a brand you do not know.',
  '3. Include the brand when it is part of how people ask for it (신라면, 새우깡, ASSI).',
  '4. Do not include shelf tags, price labels, barcodes, or store signage.',
  '5. Do not repeat the same product twice, even if there are several facings.',
  '',
  'Reply with ONLY a JSON object, no markdown fence, no commentary:',
  '{"items":[{"n":"<name as printed>","e":"<the other-language name, or empty string>"}]}',
].join('\n');

exports.bayIndex = onValueCreated(
  { ref: '/floorplan/matdae-hollywood/indexReq/{bayId}', region: 'us-central1',
    secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: '1GiB' },
  async (event) => {
    const bayId = event.params.bayId;
    const db = admin.database();
    const reqRef = db.ref('floorplan/matdae-hollywood/indexReq/' + bayId);
    const outRef = db.ref('floorplan/matdae-hollywood/bayItems/' + bayId);
    const fail = async (code, msg) => {
      await outRef.set({ err: code, msg: String(msg || '').slice(0, 200), at: Date.now() }).catch(() => {});
      await reqRef.remove().catch(() => {});
    };

    console.log('[bayIndex] start', bayId);
    let b64, mime;
    try {
      const url = (await db.ref('floorplan/matdae-hollywood/bayPhotos/' + bayId + '/dataURL').get()).val();
      if (!url) { await fail('no_photo', ''); return; }
      const m = String(url).match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (!m) { await fail('bad_photo', String(url).slice(0, 40)); return; }
      mime = m[1]; b64 = m[2];
    } catch (e) { await fail('read', e && e.message); return; }

    let items = null;
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const r = await client.messages.create({
        model: BAY_INDEX_MODEL,
        max_tokens: 1500,
        system: BAY_INDEX_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text', text: 'Shelf section ' + bayId + '. List the products you can read.' },
          ],
        }],
      });
      const raw = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(raw);
      items = (parsed.items || [])
        .filter((it) => it && it.n && String(it.n).trim())
        .slice(0, BAY_INDEX_MAX)
        .map((it) => ({ n: String(it.n).trim().slice(0, 70), e: String(it.e || '').trim().slice(0, 70) }));
    } catch (e) {
      console.error('[bayIndex] anthropic', bayId, e && e.message);
      await fail('upstream', e && e.message); return;
    }

    if (!items || !items.length) { await fail('empty', ''); return; }
    await outRef.set({ items, n: items.length, at: Date.now(), model: BAY_INDEX_MODEL }).catch(() => {});
    await reqRef.remove().catch(() => {});
    console.log('[bayIndex] done', bayId, items.length, 'items');
  }
);

// =============================================================================
// 🔄 사진이 바뀌면 그 자리를 자동으로 다시 읽는다 (2026-09-17)
// 전무님: "자리 바뀐 거 사진 새로 올리면 자동으로 읽어주나?"
// 안 그러면 진열을 바꿀 때마다 사람이 재실행을 걸어야 하는데 그건 오래 못 간다.
//
// 사진 본체(dataURL)가 아니라 옆의 ts 만 본다 — 710KB 짜리 사진을 이벤트로
// 실어 나를 이유가 없다. 사진을 지우면 목록도 같이 지운다(엉뚱한 자리로
// 직원을 보내는 것보다 "모른다"가 낫다).
// =============================================================================
exports.bayPhotoChanged = onValueWritten(
  { ref: '/floorplan/matdae-hollywood/bayPhotos/{bayId}/ts', region: 'us-central1',
    timeoutSeconds: 60, memory: '256MiB' },
  async (event) => {
    const bayId = event.params.bayId;
    const db = admin.database();
    const after = event.data.after.val();
    const before = event.data.before.val();

    if (!after) {
      await db.ref('floorplan/matdae-hollywood/bayItems/' + bayId).remove().catch(() => {});
      console.log('[bayPhoto] removed', bayId);
      return;
    }
    if (before === after) return;            // 같은 사진 다시 저장 — 읽을 이유 없다
    await db.ref('floorplan/matdae-hollywood/indexReq/' + bayId)
      .set({ ts: Date.now(), auto: true })
      .catch((e) => console.error('[bayPhoto] queue', bayId, e && e.message));
    console.log('[bayPhoto] queued', bayId);
  }
);

// =============================================================================
// 🈯 상품 이름 한글 ↔ 영문 짝 붙이기 (2026-09-17)
// 사진에서 읽은 이름은 포장지에 적힌 그대로다. 그래서 "홈런볼"로 물으면
// "HOMERUN BALL"로 읽힌 자리를 못 찾는다 — 같은 상품인데 글자가 다르다.
//
// 사전을 손으로 채우는 건 끝이 없다(과자만 수백 종). 대신 이미 만들어 둔
// 2,502개 이름을 AI 에게 통째로 보여주고 반대쪽 표기를 받아 각 항목의 e 에
// 붙인다. 검색은 n 과 e 를 같이 뒤지므로 어느 쪽으로 물어도 걸린다.
//
// 이름만 주고받으므로 사진을 다시 읽는 것보다 훨씬 싸다 (전체 약 $1).
// 진열이 바뀌어 bayIndex 를 다시 돌린 뒤에 한 번 더 돌리면 된다.
// =============================================================================
const ALIAS_MODEL = 'claude-sonnet-5';
const ALIAS_BATCH = 45;            // 한 번에 보낼 이름 수
                                   //   80 이면 답이 max_tokens 에서 잘려 묶음째 실패했다
                                   //   (2026-09-17 첫 실행 29개 중 8개). 절반으로 줄였다.
const ALIAS_PARALLEL = 4;          // 동시에 돌릴 묶음 수

const ALIAS_SYSTEM = [
  'You match product names between Korean and English for a Korean grocery store.',
  'Employees ask in Korean, Spanish or English, but the shelf index stores whatever was',
  'printed on the package — so "홈런볼" and "HOMERUN BALL" never match each other.',
  'Your job is to supply the OTHER spelling so both find the same shelf.',
  '',
  'For each numbered name, give the other-language form people actually use:',
  '  · Korean name  -> the English/romanized name as printed or commonly written',
  '    (홈런볼 -> Homerun Ball, 새우깡 -> Saewookkang Shrimp Cracker, 고추장 -> Gochujang Hot Pepper Paste)',
  '  · English name -> the Korean name Koreans would say',
  '    (HOMERUN BALL -> 홈런볼, TOFU -> 두부, SOY SAUCE -> 간장)',
  '  · Japanese/other -> both English and Korean if you know them',
  'Include the plain category word too when it helps (라면 -> Ramen Instant Noodle).',
  '',
  'If you do not know a product, return an empty string for it. Never invent a brand.',
  '',
  'Reply with ONLY a JSON object mapping the number to the other spelling, no markdown:',
  '{"1":"Homerun Ball","2":"","3":"두부 Tofu"}',
].join('\n');

exports.bayAlias = onValueCreated(
  { ref: '/floorplan/matdae-hollywood/aliasReq/{reqId}', region: 'us-central1',
    secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '1GiB' },
  async (event) => {
    const db = admin.database();
    const reqRef = db.ref('floorplan/matdae-hollywood/aliasReq/' + event.params.reqId);
    const logRef = db.ref('floorplan/matdae-hollywood/aliasLog');

    let bays;
    try {
      bays = (await db.ref('floorplan/matdae-hollywood/bayItems').get()).val();
    } catch (e) {
      await logRef.set({ err: 'read', msg: String(e && e.message).slice(0, 200), at: Date.now() }).catch(() => {});
      await reqRef.remove().catch(() => {}); return;
    }
    if (!bays) { await reqRef.remove().catch(() => {}); return; }

    // 같은 이름이 여러 자리에 있으니 한 번만 물어본다.
    const names = [];
    const seen = {};
    for (const bayId of Object.keys(bays)) {
      const rec = bays[bayId];
      if (!rec || !rec.items) continue;
      for (const it of rec.items) {
        const n = it && it.n;
        if (!n || seen[n]) continue;
        seen[n] = true; names.push(n);
      }
    }
    console.log('[bayAlias] unique names', names.length);
    if (!names.length) { await reqRef.remove().catch(() => {}); return; }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

    async function runBatch(list){
      const numbered = list.map((nm, i) => (i + 1) + '. ' + nm).join('\n');
      const r = await client.messages.create({
        model: ALIAS_MODEL,
        max_tokens: 8000,
        system: ALIAS_SYSTEM,
        messages: [{ role: 'user', content: numbered }],
      });
      const raw = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(raw);
      const out = {};
      list.forEach((nm, i) => {
        const v = parsed[String(i + 1)];
        if (v && String(v).trim()) out[nm] = String(v).trim().slice(0, 70);
      });
      return out;
    }

    // 묶음을 만들어 몇 개씩 동시에 — 순차로 하면 32번 × 5초라 시간 제한에 닿는다.
    const chunks = [];
    for (let i = 0; i < names.length; i += ALIAS_BATCH) chunks.push(names.slice(i, i + ALIAS_BATCH));
    const alias = {};
    let failed = 0;
    for (let i = 0; i < chunks.length; i += ALIAS_PARALLEL) {
      const group = chunks.slice(i, i + ALIAS_PARALLEL);
      const results = await Promise.all(group.map((c) =>
        runBatch(c).catch(() => runBatch(c))        // 한 번 재시도
          .catch((e) => { failed++; console.warn('[bayAlias] batch', e && e.message); return {}; })));
      for (const m of results) Object.assign(alias, m);
    }
    console.log('[bayAlias] matched', Object.keys(alias).length, 'failed batches', failed);

    // 각 자리의 항목 e 에 붙인다 — 검색이 n 과 e 를 같이 보므로 이걸로 양쪽이 걸린다.
    let touched = 0;
    const upd = {};
    for (const bayId of Object.keys(bays)) {
      const rec = bays[bayId];
      if (!rec || !rec.items) continue;
      let changed = false;
      const items = rec.items.map((it) => {
        const add = it && it.n && alias[it.n];
        if (!add) return it;
        const cur = String(it.e || '');
        if (cur.toLowerCase().indexOf(add.toLowerCase()) >= 0) return it;   // 이미 들어 있음
        changed = true;
        return { n: it.n, e: (cur ? cur + ' ' : '') + add };
      });
      if (changed) { upd[bayId + '/items'] = items; touched++; }
    }
    if (Object.keys(upd).length) {
      await db.ref('floorplan/matdae-hollywood/bayItems').update(upd)
        .catch((e) => console.error('[bayAlias] save', e && e.message));
    }
    await logRef.set({
      names: names.length, matched: Object.keys(alias).length,
      baysUpdated: touched, failedBatches: failed, at: Date.now(), model: ALIAS_MODEL,
    }).catch(() => {});
    await reqRef.remove().catch(() => {});
    console.log('[bayAlias] done — bays updated', touched);
  }
);

// =============================================================================
// 🧹 업무 사진 정리 — 기록에 박힌 base64 사진을 Storage 로 옮긴다 (2026-09-20)
//
// fb-auth-fetch.js 에 storageBucket 이 빠져 있어서 getStorage(app) 가 죽었고,
// 사진이 전부 base64 로 tasks/{지점}/{날짜} 안에 박혔다(9/17~19 사진 1,004장 전부).
// 코럴 하루치 44MB · 헐리우드 23MB — 폰이 그 날짜를 열 때마다 통째로 내려받아
// 느려지고 멈췄다. 업로드는 고쳤지만(507c1b2) 이미 박힌 사진은 그대로 남는다.
//
// 이 함수는 하루·한 지점씩 처리한다: base64 → Storage 업로드 → 다운로드 URL 이
// 실제로 열리는지 확인 → 그 뒤에만 DB 의 사진 문자열을 URL 로 바꾼다.
// 확인 전에는 절대 지우지 않는다(사진이 유일본이라 날리면 복구 불가).
//
// 실행: photoMigrate/{jobId} 에 { branch, date, dry } 쓰기 → 같은 노드 result 에 결과.
//   dry:true 면 세어만 보고 아무것도 바꾸지 않는다.
// =============================================================================
const MIG_BUCKET = 'kimchi-mart-order.firebasestorage.app';

function _migDataUrlToBuf(u){
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(u || ''));
  if (!m) return null;
  const type = m[1] || 'image/jpeg';
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'binary');
  if (!buf.length) return null;
  return { buf, type };
}
async function _migUpload(bucket, path, buf, type){
  const token = require('crypto').randomUUID();
  const file = bucket.file(path);
  await file.save(buf, { resumable: false, contentType: type,
    metadata: { contentType: type, cacheControl: 'public, max-age=31536000',
                metadata: { firebaseStorageDownloadTokens: token, migratedFrom: 'rtdb-base64' } } });
  const url = 'https://firebasestorage.googleapis.com/v0/b/' + MIG_BUCKET +
              '/o/' + encodeURIComponent(path) + '?alt=media&token=' + token;
  // 정말 열리는지 확인한 뒤에만 DB 를 바꾼다
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error('verify ' + r.status);
  const got = Buffer.from(await r.arrayBuffer());
  if (got.length !== buf.length) throw new Error('verify size ' + got.length + '/' + buf.length);
  return url;
}

// 하루·한 지점 처리 — 옮긴 장수·바이트를 돌려준다
async function _migOneDay(db, bucket, branch, date, dry, errs){
  const dayRef = db.ref('tasks/' + branch + '/' + date);
  const day = (await dayRef.get()).val();
  const st = { tasks: 0, found: 0, moved: 0, failed: 0, bytes: 0 };
  if (!day) return st;
  for (const taskId of Object.keys(day)) {
    const t = day[taskId];
    if (!t || typeof t !== 'object') continue;
    st.tasks++;
    const updates = {};
    let n = 0;
    // 사진이 들어 있는 자리: task.photos / checklist[i].photos / checklist[i].entries[j].photos
    const spots = [];
    if (Array.isArray(t.photos)) spots.push({ arr: t.photos, key: 'photos' });
    (Array.isArray(t.checklist) ? t.checklist : []).forEach((c, ci) => {
      if (!c) return;
      if (Array.isArray(c.photos)) spots.push({ arr: c.photos, key: 'checklist/' + ci + '/photos' });
      (Array.isArray(c.entries) ? c.entries : []).forEach((e, ei) => {
        if (e && Array.isArray(e.photos)) spots.push({ arr: e.photos, key: 'checklist/' + ci + '/entries/' + ei + '/photos' });
      });
    });
    for (const sp of spots) {
      let changed = false;
      const out = sp.arr.slice();
      for (let i = 0; i < out.length; i++) {
        const v = out[i];
        if (typeof v !== 'string' || v.indexOf('data:') !== 0) continue;
        st.found++;
        const d = _migDataUrlToBuf(v);
        if (!d) { st.failed++; if (errs.length < 20) errs.push(date + ' ' + taskId + ' bad data url'); continue; }
        if (dry) { st.bytes += d.buf.length; continue; }
        const ext = d.type.indexOf('png') >= 0 ? '.png' : '.jpg';
        const path = 'tasks-migrated/' + branch + '/' + date + '/' + taskId + '/' + sp.key.replace(/\//g, '_') + '_' + i + ext;
        try {
          out[i] = await _migUpload(bucket, path, d.buf, d.type);   // 열리는지 확인까지 하고 URL 반환
          st.moved++; st.bytes += d.buf.length; changed = true; n++;
        } catch (e) {
          st.failed++;
          if (errs.length < 20) errs.push(date + ' ' + taskId + ' ' + ((e && e.message) || e));
        }
      }
      if (changed) updates[sp.key] = out;
    }
    // 올리고 열리는 것까지 확인한 뒤에만 DB 의 base64 를 URL 로 바꾼다
    if (!dry && n) {
      try { await dayRef.child(taskId).update(updates); }
      catch (e) { if (errs.length < 20) errs.push(date + ' ' + taskId + ' db ' + ((e && e.message) || e)); }
    }
  }
  return st;
}

// 여러 날을 이어서 — 시간이 모자라면 남은 날짜로 다음 작업을 스스로 만든다(체인).
exports.photoMigrate = onValueCreated(
  { ref: '/photoMigrate/{jobId}', region: 'us-central1', timeoutSeconds: 540, memory: '2GiB' },
  async (event) => {
    const jobId = event.params.jobId;
    const job = event.data.val();
    if (!job || job.result || !job.branch || (!job.date && !job.dates)) return;
    const db = admin.database();
    const node = db.ref('photoMigrate/' + jobId);
    const branch = String(job.branch), dry = !!job.dry;
    const dates = job.dates ? String(job.dates).split(',').map((x) => x.trim()).filter(Boolean) : [String(job.date)];
    const bucket = admin.storage().bucket(MIG_BUCKET);
    const t0 = Date.now();
    const tot = { days: 0, tasks: 0, found: 0, moved: 0, failed: 0, bytes: 0 };
    const errs = [];
    let i = 0;
    for (; i < dates.length; i++) {
      if (i > 0 && Date.now() - t0 > 400000) break;          // 400초 넘으면 나머지는 다음 작업으로
      try {
        const st = await _migOneDay(db, bucket, branch, dates[i], dry, errs);
        tot.days++; tot.tasks += st.tasks; tot.found += st.found; tot.moved += st.moved;
        tot.failed += st.failed; tot.bytes += st.bytes;
      } catch (e) {
        errs.push(dates[i] + ' DAY FAIL ' + ((e && e.message) || e));
      }
    }
    const rest = dates.slice(i);
    const result = { branch, days: tot.days, tasks: tot.tasks, found: tot.found, moved: tot.moved,
                     failed: tot.failed, mb: Math.round(tot.bytes / 1048576 * 10) / 10, dry,
                     left: rest.length, at: Date.now(), secs: Math.round((Date.now() - t0) / 1000),
                     errs: errs.slice(0, 20) };
    console.log('[mig] ' + branch + ' ' + JSON.stringify(result));
    await node.child('result').set(result).catch(() => {});
    if (rest.length) {
      await db.ref('photoMigrate/' + jobId + 'x').set({ branch, dates: rest.join(','), dry, by: 'chain' }).catch(() => {});
    }
  }
);

// =============================================================================
// 📋 매일 저녁 업무 요약 — 👔 매니저 룸에 자동 게시 (2026-09-23)
// 전무님: "업무 지시를 잘 수행 안 하는데 효율적인 방법?"
//   안 해도 조용히 지나가는 게 문제다. 사람이 잔소리하지 않아도 매일 같은 시각에
//   지점별 완료율과 남은 업무·담당자가 매니저 룸에 뜨면, 드러나는 것만으로 올라간다.
// 밤 9시(뉴욕) 기준 — 마감 전 아니라 하루가 끝난 뒤 사실만 적는다.
// 점수에는 반영하지 않는다(meta.kind='task_daily' → 활동순위 채팅 점수 제외).
// =============================================================================
const { onSchedule } = require('firebase-functions/v2/scheduler');

const RPT_BRANCHES = [
  { id: 'HOLLYWOOD', ko: '할리우드' }, { id: 'MIAMI', ko: '마이애미' },
  { id: 'PEMBROKE_PINES', ko: '펨브로크 파인즈' }, { id: 'CORAL_SPRINGS', ko: '코럴 스프링스' },
  { id: 'LASOLAS', ko: '라스올라스' },
];
function rptDay(){
  // 뉴욕 날짜 (서버는 UTC)
  const s = new Date().toLocaleString('en-CA', { timeZone: 'America/New_York' });
  return s.slice(0, 10);
}
exports.dailyTaskReport = onSchedule(
  { schedule: '0 21 * * *', timeZone: 'America/New_York', region: 'us-central1', memory: '512MiB' },
  async () => {
    const db = admin.database();
    const day = rptDay();
    const lines = [], slow = [];
    let totAll = 0, doneAll = 0;
    for (const b of RPT_BRANCHES){
      let node = null;
      try { node = (await db.ref('tasks/' + b.id + '/' + day).get()).val(); } catch (e) { console.warn('[rpt]', b.id, e && e.message); }
      const tasks = Object.keys(node || {}).map(k => node[k]).filter(t => t && typeof t === 'object' && t.name);
      if (!tasks.length){ lines.push('• ' + b.ko + ' — 오늘 등록된 업무 없음'); continue; }
      const done = tasks.filter(t => t.completedAt);
      const open = tasks.filter(t => !t.completedAt);
      totAll += tasks.length; doneAll += done.length;
      const pct = Math.round(done.length / tasks.length * 100);
      lines.push('• ' + b.ko + ' — ' + done.length + '/' + tasks.length + ' (' + pct + '%)' + (pct >= 90 ? ' 👍' : (pct < 60 ? ' ⚠️' : '')));
      // 남은 업무는 담당자까지 — 누가 무엇을 안 했는지가 분명해야 움직인다
      open.slice(0, 6).forEach(t => {
        const who = t.assignedTo === '*' ? '(전체)' : (t.assignedTo || t.assignedToRole || '미지정');
        slow.push('   – ' + b.ko + ' · ' + String(t.name).slice(0, 34) + ' → ' + who);
      });
      if (open.length > 6) slow.push('   – ' + b.ko + ' 외 ' + (open.length - 6) + '건 더');
    }
    const pctAll = totAll ? Math.round(doneAll / totAll * 100) : 0;
    const text = '📋 오늘 업무 마감 현황 — ' + day + '\n' +
      '전체 ' + doneAll + '/' + totAll + ' (' + pctAll + '%)\n\n' + lines.join('\n') +
      (slow.length ? ('\n\n남은 업무\n' + slow.join('\n')) : '\n\n✅ 남은 업무 없음') +
      '\n\n(매일 밤 9시 자동 집계 — 내일 아침 지점별로 확인해 주세요)';
    const ts = Date.now(), id = 'm' + ts + Math.floor(Math.random() * 900);
    await db.ref('chat/messages/managers/' + id).set({
      sender: '📋 업무 마감 집계', senderBranch: '', senderRole: '', isManager: false, color: '#1d4ed8',
      text, ts, photos: [], meta: { kind: 'task_daily', day },
    });
    await db.ref('chat/rooms/managers').update({ lastMsg: text.split('\n')[0].slice(0, 40), lastTs: ts, lastSender: '📋 업무 마감 집계' }).catch(() => {});
    console.log('[rpt] posted', day, doneAll + '/' + totAll);
  }
);

// =============================================================================
// 🏅 주간 완료율 보너스 — 잘한 사람에게 자동으로 점수 (2026-09-23)
// 전무님: "수행을 잘 안 한다" → 드러내기(매일 집계)만으로는 부족하다.
//   잘한 쪽이 보상을 받아야 나머지가 따라온다. 매주 일요일 밤, 지난 7일 동안
//   자기한테 지정된 업무를 90% 이상 끝낸 사람에게 +3점(mgrBonus)을 자동 지급하고,
//   지점 순위와 함께 👔 매니저 룸에 올린다. 이유가 남으므로 나중에 확인할 수 있다.
//
// 지급 기준 (너무 쉬우면 의미가 없고, 너무 빡빡하면 아무도 못 받는다):
//   · 그 주에 본인 이름으로 지정된 업무가 5건 이상
//   · 그중 90% 이상 완료
// 테스트: weeklyBonusRun/{id} 에 { dry:true } 를 쓰면 지급 없이 결과만 계산해 돌려준다.
// =============================================================================
const WB_MIN_TASKS = 5, WB_RATE = 0.9, WB_POINTS = 3;

function wbNorm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, ''); }
function wbTokens(s){
  return String(s || '').toLowerCase().split(/[\s\-_.,/()]+/)
    .map(x => x.replace(/[^a-z0-9가-힣]+/g, '')).filter(x => x.length >= 2);
}
function wbSame(a, b){
  const na = wbNorm(a), nb = wbNorm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = wbTokens(a), tb = wbTokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const set = new Set(long);
  return short.every(x => set.has(x));
}
async function wbCompute(db, days){
  const out = { branches: [], people: [], days };
  for (const b of RPT_BRANCHES){
    const per = {};                      // 이름 → {assigned, done}
    let tot = 0, done = 0;
    for (const day of days){
      let node = null;
      try { node = (await db.ref('tasks/' + b.id + '/' + day).get()).val(); } catch(e){ continue; }
      const tasks = Object.keys(node || {}).map(k => node[k]).filter(t => t && typeof t === 'object' && t.name);
      tot += tasks.length;
      done += tasks.filter(t => t.completedAt).length;
      tasks.forEach(t => {
        const who = t.assignedTo;
        if (!who || who === '*') return;                     // 전체 업무는 개인 집계에서 뺀다
        const key = String(who).trim();
        per[key] = per[key] || { assigned: 0, done: 0 };
        per[key].assigned++;
        if (t.completedAt && (wbSame(t.completedBy, key) || !t.completedBy)) per[key].done++;
      });
    }
    out.branches.push({ id: b.id, ko: b.ko, total: tot, done: done, pct: tot ? Math.round(done / tot * 100) : 0 });
    Object.keys(per).forEach(name => {
      const p = per[name];
      out.people.push({ branch: b.id, branchKo: b.ko, name,
        assigned: p.assigned, done: p.done, pct: p.assigned ? Math.round(p.done / p.assigned * 100) : 0 });
    });
  }
  out.winners = out.people.filter(p => p.assigned >= WB_MIN_TASKS && p.done / p.assigned >= WB_RATE)
                          .sort((a, b) => b.done - a.done);
  out.branches.sort((a, b) => b.pct - a.pct);
  return out;
}
function wbLastDays(n){
  const out = [];
  for (let i = 1; i <= n; i++){
    const d = new Date(Date.now() - i * 86400000);
    out.push(d.toLocaleString('en-CA', { timeZone: 'America/New_York' }).slice(0, 10));
  }
  return out;
}
async function wbAwardAndPost(db, res, dry){
  const ts = Date.now();
  let paid = 0;
  if (!dry){
    for (const w of res.winners){
      try {
        await db.ref('mgrBonus/' + w.branch).push({
          to: w.name, points: WB_POINTS,
          reason: '🏅 주간 업무 완료율 ' + w.pct + '% (' + w.done + '/' + w.assigned + ')',
          by: '자동 집계', byRole: 'SYSTEM', branch: w.branch, ts: Date.now(),
        });
        paid++;
      } catch(e){ console.warn('[wb] award', w.name, e && e.message); }
    }
  }
  const text = '🏅 주간 업무 완료율 — ' + res.days[res.days.length - 1] + ' ~ ' + res.days[0] + '\n\n' +
    res.branches.map((b, i) => (i + 1) + '. ' + b.ko + ' ' + b.pct + '% (' + b.done + '/' + b.total + ')').join('\n') +
    '\n\n🏅 보너스 +' + WB_POINTS + '점 (본인 지정 업무 ' + WB_MIN_TASKS + '건 이상, ' + Math.round(WB_RATE * 100) + '% 이상 완료)\n' +
    (res.winners.length
      ? res.winners.slice(0, 15).map(w => '• ' + w.name + ' (' + w.branchKo + ') ' + w.done + '/' + w.assigned).join('\n')
      : '• 이번 주는 대상자가 없습니다') +
    '\n\n(매주 일요일 밤 자동 집계 — 점수는 활동순위에 반영됩니다)';
  if (!dry){
    const id = 'm' + ts + Math.floor(Math.random() * 900);
    await db.ref('chat/messages/managers/' + id).set({
      sender: '🏅 주간 집계', senderBranch: '', senderRole: '', isManager: false, color: '#b45309',
      text, ts, photos: [], meta: { kind: 'task_weekly' },
    });
    await db.ref('chat/rooms/managers').update({ lastMsg: text.split('\n')[0].slice(0, 40), lastTs: ts, lastSender: '🏅 주간 집계' }).catch(() => {});
  }
  return { paid, text };
}
exports.weeklyTaskBonus = onSchedule(
  { schedule: '30 21 * * 0', timeZone: 'America/New_York', region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async () => {
    const db = admin.database();
    const res = await wbCompute(db, wbLastDays(7));
    const r = await wbAwardAndPost(db, res, false);
    console.log('[wb] paid', r.paid, 'winners', res.winners.length);
  }
);
// 테스트·수동 실행용 — weeklyBonusRun/{id} 에 { dry:true, days:7 }
exports.weeklyBonusRun = onValueCreated(
  { ref: '/weeklyBonusRun/{id}', region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (event) => {
    const job = event.data.val();
    if (!job || job.result) return;
    const db = admin.database();
    const res = await wbCompute(db, wbLastDays(+job.days || 7));
    const r = await wbAwardAndPost(db, res, job.dry !== false);
    await event.data.ref.child('result').set({
      dry: job.dry !== false, paid: r.paid, winners: res.winners.length,
      branches: res.branches, top: res.winners.slice(0, 15), text: r.text, at: Date.now(),
    });
  }
);
