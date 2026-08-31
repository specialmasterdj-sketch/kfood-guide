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
