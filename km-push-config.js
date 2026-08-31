// 🔔 FCM 웹푸시 설정 — 사장님이 Firebase 콘솔에서 발급한 키를 여기 채우면
// km-push.js 가 자동 활성화됨. 비어 있는 동안은 완전 무동작 (안전).
// 발급 방법: PUSH-SETUP.md 참조.
window.KM_FCM = {
  vapidKey: '',          // 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서 '키 쌍'
  messagingSenderId: '', // 콘솔 → 프로젝트 설정 → 일반 → 클라우드 메시징 발신자 ID
  appId: '',             // 콘솔 → 프로젝트 설정 → 일반 → 웹 앱 → appId
};
