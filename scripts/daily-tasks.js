#!/usr/bin/env node
// 매일 아침 4am ET (동부시간) 자동 일일 보고 발송.
// GitHub Actions cron 으로 실행. HOLLYWOOD 매장에 5개 일일 보고 task PUT:
//   정육 / K-Food / 해산물 / 농산물 / 냉동고
// 동일 task ID 로 idempotent — 이미 있으면 skip (직원 진행 데이터 보존).

const FB_API_KEY = process.env.FB_API_KEY || 'AIzaSyBwL0Wa1Q8aFhZp5hsn9gTw5aZwXUdAVy4';
const FB_DB     = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
// TARGET_BRANCH 가 'ALL' (또는 미지정) 이면 활성 5개 지점 모두 발송.
// 단일 지점만 지정도 가능: TARGET_BRANCH=HOLLYWOOD
const ALL_BRANCHES = ['HOLLYWOOD','MIAMI','CORAL_SPRINGS','LASOLAS','PEMBROKE_PINES'];
const TARGET_INPUT = (process.env.TARGET_BRANCH || 'ALL').toUpperCase();
const BRANCHES_TO_RUN = (TARGET_INPUT === 'ALL' || !TARGET_INPUT)
  ? ALL_BRANCHES
  : [TARGET_INPUT];
const SENDER    = 'AUTO (GitHub Actions cron)';

// ─── 체크리스트 템플릿 (tasks.html 의 _XXX_TPL_2026 과 동일) ─────────
const TPL = {
  kfood: [
    { name: '🍙 김밥', done: false, nameTr: { ko:'🍙 김밥', en:'🍙 Kimbap', es:'🍙 Kimbap' } },
    { name: '🍚 삼각김밥', done: false, nameTr: { ko:'🍚 삼각김밥', en:'🍚 Triangle Kimbap', es:'🍚 Onigiri' } },
    { name: '🍜 잡채', done: false, nameTr: { ko:'🍜 잡채', en:'🍜 Japchae', es:'🍜 Japchae' } },
  ],
  seafood: [
    { name: '🐟 연어 (Salmon)', done: false, nameTr: { ko:'🐟 연어', en:'🐟 Salmon', es:'🐟 Salmón' } },
    { name: '🦐 새우 (Shrimp)', done: false, nameTr: { ko:'🦐 새우', en:'🦐 Shrimp', es:'🦐 Camarón' } },
    { name: '🐟 고등어 (Mackerel)', done: false, nameTr: { ko:'🐟 고등어', en:'🐟 Mackerel', es:'🐟 Caballa' } },
  ],
  produce: [
    { name: '🌱 BEAN SPROUTS', done: false, nameTr: { ko:'🌱 숙주나물', en:'🌱 BEAN SPROUTS', es:'🌱 BROTES' } },
    { name: '🥬 SHANGHAI', done: false, nameTr: { ko:'🥬 상하이', en:'🥬 SHANGHAI', es:'🥬 SHANGHAI' } },
    { name: '🍆 EGGPLANT', done: false, nameTr: { ko:'🍆 가지', en:'🍆 EGGPLANT', es:'🍆 BERENJENA' } },
  ],
  frozen: [
    { name: '🧊 냉동 매대 (벽)', done: false, nameTr: { ko:'🧊 냉동 매대 (벽)', en:'🧊 Wall Freezer', es:'🧊 Congelador de Pared' } },
    { name: '🥶 냉동 케이스 (오픈)', done: false, nameTr: { ko:'🥶 냉동 케이스 (오픈)', en:'🥶 Open Case Freezer', es:'🥶 Congelador Abierto' } },
    { name: '🍦 아이스크림 코너', done: false, nameTr: { ko:'🍦 아이스크림 코너', en:'🍦 Ice Cream Section', es:'🍦 Sección de Helados' } },
  ],
  meat: [
    { name: '🐂 BEEF 작업한 종류·수량 (사진+메모)', done: false,
      nameTr: { ko:'🐂 BEEF 작업한 종류·수량 (사진+메모)', en:'🐂 BEEF — types & qty worked (photo + memo)', es:'🐂 BEEF — tipos y cantidad trabajados (foto + memo)' } },
    { name: '🐖 PORK 작업한 종류·수량 (사진+메모)', done: false,
      nameTr: { ko:'🐖 PORK 작업한 종류·수량 (사진+메모)', en:'🐖 PORK — types & qty worked (photo + memo)', es:'🐖 PORK — tipos y cantidad trabajados (foto + memo)' } },
    { name: '🐔 CHICKEN 작업한 종류·수량 (사진+메모)', done: false,
      nameTr: { ko:'🐔 CHICKEN 작업한 종류·수량 (사진+메모)', en:'🐔 CHICKEN — types & qty worked (photo + memo)', es:'🐔 CHICKEN — tipos y cantidad trabajados (foto + memo)' } },
    { name: '🍱 마리네이드/양념 작업 (사진+메모)', done: false,
      nameTr: { ko:'🍱 마리네이드/양념 작업 (사진+메모)', en:'🍱 Marinated / seasoned items (photo + memo)', es:'🍱 Marinado / condimentado (foto + memo)' } },
    { name: '🥗 기타 작업한 종류·수량 (사진+메모)', done: false,
      nameTr: { ko:'🥗 기타 작업한 종류·수량 (사진+메모)', en:'🥗 Other items worked (photo + memo)', es:'🥗 Otros artículos trabajados (foto + memo)' } },
    { name: '🧹 정육 매대·작업대·기계 청소 (사진)', done: false,
      nameTr: { ko:'🧹 정육 매대·작업대·기계 청소 (사진)', en:'🧹 Meat case / counter / equipment cleaning (photo)', es:'🧹 Limpieza de vitrina / mesa / equipo (foto)' } },
  ],
};

// ─── 5개 task payload 정의 (sendXXXDailyAll 들과 동일 필드) ─────────
const TASKS = [
  { key:'meat',
    taskId: 'auto_meat_daily_all',
    payload: {
      name: '🥩 정육 일일 작업 보고',
      nameTr: { ko:'🥩 정육 일일 작업 보고', en:'🥩 Daily Meat Department Report', es:'🥩 Reporte Diario de Carnicería' },
      deadline: '18:00', category: '정육', requirePhoto: true, place: '정육 작업장',
      locationNote: '하루 작업한 BEEF / PORK / CHICKEN / 마리네이드 / 청소 — 각 항목에 사진+간단 메모',
      locationNoteTr: {
        ko: '하루 작업한 BEEF / PORK / CHICKEN / 마리네이드 / 청소 — 각 항목에 사진+간단 메모',
        en: 'BEEF / PORK / CHICKEN / Marinated / Cleaning — attach a photo + brief memo per item',
        es: 'BEEF / PORK / CHICKEN / Marinado / Limpieza — adjunta foto + memo breve por ítem',
      },
      checklist: TPL.meat,
      autoMeatDaily: true, noAutoChat: true, points: 3,
    },
  },
  { key:'kfood',
    taskId: 'auto_kfood_daily_all',
    payload: {
      name: '🍙 K-Food 일일 작업 보고',
      nameTr: { ko:'🍙 K-Food 일일 작업 보고', en:'🍙 Daily K-Food Production Report', es:'🍙 Reporte Diario de K-Food' },
      deadline: '18:00', category: 'K-Food', requirePhoto: true, place: 'K-Food 작업장',
      locationNote: '오늘 만든 김밥 / 삼각김밥 / 잡채 / 기타 메뉴 — 각 항목에 만든 개수와 사진 첨부.',
      locationNoteTr: {
        ko: '오늘 만든 김밥 / 삼각김밥 / 잡채 / 기타 메뉴 — 각 항목에 만든 개수와 사진 첨부.',
        en: 'Kimbap / Triangle kimbap / Japchae / Others made today — attach count + photo per item.',
        es: 'Kimbap / Onigiri / Japchae / Otros hechos hoy — adjuntar cantidad + foto por ítem.',
      },
      checklist: TPL.kfood,
      autoKfoodDaily: true, points: 3,
    },
  },
  { key:'seafood',
    taskId: 'auto_seafood_daily_all',
    payload: {
      name: '🐟 해산물 일일 작업 보고',
      nameTr: { ko:'🐟 해산물 일일 작업 보고', en:'🐟 Daily Seafood Report', es:'🐟 Reporte Diario de Mariscos' },
      deadline: '18:00', category: 'Seafood', requirePhoto: true, place: '해산물 작업장',
      locationNote: '오늘 작업한 연어 / 새우 / 고등어 / 기타 — 각 항목에 수량과 사진 첨부.',
      locationNoteTr: {
        ko: '오늘 작업한 연어 / 새우 / 고등어 / 기타 — 각 항목에 수량과 사진 첨부.',
        en: 'Salmon / Shrimp / Mackerel / Others worked today — attach qty + photo per item.',
        es: 'Salmón / Camarón / Caballa / Otros trabajados hoy — adjuntar cant. + foto.',
      },
      checklist: TPL.seafood,
      autoSeafoodDaily: true, points: 3,
    },
  },
  { key:'produce',
    taskId: 'auto_produce_daily_all',
    payload: {
      name: '🥬 농산물 일일 작업 보고',
      nameTr: { ko:'🥬 농산물 일일 작업 보고', en:'🥬 Daily Produce Report', es:'🥬 Reporte Diario de Frutas y Verduras' },
      deadline: '18:00', category: 'Produce', requirePhoto: true, place: '농산물 매대',
      locationNote: '오늘 진열·정리한 BEAN SPROUTS / SHANGHAI / EGGPLANT / 기타 — 각 항목에 상태/수량과 사진.',
      locationNoteTr: {
        ko: '오늘 진열·정리한 BEAN SPROUTS / SHANGHAI / EGGPLANT / 기타 — 각 항목에 상태/수량과 사진.',
        en: 'BEAN SPROUTS / SHANGHAI / EGGPLANT / Others displayed today — attach state/qty + photo.',
        es: 'BROTES / SHANGHAI / BERENJENA / Otros exhibidos hoy — adjuntar estado/cant. + foto.',
      },
      checklist: TPL.produce,
      autoProduceDaily: true, points: 3,
    },
  },
  { key:'frozen',
    taskId: 'auto_frozen_daily_all',
    payload: {
      name: '🧊 냉동고 전체 진열 보고',
      nameTr: { ko:'🧊 냉동고 전체 진열 보고', en:'🧊 Freezer Full Display Report', es:'🧊 Reporte Completo de Congeladores' },
      deadline: '18:00', category: '냉동', requirePhoto: true, place: '냉동 매대',
      locationNote: '냉동 매대(벽) / 냉동 케이스(오픈) / 아이스크림 코너 — 각 구역 진열 상태 사진.',
      locationNoteTr: {
        ko: '냉동 매대(벽) / 냉동 케이스(오픈) / 아이스크림 코너 — 각 구역 진열 상태 사진.',
        en: 'Wall freezer / Open case / Ice cream section — attach a photo of each section\'s display.',
        es: 'Congelador de pared / Caja abierta / Sección de helados — foto de cada sección.',
      },
      checklist: TPL.frozen,
      autoFrozenDaily: true, points: 2,
    },
  },
];

// ─── 헬퍼 ───────────────────────────────────────────────────────
async function getAnonymousToken() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!r.ok) throw new Error(`Auth token fetch failed: HTTP ${r.status}`);
  const d = await r.json();
  return d.idToken;
}

function todayInBranch(){
  // 매장 타임존(미국 동부, 플로리다)의 YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function sendToBranch(branchId, token, today) {
  let created = 0, skipped = 0, failed = 0;
  for (const t of TASKS) {
    const url = `${FB_DB}/tasks/${branchId}/${today}/${t.taskId}.json?auth=${encodeURIComponent(token)}`;
    try {
      const exr = await fetch(url, { cache: 'no-store' });
      if (exr.ok) {
        const ex = await exr.json();
        if (ex && Array.isArray(ex.checklist) && ex.checklist.length >= t.payload.checklist.length) {
          console.log(`  [${branchId}/${t.key}] ⏭ 이미 있음 (skip)`);
          skipped++;
          continue;
        }
      }
      const payload = Object.assign({}, t.payload, {
        assignedTo: '*',
        assignedToId: null,
        from: SENDER,
        fromRole: 'AUTO',
        createdAt: Date.now(),
      });
      const w = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (w.ok) {
        console.log(`  [${branchId}/${t.key}] ✅ 새로 발송 — ${t.taskId}`);
        created++;
      } else {
        const body = await w.text().catch(() => '');
        console.error(`  [${branchId}/${t.key}] ❌ PUT 실패 HTTP ${w.status}: ${body.slice(0, 120)}`);
        failed++;
      }
    } catch (e) {
      console.error(`  [${branchId}/${t.key}] ❌ 예외:`, e.message);
      failed++;
    }
  }
  return { created, skipped, failed };
}

// ─── 메인 ─────────────────────────────────────────────────────
async function main() {
  console.log(`[daily-tasks] BRANCHES=${BRANCHES_TO_RUN.join(',')}, ET date=${todayInBranch()}`);
  const token = await getAnonymousToken();
  console.log(`[daily-tasks] anonymous token: ${token.length} chars`);

  const today = todayInBranch();
  const perBranch = [];
  let totalCreated = 0, totalSkipped = 0, totalFailed = 0;

  for (const br of BRANCHES_TO_RUN) {
    console.log(`\n── ${br} ──`);
    const r = await sendToBranch(br, token, today);
    perBranch.push({ branch: br, ...r });
    totalCreated += r.created;
    totalSkipped += r.skipped;
    totalFailed += r.failed;
  }

  console.log(`\n[daily-tasks] 전체 완료 — 신규 ${totalCreated} · 스킵 ${totalSkipped} · 실패 ${totalFailed} (지점 ${BRANCHES_TO_RUN.length}개)`);

  // 📬 매일 발화 확인용 chat 알림 — '김치마트 앱 랩' 방에 결과 한 줄.
  // 이게 매일 아침 안 오면 = cron 안 돌았다는 뜻 → 즉시 인지 가능.
  // 단, skip 만 일어났으면 (이미 발송됨) 알림 안 보냄 — 채팅방 도배 방지.
  if (totalCreated > 0 || totalFailed > 0) {
    try {
      const room = 'kimchi_mart_app_lab';
      const status = totalFailed > 0 ? '⚠️' : '✅';
      const perBranchLines = perBranch.map(b => `· ${b.branch}: 신규 ${b.created} · 스킵 ${b.skipped} · 실패 ${b.failed}`).join('\n');
      const text = `${status} 일일 보고 자동 발송 (${todayInBranch()})\n` +
                   `전체: 신규 ${totalCreated} · 스킵 ${totalSkipped} · 실패 ${totalFailed}\n` +
                   perBranchLines;
      const ts = Date.now();
      const msgId = 'm' + ts + Math.floor(Math.random()*900);
      await fetch(`${FB_DB}/chat/messages/${room}/${msgId}.json?auth=${encodeURIComponent(token)}`, {
        method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'},
        body: Buffer.from(JSON.stringify({
          sender: 'AUTO 일일 발송',
          senderBranch: 'SYSTEM',
          senderRole: 'AUTO',
          isManager: true,
          color: totalFailed > 0 ? '#dc2626' : '#16a34a',
          text, ts, photos:[], files:[]
        }), 'utf8')
      });
      await fetch(`${FB_DB}/chat/rooms/${room}.json?auth=${encodeURIComponent(token)}`, {
        method:'PATCH', headers:{'Content-Type':'application/json; charset=utf-8'},
        body: Buffer.from(JSON.stringify({ lastMsg: text.split('\n')[0], lastTs: ts, lastSender: 'AUTO 일일 발송' }), 'utf8')
      });
      console.log('[daily-tasks] ✓ chat 알림 발송');
    } catch(e) {
      console.warn('[daily-tasks] chat 알림 실패:', e.message);
    }
  }

  if (totalFailed > 0) process.exit(1);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
