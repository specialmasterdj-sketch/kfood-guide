# 🔔 완전 종료 푸시(FCM) — 남은 설정 5분 (사장님 계정으로만 가능)

앱 쪽 코드는 전부 배포돼 있고 **키만 채우면 자동 활성**됩니다. 키가 비어 있는 동안은 완전 무동작(안전).

## 1. 키 3개 발급 (Firebase 콘솔, 약 3분)

1. https://console.firebase.google.com → **kimchi-mart-order** 프로젝트 → ⚙️ **프로젝트 설정**
2. **일반** 탭에서:
   - `클라우드 메시징 발신자 ID` (숫자) 복사 → ①
   - 아래 "내 앱"의 **웹 앱** `appId` (`1:...:web:...` 형태) 복사 → ② (웹 앱이 없으면 [앱 추가 → 웹] 한 번 클릭해 생성)
3. **클라우드 메시징** 탭 → 아래 **웹 구성 / 웹 푸시 인증서** → [키 쌍 생성] → 생성된 키 복사 → ③

→ **①②③ 세 개를 채팅으로 저(Claude)에게 주시면**, 제가 `km-push-config.js` 에 넣어 배포합니다. 그 순간부터 전 기기가 자동으로 토큰 등록을 시작합니다.

## 2. 발송 서버 배포 (약 2분, 1회)

컴퓨터에서 터미널 열고:

```bash
cd "C:\Users\speci\OneDrive\Desktop\01_매장운영\kfood-guide"
npx firebase-tools login
npx firebase-tools deploy --only functions --project kimchi-mart-order
```

- 로그인 창이 뜨면 **specialmasterdj@gmail.com** 으로 로그인만 해주세요 (배포는 자동).
- Blaze 요금제 안내가 뜨면 승인 필요 (무료 한도 내 사용량 — 채팅 푸시 규모로는 월 $0 예상).

## 이후 동작 (자동)

- 1:1 메시지 → 상대 폰에 푸시 (사장님 발신이면 제목 **👑 Owner's Message**)
- 매니저룸 메시지 → **오너에게만** 푸시
- 다른 방은 푸시 없음 (도배 방지) · 만료 토큰 자동 청소 · 앱 완전 종료 상태에서도 도착
