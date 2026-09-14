# ⚠️ RTDB 규칙은 이 리포에서 배포하지 마십시오

## 지금 상태

- `firebase.json` 에서 **`database` 설정을 뺐습니다.**
  → `firebase deploy` 를 돌려도 규칙은 건드리지 않습니다. (`functions` 만 배포됩니다.)
- 옛 규칙 파일은 `database.rules.STALE-DO-NOT-DEPLOY.json` 으로 이름만 바꿔 남겨뒀습니다.
  **참고용이며, 이 파일을 게시하면 안 됩니다.**

## 왜

로컬 파일이 라이브보다 한참 낡았습니다. 2026-09-14 확인 시점에
**라이브에는 있는데 로컬에는 통째로 없는 규칙**이 최소 셋이었습니다:

| 경로 | 로컬 | 라이브 |
|---|---|---|
| `shopOrders` | ❌ 없음 | ✅ 있음 |
| `membershipApplications` | ❌ 없음 | ✅ 있음 |
| `shopCatalog` | ❌ 없음 | ✅ 있음 |

이 상태로 `firebase deploy --only database` 를 한 번 돌리면
**쇼핑몰·멤버십 관련 규칙이 사라지고 해당 앱이 즉시 멈춥니다.**
경고만으로는 언젠가 사고가 나기 때문에 설정 자체를 빼두었습니다.

## 그럼 규칙은 어떻게 바꾸나

**Firebase Console 에서 손으로 추가합니다.** (지금까지 해온 방식)

```
https://console.firebase.google.com/u/3/project/kimchi-mart-order/database/kimchi-mart-order-default-rtdb/rules
```

> ⚠️ `/u/3` = 사장님(DJ) 계정. `byhoki64@gmail.com` 에는 이 프로젝트 권한이 없습니다
> (2026-09-14 확인 — 콘솔에 `kimchi-opcontrol` 만 보임).
> 권한을 복구하려면: 콘솔 → ⚙️ → 사용자 및 권한 → `byhoki64@gmail.com` 을 **편집자(Editor)** 로 추가.

### 규칙 한 줄 추가하는 요령

1. 편집기에서 **`"rules": {` 바로 다음 줄**에 넣습니다.
   JSON 은 순서가 상관없고, 이 자리는 어떤 구조에서든 확실합니다.
   (특정 키를 앵커로 삼지 마십시오 — 로컬에 있는 키가 라이브엔 없을 수 있습니다.
    실제로 `priceAudit` 을 찾다가 없어서 헤맸습니다.)
2. **다른 줄은 절대 건드리지 마십시오.** 전체 선택 후 붙여넣기는 금물입니다.
3. 게시 버튼이 안 보이면 편집기 안을 클릭하고 **Ctrl+S**.

## 제대로 고치려면 (언젠가)

라이브 규칙을 받아서 로컬을 최신으로 맞춘 뒤 `firebase.json` 에 `database` 를 되살리면
CLI 배포가 다시 안전해집니다. 순서:

1. `firebase login --reauth` — **`kimchi-mart-order` 권한이 있는 계정**으로
2. Console 규칙 편집기에서 **전체를 복사**해 `database.rules.json` 으로 저장
3. `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8'))"` 로 유효성 확인
4. `firebase.json` 에 `"database": { "rules": "database.rules.json" }` 복원
5. `firebase deploy --only database` 로 한 번 왕복시켜 동일한지 확인

이걸 하기 전까지는 **Console 수동 편집이 유일하게 안전한 방법**입니다.
