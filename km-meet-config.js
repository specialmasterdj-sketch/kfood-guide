// 📹 화상 회의 설정 — meet.html 이 읽는다.
//
// 지금은 **Google Meet 링크를 앱 안에서 저장해 쓰는 방식**이다.
//   회사 메일이 Google Workspace 위에 있어(MX 가 전부 aspmx.l.google.com)
//   Meet 그룹 통화에 시간 제한이 없고 100명까지 들어온다. 5지점은 넉넉하다.
//   링크는 임원이 앱 화면의 [⚙ 회의 링크] 로 넣는다 — 여기 적을 필요 없다.
//
// 나중에 "앱을 떠나지 않고 이 화면 안에서 통화하고 싶다" 가 되면
// Daily(daily.co) 에 가입해 받은 **내 도메인 이름만** 아래에 채운다.
//   예) 주소가 https://kimchimart.daily.co/all 이면 dailyDomain: 'kimchimart'
//   채우는 순간 meet.html 이 iframe 으로 이 화면 안에 영상을 띄운다.
//   (Google Meet 은 iframe 을 막아 두어 이 방식이 안 된다 — 그래서 Daily 를 쓴다)
//   값이 비어 있는 동안은 완전 무동작 — 지금 방식 그대로다.
window.KM_MEET = {
  dailyDomain: '',
};
