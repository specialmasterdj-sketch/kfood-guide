// _build_core_catalog.js — 벤더 카탈로그 → 슬림 JSON (stock-check.html 용)
//
// 목적: 발주 앱(kimchi-mart-order)의 카탈로그(products.js 5.5MB 등)를 페이지에서
// 통째로 읽을 수 없으니, 벤더별로 {id → 이름/규격/카테고리/사진} 만 뽑아
// stock-check/catalog/<vendor>.json 으로 저장한다. 페이지는 recs_global 에
// ⭐(TOP PICK) 가 있는 벤더 파일만 골라 읽는다.
//
// Usage: node _build_core_catalog.js [kimchi-mart-order 경로]
// 재실행 시점: 발주 앱 카탈로그(products.js / hanmi_products.js / rheebros_products.js /
//             wismettac.html / namdaemun 브랜드 파일)가 바뀌었을 때.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORDER_DIR = process.argv[2] || path.resolve(__dirname, '..', '..', '06_앱_시스템', 'kimchi-mart-order');
const OUT_DIR = path.join(__dirname, 'stock-check', 'catalog');
fs.mkdirSync(OUT_DIR, { recursive: true });

function readSrc(f) { return fs.readFileSync(path.join(ORDER_DIR, f), 'utf8'); }
function runJs(src, extra) {
  // 브라우저 전역 흉내 — 카탈로그 파일이 window.* / var 로 전역을 만든다.
  const sandbox = { window: {}, document: { addEventListener() {} }, console, localStorage: { getItem() { return null; }, setItem() {} } };
  Object.assign(sandbox, extra || {});
  sandbox.window = sandbox; // window.X = ... 도 sandbox 에 잡히게
  vm.runInNewContext(src, sandbox, { timeout: 60000 });
  return sandbox;
}
function catName(c) { return (c && (c.nameKr || c.name)) || ''; }

const out = {}; // vendor -> { name, nameKr, items:{} }
function ensure(v, name, nameKr) {
  if (!out[v]) out[v] = { vendor: v, name: name || v, nameKr: nameKr || '', items: {} };
  if (name && out[v].name === v) out[v].name = name;
  if (nameKr && !out[v].nameKr) out[v].nameKr = nameKr;
  return out[v];
}
function addItem(v, p, catLabel) {
  if (!p || p.id == null) return;
  const id = String(p.id).trim();
  if (!id) return;
  const bucket = out[v].items;
  if (bucket[id]) return; // 첫 정의 우선
  bucket[id] = {
    n: p.name || p.nameEn || '',
    k: p.nameKr || p.nameKo || '',
    s: p.size || p.packSize || p.pack || '',
    c: catLabel || p.categoryKr || p.category || p.group || '',
    i: p.image || p.img || ''
  };
}

// 1) products.js (자동 발주 앱 — 26개 벤더)
{
  const src = readSrc('products.js');
  const sb = runJs(src + '\n;this.__V = (typeof VENDORS!=="undefined")?VENDORS:(window.VENDORS||null);');
  const V = sb.__V;
  if (!V) throw new Error('products.js: VENDORS 못 찾음');
  for (const vid of Object.keys(V)) {
    const v = V[vid];
    const b = ensure(vid, v.name, v.nameKr);
    const cmap = {};
    (v.categories || []).forEach(c => { cmap[c.id] = catName(c); });
    (v.products || []).forEach(p => addItem(vid, p, cmap[p.category] || p.categoryKr || p.category));
    console.log('products.js', vid, Object.keys(b.items).length);
  }
}

// 2) wang = Hanmi + CJ (hanmi.html 이 vendor:'wang' 으로 ⭐ 저장)
{
  const sb = runJs(readSrc('hanmi_products.js') + '\n' + readSrc('cj_products.js') +
    '\n;this.__H = window.HANMI_PRODUCTS||HANMI_PRODUCTS; this.__C = (typeof CJ_PRODUCTS!=="undefined")?CJ_PRODUCTS:window.CJ_PRODUCTS;');
  const b = ensure('wang', 'Wang Global (Hanmi + CJ)', '왕글로벌 (한미 + CJ)');
  (sb.__H || []).forEach(p => addItem('wang', p, p.categoryKr || p.category));
  (sb.__C || []).forEach(p => addItem('wang', p, (p.categoryKr || p.category) ? 'CJ · ' + (p.categoryKr || p.category) : 'CJ'));
  console.log('wang', Object.keys(b.items).length);
}

// 3) rhee_full = rheebros_products.js (rheebros.html 전용 카탈로그, ⭐ 374개 기준)
{
  const sb = runJs(readSrc('rheebros_products.js') + '\n;this.__R = window.RHEE_PRODUCTS||RHEE_PRODUCTS;');
  const b = ensure('rhee_full', 'Rhee Bros', '리브라더스');
  // rheebros 전용 카탈로그를 products.js 보다 우선 — 같은 id 면 덮어씀
  (sb.__R || []).forEach(p => {
    const id = String(p.id).trim(); if (!id) return;
    b.items[id] = { n: p.name || '', k: p.nameKr || '', s: p.size || '', c: p.categoryKr || p.category || '', i: p.image || '' };
  });
  console.log('rhee_full', Object.keys(b.items).length);
}

// 4) wismettac = wismettac.html 안의 인라인 PRODUCTS
{
  const html = readSrc('wismettac.html');
  const m = html.match(/const PRODUCTS\s*=\s*(\[[\s\S]*?\]);\s*\n/);
  if (m) {
    let arr = null;
    try { arr = JSON.parse(m[1]); } catch (e) { arr = runJs('this.__W=' + m[1] + ';').__W; }
    const b = ensure('wismettac', 'Wismettac', '위스메탁');
    (arr || []).forEach(p => {
      const id = String(p.id).trim(); if (!id) return;
      b.items[id] = { n: p.name || '', k: p.nameKr || '', s: p.packSize || p.size || '', c: p.category || p.group || '', i: p.image || '' };
    });
    console.log('wismettac(inline)', (arr || []).length);
  } else console.warn('wismettac.html: PRODUCTS 인라인 못 찾음');
}

// 5) namdaemun 브랜드 파일 (jayone / ottogi / pulmuone / sempio / chungjungone)
{
  const files = ['jayone_products.js', 'ottogi_products.js', 'pulmuone_products.js', 'sempio_products.js', 'chungjungone_products.js'];
  let src = '';
  for (const f of files) { try { src += readSrc(f) + '\n'; } catch (e) { console.warn('skip', f); } }
  const sb = runJs(src + '\n;this.__ALL = Object.keys(this).filter(k=>/PRODUCTS|ITEMS/.test(k)).map(k=>[k,this[k]]);');
  const b = ensure('namdaemun', 'Namdaemun', '남대문');
  (sb.__ALL || []).forEach(([k, val]) => {
    if (!Array.isArray(val)) return;
    const brand = k.replace(/_?(PRODUCTS|ITEMS)$/, '');
    val.forEach(p => addItem('namdaemun', p, (p.categoryKr || p.category) ? brand + ' · ' + (p.categoryKr || p.category) : brand));
  });
  console.log('namdaemun(+brands)', Object.keys(b.items).length);
}

// 저장
const vendors = [];
for (const vid of Object.keys(out)) {
  const b = out[vid];
  const n = Object.keys(b.items).length;
  if (!n) continue;
  fs.writeFileSync(path.join(OUT_DIR, vid + '.json'), JSON.stringify(b));
  vendors.push({ id: vid, name: b.name, nameKr: b.nameKr, count: n });
}
fs.writeFileSync(path.join(OUT_DIR, 'vendors.json'), JSON.stringify({ generatedAt: new Date().toISOString(), vendors }, null, 1));
console.log('DONE vendors:', vendors.length, '→', OUT_DIR);
