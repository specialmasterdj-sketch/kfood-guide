// Top500 상품 ↔ kimchi-mart-order 카탈로그 이미지 매칭.
// 출력:
//   top500/photos/<safeCode>.jpg  — 압축된 JPEG (브라우저가 개별 캐시 + lazy load)
//   top500/photos-map.json        — { UPC: safeCode } 작은 매핑 파일
// top500.html 이 사용자 RTDB 사진과 함께 머지해 표시 (RTDB 우선, static fallback).
//
// 매칭 전략: 토큰 Jaccard + 사이즈 토큰 보너스 + 브랜드 약어 정규화.

const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/speci/OneDrive/Desktop/kimchi-mart-order/node_modules/sharp');

const KMO_DIR = 'C:/Users/speci/OneDrive/Desktop/kimchi-mart-order';
const OUT_DIR = path.join(__dirname, 'top500', 'photos');
const OUT_MAP = path.join(__dirname, 'top500', 'photos-map.json');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// 브랜드 약어 → 풀네임 (top500 이름이 짧고 카탈로그가 김)
const BRAND = {
  HSE: 'HOUSE', QP: 'KEWPIE', SY: 'SAMYANG', TYJ: 'TEEYIHJIA', BGR: 'BINGGRAE',
  KKM: 'KIKKOMAN', OTO: 'OTOKI', NS: 'NONGSHIM', LT: 'LOTTE',
  HT: 'HAITAI', JS: 'JONGGA', SRS: 'SURASANG', BBG: 'BIBIGO',
  ASS: 'ASSI', PD: 'PALDO', WG: 'WANG',
  LKK: 'LEEKUMKEE', LS: 'LAYS', SLW: 'SOULWELL',
};

// 붙여 쓴 합성어 분리 — top500 이 "ICECREAM" 카탈로그 "ICE CREAM" 인 케이스
const COMPOUND = {
  ICECREAM: 'ICE CREAM',
  RICECAKE: 'RICE CAKE',
  SOYMILK: 'SOY MILK',
  SOYSAUCE: 'SOY SAUCE',
  RICEPAPER: 'RICE PAPER',
  GREENONION: 'GREEN ONION',
  BLACKBEAN: 'BLACK BEAN',
  GLUTENFREE: 'GLUTEN FREE',
  HOTPOT: 'HOT POT',
};

// Generic 토큰 — 두 개 이상 매칭되어야 의미. 단독 매치는 가중치 낮음 (SMART WATER vs COCONUT WATER 같은 false positive 방지).
const GENERIC = new Set([
  'ICE','CREAM','RICE','MILK','WATER','DRINK','SAUCE','SOUP','SODA',
  'NOODLE','NOODLES','RAMEN','CHIP','CHIPS','SNACK','SNACKS','CANDY',
  'FLAVOR','FLAVORED','FLAVOURED','STYLE','JUICE','PASTE','TEA','COFFEE',
  'TYPE','COOKED','ORIGINAL','PREMIUM','HOT','COLD','SWEET','SPICY',
  'CRACKER','COOKIE','CAKE','BREAD','BUN','RICE',
  'POWDER','LIQUID','POUCH','CUP','BOWL','BOTTLE','CAN',
]);

const SIZE_RE = /\d+(?:\.\d+)?\s*(?:OZ|LB|ML|G|KG|L|FL|PC|PK|CT|CASE|X\d+|#)+/gi;

const STOP = new Set([
  'AND','THE','OF','WITH','FOR','IN','TO','A','AN','OR','BY','ON','AT','FROM',
  'KOREAN','KOREA','JAPANESE','JAPAN','PRODUCT','BRAND','NEW','FRESH',
  'EA','CT','PC','PCS','PK','OZ','LB','ML','G','KG','L','FL','BOX','BAG','EACH',
  '&','-','+','/',
]);

function normalize(s){
  if (!s) return '';
  let t = String(s).toUpperCase()
    .replace(/[-￿]/g, ' ')
    .replace(/[^A-Z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const parts = t.split(' ');
  if (BRAND[parts[0]]) parts[0] = BRAND[parts[0]];
  // Compound word 분리 — ICECREAM → ICE CREAM
  t = parts.join(' ');
  for (const [c, ex] of Object.entries(COMPOUND)){
    t = t.replace(new RegExp('\\b'+c+'\\b', 'g'), ex);
  }
  return t;
}

function tokens(s){
  return normalize(s).split(' ')
    .filter(tok => tok && !STOP.has(tok) && tok.length >= 2)
    .filter(tok => !/^\d+$/.test(tok) || tok.length >= 4);
}

function sizeTokens(s){
  const m = String(s||'').toUpperCase().match(SIZE_RE) || [];
  return m.map(x => x.replace(/\s+/g,''));
}

// Prefix-5 키 — 오타 / 변형 (MAYONNASE ↔ MAYONNAISE) 흡수.
// 6글자 이상 토큰은 첫 5글자로 매칭. 짧은 토큰은 그대로.
function tokenKey(tok){
  return tok.length >= 6 ? tok.slice(0, 5) : tok;
}

// 점수 계산: jaccard + containment + generic-aware
// - 최소 2개 토큰 또는 1개 + 사이즈 일치 필요
// - generic-only 매치는 약하게, significant 토큰 보너스
function score(aTok, bTok, aSize, bSize){
  if (!aTok.length || !bTok.length) return 0;
  const aKeys = new Set(aTok.map(tokenKey));
  const bKeys = new Set(bTok.map(tokenKey));
  // 원래 토큰들로 generic 여부 판정 — keys 는 prefix 라 generic 여부 알 수 없음
  const aGen = new Set(aTok.filter(t => GENERIC.has(t)).map(tokenKey));
  const bGen = new Set(bTok.filter(t => GENERIC.has(t)).map(tokenKey));
  let interSig = 0, interGen = 0;
  for (const k of aKeys){
    if (!bKeys.has(k)) continue;
    if (aGen.has(k) || bGen.has(k)) interGen++;
    else interSig++;
  }
  const inter = interSig + interGen;
  // 최소 2개 토큰 매치 필요 (그 중 최소 1개는 significant)
  if (inter < 2 || interSig < 1) return 0;

  const jacc = inter / (aKeys.size + bKeys.size - inter);
  const cont = inter / Math.min(aKeys.size, bKeys.size);
  // Containment 가중치 더 — 짧은 top500 이름이 긴 카탈로그에 포함되면 강한 신호
  const combined = jacc * 0.3 + cont * 0.7;
  const sigBonus = Math.min(interSig * 0.04, 0.12);
  let sizeBonus = 0;
  if (aSize.length && bSize.length) {
    const aSz = new Set(aSize);
    for (const s of bSize) if (aSz.has(s)) { sizeBonus = 0.15; break; }
  }
  return combined + sigBonus + sizeBonus;
}

// safeCode: 파일명용. UPC 의 `=` 등 특수문자 제거.
function safeCodeFor(code){
  return String(code).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ============== Load catalog ==============
console.log('Loading vendor_images.json…');
const vi = JSON.parse(fs.readFileSync(path.join(KMO_DIR, 'vendor_images.json'),'utf8'));

const CAT = [];
let kept = 0, skipped = 0;
for (const [id, ent] of Object.entries(vi)){
  if (!ent || !ent.image || !ent.name) { skipped++; continue; }
  if (ent.image.startsWith('http')) { skipped++; continue; }
  const fullPath = path.join(KMO_DIR, ent.image);
  if (!fs.existsSync(fullPath)) { skipped++; continue; }
  CAT.push({
    name: ent.name,
    image: fullPath,
    vendor: ent.vendor,
    nameTok: tokens(ent.name),
    nameSize: sizeTokens(ent.name),
  });
  kept++;
}
console.log(`Catalog: ${kept} entries with local images (${skipped} skipped)`);

// ============== Match top500 ==============
function matchBranch(branchId){
  const jsonPath = path.join(__dirname, 'top500', branchId + '.json');
  if (!fs.existsSync(jsonPath)) return [];
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const items = data.items || [];
  console.log(`\n=== ${branchId}: ${items.length} items ===`);
  const out = [];
  let matched = 0;
  for (const p of items){
    const aTok = tokens(p.name);
    const aSize = sizeTokens(p.name);
    let best = null, bestScore = 0;
    for (const c of CAT){
      const sc = score(aTok, c.nameTok, aSize, c.nameSize);
      if (sc > bestScore){ bestScore = sc; best = c; }
    }
    if (bestScore >= 0.55){
      out.push({ code: p.code, name: p.name, match: best.name, image: best.image, score: bestScore });
      matched++;
    }
  }
  console.log(`  matched (≥0.55): ${matched}`);
  return out;
}

// ============== Compress ==============
async function compressToFile(srcPath, outPath){
  await sharp(srcPath)
    .resize(220, 220, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(outPath);
}

(async function main(){
  const branches = ['CORAL_SPRINGS', 'HOLLYWOOD', 'LASOLAS'];
  const allMatches = [];
  for (const b of branches){
    allMatches.push(...matchBranch(b));
  }
  // dedupe by code
  const byCode = {};
  for (const m of allMatches){
    if (!byCode[m.code] || m.score > byCode[m.code].score) byCode[m.code] = m;
  }
  const unique = Object.values(byCode);
  console.log(`\nUnique matched codes: ${unique.length}`);

  // Clean output dir first
  for (const f of fs.readdirSync(OUT_DIR)){
    if (f.endsWith('.jpg')) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  // Compress each → JPEG file
  console.log('Compressing images…');
  const photoMap = {};
  let done = 0, fail = 0;
  let totalBytes = 0;
  for (const m of unique){
    const safe = safeCodeFor(m.code);
    const outPath = path.join(OUT_DIR, safe + '.jpg');
    try {
      await compressToFile(m.image, outPath);
      photoMap[m.code] = safe;
      totalBytes += fs.statSync(outPath).size;
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${unique.length}…`);
    } catch(e) {
      fail++;
      console.warn(`  fail ${m.code}: ${e.message}`);
    }
  }
  console.log(`Compressed: ${done} ok, ${fail} failed`);
  console.log(`Total on disk: ${(totalBytes/1024).toFixed(0)} KB (avg ${(totalBytes/done).toFixed(0)} bytes/photo)`);

  console.log('\nSample matches (top 10 highest score):');
  unique.sort((a,b) => b.score - a.score).slice(0,10).forEach(m =>
    console.log(`  ${m.score.toFixed(2)} | ${m.code} | ${m.name}  ←→  ${m.match}`));

  fs.writeFileSync(OUT_MAP, JSON.stringify(photoMap, null, 2));
  console.log(`\nWrote ${OUT_MAP} (${Object.keys(photoMap).length} entries)`);
})().catch(e => { console.error(e); process.exit(1); });
