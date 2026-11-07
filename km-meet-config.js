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
// 2026-11-06 전무님 가입 완료 — 회의 영상을 앱 화면 안에서 연다(통역을 같은 화면에서 쓰려고).
// dailyRooms 에 적힌 방만 Daily 로 열고, 없는 방은 예전대로 Jitsi 새 창으로 연다.
// 방을 새로 만들 때마다 여기에 한 줄 더한다 (대시보드 ▸ Rooms ▸ Create room).
window.KM_MEET = {
  dailyDomain: 'kimchimart',
  dailyRooms: {
    // 2026-11-06 전무님 카드 등록·요금제 올림 → 아홉 방을 모두 Daily 로 옮겼다.
    //   만든 도구: _Claude_Tools/daily_rooms_make.js (할리우드 방 설정을 그대로 베낀다)
    //   🔴 이 목록에서 이름을 지우면 그 방은 Jitsi 새 창으로 되돌아간다 — 통역이 따로 논다.
    HOLLYWOOD:      'store-hollywood',
    MIAMI:          'store-miami',
    PEMBROKE_PINES: 'store-pembroke-pines',
    CORAL_SPRINGS:  'store-coral-springs',
    LASOLAS:        'store-lasolas',
    all:            'allbranch',
    k_mgr:          'council',
    k_bm:           'branchmgrs',
    k_urgent:       'emergency',
  },
};
