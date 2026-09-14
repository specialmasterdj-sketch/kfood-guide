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
