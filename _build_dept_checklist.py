# _build_dept_checklist.py — 부문별 10시 감독 체크리스트(md) → dept-check.html 설정 JSON
#
# 입력: AI HQ\Operations_Checklists_2026-09\0X_<부문>_10시_영업준비_감독체크리스트.md (B절 표)
# 출력: kfood-guide\stock-check\dept-checklist.json
# 핵심(core) 항목 = B-1 첫 장면 · B-2 필수 품목 · B-4 라벨/영어 사인 · B-7 오더 · B-8 사진 (앱 기본 화면)
# 재실행: 체크리스트 md 를 고칠 때마다.  python _build_dept_checklist.py
import io, json, os, re, sys

SRC = r"C:\Users\speci\OneDrive\Desktop\AI HQ\Operations_Checklists_2026-09"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stock-check", "dept-checklist.json")
VENDORS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stock-check", "catalog", "vendors.json")

DEPTS = [
    {"id": "produce", "ko": "야채 · 과일", "en": "Produce", "icon": "🥬", "room": "produce", "file": "01_야채과일"},
    {"id": "seafood", "ko": "해산물", "en": "Seafood", "icon": "🐟", "room": "seafood_evalution_room", "file": "02_해산물"},
    {"id": "meat", "ko": "정육", "en": "Meat", "icon": "🥩", "room": "meat_evalution_room", "file": "03_정육"},
    {"id": "sushi", "ko": "스시", "en": "Sushi", "icon": "🍣", "room": "sushi", "file": "04_스시"},
    {"id": "bakery", "ko": "베이커리", "en": "Bakery", "icon": "🥐", "room": "bakery_eval", "file": "05_베이커리"},
    {"id": "bbq", "ko": "bb.q 치킨", "en": "bb.q Chicken", "icon": "🍗", "room": "kfood_eval", "file": "06_bbq치킨"},
    {"id": "bibib", "ko": "BIBIB", "en": "BIBIB Deli · Hot Food · Kimchi", "icon": "🍱", "room": "kfood_eval", "file": "07_BIBIB"},
]
CORE_SECTIONS = ("B-1", "B-2", "B-4", "B-7", "B-8")

def clean(s):
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"`", "", s)
    return re.sub(r"\s+", " ", s).strip()

def find_file(prefix):
    for f in os.listdir(SRC):
        if f.startswith(prefix) and f.endswith(".md"):
            return os.path.join(SRC, f)
    return None

vendor_names = []
try:
    for v in json.load(io.open(VENDORS_JSON, encoding="utf-8"))["vendors"]:
        vendor_names.append((v["id"], v["name"], v.get("nameKr", "")))
except Exception as e:
    print("vendors.json 없음", e)

out = {"version": "2026-09", "deadline": "10:00", "depts": []}
for d in DEPTS:
    path = find_file(d["file"])
    dep = {k: d[k] for k in ("id", "ko", "en", "icon", "room")}
    dep["sections"] = []
    dep["vendors"] = []
    if not path:
        dep["missing"] = True
        print("MISSING", d["file"])
        out["depts"].append(dep)
        continue
    text = io.open(path, encoding="utf-8", errors="ignore").read()
    # B절만
    mB = re.search(r"^## B\..*?$", text, re.M)
    mC = re.search(r"^## C\..*?$", text, re.M)
    B = text[mB.end():mC.start()] if (mB and mC) else ""
    # 섹션 분할
    parts = re.split(r"^### (B-[\dⅠⅡⅢⅣⅤ]+)\.?\s*(.*?)$", B, flags=re.M)
    # parts: [pre, code, title, body, code, title, body...]
    n_items = 0
    for i in range(1, len(parts), 3):
        code, title, body = parts[i], clean(parts[i + 1]), parts[i + 2]
        title_ko = title.split(" / ")[0].split(" (")[0].strip()
        sec = {"id": code, "title": f"{code} {title_ko}", "items": []}
        for line in body.splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 3:
                continue
            num = cells[0]
            sub = None
            if re.match(r"^[ⅠⅡⅢⅣⅤ]-\d+$", num) and len(cells) >= 7:
                sub = cells[1]; cells = [cells[0]] + cells[2:]
            elif not re.match(r"^\d+[\-①②③④]*$", num):
                continue
            item_text = clean(cells[1])
            std = clean(cells[2]) if len(cells) > 2 else ""
            how = clean(cells[3]) if len(cells) > 3 else ""
            action = clean(cells[5]) if len(cells) > 5 else (clean(cells[4]) if len(cells) > 4 else "")
            code_for_core = sub if sub else code
            # 영문 병기는 앱에서 길어지므로 한글 우선 (앞 부분만)
            short = item_text.split(" / ")[0] if " / " in item_text else item_text
            sec["items"].append({
                "id": f"{d['id']}-{code}-{num}".replace("Ⅰ","I").replace("Ⅱ","II").replace("Ⅲ","III").replace("Ⅳ","IV"),
                "text": short[:140],
                "std": std[:180],
                "how": how[:120],
                "action": action[:160],
                "core": (code_for_core in CORE_SECTIONS) or ("⭐" in item_text),
            })
        n_items += len(sec["items"])
        if sec["items"]:
            dep["sections"].append(sec)
    # E절에서 벤더 이름 추출
    mE = re.search(r"^## E\..*?$", text, re.M)
    mF = re.search(r"^## F\..*?$", text, re.M)
    E = text[mE.end():mF.start()] if (mE and mF) else text
    seen = set()
    for vid, name, kr in vendor_names:
        key = name.split(" - ")[0].split(" (")[0]
        if (key and key.lower() in E.lower()) or (kr and kr.split(" ")[0] in E):
            if key not in seen:
                seen.add(key); dep["vendors"].append(key)
    print(d["id"], os.path.basename(path), "sections", len(dep["sections"]), "items", n_items, "core", sum(1 for s in dep["sections"] for it in s["items"] if it["core"]), "vendors", dep["vendors"])
    out["depts"].append(dep)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
print("WROTE", OUT, os.path.getsize(OUT), "bytes")
