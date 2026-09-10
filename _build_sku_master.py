# -*- coding: utf-8 -*-
# _build_sku_master.py — 5개 지점 Top 500 합집합 → 핵심 상품 마스터(사진·한글명) 시드
#
# POS 상품명은 약어라 직원이 못 알아보므로, 바코드로 벤더 카탈로그(한글명·사진)와 맞추고
# top500/photos 사진을 붙여 stock-check/sku-master.json 을 만든다.
# 앱은 여기에 없는 것만 직원이 사진 촬영·이름 입력으로 채우고(RTDB skuMaster/{code}), 그게 마스터를 갱신한다.
# 재실행: top500/*.json 이나 벤더 카탈로그가 바뀌었을 때.  python _build_sku_master.py
import io, json, os, re, collections
HERE = os.path.dirname(os.path.abspath(__file__))
O = r"C:\Users\speci\OneDrive\Desktop\06_앱_시스템\kimchi-mart-order"
ORDER_BASE = "https://specialmasterdj-sketch.github.io/kimchi-mart-order/"
BRANCHES = ["MIAMI", "PEMBROKE_PINES", "HOLLYWOOD", "CORAL_SPRINGS", "LASOLAS"]

def cd(s):
    d = [int(x) for x in s]; tot = 0
    for i, x in enumerate(reversed(d)): tot += x * 3 if i % 2 == 0 else x
    return str((10 - tot % 10) % 10)
def norm(c): return re.sub(r"\D", "", str(c or ""))
def variants(c):
    c = norm(c); out = {c}
    if len(c) in (7, 11, 12): out.add(c + cd(c))
    for x in list(out):
        if len(x) == 12: out.add("0" + x)
        if len(x) == 13 and x.startswith("0"): out.add(x[1:])
    return {x for x in out if x}

# 1) 벤더 카탈로그 바코드 인덱스
bc = {}
def add(v, pid, name, kr, img, barcode):
    for k in variants(barcode):
        bc.setdefault(k, (v, pid, name, kr, img))
src = io.open(os.path.join(O, "products.js"), encoding="utf-8", errors="ignore").read()
for vm in re.finditer(r'\n  (\w+): \{\s*\n\s*name: "([^"]*)"', src):
    v = vm.group(1); start = vm.end(); nxt = re.search(r'\n  \w+: \{\s*\n\s*name: "', src[start:]); end = start + (nxt.start() if nxt else len(src) - start)
    for im in re.finditer(r'\{([^{}]*?)\}', src[start:end]):
        b = im.group(1); bm = re.search(r'"?barcode"?:\s*"(\d{7,14})"', b)
        if not bm: continue
        g = lambda k: (re.search(r'"?' + k + r'"?:\s*"([^"]*)"', b) or [None, ""])[1]
        add(v, g("id"), g("name"), g("nameKr"), g("image"), bm.group(1))
for fn, v in (("hanmi_products.js", "wang"), ("cj_products.js", "wang"), ("rheebros_products.js", "rhee_full"), ("wismettac.html", "wismettac")):
    t = io.open(os.path.join(O, fn), encoding="utf-8", errors="ignore").read()
    for im in re.finditer(r'\{"id":"([^"]+)"[^{}]*?\}', t):
        b = im.group(0); bm = re.search(r'"barcode":"(\d{7,14})"', b)
        if not bm: continue
        g = lambda k: (re.search(r'"' + k + r'":"([^"]*)"', b) or [None, ""])[1]
        add(v, im.group(1), g("name"), g("nameKr"), g("image"), bm.group(1))
print("barcode index:", len(bc))

# 2) top500 사진 맵
pm = json.load(io.open(os.path.join(HERE, "top500", "photos-map.json"), encoding="utf-8"))
pfiles = set(os.listdir(os.path.join(HERE, "top500", "photos")))
def photo_for(code):
    for k in variants(code) | {norm(code)}:
        if k in pm and (pm[k] + ".jpg") in pfiles: return "top500/photos/" + pm[k] + ".jpg"
        if (k + ".jpg") in pfiles: return "top500/photos/" + k + ".jpg"
    return ""

# 3) 합집합 마스터
master = {}; stats = collections.Counter()
for b in BRANCHES:
    items = json.load(io.open(os.path.join(HERE, "top500", b + ".json"), encoding="utf-8"))["items"]
    for it in items:
        code = norm(it["code"])
        if not code: continue
        m = master.setdefault(code, {"pos": it["name"], "cat": it["cat"], "dept": it["dept"], "vendor": it.get("vendor", ""), "br": {}})
        m["br"][b] = {"rank": it["rank"], "qty": it.get("qty", 0)}
for code, m in master.items():
    hit = next((bc[k] for k in variants(code) if k in bc), None)
    if hit:
        v, pid, name, kr, img = hit
        m["v"] = v; m["vid"] = pid; m["n"] = name; m["k"] = kr
        if img: m["i"] = img if re.match(r"^https?:", img) else ORDER_BASE + img.lstrip("./")
        stats["catalog"] += 1
    ph = photo_for(code)
    if ph and not m.get("i"): m["i"] = ph; stats["top500photo"] += 1
    if m.get("k"): stats["kr"] += 1
    if m.get("i"): stats["photo"] += 1
out = {"generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"), "count": len(master), "items": master}
io.open(os.path.join(HERE, "stock-check", "sku-master.json"), "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
print("SKU master:", len(master), "codes |", dict(stats))
missing = [c for c, m in master.items() if not m.get("i")]
print("사진 없음:", len(missing), "| 한글명 없음:", sum(1 for m in master.values() if not m.get("k")))
