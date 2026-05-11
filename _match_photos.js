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
  KKM: 'KIKKOMAN', OTO: 'OTOKI', NS: 'NONGSHIM', LT: 'LOTTE', CJ: 'CJ',
  HT: 'HAITAI', JS: 'JONGGA', SRS: 'SURASANG', BBG: 'BIBIGO',
  HQ: 'HAEKAR', CKN: 'CHICKEN', FLV: 'FLAVOR', BUL: 'BULDAK',
  ASS: 'ASSI', PD: 'PALDO', WG: 'WANG', WMT: 'WISMETTAC',
};

const SIZE_RE = /\d+(?:\.\d+)?\s*(?:OZ|LB|ML|G|KG|L|FL|PC|PK|CT|CASE|X\d+|#)+/gi;

const STOP = new Set([
  'AND','THE','OF','WITH','FOR','IN','TO','A','AN','OR','BY','ON','AT','FROM',
  'KOREAN','KOREA','JAPANESE','JAPAN','PRODUCT','BRAND','NEW','FRESH','PREMIUM',
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
  return parts.join(' ');
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

function score(aTok, bTok, aSize, bSize){
  if (!aTok.length || !bTok.length) return 0;
  const aSet = new Set(aTok), bSet = new Set(bTok);
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const jacc = inter / (aSet.size + bSet.size - inter);
  let sizeBonus = 0;
  if (aSize.length && bSize.length) {
    const aSz = new Set(aSize);
    for (const s of bSize) if (aSz.has(s)) { sizeBonus = 0.15; break; }
  }
  return jacc + sizeBonus;
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
  const branches = ['CORAL_SPRINGS', 'HOLLYWOOD'];
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
