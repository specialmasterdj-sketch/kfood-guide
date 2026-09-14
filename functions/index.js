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
const { onRequest } = require('firebase-functions/v2/https');

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

function buildContext(profile, shifts, tasks){
  const now = new Date();
  const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const parts = [];
  parts.push('## Who is asking');
  parts.push('Name: ' + profile.name + ' | Store: ' + profile.branch + ' | Role: ' + (profile.role || '(not set)'));
  parts.push('Today: ' + ymd(now) + ' (' + day + ')');
  parts.push('');
  parts.push('## Their work schedule (next 7 days)');
  parts.push(shifts ? shifts.join('\n') : '(no schedule found for this person — tell them to check with their manager)');
  parts.push('');
  parts.push('## Their tasks today');
  parts.push(tasks ? tasks.join('\n') : '(no tasks assigned to them today)');
  parts.push('');
  parts.push('## Which app does what');
  parts.push(APP_GUIDE.map((a) => '- ' + a[0] + ' — ' + a[1]).join('\n'));
  parts.push('');
  parts.push('## Not available');
  parts.push('You do NOT have: product shelf locations, prices, return/exchange policy,');
  parts.push('other people\'s schedules, other stores\' data, inventory counts.');
  parts.push('If asked about any of these, say you do not have that and to ask a manager.');
  return parts.join('\n');
}

// ---- 함수 본체 ---------------------------------------------------------------
exports.askAssistant = onRequest(
  { region: 'us-central1', secrets: [ANTHROPIC_API_KEY], cors: true, maxInstances: 10 },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

    // 1) 토큰 검증
    const hdr = String(req.headers.authorization || '');
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (!token) { res.status(401).json({ error: 'auth' }); return; }
    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
      if (decoded.firebase && decoded.firebase.sign_in_provider === 'anonymous') {
        res.status(403).json({ error: 'anonymous' }); return;
      }
    } catch (e) { res.status(401).json({ error: 'auth' }); return; }

    const db = admin.database();

    // 2) 승인된 직원인지 + 프로필
    let profile;
    try {
      const u = (await db.ref('users/' + uid).get()).val();
      if (!u || u.status !== 'approved') { res.status(403).json({ error: 'not_approved' }); return; }
      profile = { name: u.name || '', branch: u.branch || '', role: u.role || '' };
      if (!profile.name) { res.status(403).json({ error: 'no_name' }); return; }
    } catch (e) { res.status(500).json({ error: 'profile' }); return; }

    // 3) 질문
    const q = String((req.body && req.body.q) || '').trim().slice(0, ASK_MAX_LEN);
    if (!q) { res.status(400).json({ error: 'empty' }); return; }

    // 4) 하루 한도 — admin 권한이라 규칙 없이 서버만 읽고 쓴다
    const qKey = 'aiQuota/' + ymd(new Date()) + '/' + uid;
    let used = 0;
    try {
      const tx = await db.ref(qKey).transaction((cur) => (cur || 0) + 1);
      used = (tx.snapshot && tx.snapshot.val()) || 1;
    } catch (e) { console.warn('[ask] quota', e && e.message); }
    if (used > ASK_DAILY_LIMIT) {
      res.status(429).json({ error: 'quota', limit: ASK_DAILY_LIMIT });
      return;
    }

    // 5) 컨텍스트 — 본인 지점·본인 것만
    const [shifts, tasks] = await Promise.all([
      myShifts(db, profile.branch, profile.name),
      myTasks(db, profile.branch, profile.name),
    ]);
    const context = buildContext(profile, shifts, tasks);

    // 6) Claude
    let answer = '';
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const r = await client.messages.create({
        model: ASK_MODEL,
        max_tokens: 600,
        system: ASK_SYSTEM,
        messages: [{ role: 'user', content: '<context>\n' + context + '\n</context>\n\nQuestion: ' + q }],
      });
      answer = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    } catch (e) {
      console.error('[ask] anthropic', e && e.message);
      res.status(502).json({ error: 'upstream' });
      return;
    }
    if (!answer) { res.status(502).json({ error: 'empty_answer' }); return; }

    // 7) 로그 — 무엇을 많이 묻는지가 다음 개발 우선순위가 된다 (월마트의 중복 신호와 같은 논리)
    db.ref('aiLog').push({
      uid, name: profile.name, branch: profile.branch,
      q, a: answer.slice(0, 500), ts: Date.now(),
    }).catch(() => {});

    res.json({ answer, used, limit: ASK_DAILY_LIMIT });
  }
);
