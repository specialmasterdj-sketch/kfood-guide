// One-shot: parse 위판매순.csv → top500.json (sorted by units sold desc).
// 회전율 높은 상위 500개 SKU 만 추출해 재고관리 우선순위 리스트로 사용.
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'C:/Users/speci/Downloads/위판매순.csv';
const OUT = process.argv[3] || path.join(__dirname, 'top500.json');

const raw = fs.readFileSync(SRC, 'utf8');

// Simple CSV parser that handles quoted fields with embedded commas
function parseCSV(text){
  const rows = [];
  let cur = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { inQuote = false; }
      } else { field += c; }
    } else {
      if (c === '"') { inQuote = true; }
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

const rows = parseCSV(raw);
const header = rows[0].map(h => h.trim());
// Expected: DEPARTMENT,::CAT::,::VENDOR::,CODE,PRODUCT,QTY,VLM,SBTLS,COST,PRF
const idx = (n) => header.indexOf(n);
const I = {
  dep: idx('DEPARTMENT'),
  cat: idx('::CAT::'),
  ven: idx('::VENDOR::'),
  code: idx('CODE'),
  name: idx('PRODUCT'),
  qty: idx('QTY'),
  sbtls: idx('SBTLS'),
  cost: idx('COST'),
  prf: idx('PRF'),
};

function num(s){ return parseFloat(String(s||'').replace(/[",]/g, '')) || 0; }

// 야채/고기/생선은 별도 일일 작업 보고로 관리 — 일반 SKU top500 에서 제외.
// 매니저 요청: PRODUCE (FRUITS, VEGETABLE) + MEAT/SEAFOOD (MEAT, SEAFOOD,
// MARINATED MEAT) 통째로 제외해 grocery/dry/frozen/snacks 위주의 진열 관리만.
const EXCLUDE_DEPTS = new Set(['PRODUCE', 'MEAT/SEAFOOD']);
// 짧은 PLU 코드 (3~6 자리) 는 매장 내부 제조품 (김치, 김밥, 반찬 등) — 별도 관리.
// 진짜 UPC/EAN 바코드는 8자리 이상이므로 7자리 미만 자동 제외.
const MIN_CODE_LEN = 7;

const products = [];
const excluded = { byDept: {}, total: 0, shortCode: 0 };
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.length < 5) continue;
  const code = String(row[I.code] || '').trim();
  const name = String(row[I.name] || '').trim();
  if (!code) continue;
  if (/- ITEM$/.test(name)) continue;
  const qty = num(row[I.qty]);
  if (qty <= 0) continue;
  const dept = String(row[I.dep]||'').trim();
  if (EXCLUDE_DEPTS.has(dept)) {
    excluded.byDept[dept] = (excluded.byDept[dept]||0) + 1;
    excluded.total++;
    continue;
  }
  // 짧은 코드 (매장 내부 PLU — 김치, 김밥, 반찬 등) 제외
  if (code.length < MIN_CODE_LEN) {
    excluded.shortCode++;
    excluded.total++;
    continue;
  }
  products.push({
    code,
    name,
    dept,
    cat: String(row[I.cat]||'').trim(),
    vendor: String(row[I.ven]||'').trim(),
    qty,
    sbtls: num(row[I.sbtls]),
    cost: num(row[I.cost]),
    prf: num(row[I.prf]),
  });
}
console.log('Excluded (managed separately via daily report):', excluded.total, 'SKUs');
Object.entries(excluded.byDept).forEach(([d,n]) => console.log('  ' + d + ': ' + n));
console.log('  short code (<' + MIN_CODE_LEN + ' chars, in-house PLU): ' + excluded.shortCode);

// Sort by QTY desc (highest turnover first — most likely to run out)
products.sort((a, b) => b.qty - a.qty);

const top = products.slice(0, 500).map((p, i) => Object.assign({ rank: i+1 }, p));

// Some quick stats
const totalQty = products.reduce((s,p) => s+p.qty, 0);
const top500Qty = top.reduce((s,p) => s+p.qty, 0);
const totalSbtls = products.reduce((s,p) => s+p.sbtls, 0);
const top500Sbtls = top.reduce((s,p) => s+p.sbtls, 0);

console.log('Total SKUs with sales:', products.length);
console.log('Top 500 covers', ((top500Qty/totalQty)*100).toFixed(1)+'% of unit volume');
console.log('Top 500 covers', ((top500Sbtls/totalSbtls)*100).toFixed(1)+'% of revenue');
console.log('Top 1 sales:', top[0].qty, 'units —', top[0].name);
console.log('Bottom of top500:', top[499]?.qty, 'units —', top[499]?.name);

// Category counts in top 500
const byCat = {};
top.forEach(p => { byCat[p.cat] = (byCat[p.cat]||0) + 1; });
console.log('\nBy category (top 10):');
Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([c,n]) => console.log('  ' + c + ': ' + n));

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: Date.now(),
  source: path.basename(SRC),
  totalSKUs: products.length,
  coverageQty: top500Qty / totalQty,
  coverageRevenue: top500Sbtls / totalSbtls,
  items: top,
}, null, 2));
console.log('\nWrote ' + OUT);
