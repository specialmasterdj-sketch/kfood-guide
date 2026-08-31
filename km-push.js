// =============================================================================
// 🔔 km-push.js — FCM 웹푸시 클라이언트 (2026-08-30)
// 앱이 완전히 종료된 폰에도 알림을 보내기 위한 기기 토큰 등록.
//
// 동작 조건 (전부 충족 시에만):
//   1. km-push-config.js 의 window.KM_FCM 3개 키가 채워져 있고
//   2. 브라우저 알림 권한이 이미 '허용' 상태이고 (권한 요청은 채팅 기존 플로우가 담당)
//   3. 본인 등록(chat.me)이 되어 있을 때
// → FCM 기기 토큰을 발급받아 RTDB fcmTokens/<이름>/<토큰> 에 저장.
//   서버(functions/index.js)가 새 메시지 이벤트 때 이 토큰들로 푸시 발송.
// 조건 미충족 시 완전 무동작 — 기존 앱에 영향 0.
// =============================================================================
(function(){
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
  const FB_DB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  function normNamePush(s){ return String(s||'').trim().replace(/\s+/g,'_').replace(/[^A-Za-z0-9_가-힣]/g,'').toUpperCase(); }

  async function register(){
    try {
      const C = window.KM_FCM || {};
      if (!C.vapidKey || !C.messagingSenderId || !C.appId) return;      // 키 미설정 — 무동작
      if (Notification.permission !== 'granted') return;                 // 권한 없으면 다음 기회에
      let me = null;
      try { me = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(_){}
      if (!me || !me.name) return;
      // 같은 토큰 재등록 방지 (7일에 1번만 갱신)
      let last = null;
      try { last = JSON.parse(localStorage.getItem('km.fcm.reg') || 'null'); } catch(_){}
      if (last && last.t && Date.now() - (last.at || 0) < 7 * 86400000) return;

      const { initializeApp, getApps, getApp } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      const { getMessaging, getToken } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js');
      const cfg = {
        apiKey: 'AIzaSyBwL0Wa1Q8aFhZp5hsn9gTw5aZwXUdAVy4',
        authDomain: 'kimchi-mart-order.firebaseapp.com',
        databaseURL: FB_DB,
        projectId: 'kimchi-mart-order',
        storageBucket: 'kimchi-mart-order.firebasestorage.app',
        messagingSenderId: C.messagingSenderId,
        appId: C.appId,
      };
      const app = getApps().length ? getApp() : initializeApp(cfg);
      const messaging = getMessaging(app);
      const reg = await navigator.serviceWorker.ready;   // 기존 sw.js 재사용 (push 핸들러 내장)
      const token = await getToken(messaging, { vapidKey: C.vapidKey, serviceWorkerRegistration: reg });
      if (!token) return;
      const key = normNamePush(me.name);
      // fb-auth-fetch 패치가 auth 토큰을 자동 첨부 (승인 사용자만 쓰기 가능)
      await fetch(FB_DB + '/fcmTokens/' + key + '/' + encodeURIComponent(token) + '.json', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: me.branch || '', ua: (navigator.userAgent || '').slice(0, 80), at: Date.now() }),
      });
      try { localStorage.setItem('km.fcm.reg', JSON.stringify({ t: token, at: Date.now() })); } catch(_){}
      console.info('[km-push] FCM 토큰 등록 완료');
    } catch(e){ console.warn('[km-push]', (e && e.message) || e); }
  }
  // 페이지 로드 8초 후 (초기 로딩 방해 금지) + 권한이 나중에 허용되면 visibility 복귀 때 재시도
  setTimeout(register, 8000);
  document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') setTimeout(register, 3000); });
})();
