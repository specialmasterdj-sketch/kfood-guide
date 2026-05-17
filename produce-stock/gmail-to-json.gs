/**
 * KIMCHI Produce Stock — Gmail → JSON → GitHub 자동 파이프라인 (Google Apps Script)
 *
 * 목적: Gmail 에서 FreshPoint 메일 자동 수집 → 파싱 → JSON →
 *       GitHub repo 에 직접 push → GitHub Pages 자동 배포 → 폰에서 새 데이터 확인
 *       (Apps Script 의 GmailApp.getPlainBody() 는 HTML 메일도 자동 텍스트 변환해줘서
 *        4매장 모든 메일 가져옴 — FW 안 된 매장 포함)
 *
 * ===== 설치 절차 =====
 *
 * STEP 1: GitHub Personal Access Token (PAT) 발급 (1회)
 *   1. https://github.com/settings/tokens 접속
 *   2. "Generate new token" → "Generate new token (classic)"
 *   3. Note: "KIMCHI Produce Stock Auto-Push"
 *   4. Expiration: 90 days (또는 No expiration)
 *   5. Scopes 체크: ✅ repo (전체)
 *   6. Generate token → 토큰 복사 (한 번만 보임! ghp_xxxxxx...)
 *
 * STEP 2: Apps Script 프로젝트 생성
 *   1. https://script.google.com 접속 → "New project"
 *   2. 프로젝트 이름: KIMCHI Produce Stock Auto-Sync
 *   3. 이 파일 전체 내용 복사 → Code.gs 에 붙여넣기
 *
 * STEP 3: PAT 등록 (안전하게)
 *   1. 좌측 ⚙️ Project Settings → Script Properties → Edit
 *   2. Add property:
 *      - Property: GITHUB_TOKEN
 *      - Value: ghp_xxxxxx... (복사한 토큰)
 *   3. Save
 *
 * STEP 4: 1회 수동 실행
 *   1. 함수 선택: extractAndPush → ▶ Run
 *   2. 권한 승인 (Gmail 읽기 + 외부 URL 호출)
 *      - "Advanced" → "Go to ... (unsafe)" → Allow
 *   3. 실행 로그 확인 → "✅ Pushed to GitHub" 떠야 성공
 *   4. 1~2분 뒤 https://specialmasterdj-sketch.github.io/kfood-guide/produce-stock/ 에서
 *      Hollywood/Coral Springs/Pembroke 데이터 새로 들어왔나 확인
 *
 * STEP 5: 매일 자동 실행 등록
 *   1. 좌측 ⏰ Triggers → + Add Trigger
 *   2. Function: extractAndPush
 *   3. Event source: Time-driven
 *   4. Type: Day timer
 *   5. Time: 5am ~ 6am (새벽)
 *   6. Save → 매일 새벽 자동 실행 → 1~2분 뒤 앱 자동 갱신
 */

// ========== 설정 ==========
const SEARCH_QUERY = 'from:internet.order@freshpoint.com OR from:tanya.uline@freshpoint.com subject:"Order Confirmation" newer_than:90d';
const OUTPUT_FOLDER_NAME = 'KIMCHI Produce Stock';  // Drive 백업 폴더 이름

// GitHub 설정 — 토큰은 Script Properties 에 저장됨
const GITHUB_REPO   = 'specialmasterdj-sketch/kfood-guide';
const GITHUB_BRANCH = 'master';
const GITHUB_ORDERS_PATH  = 'produce-stock/data/orders.json';
const GITHUB_CATALOG_PATH = 'produce-stock/data/catalog.json';

// ========== 주소 → 매장 ==========
const BRANCH_BY_ADDR = [
  { re: /2420 N DIXIE HWY/i,     id: 'HOLLYWOOD',      label: 'Hollywood' },
  { re: /2693 N UNIVERSITY DR/i, id: 'CORAL_SPRINGS',  label: 'Coral Springs' },
  { re: /510 NW 7TH AVE/i,       id: 'LASOLAS',        label: 'Las Olas' },
  { re: /11230 PINES BLVD/i,     id: 'PEMBROKE_PINES', label: 'Pembroke Pines' },
];

// ========== 카테고리 ==========
const CAT_MATCHERS = [
  ['avocado',     /AVOCADO/i],
  ['banana',      /\bBANANA\b/i],
  ['berry',       /BERRY|BLUEBERRY|RASPBERRY|BLACKBERRY|STRAWBERRY/i],
  ['citrus',      /LEMON|LIME|ORANGE|CLEMENTINE|GRAPEFRUIT|KUMQUAT|TANGERINE/i],
  ['tomato',      /TOMATO/i],
  ['cucumber',    /CUCUMBER/i],
  ['pepper',      /PEPPER|JALAPENO|CHILI/i],
  ['onion',       /\bONION\b|GARLIC|SHALLOT|SCALLION|LEEK/i],
  ['potato',      /POTATO|YAM|SWEET POTATO/i],
  ['leafy',       /LETTUCE|SPINACH|KALE|CABBAGE|ARUGULA|CHARD|BOK CHOY|NAPA|ROMAINE/i],
  ['herb',        /PARSLEY|CILANTRO|MINT|BASIL|DILL|ROSEMARY|THYME|SAGE|KAFFIR|LEMONGRASS|GINGER/i],
  ['mushroom',    /MUSHROOM/i],
  ['squash',      /SQUASH|ZUCCHINI|PUMPKIN|CALABAZA|CHAYOTE/i],
  ['eggplant',    /EGGPLANT/i],
  ['root',        /CARROT|BEET|RADISH|TURNIP|PARSNIP|DAIKON/i],
  ['tropical',    /MANGO|PAPAYA|PINEAPPLE|DRAGONFRUIT|COCONUT|PLANTAIN|KIWI|POMEGRANATE/i],
  ['melon',       /MELON|WATERMELON|CANTALOUPE|HONEYDEW/i],
  ['apple_pear',  /APPLE|PEAR/i],
  ['grape',       /\bGRAPE\b/i],
  ['celery',      /CELERY/i],
  ['bean_legume', /\bBEAN|LEGUME|LENTIL/i],
  ['corn',        /\bCORN\b/i],
  ['broccoli',    /BROCCOLI|CAULIFLOWER/i],
  ['asparagus',   /ASPARAGUS/i],
  ['okra',        /OKRA/i],
  ['egg',         /\bEGG\b/i],
  ['dairy',       /\bMILK\b|CHEESE|YOGURT|CREAM|BUTTER/i],
];

function detectCategory(name){
  for (const [id, re] of CAT_MATCHERS) if (re.test(name)) return id;
  return 'other';
}

function detectBranch(text){
  for (const b of BRANCH_BY_ADDR){
    if (b.re.test(text)) return { id: b.id, label: b.label };
  }
  return { id: 'UNKNOWN', label: 'Unknown' };
}

// ========== 메일 본문 파서 ==========
function parseEmail(text){
  const refMatch = text.match(/Reference\s+#(\d+)/);
  const ref = refMatch ? refMatch[1] : null;

  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  const orderDate = dateMatch ? dateMatch[3] + '-' + dateMatch[1] + '-' + dateMatch[2] : null;
  const orderTime = dateMatch ? dateMatch[4] : null;

  const dayDate = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const deliveryDate = dayDate ? dayDate[3] + '-' + dayDate[1] + '-' + dayDate[2] : null;

  const branch = detectBranch(text);

  const tableMatch = text.match(/Item#[\s\r\n]+Product[\s\r\n]+Size[\s\r\n]+Qty[\s\r\n]+Price[\s\r\n]+Ext\.P\s*([\s\S]*?)Order Summary/i);
  const items = [];
  if (tableMatch){
    const lines = tableMatch[1].split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean);
    let i = 0;
    while (i + 5 < lines.length){
      const itemNo = lines[i];
      if (!/^\d{4,7}$/.test(itemNo)){
        i++;
        continue;
      }
      const product = lines[i+1];
      const size = lines[i+2];
      const qty = parseFloat(lines[i+3]);
      const unitPrice = parseFloat(lines[i+4]);
      const extPrice = parseFloat(lines[i+5]);
      if (product && !isNaN(qty)){
        items.push({
          itemNo: itemNo,
          product: product,
          size: size,
          qty: qty,
          unitPrice: unitPrice,
          extPrice: extPrice,
          category: detectCategory(product),
        });
      }
      i += 6;
    }
  }

  const sumMatch = text.match(/Order Summary[\s\S]*?Items\s+(\d+)\s+Quantity\s+(\d+)\s+Total\s+([\d.]+)/i);
  const summary = sumMatch ? {
    itemCount: parseInt(sumMatch[1], 10),
    quantity:  parseInt(sumMatch[2], 10),
    total:     parseFloat(sumMatch[3]),
  } : null;

  return { ref: ref, orderDate: orderDate, orderTime: orderTime, deliveryDate: deliveryDate, branch: branch, items: items, summary: summary };
}

// ========== GitHub Contents API — 파일 push ==========
// PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}
// Body: { message, content (base64), sha (기존 파일이면 필요), branch }
function pushToGitHub(path, content, commitMsg, token){
  const url = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + path;
  const headers = {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github+json',
  };

  // 1) 기존 파일의 SHA 가져오기 (있어야 update 가능)
  let sha = null;
  try {
    const getRes = UrlFetchApp.fetch(url + '?ref=' + GITHUB_BRANCH, {
      method: 'get', headers: headers, muteHttpExceptions: true
    });
    if (getRes.getResponseCode() === 200){
      sha = JSON.parse(getRes.getContentText()).sha;
    }
  } catch(e){ /* 새 파일이면 404 → sha 없음 OK */ }

  // 2) PUT 으로 업로드
  const body = {
    message: commitMsg,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const putRes = UrlFetchApp.fetch(url, {
    method: 'put', headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = putRes.getResponseCode();
  if (code < 200 || code >= 300){
    throw new Error('GitHub push failed ' + code + ': ' + putRes.getContentText().substring(0, 200));
  }
  return JSON.parse(putRes.getContentText());
}

// ========== 메인 — 메일 수집 + 파싱 + Drive 저장 + GitHub push ==========
function extractAndPush(){
  extractAndSave();
}
function extractAndSave(){
  Logger.log('🔍 Searching Gmail: ' + SEARCH_QUERY);
  const threads = GmailApp.search(SEARCH_QUERY, 0, 200);
  Logger.log('Found ' + threads.length + ' threads');

  const ordersMap = {};   // ref → parsed order (중복 제거)
  let skipped = 0;

  for (let i = 0; i < threads.length; i++){
    const messages = threads[i].getMessages();
    for (let j = 0; j < messages.length; j++){
      const msg = messages[j];
      try {
        const body = msg.getPlainBody();   // ⭐ HTML → 텍스트 자동 변환
        const parsed = parseEmail(body);
        if (!parsed.ref || !parsed.items.length){
          skipped++;
          continue;
        }
        // 중복 ref 면 가장 늦은 발송 메일 우선 (CE 와 CU 가 같은 ref 인 경우)
        if (!ordersMap[parsed.ref] || msg.getDate() > new Date(ordersMap[parsed.ref]._receivedAt)){
          parsed._receivedAt = msg.getDate().toISOString();
          ordersMap[parsed.ref] = parsed;
        }
      } catch(e){
        Logger.log('⚠️ Error parsing message: ' + e.message);
        skipped++;
      }
    }
  }

  const orders = Object.values(ordersMap).sort(function(a, b){
    return (b.orderDate || '').localeCompare(a.orderDate || '');
  });

  // 카탈로그 계산
  const catalog = {};
  for (let i = 0; i < orders.length; i++){
    const o = orders[i];
    for (let k = 0; k < o.items.length; k++){
      const it = o.items[k];
      if (!catalog[it.itemNo]){
        catalog[it.itemNo] = {
          itemNo: it.itemNo,
          product: it.product,
          category: it.category,
          sizes: {},
          lastUnitPrice: it.unitPrice,
          lastOrderDate: o.orderDate,
          totalOrdered: 0,
          orderCount: 0,
          branches: {},
        };
      }
      const c = catalog[it.itemNo];
      c.sizes[it.size] = (c.sizes[it.size] || 0) + 1;
      c.totalOrdered += it.qty;
      c.orderCount += 1;
      c.branches[o.branch.id] = (c.branches[o.branch.id] || 0) + it.qty;
      if ((o.orderDate || '') >= c.lastOrderDate){
        c.lastUnitPrice = it.unitPrice;
        c.lastOrderDate = o.orderDate;
      }
    }
  }

  // Drive 폴더 찾거나 생성
  let folder;
  const folders = DriveApp.getFoldersByName(OUTPUT_FOLDER_NAME);
  if (folders.hasNext()) folder = folders.next();
  else folder = DriveApp.createFolder(OUTPUT_FOLDER_NAME);

  const today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');

  // orders.json
  const ordersJson = JSON.stringify(orders, null, 2);
  const ordersFile = folder.createFile('orders.json', ordersJson, MimeType.PLAIN_TEXT);
  // dated 복사본도 같이 (히스토리)
  folder.createFile('orders-' + today + '.json', ordersJson, MimeType.PLAIN_TEXT);

  // catalog.json
  const catalogJson = JSON.stringify(catalog, null, 2);
  folder.createFile('catalog.json', catalogJson, MimeType.PLAIN_TEXT);

  // 통합 파일 (index.html 의 JSON 불러오기 와 호환)
  const combined = {
    orders: orders,
    catalog: catalog,
    exportedAt: new Date().toISOString(),
    source: 'Gmail Apps Script',
  };
  folder.createFile('produce-stock-' + today + '.json', JSON.stringify(combined, null, 2), MimeType.PLAIN_TEXT);

  // 요약
  const branchCounts = {};
  let totalItems = 0;
  let totalValue = 0;
  for (let i = 0; i < orders.length; i++){
    const o = orders[i];
    branchCounts[o.branch.id] = (branchCounts[o.branch.id] || 0) + 1;
    totalItems += o.items.length;
    totalValue += o.summary ? o.summary.total : 0;
  }

  Logger.log('');
  Logger.log('========== SUMMARY ==========');
  Logger.log('Orders parsed: ' + orders.length);
  Logger.log('Skipped messages: ' + skipped);
  Logger.log('Total line items: ' + totalItems);
  Logger.log('Unique products: ' + Object.keys(catalog).length);
  Logger.log('Total value: $' + totalValue.toFixed(2));
  Logger.log('By branch: ' + JSON.stringify(branchCounts));
  Logger.log('');
  Logger.log('📁 Saved to Drive folder: ' + OUTPUT_FOLDER_NAME);
  Logger.log('   - orders.json (latest, ' + orders.length + ' orders)');
  Logger.log('   - catalog.json (' + Object.keys(catalog).length + ' unique items)');
  Logger.log('   - produce-stock-' + today + '.json (combined for app import)');
  Logger.log('🔗 Drive: https://drive.google.com/drive/folders/' + folder.getId());

  // ========== GitHub 자동 push ==========
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token){
    Logger.log('');
    Logger.log('💡 Script Properties 에 GITHUB_TOKEN 없음 — GitHub push 건너뜀.');
    Logger.log('   Drive 에 저장된 JSON 을 수동으로 앱에 import 하세요.');
    Logger.log('   (자동 push 활성화 방법: 파일 상단 주석의 STEP 1~3 참고)');
    return;
  }

  Logger.log('');
  Logger.log('🚀 GitHub 에 push 중…');
  try {
    const commitMsg = 'data(produce-stock): auto-sync ' + today + ' — '
                    + orders.length + ' orders, '
                    + Object.keys(catalog).length + ' items, $'
                    + totalValue.toFixed(2);
    pushToGitHub(GITHUB_ORDERS_PATH, ordersJson, commitMsg + ' [orders]', token);
    pushToGitHub(GITHUB_CATALOG_PATH, catalogJson, commitMsg + ' [catalog]', token);
    Logger.log('✅ GitHub push 완료 — 1~2 분 뒤 앱에서 새 데이터 확인 가능');
    Logger.log('   https://specialmasterdj-sketch.github.io/kfood-guide/produce-stock/');
  } catch(e){
    Logger.log('⚠️ GitHub push 실패: ' + e.message);
    Logger.log('   토큰 만료/권한 확인 필요. Drive 백업은 정상 저장됨.');
  }
}

// ========== 디버그 — 1건만 처리해서 파싱 확인 ==========
function debugOne(){
  const threads = GmailApp.search(SEARCH_QUERY, 0, 1);
  if (!threads.length){ Logger.log('No threads found'); return; }
  const msg = threads[0].getMessages()[0];
  Logger.log('Subject: ' + msg.getSubject());
  Logger.log('Date: ' + msg.getDate());
  Logger.log('---Plain Body (first 1000 chars)---');
  Logger.log(msg.getPlainBody().substring(0, 1000));
  Logger.log('---Parsed---');
  const parsed = parseEmail(msg.getPlainBody());
  Logger.log(JSON.stringify(parsed, null, 2));
}
