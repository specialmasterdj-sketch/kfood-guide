// Top500 상품 ↔ 카탈로그 이미지 매칭 — 바코드 우선, 이름 매칭 fallback.
//
// 매칭 전략 (전무 제안: 바코드 우선이 false positive 없고 정확):
//   1. 카탈로그 products.js (rheebros + hanmi + cj + jayone + wismettac/main) 에서
//      바코드 + 이미지 가진 ~5,300개 항목 추출
//   2. 각 top500 코드 (Vela POS, 마지막 자리 없음) 를 다양한 방식으로 매칭:
//      - 정확 일치
//      - 앞에 = 또는 0 붙은 변형
//      - 11자리 prefix (Vela 가 check digit 잘림)
//      - 카탈로그 바코드의 처음 N자리 일치
//   3. 바코드 매칭 안 된 항목만 이름 매칭 (fuzzy Jaccard + 합성어 + prefix-5)
//
// 출력:
//   top500/photos/<safeCode>.jpg  — JPEG 220×220 quality 72 (sharp/mozjpeg)
//   top500/photos-map.json         — { 코드: safeCode, source: 'barcode'|'name' }

const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/speci/OneDrive/Desktop/kimchi-mart-order/node_modules/sharp');

const KMO_DIR = 'C:/Users/speci/OneDrive/Desktop/kimchi-mart-order';
const OUT_DIR = path.join(__dirname, 'top500', 'photos');
const OUT_MAP = path.join(__dirname, 'top500', 'photos-map.json');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ============== 1. Barcode-indexed catalog 로딩 ==============
// kimchi-mart-order/*products*.js 파일에서 바코드+이미지 추출.
// 각 파일이 JS 객체 리터럴이라 직접 require 못 함 → 정규식으로 entry 추출.

function extractEntriesFromJSFile(filePath){
  // products.js 가 4MB 라서 한번에 정규식 처리. 메모리는 충분.
  const txt = fs.readFileSync(filePath, 'utf8');
  // 다양한 객체 리터럴 패턴 캐치 — barcode + image 모두 가진 것만.
  // { ... barcode: "..." ... image: "..." ... }  OR  { ... image: "..." ... barcode: "..." ... }
  // 키는 따옴표 있/없을 수 있음.
  const entries = [];
  // 단일 객체 단위로 잡기 — { ... } 안에 barcode 와 image 둘 다 있는지 확인.
  // 객체 nesting 깊지 않다고 가정 (실제로 평탄한 구조)
  const objRe = /\{[^{}]*\}/g;
  let m;
  while ((m = objRe.exec(txt)) !== null){
    const obj = m[0];
    const barcodeM = obj.match(/(?:^|\s|,)["']?barcode["']?\s*:\s*["']([^"']*)["']/);
    const imageM = obj.match(/(?:^|\s|,)["']?image["']?\s*:\s*["']([^"']+)["']/);
    const nameM = obj.match(/(?:^|\s|,)["']?name["']?\s*:\s*["']([^"']+)["']/);
    const idM = obj.match(/(?:^|\s|,)["']?id["']?\s*:\s*["']([^"']+)["']/);
    if (!barcodeM || !imageM) continue;
    const barcode = String(barcodeM[1]||'').trim();
    const image = String(imageM[1]||'').trim();
    if (!barcode || !image) continue;
    entries.push({
      barcode,
      image,
      name: nameM ? nameM[1] : '',
      id: idM ? idM[1] : '',
      source: path.basename(filePath),
    });
  }
  return entries;
}

// Vela CODE 는 보통 check digit 잘려 11자리. 다양한 변형 생성해서 매칭 시도.
// 카탈로그 바코드는 12자리 UPC 또는 13자리 EAN 가능.
function barcodeVariants(code){
  const s = String(code||'').trim();
  if (!s) return [];
  const out = new Set();
  // 원형
  out.add(s);
  // = prefix 제거 (Vela CSV export 시 텍스트 강제 형식)
  if (s.startsWith('=')) out.add(s.slice(1));
  // 앞 0 제거/추가
  out.add(s.replace(/^0+/, ''));
  out.add('0' + s);
  // = 떼고 정규화한 키도
  const noEq = s.replace(/^=+/, '');
  out.add(noEq);
  out.add(noEq.replace(/^0+/, ''));
  out.add('0' + noEq);
  return Array.from(out).filter(x => x.length >= 6);
}

console.log('Loading product catalogs (with barcodes)…');
const PRODUCT_FILES = [
  'products.js', 'hanmi_products.js', 'cj_products.js',
  'jayone_products.js', 'rheebros_products.js',
];
const BARCODE_INDEX = new Map();   // 키: 다양한 변형 → { barcode, image, name }
let totalEntries = 0;
for (const f of PRODUCT_FILES){
  const full = path.join(KMO_DIR, f);
  if (!fs.existsSync(full)){ console.log('  '+f+': skip (not found)'); continue; }
  const entries = extractEntriesFromJSFile(full);
  let added = 0;
  for (const e of entries){
    // image path 가 로컬인지 확인
    if (e.image.startsWith('http')) continue;
    const imgPath = path.join(KMO_DIR, e.image);
    if (!fs.existsSync(imgPath)) continue;
    e.image = imgPath;
    // 바코드 변형들을 모두 인덱스에 등록 — 첫번째 항목 우선 (중복 무시)
    for (const v of barcodeVariants(e.barcode)){
      if (!BARCODE_INDEX.has(v)) BARCODE_INDEX.set(v, e);
    }
    // prefix 11 자리도 등록 (Vela 호환)
    const cleanBc = e.barcode.replace(/[^0-9]/g, '');
    if (cleanBc.length >= 11){
      const prefix11 = cleanBc.slice(0, 11);
      if (!BARCODE_INDEX.has(prefix11)) BARCODE_INDEX.set(prefix11, e);
      const prefix12 = cleanBc.slice(0, 12);
      if (cleanBc.length >= 12 && !BARCODE_INDEX.has(prefix12)) BARCODE_INDEX.set(prefix12, e);
    }
    added++;
  }
  console.log('  '+f+': '+added+' barcode+image entries');
  totalEntries += added;
}
console.log('Total barcode keys in index: '+BARCODE_INDEX.size+' ('+totalEntries+' products)');

// ============== 2. Name-match fallback (이전 알고리즘) ==============
const BRAND = {
  HSE:'HOUSE',QP:'KEWPIE',SY:'SAMYANG',TYJ:'TEEYIHJIA',BGR:'BINGGRAE',
  KKM:'KIKKOMAN',OTO:'OTOKI',NS:'NONGSHIM',LT:'LOTTE',HT:'HAITAI',
  JS:'JONGGA',SRS:'SURASANG',BBG:'BIBIGO',ASS:'ASSI',PD:'PALDO',WG:'WANG',
  LKK:'LEEKUMKEE',LS:'LAYS',SLW:'SOULWELL',
};
const COMPOUND = {
  ICECREAM:'ICE CREAM',RICECAKE:'RICE CAKE',SOYMILK:'SOY MILK',
  SOYSAUCE:'SOY SAUCE',RICEPAPER:'RICE PAPER',GREENONION:'GREEN ONION',
  BLACKBEAN:'BLACK BEAN',GLUTENFREE:'GLUTEN FREE',HOTPOT:'HOT POT',
};
const GENERIC = new Set([
  'ICE','CREAM','RICE','MILK','WATER','DRINK','SAUCE','SOUP','SODA',
  'NOODLE','NOODLES','RAMEN','CHIP','CHIPS','SNACK','SNACKS','CANDY',
  'FLAVOR','FLAVORED','FLAVOURED','STYLE','JUICE','PASTE','TEA','COFFEE',
  'TYPE','COOKED','ORIGINAL','PREMIUM','HOT','COLD','SWEET','SPICY',
  'CRACKER','COOKIE','CAKE','BREAD','BUN','POWDER','LIQUID','POUCH','CUP','BOWL','BOTTLE','CAN',
]);
const SIZE_RE = /\d+(?:\.\d+)?\s*(?:OZ|LB|ML|G|KG|L|FL|PC|PK|CT|CASE|X\d+|#)+/gi;
const STOP = new Set([
  'AND','THE','OF','WITH','FOR','IN','TO','A','AN','OR','BY','ON','AT','FROM',
  'KOREAN','KOREA','JAPANESE','JAPAN','PRODUCT','BRAND','NEW','FRESH',
  'EA','CT','PC','PCS','PK','OZ','LB','ML','G','KG','L','FL','BOX','BAG','EACH',
]);
function normalize(s){
  if(!s) return '';
  let t=String(s).toUpperCase().replace(/[-￿]/g,' ').replace(/[^A-Z0-9\s.]/g,' ').replace(/\s+/g,' ').trim();
  const parts=t.split(' ');
  if(BRAND[parts[0]]) parts[0]=BRAND[parts[0]];
  t=parts.join(' ');
  for(const[c,ex]of Object.entries(COMPOUND))t=t.replace(new RegExp('\\b'+c+'\\b','g'),ex);
  return t;
}
function tokens(s){
  return normalize(s).split(' ')
    .filter(tok=>tok&&!STOP.has(tok)&&tok.length>=2)
    .filter(tok=>!/^\d+$/.test(tok)||tok.length>=4);
}
function sizeTokens(s){
  const m=String(s||'').toUpperCase().match(SIZE_RE)||[];
  return m.map(x=>x.replace(/\s+/g,''));
}
function tokenKey(tok){ return tok.length>=6?tok.slice(0,5):tok; }
function nameScore(aTok,bTok,aSize,bSize){
  if(!aTok.length||!bTok.length) return 0;
  const aKeys=new Set(aTok.map(tokenKey));
  const bKeys=new Set(bTok.map(tokenKey));
  const aGen=new Set(aTok.filter(t=>GENERIC.has(t)).map(tokenKey));
  const bGen=new Set(bTok.filter(t=>GENERIC.has(t)).map(tokenKey));
  let interSig=0,interGen=0;
  for(const k of aKeys){if(!bKeys.has(k))continue;if(aGen.has(k)||bGen.has(k))interGen++;else interSig++;}
  const inter=interSig+interGen;
  if(inter<2||interSig<1) return 0;
  const jacc=inter/(aKeys.size+bKeys.size-inter);
  const cont=inter/Math.min(aKeys.size,bKeys.size);
  const combined=jacc*0.3+cont*0.7;
  const sigBonus=Math.min(interSig*0.04,0.12);
  let sizeBonus=0;
  if(aSize.length&&bSize.length){
    const aSz=new Set(aSize);
    for(const s of bSize)if(aSz.has(s)){sizeBonus=0.15;break;}
  }
  return combined+sigBonus+sizeBonus;
}

// vendor_images.json 도 fallback 용으로 로드 (이름 매칭 보충)
console.log('Loading vendor_images.json for name-fallback…');
const vi=JSON.parse(fs.readFileSync(path.join(KMO_DIR,'vendor_images.json'),'utf8'));
const NAME_CAT=[];
for(const[id,ent]of Object.entries(vi)){
  if(!ent||!ent.image||!ent.name) continue;
  if(ent.image.startsWith('http')) continue;
  const fullPath=path.join(KMO_DIR,ent.image);
  if(!fs.existsSync(fullPath)) continue;
  NAME_CAT.push({
    name:ent.name,image:fullPath,vendor:ent.vendor,
    nameTok:tokens(ent.name),nameSize:sizeTokens(ent.name),
  });
}
console.log('Name-fallback catalog: '+NAME_CAT.length+' entries');

// ============== 3. Match each branch ==============
function safeCodeFor(code){ return String(code).replace(/[^a-zA-Z0-9_-]/g,'_'); }

function matchBranch(branchId){
  const jsonPath=path.join(__dirname,'top500',branchId+'.json');
  if(!fs.existsSync(jsonPath)) return [];
  const data=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
  const items=data.items||[];
  console.log('\n=== '+branchId+': '+items.length+' items ===');
  const out=[];
  let bcMatched=0,nameMatched=0;
  for(const p of items){
    // 1. 바코드 매칭 시도 (variant 다양한 키)
    let hit=null;
    for(const v of barcodeVariants(p.code)){
      if(BARCODE_INDEX.has(v)){ hit=BARCODE_INDEX.get(v); break; }
    }
    if(hit){
      out.push({code:p.code,name:p.name,image:hit.image,source:'barcode',matchedBarcode:hit.barcode,score:1.0});
      bcMatched++;
      continue;
    }
    // 2. 이름 매칭 fallback
    const aTok=tokens(p.name); const aSize=sizeTokens(p.name);
    let best=null,bestScore=0;
    for(const c of NAME_CAT){
      const sc=nameScore(aTok,c.nameTok,aSize,c.nameSize);
      if(sc>bestScore){bestScore=sc;best=c;}
    }
    if(bestScore>=0.55){
      out.push({code:p.code,name:p.name,image:best.image,source:'name',match:best.name,score:bestScore});
      nameMatched++;
    }
  }
  console.log('  바코드 매칭: '+bcMatched);
  console.log('  이름 매칭 (fallback): '+nameMatched);
  console.log('  총: '+(bcMatched+nameMatched)+' / '+items.length+' ('+(((bcMatched+nameMatched)/items.length)*100).toFixed(0)+'%)');
  return out;
}

async function compressToFile(src,dst){
  await sharp(src).resize(220,220,{fit:'inside',withoutEnlargement:true}).jpeg({quality:72,mozjpeg:true}).toFile(dst);
}

(async function main(){
  const branches=['CORAL_SPRINGS','HOLLYWOOD','LASOLAS','PEMBROKE_PINES'];
  const allMatches=[];
  for(const b of branches) allMatches.push(...matchBranch(b));

  // dedupe by code — barcode 매치가 name 매치보다 우선
  const byCode={};
  for(const m of allMatches){
    const prev=byCode[m.code];
    if(!prev) byCode[m.code]=m;
    else if(prev.source==='name'&&m.source==='barcode') byCode[m.code]=m;
    else if(prev.source===m.source&&m.score>prev.score) byCode[m.code]=m;
  }
  const unique=Object.values(byCode);
  const bcCount=unique.filter(m=>m.source==='barcode').length;
  const nmCount=unique.filter(m=>m.source==='name').length;
  console.log('\nUnique matched codes: '+unique.length+' (barcode: '+bcCount+', name-fallback: '+nmCount+')');

  // 출력 폴더 정리 (이전 사진 모두 제거)
  for(const f of fs.readdirSync(OUT_DIR)){
    if(f.endsWith('.jpg')) fs.unlinkSync(path.join(OUT_DIR,f));
  }

  console.log('Compressing…');
  const photoMap={};
  let done=0,fail=0,totalBytes=0;
  for(const m of unique){
    const safe=safeCodeFor(m.code);
    const outPath=path.join(OUT_DIR,safe+'.jpg');
    try{
      await compressToFile(m.image,outPath);
      photoMap[m.code]=safe;
      totalBytes+=fs.statSync(outPath).size;
      done++;
      if(done%100===0) console.log('  '+done+'/'+unique.length+'…');
    } catch(e){
      fail++; console.warn('  fail '+m.code+': '+e.message);
    }
  }
  console.log('Compressed: '+done+' ok, '+fail+' failed, '+(totalBytes/1024).toFixed(0)+'KB total');

  // 바코드 매칭 샘플 (전무가 확인할 수 있게)
  console.log('\n=== 바코드 매칭 샘플 ===');
  unique.filter(m=>m.source==='barcode').slice(0,8).forEach(m=>
    console.log('  '+m.code+' (vela) ↔ '+m.matchedBarcode+' (catalog) | '+m.name));

  fs.writeFileSync(OUT_MAP,JSON.stringify(photoMap,null,2));
  console.log('\nWrote '+OUT_MAP+' ('+Object.keys(photoMap).length+' entries)');
})().catch(e=>{console.error(e);process.exit(1);});
