# 🤖 AI 기능 설치 절차 (번역 + 매장 어시스턴트)

Cloud Function 두 개를 살리는 절차입니다. **API 키 하나로 둘 다 돌아갑니다.**

| 함수 | 하는 일 | 안 켜면 |
|---|---|---|
| `ideaTranslate` | 개선 요청 글을 한/영/스로 번역 | 원문만 보임 (정상 동작) |
| `askAssistant` | 직원 질문에 답변 (근무·업무·앱 안내) | 질문창이 아예 안 보임 |

**한 번만 하면 됩니다.** 안 해도 앱은 정상 동작합니다.

---

## 1. Anthropic API 키 발급

1. <https://console.anthropic.com> 접속 → 로그인/가입
2. **Settings → API Keys → Create Key**
3. 이름은 아무거나 (예: `kimchi-mart-ideas`)
4. **`sk-ant-...` 로 시작하는 키를 복사해 둡니다.**
   ⚠️ 이 화면을 닫으면 다시 못 봅니다. 닫기 전에 복사하세요.

### 결제 · 한도 (중요)

- **Settings → Billing** 에서 크레딧을 충전합니다. **$20 이면 한참 씁니다**
  (번역 1건 ≈ $0.0014 → $20 이면 글 14,000건).
- **Settings → Limits** 에서 **월 지출 한도**를 반드시 걸어두십시오.
  사장님께 "월 $50 을 넘길 수 없는 구조"로 보고했으므로 **$50** 을 권장합니다.
  넘으면 자동으로 멈춥니다.

---

## 2. Firebase CLI 로그인

⚠️ **`kimchi-mart-order` 프로젝트 권한이 있는 계정이어야 합니다.**
현재 `byhoki64@gmail.com` 에는 권한이 없어 **사장님 계정(`specialmasterdj@gmail.com`)** 이 필요합니다.

```bash
cd "C:/Users/speci/OneDrive/Desktop/01_매장운영/kfood-guide"
firebase login --reauth
```

브라우저가 열리면 사장님 계정으로 로그인합니다.
확인:

```bash
firebase projects:list
```

목록에 `kimchi-mart-order` 가 보이면 통과입니다.

---

## 3. API 키를 Secret Manager 에 등록

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY --project kimchi-mart-order
```

프롬프트가 뜨면 1단계에서 복사한 `sk-ant-...` 키를 붙여넣고 Enter.

> 키는 Google Secret Manager 에 저장됩니다. 코드·리포·브라우저 어디에도 남지 않습니다.

---

## 4. 배포

```bash
firebase deploy --only functions --project kimchi-mart-order
```

`ideaTranslate` · `askAssistant` · 기존 `chatPush` 세 개가 올라갑니다.
`✔ Deploy complete!` 가 나오면 끝입니다.

---

## 5. 질문창 켜기 (어시스턴트)

배포가 끝났으면 `tasks.html` 에서 한 줄을 바꿉니다:

```js
const KM_ASK_ENABLED = false;   //  ← 이걸
const KM_ASK_ENABLED = true;    //  ← 이렇게
```

그리고 `sw.js` 의 버전을 하나 올린 뒤 커밋·push 하면 직원 화면에 나타납니다.
배포 전에 켜두면 직원이 눌렀다가 실패만 보기 때문에 순서를 지켜야 합니다.

---

## 6. 확인

1. 업무지시 앱에서 **한국어로** 개선 요청을 하나 올립니다.
2. **10초쯤 기다렸다가** 화면을 새로고침합니다.
3. 우측 상단 언어를 **ES** 로 바꿉니다.
4. 방금 올린 글이 **스페인어로** 보이고, 밑에 `🌐 traducido · Ver original` 이 있으면 성공입니다.

**어시스턴트는** (5번까지 마친 뒤) 업무지시 앱 맨 위 초록색 🤖 칸에서
"내일 나 몇 시 출근?" 을 눌러 봅니다. 본인 근무 시간이 나오면 성공입니다.
스케줄이 등록돼 있지 않은 사람은 "매니저에게 확인하라"는 답이 나오는 게 정상입니다.

안 되면 로그를 봅니다:

```bash
firebase functions:log --only ideaTranslate,askAssistant --project kimchi-mart-order
```

---

## 동작 방식 (참고)

- 글이 `ideas/{지점}/{글id}` 에 저장되면 **서버에서** 트리거가 돕니다.
  API 키가 브라우저로 나가지 않습니다.
- 번역 결과는 `ideas/{지점}/{글id}/tr = {ko, en, es}` 에 붙습니다.
- **글 저장 후**에 번역하므로, 번역이 실패해도 원문은 이미 안전합니다.
- **작성 시 1회만** 번역합니다. 읽을 때는 저장된 걸 쓰므로 조회는 공짜입니다.
- 이미 `tr` 이 있으면 즉시 종료 — 중복 과금이 나지 않습니다.
- 원문 언어는 번역하지 않고 그대로 넣습니다.

## 비용

| 항목 | 비용 |
|---|---|
| 번역 1건 | 약 $0.0014 |
| 질문 1건 | 약 $0.0015 (컨텍스트가 작아 당초 추정의 1/3) |
| 하루 20건 번역 + 300건 질문 | 약 **월 $15** |
| Cloud Functions | $0 (무료 한도 안쪽) |

안전장치 둘:
- 직원 1인당 **하루 질문 20건** (서버에서 차단, `ASK_DAILY_LIMIT`)
- Anthropic 콘솔 **월 지출 한도 $50** — 사장님께 보고한 상한

모델은 둘 다 `claude-haiku-4-5`. 품질이 아쉬우면 `functions/index.js` 의
`model:` 을 `claude-sonnet-5` 로 바꾸면 됩니다 (비용 약 2배, 그래도 월 $30 내외).

---

## 어시스턴트가 답할 수 있는 것 / 없는 것

**답합니다** — 내 근무 일정(7일) · 오늘 내 업무 · 어느 앱이 뭘 하는지.

**못 답합니다** — 상품 위치(매대 데이터가 헐리우드에만 있음) · 가격 · 반품/교환 정책
· 남의 근무 · 다른 지점 데이터. 이런 질문에는 **"모른다, 매니저에게 물어보라"** 고 답합니다.
지어낸 답을 직원이 따라 하면 돈이 틀어지기 때문에 일부러 그렇게 고정했습니다.

범위를 넓히려면 업무 정책을 문서로 정리해 `ASK_SYSTEM` / 컨텍스트에 넣으면 됩니다.
