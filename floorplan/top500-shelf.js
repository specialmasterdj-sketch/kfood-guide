/* ⭐ Top 500 ↔ 도면 매대 연결 (2026-11-23 사장님 지시)
 * - 사장님이 도면의 세일존(SZ)·통로·쿨러마다 "여기에 올 Top 500 상품"을 정한다.
 * - 직원은 그 자리를 누르면 사진·이름·바코드로 무엇을 채울지 본다.
 * 데이터: ../top500/shelf/{BRANCH}.json (매대 분류된 Top 500, 빌드 스크립트 산출)
 * 저장:   RTDB floorplan/top500Map/{store}/{key} = {shelves:[], codes:[], label, by, ts}
 *         key = 'A:<통로번호>' (통로 한쪽) | 'Z:<x>_<y>' (그 외 박스, 도면 좌표)
 * 편집:   사장님·임원 계정만 (chat.me.role). 직원은 보기만.
 * 이 파일만 index.html 뒤에 붙는다 — 도면 저장 구조(serialize)는 건드리지 않음.
 */
(function () {
  const BRANCH_OF = { lasolas: 'LASOLAS', miami: 'MIAMI', hollywood: 'HOLLYWOOD', coral: 'CORAL_SPRINGS', pembroke: 'PEMBROKE_PINES', westpalm: 'WEST_PALM' };
  const DATA = {};      // branch -> shelf json | null
  const MAP = {};       // store -> {key: entry}
  const PICKABLE = /^(open-cooler|open-freezer|door-cooler|door-freezer|island-freezer|perimeter|fixture)$/;
  const SKIP_LABEL = /OFFICE|RESTROOM|WALK-IN|CHECK|^CO$|DOOR$/i;

  function me() { try { return JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch (_) { return null; } }
  function canEdit() { const m = me(); return !!(m && /OWNER|EXECUTIVE|임원|전무|사장/i.test(m.role || '')); }
  function store() { return typeof currentStore === 'string' ? currentStore : ''; }
  function isSZ(z) { return z && (z.label === 'SZ' || z.num === 'SZ'); }
  function zoneKey(z) { return 'Z:' + Math.round(z.x) + '_' + Math.round(z.y); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function loadData(st) {
    const br = BRANCH_OF[st];
    if (!br) return null;
    if (DATA[br] !== undefined) return DATA[br];
    try {
      const r = await fetch('../top500/shelf/' + br + '.json?t=' + Date.now(), { cache: 'no-store' });
      DATA[br] = r.ok ? await r.json() : null;
    } catch (_) { DATA[br] = null; }
    if (DATA[br]) {
      DATA[br].byCode = {}; DATA[br].shelfName = {};
      DATA[br].items.forEach(x => { DATA[br].byCode[x.code] = x; });
      DATA[br].shelves.forEach(s => { DATA[br].shelfName[s.key] = s.ko; });
    }
    return DATA[br];
  }
  async function loadMap(st) {
    try {
      const r = await window.KM.safeFetch('floorplan/top500Map/' + st);
      MAP[st] = (r && r.ok && r.data) || {};
    } catch (_) { MAP[st] = MAP[st] || {}; }
    return MAP[st];
  }
  function itemsOf(d, e) {
    if (!d || !e) return [];
    const set = new Set(e.shelves || []), out = [], seen = new Set();
    d.items.forEach(x => { if (set.has(x.shelf)) { out.push(x); seen.add(x.code); } });
    (e.codes || []).forEach(c => { const x = d.byCode[c]; if (x && !seen.has(c)) { out.push(x); seen.add(c); } });
    return out.sort((a, b) => a.rank - b.rank);
  }

  /* 세일존(주황) 순서 A, B, C …: 정문(M-E)에서 출발해 위로 올라가 매장을 한 바퀴(시계방향) 도는 순서.
     매장 중심에서 본 각도를 정문 각도부터 재서 정렬. 사장님이 글자를 바꿔 저장하면 그 글자 우선. */
  const SZNAME = {}; // zoneKey -> 'A'
  function letter(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
  function nameSZ(map) {
    Object.keys(SZNAME).forEach(k => delete SZNAME[k]);
    const all = (window.zones || zones);
    if (!all.length) return;
    const minX = Math.min(...all.map(z => z.x)), maxX = Math.max(...all.map(z => z.x + z.w));
    const minY = Math.min(...all.map(z => z.y)), maxY = Math.max(...all.map(z => z.y + z.h));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const door = all.find(z => z.ftype === 'front-door' || z.type === 'front-door' || z.num === 'M-E');
    const dx0 = door ? door.x + door.w / 2 : minX, dy0 = door ? door.y + door.h / 2 : maxY;
    // 매장 테두리(사각형)를 시계방향으로 도는 길이 위치: 위(왼→오) → 오른쪽(위→아래) → 아래(오→왼) → 왼쪽(아래→위).
    // 각 세일존은 가장 가까운 벽에 비춰 위치를 정하고, 정문 위치부터 잰다. 같은 위치면 안쪽(벽에서 먼 것)이 먼저.
    const W = maxX - minX, H = maxY - minY, P = 2 * (W + H);
    const along = (px, py) => {
      const dl = px - minX, dt = py - minY, dr = maxX - px, db = maxY - py, m = Math.min(dl, dt, dr, db);
      if (m === dt) return [px - minX, dt];
      if (m === dr) return [W + (py - minY), dr];
      if (m === db) return [W + H + (maxX - px), db];
      return [2 * W + H + (maxY - py), dl];
    };
    const t0 = along(dx0, dy0)[0];
    const pos = z => { const [t, d] = along(z.x + z.w / 2, z.y + z.h / 2); let u = t - t0; while (u < 0) u += P; return [u, d]; };
    const list = all.filter(isSZ).map(z => ({ z, p: pos(z) }))
      .sort((A, B) => (Math.abs(A.p[0] - B.p[0]) < 25 ? B.p[1] - A.p[1] : A.p[0] - B.p[0])).map(o => o.z);
    const used = new Set();
    list.forEach(z => { const e = map[zoneKey(z)]; if (e && e.name) { SZNAME[zoneKey(z)] = e.name; used.add(e.name); } });
    let i = 0;
    list.forEach(z => { const k = zoneKey(z); if (SZNAME[k]) return; let n; do { n = letter(i++); } while (used.has(n)); SZNAME[k] = n; used.add(n); });
  }

  /* ---------- 도면 위 표시 ---------- */
  async function decorate() {
    const st = store();
    document.querySelectorAll('.t5-badge').forEach(b => b.remove());
    document.querySelectorAll('[data-t5n]').forEach(s => s.removeAttribute('data-t5n'));
    const d = await loadData(st);
    if (!d || st !== store()) return;
    const map = await loadMap(st);
    if (st !== store()) return;
    const edit = canEdit();
    nameSZ(map);
    (window.zones || zones).forEach(z => {
      if (!z.el) return;
      if (z.type === 'aisle') {
        z.el.querySelectorAll('[class^="aisle-num-"]').forEach(sp => {
          const n = sp.textContent.trim(); const e = map['A:' + n];
          const cnt = itemsOf(d, e).length + ((e && e.photos) || []).length;
          if (cnt) sp.setAttribute('data-t5n', cnt);
        });
        return;
      }
      const e = map[zoneKey(z)];
      const cnt = itemsOf(d, e).length + ((e && e.photos) || []).length;
      const show = isSZ(z) || cnt > 0 || (edit && ( (PICKABLE.test(z.ftype || z.type) && !SKIP_LABEL.test(z.label || ''))));
      if (!show) return;
      const b = document.createElement('button');
      b.className = 't5-badge' + (cnt ? '' : ' empty') + (isSZ(z) ? ' sz' : '');
      b.textContent = isSZ(z) ? (SZNAME[zoneKey(z)] || '') : (cnt ? '⭐' + cnt : '＋⭐');
      if (isSZ(z) && cnt) b.classList.add('has');
      b.title = cnt ? 'Top 500 상품 ' + cnt + '개 보기' : '여기에 올 Top 500 정하기 (사장님)';
      b.addEventListener('mousedown', ev => ev.stopPropagation());
      b.addEventListener('dblclick', ev => ev.stopPropagation());
      b.addEventListener('click', ev => { ev.stopPropagation(); openFor(zoneKey(z), titleOf(z)); });
      if (isSZ(z)) { z.el.style.overflow = 'visible'; z.el.classList.add('t5-szone'); }
      z.el.appendChild(b);
    });
  }
  function titleOf(z) {
    if (isSZ(z)) return '세일존 ' + (SZNAME[zoneKey(z)] || 'SZ');
    const lb = String(z.label || '').replace(/<br>/g, ' ').trim();
    return (lb || z.ftype || z.type) + (z.sub ? ' · ' + String(z.sub).replace(/<br>/g, ' ') : '');
  }

  /* ---------- 팝업 ---------- */
  let cur = null; // {key, title, editing, draft}
  function modal() {
    let m = document.getElementById('t5-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 't5-modal';
    m.innerHTML = `<div class="t5-box">
      <div class="t5-head"><div style="flex:1;min-width:0"><div id="t5-title" class="t5-title"></div><div id="t5-sub" class="t5-sub"></div></div>
        <button id="t5-cut" class="t5-btn gold" style="display:none">✂️ 사진 넣기</button>
        <button id="t5-edit" class="t5-btn" style="display:none">✏️ 편집</button>
        <button id="t5-ref" class="t5-btn">🖼 진열 레퍼런스</button>
        <button id="t5-close" class="t5-btn red">✕</button></div>
      <div id="t5-tools" class="t5-tools"></div>
      <div id="t5-body" class="t5-body"></div>
      <div id="t5-foot" class="t5-foot" style="display:none"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#t5-close').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.style.display === 'flex') close(); });
    return m;
  }
  function close() { const m = document.getElementById('t5-modal'); if (m) m.style.display = 'none'; cur = null; }

  async function openFor(key, title, refCb) {
    const st = store(); const d = await loadData(st);
    if (!d) { alert('이 지점은 아직 Top 500 매대 자료가 없습니다.'); return; }
    await loadMap(st);
    cur = { key, title, editing: false, mode: '', refCb, q: '', chip: '', topic: '', pq: '' };
    modal().style.display = 'flex';
    render();
  }
  function card(x, sel) {
    const ph = x.photo ? `<img loading="lazy" src="../top500/${esc(x.photo)}" alt="">` : '<div class="t5-noph">사진 없음</div>';
    return `<div class="t5-card${sel === undefined ? '' : sel ? ' on' : ' off'}" data-code="${esc(x.code)}">
      <div class="t5-ph">${ph}<span class="t5-rank">#${x.rank}</span>${sel === undefined ? '' : `<span class="t5-chk">${sel ? '✓' : '+'}</span>`}</div>
      <div class="t5-nm">${esc(x.name)}</div>
      <div class="t5-meta">${esc(x.code)} · 판매 ${Number(x.qty).toLocaleString()}</div>
      ${x.note ? `<div class="t5-note">[확인] ${esc(x.note)}</div>` : ''}</div>`;
  }
  function render() {
    if (!cur) return;
    if (cur.mode === 'pick') return renderPick();
    if (cur.mode === 'crop') return renderCrop();
    document.getElementById('t5-cut').style.display = canEdit() && !cur.editing ? '' : 'none';
    document.getElementById('t5-cut').onclick = () => { cur.mode = 'pick'; cur.topic = cur.topic || (cur.title.startsWith('세일존') ? 'sale_zone' : ''); render(); };
    const st = store(), d = DATA[BRANCH_OF[st]], map = MAP[st] || {};
    const e = cur.editing ? cur.draft : (map[cur.key] || null);
    const list = itemsOf(d, e);
    const $ = id => document.getElementById(id);
    $('t5-title').textContent = '⭐ ' + cur.title;
    const shelfTxt = (e && e.shelves && e.shelves.length) ? e.shelves.map(k => d.shelfName[k] || k).join(' · ') : '';
    const npc = ((e && e.photos) || []).length;
    $('t5-sub').textContent = cur.editing
      ? '편집 중 — 매대 묶음을 누르거나, 아래에서 상품을 하나씩 눌러 넣고 빼세요. 선택 ' + list.length + '개'
      : ((npc || list.length) ? [npc ? '사진 ' + npc + '장' : '', list.length ? 'Top 500 ' + list.length + '개' : '', shelfTxt].filter(Boolean).join(' · ') + (e && e.by ? ' · ' + e.by : '') : '아직 정해지지 않음');
    $('t5-edit').style.display = canEdit() && !cur.editing && e && ((e.shelves || []).length || (e.codes || []).length) ? '' : 'none';
    $('t5-edit').onclick = () => { cur.editing = true; cur.draft = { shelves: [...((map[cur.key] || {}).shelves || [])], codes: [...((map[cur.key] || {}).codes || [])], name: (map[cur.key] || {}).name || SZNAME[cur.key] || '' }; render(); };
    $('t5-ref').style.display = cur.refCb && !cur.editing ? '' : 'none';
    $('t5-ref').onclick = () => { const cb = cur.refCb; close(); cb && cb(); };
    const tools = $('t5-tools'), body = $('t5-body'), foot = $('t5-foot');
    if (!cur.editing) {
      tools.innerHTML = list.length > 12 ? `<input id="t5-q" class="t5-q" placeholder="🔍 이름·바코드 검색" value="${esc(cur.q)}">` : '';
      const q = cur.q.trim().toUpperCase();
      const shown = q ? list.filter(x => x.name.toUpperCase().includes(q) || x.code.includes(q)) : list;
      const pcs = (e && e.photos) || [];
      const photoHtml = pcs.length ? `<div class="t5-mosaic" id="t5-mosaic"></div>` : '';
      body.innerHTML = (pcs.length || list.length)
        ? photoHtml + (list.length ? `${pcs.length ? '<div class="t5-sec">📦 Top 500 상품</div>' : ''}<div class="t5-grid">${shown.map(x => card(x)).join('')}</div>` : '')
        : `<div class="t5-empty">${canEdit() ? '오른쪽 위 <b>✂️ 사진 넣기</b>를 누르세요.<br>위 칸 = 플래노그램 사진에서 필요한 부분만 오려 넣기 · 아래 칸 = 우리 제품 사진 넣기' : '사장님이 아직 이 자리를 정하지 않았습니다.'}</div>`;
      if (pcs.length) layoutMosaic(pcs, d);
      if (canEdit() && pcs.length > 1) {
        foot.style.display = 'flex';
        foot.innerHTML = cur.swap
          ? `<span style="flex:1"><b>자리 바꾸기:</b> 바꿀 사진 두 장을 차례로 누르세요</span><button class="t5-btn green" id="t5-swap">✓ 끝</button>`
          : `<span style="flex:1;color:#666">사진은 칸에 맞춰 자동으로 정렬됩니다</span><button class="t5-btn" id="t5-swap">🔀 자리 바꾸기</button>`;
        $('t5-swap').onclick = () => { cur.swap = !cur.swap; cur.swapSel = null; render(); };
      } else { foot.style.display = 'none'; cur.swap = false; }
      const qi = $('t5-q'); if (qi) { qi.oninput = () => { cur.q = qi.value; const p = qi.selectionStart; render(); const n = $('t5-q'); n.focus(); n.setSelectionRange(p, p); }; }
      return;
    }
    // 편집 화면: 매대 묶음 칩 + 전체 Top 500 (선택/해제)
    const dr = cur.draft, onShelf = new Set(dr.shelves), sel = new Set(list.map(x => x.code));
    const isSzKey = cur.title.startsWith('세일존');
    tools.innerHTML = (isSzKey ? `<div class="t5-row" style="margin:0 0 6px"><b style="align-self:center;white-space:nowrap">이름</b><input id="t5-name" class="t5-q" style="max-width:160px" value="${esc(dr.name || '')}" placeholder="A"></div>` : '') + `<div class="t5-chips">${d.shelves.map(s => `<button class="t5-chip${onShelf.has(s.key) ? ' on' : ''}" data-shelf="${s.key}">${esc(s.ko)} <small>${s.count}</small></button>`).join('')}</div>
      <div class="t5-row"><input id="t5-q" class="t5-q" placeholder="🔍 Top 500 에서 찾기 (이름·바코드)" value="${esc(cur.q)}">
      <select id="t5-f" class="t5-q" style="max-width:190px"><option value="">전체 매대</option>${d.shelves.map(s => `<option value="${s.key}"${cur.chip === s.key ? ' selected' : ''}>${esc(s.ko)}</option>`).join('')}</select></div>`;
    const q = cur.q.trim().toUpperCase();
    const pool = d.items.filter(x => (!cur.chip || x.shelf === cur.chip) && (!q || x.name.toUpperCase().includes(q) || x.code.includes(q)));
    body.innerHTML = `<div class="t5-grid">${pool.map(x => card(x, sel.has(x.code))).join('')}</div>`;
    foot.style.display = 'flex';
    foot.innerHTML = `<span style="flex:1">선택 <b>${list.length}</b>개</span>
      <button class="t5-btn" id="t5-clear">모두 빼기</button><button class="t5-btn" id="t5-cancel">취소</button><button class="t5-btn green" id="t5-save">💾 저장</button>`;
    tools.querySelectorAll('.t5-chip').forEach(b => b.onclick = () => {
      const k = b.dataset.shelf;
      if (onShelf.has(k)) { dr.shelves = dr.shelves.filter(s => s !== k); const inK = new Set(d.items.filter(x => x.shelf === k).map(x => x.code)); dr.codes = dr.codes.filter(c => !inK.has(c)); }
      else dr.shelves.push(k);
      render();
    });
    body.querySelectorAll('.t5-card').forEach(c => c.onclick = () => {
      const code = c.dataset.code, x = d.byCode[code];
      if (sel.has(code)) {
        if (onShelf.has(x.shelf)) { // 묶음에서 하나만 빼기 → 묶음을 낱개로 풀어서 그 하나 제외
          dr.shelves = dr.shelves.filter(s => s !== x.shelf);
          d.items.filter(y => y.shelf === x.shelf && y.code !== code).forEach(y => { if (!dr.codes.includes(y.code)) dr.codes.push(y.code); });
        }
        dr.codes = dr.codes.filter(cc => cc !== code);
      } else dr.codes.push(code);
      render();
    });
    const qi = $('t5-q'); qi.oninput = () => { cur.q = qi.value; const p = qi.selectionStart; render(); const n = $('t5-q'); n.focus(); n.setSelectionRange(p, p); };
    const ni = $('t5-name'); if (ni) ni.oninput = () => { dr.name = ni.value.trim().toUpperCase(); };
    $('t5-f').onchange = e2 => { cur.chip = e2.target.value; render(); };
    $('t5-clear').onclick = () => { dr.shelves = []; dr.codes = []; render(); };
    $('t5-cancel').onclick = () => { cur.editing = false; render(); };
    $('t5-save').onclick = save;
  }
  async function save() {
    const st = store(), dr = cur.draft, m = me();
    const isSzKey = cur.title.startsWith('세일존');
    if (isSzKey && dr.name) {
      const clash = Object.keys(SZNAME).find(k => k !== cur.key && SZNAME[k] === dr.name);
      if (clash) { alert(dr.name + ' 이름은 이미 다른 세일존에 있습니다.'); return; }
    }
    const oldPhotos = ((MAP[st] || {})[cur.key] || {}).photos || [];
    const val = (dr.shelves.length || dr.codes.length || oldPhotos.length || (isSzKey && dr.name))
      ? { photos: oldPhotos, shelves: dr.shelves, codes: dr.codes, name: isSzKey ? (dr.name || SZNAME[cur.key] || '') : '', label: isSzKey ? '세일존 ' + (dr.name || SZNAME[cur.key]) : cur.title, by: (m && m.name) || '', ts: Date.now() }
      : null;
    const btn = document.getElementById('t5-save'); if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    let ok = false;
    try { const r = await window.KM.safeSave('floorplan/top500Map/' + st + '/' + cur.key, val, { silent: true }); ok = !!(r && r.ok); } catch (_) {}
    if (!ok) { alert('저장 실패 — 인터넷·로그인 확인 후 다시 눌러 주세요.'); if (btn) { btn.disabled = false; btn.textContent = '💾 저장'; } return; }
    MAP[st] = MAP[st] || {}; if (val) MAP[st][cur.key] = val; else delete MAP[st][cur.key];
    if (isSzKey && dr.name) { SZNAME[cur.key] = dr.name; cur.title = '세일존 ' + dr.name; }
    cur.editing = false; render(); decorate();
  }

  /* ---------- ✂️ 사진 넣기: 위 칸 = 플래노그램 사진 오려 넣기, 아래 칸 = 우리 제품 사진 ---------- */
  // 플래노그램 = ../hmart-photos/{file} (사장님 쉘브 사진판 manifest.js). 오린 부분은 좌표만 저장(이미지 복사·base64 없음).
  // photos[] 한 칸 = {f: 파일, r: 회전°, c: [x,y,w,h] 0~1(회전 후 기준)}  또는  {code: Top 500 바코드}
  let PLANO = null;
  function loadPlano() {
    if (PLANO) return PLANO;
    const add = src => new Promise(res => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
    PLANO = Promise.all([add('../hmart-photos/manifest.js?v=1'), add('../hmart-photos/rotations.js?v=1')]).then(() => ({
      photos: (typeof HMART_PHOTOS !== 'undefined') ? HMART_PHOTOS : {},
      rot: (typeof HMART_ROTATIONS !== 'undefined') ? HMART_ROTATIONS : {}
    }));
    return PLANO;
  }
  const TOPICS = [['sale_zone', '🏷️ 세일존'], ['ramen_noodles', '🍜 라면'], ['snack', '🍪 과자'], ['drinks', '🥤 음료'], ['sauce', '🫙 소스'], ['seasoning', '🥄 조미료'],
    ['dry_noodles', '🍝 건면'], ['instant_dry', '⚡ 즉석'], ['grain', '🌾 곡물'], ['can', '🥫 통조림'], ['tea', '🍵 차'], ['seaweed', '🌿 해조류'], ['dried_food', '🍂 건조'],
    ['flour_powder', '🥣 가루'], ['sugar_salt', '🧂 설탕소금'], ['mealkit', '📦 밀키트'], ['beer_sake_soju', '🍶 주류'], ['refrigerated', '🥶 냉장'], ['frozen', '🧊 냉동'],
    ['produce', '🥬 청과'], ['meat', '🥩 정육'], ['poultry', '🍗 가금'], ['seafood', '🦐 해산물'], ['sushi', '🍣 스시'], ['sidedish', '🥢 반찬'], ['hotfood', '🔥 핫푸드'],
    ['houseware', '🍳 주방'], ['wholesale_bulk', '🛒 벌크'], ['usa_items', '🇺🇸 미국'], ['india', '🇮🇳 인도'], ['supply', '🧰 비품'], ['signage', '🪧 사인'], ['facility', '🏬 시설'], ['manual', '📖 매뉴얼']];
  const IMG = {};
  function img(f) { if (!IMG[f]) IMG[f] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => { delete IMG[f]; rej(); }; i.src = '../hmart-photos/' + f; }); return IMG[f]; }
  function rotated(im, r) {
    const c = document.createElement('canvas'), sw = (r % 180) ? im.height : im.width, sh = (r % 180) ? im.width : im.height;
    c.width = sw; c.height = sh; const g = c.getContext('2d');
    g.translate(sw / 2, sh / 2); g.rotate(r * Math.PI / 180); g.drawImage(im, -im.width / 2, -im.height / 2); return c;
  }
  async function drawPiece(cv, p) {
    try {
      const rc = rotated(await img(p.f), p.r || 0), c = p.c || [0, 0, 1, 1];
      const sx = c[0] * rc.width, sy = c[1] * rc.height, sw = Math.max(1, c[2] * rc.width), sh = Math.max(1, c[3] * rc.height);
      const k = Math.min(1, 900 / sw); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
      cv.getContext('2d').drawImage(rc, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    } catch (_) { cv.replaceWith(Object.assign(document.createElement('div'), { className: 't5-noph', textContent: '사진을 불러오지 못했습니다' })); }
  }
  async function patchEntry(patch, stay) {
    const st = store(), m = me(), old = (MAP[st] || {})[cur.key] || {};
    const val = Object.assign({ shelves: [], codes: [], photos: [] }, old, patch, { by: (m && m.name) || '', ts: Date.now() });
    val.label = cur.title; if (!cur.title.startsWith('세일존')) val.name = '';
    const empty = !(val.photos.length || val.shelves.length || val.codes.length || val.name);
    let ok = false;
    try { const r = await window.KM.safeSave('floorplan/top500Map/' + st + '/' + cur.key, empty ? null : val, { silent: true }); ok = !!(r && r.ok); } catch (_) {}
    if (!ok) { alert('저장 실패 — 인터넷·로그인 확인 후 다시 해 주세요.'); return false; }
    MAP[st] = MAP[st] || {}; if (empty) delete MAP[st][cur.key]; else MAP[st][cur.key] = val;
    if (!stay) cur.mode = '';
    render(); decorate(); return true;
  }
  function pinned() { return ((MAP[store()] || {})[cur.key] || {}).photos || []; }
  async function renderPick() {
    const $ = id => document.getElementById(id);
    $('t5-cut').style.display = 'none'; $('t5-edit').style.display = 'none'; $('t5-ref').style.display = 'none';
    $('t5-title').textContent = '✂️ ' + cur.title + ' — 사진 넣기';
    const pins = pinned();
    $('t5-sub').textContent = '위 칸: 플래노그램 사진을 눌러 필요한 부분만 오려 넣기 · 아래 칸: 우리 제품 사진을 눌러 넣기(다시 누르면 빼기) · 지금 ' + pins.length + '장';
    const P = await loadPlano();
    if (!cur || cur.mode !== 'pick') return;
    const d = DATA[BRANCH_OF[store()]];
    const tops = TOPICS.filter(([k]) => (P.photos[k] || []).length);
    if (!cur.topic || !(P.photos[cur.topic] || []).length) cur.topic = tops[0] ? tops[0][0] : '';
    const files = P.photos[cur.topic] || [];
    const have = new Set(pins.filter(x => x.code).map(x => x.code));
    const q = (cur.pq || '').trim().toUpperCase();
    const prods = d.items.filter(x => !q || x.name.toUpperCase().includes(q) || x.code.includes(q));
    $('t5-tools').innerHTML = '';
    $('t5-body').innerHTML = `<div class="t5-split">
      <section class="t5-pane"><div class="t5-ph2">🖼 플래노그램 사진 — 눌러서 오려 넣기</div>
        <div class="t5-chips">${tops.map(([k, nm]) => `<button class="t5-chip${k === cur.topic ? ' on' : ''}" data-k="${k}">${nm} <small>${P.photos[k].length}</small></button>`).join('')}</div>
        <div class="t5-scroll" id="t5-pl"><div class="t5-pgrid">${files.map(f => `<button class="t5-pth" data-f="${esc(f)}"><img loading="lazy" src="../hmart-photos/${esc(f)}" style="transform:rotate(${P.rot[f] || 0}deg)"></button>`).join('')}</div></div></section>
      <section class="t5-pane"><div class="t5-ph2">📦 우리 제품 사진 (Top 500) — 눌러서 넣기</div>
        <input id="t5-pq" class="t5-q" placeholder="🔍 이름·바코드로 찾기" value="${esc(cur.pq || '')}">
        <div class="t5-scroll" id="t5-pr"><div class="t5-grid">${prods.map(x => card(x, have.has(x.code))).join('')}</div></div></section></div>`;
    $('t5-foot').style.display = 'flex';
    $('t5-foot').innerHTML = `<span style="flex:1">넣은 사진 <b>${pins.length}</b>장</span><button class="t5-btn green" id="t5-back">✓ 다 넣었어요</button>`;
    $('t5-back').onclick = () => { cur.mode = ''; render(); };
    $('t5-body').querySelectorAll('.t5-chip').forEach(b => b.onclick = () => { cur.topic = b.dataset.k; renderPick(); });
    $('t5-body').querySelectorAll('.t5-pth').forEach(b => b.onclick = () => { cur.cropFile = b.dataset.f; cur.cropRot = P.rot[b.dataset.f] || 0; cur.sel = null; cur.mode = 'crop'; render(); });
    $('t5-body').querySelectorAll('#t5-pr .t5-card').forEach(c => c.onclick = async () => {
      const code = c.dataset.code, list = pinned();
      const next = have.has(code) ? list.filter(x => x.code !== code) : list.concat([{ code }]);
      const keep = $('t5-pr').scrollTop;
      if (await patchEntry({ photos: next }, true)) { const r = document.getElementById('t5-pr'); if (r) r.scrollTop = keep; }
    });
    const pq = $('t5-pq'); pq.oninput = () => { cur.pq = pq.value; const pos = pq.selectionStart; renderPick().then(() => { const n = document.getElementById('t5-pq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); };
  }
  async function renderCrop() {
    const $ = id => document.getElementById(id);
    $('t5-title').textContent = '✂️ ' + cur.title + ' — 오리기';
    $('t5-sub').textContent = '필요한 제품 부분을 손가락(마우스)으로 끌어서 네모를 그리세요. 다시 그리면 새 네모로 바뀝니다.';
    $('t5-tools').innerHTML = `<div class="t5-row" style="margin:0"><button class="t5-btn dark" id="t5-rot">↻ 돌리기</button></div>`;
    $('t5-body').innerHTML = `<div class="t5-cropwrap"><canvas id="t5-cv"></canvas></div>`;
    $('t5-foot').style.display = 'flex';
    $('t5-foot').innerHTML = `<button class="t5-btn" id="t5-back">← 다른 사진</button><span style="flex:1"></span>
      <button class="t5-btn" id="t5-whole">사진 통째로 넣기</button><button class="t5-btn green" id="t5-take" disabled>✂️ 이 부분 넣기</button>`;
    $('t5-back').onclick = () => { cur.mode = 'pick'; render(); };
    const cv = $('t5-cv'), wrap = cv.parentElement;
    let rc;
    try { rc = rotated(await img(cur.cropFile), cur.cropRot); } catch (_) { $('t5-body').innerHTML = '<div class="t5-empty">사진을 불러오지 못했습니다</div>'; return; }
    if (!cur || cur.mode !== 'crop') return;
    const paint = () => {
      const g = cv.getContext('2d'); g.drawImage(rc, 0, 0, cv.width, cv.height);
      const s = cur.sel; if (!s) return;
      const x = s[0] * cv.width, y = s[1] * cv.height, w = s[2] * cv.width, h = s[3] * cv.height;
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(0, 0, cv.width, y); g.fillRect(0, y + h, cv.width, cv.height - y - h); g.fillRect(0, y, x, h); g.fillRect(x + w, y, cv.width - x - w, h);
      g.strokeStyle = '#F5B700'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    };
    const fit = () => {
      const k = Math.min((wrap.clientWidth - 4) / rc.width, (wrap.clientHeight - 4) / rc.height);
      cv.width = Math.max(10, Math.round(rc.width * k)); cv.height = Math.max(10, Math.round(rc.height * k)); paint();
    };
    let start = null;
    const pt = ev => { const b = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))]; };
    cv.onpointerdown = ev => { ev.preventDefault(); cv.setPointerCapture(ev.pointerId); start = pt(ev); cur.sel = null; paint(); };
    cv.onpointermove = ev => { if (!start) return; const q = pt(ev); cur.sel = [Math.min(start[0], q[0]), Math.min(start[1], q[1]), Math.abs(q[0] - start[0]), Math.abs(q[1] - start[1])]; paint(); };
    cv.onpointerup = () => { start = null; if (cur.sel && (cur.sel[2] < 0.02 || cur.sel[3] < 0.02)) cur.sel = null; paint(); $('t5-take').disabled = !cur.sel; };
    fit();
    $('t5-rot').onclick = async () => { cur.cropRot = ((cur.cropRot || 0) + 90) % 360; cur.sel = null; rc = rotated(await img(cur.cropFile), cur.cropRot); fit(); $('t5-take').disabled = true; };
    const add = async c => {
      const piece = { f: cur.cropFile, r: cur.cropRot || 0, c: c.map(v => Math.round(v * 10000) / 10000) };
      $('t5-take').disabled = true; $('t5-whole').disabled = true;
      cur.mode = 'pick';
      if (!await patchEntry({ photos: pinned().concat([piece]) }, true)) { cur.mode = 'crop'; $('t5-take').disabled = !cur.sel; $('t5-whole').disabled = false; }
    };
    $('t5-take').onclick = () => cur.sel && add(cur.sel);
    $('t5-whole').onclick = () => add([0, 0, 1, 1]);
  }

  /* ---------- 사진 자동 정렬 (줄마다 높이를 맞춰 빈틈 없이 꽉 채움) + 자리 바꾸기 ---------- */
  async function aspectOf(p, d) {
    let a = 1;
    try {
      if (p.code) {
        const x = d.byCode[p.code];
        a = (x && x.photo) ? await new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth / i.naturalHeight || 0.8); i.onerror = () => res(0.8); i.src = '../top500/' + x.photo; }) : 0.8;
      } else {
        const im = await img(p.f), r = p.r || 0, c = p.c || [0, 0, 1, 1];
        const rw = (r % 180) ? im.height : im.width, rh = (r % 180) ? im.width : im.height;
        a = (c[2] * rw) / (c[3] * rh);
      }
    } catch (_) {}
    return Math.min(4, Math.max(0.25, a || 1));
  }
  let mosaicJob = 0;
  async function layoutMosaic(pcs, d) {
    const job = ++mosaicJob;
    const box0 = document.getElementById('t5-mosaic'); if (!box0) return;
    const asp = await Promise.all(pcs.map(pc => aspectOf(pc, d)));
    const box = document.getElementById('t5-mosaic');
    if (!box || job !== mosaicJob) return;
    const W = box.clientWidth, gap = 6, H0 = W < 700 ? 160 : 220;
    // 줄 수를 먼저 정하고(기본 높이 기준), 비율 합이 줄마다 비슷하게 나눈 뒤 각 줄을 폭에 꽉 채움 → 혼자 남는 사진 없음
    const total = asp.reduce((x, y) => x + y, 0);
    const k = Math.max(1, Math.min(pcs.length, Math.round(total * H0 / W) || 1));
    const target = total / k, rows = []; let row = [], sum = 0, done = 0;
    pcs.forEach((_, i) => {
      const left = pcs.length - i, rowsLeft = k - rows.length;
      if (row.length && rows.length < k - 1 && (Math.abs(sum + asp[i] - target) > Math.abs(sum - target) || left < rowsLeft)) {
        rows.push(row); done += sum; row = []; sum = 0;
      }
      row.push(i); sum += asp[i];
    });
    if (row.length) rows.push(row);
    const rowsH = rows.map(r => { const sm = r.reduce((x, i) => x + asp[i], 0); return [r, Math.min((W - gap * (r.length - 1)) / sm, H0 * 2.2)]; });
    const edit = canEdit();
    box.innerHTML = rowsH.map(([r, h]) => `<div class="t5-mrow" style="height:${h}px">${r.map(i => {
      const pc = pcs[i], w = Math.floor(asp[i] * h);
      const del = edit && !cur.swap ? `<button class="t5-del" data-i="${i}" title="빼기">✕</button>` : '';
      const selc = cur.swap ? (cur.swapSel === i ? ' sel' : ' swap') : '';
      if (pc.code) {
        const x = d.byCode[pc.code];
        return `<div class="t5-tile prod${selc}" data-i="${i}" style="width:${w}px">${x && x.photo ? `<img src="../top500/${esc(x.photo)}" alt="">` : '<div class="t5-noph">사진 없음</div>'}<span class="t5-cap">${esc(x ? x.name : pc.code)}</span>${del}</div>`;
      }
      return `<div class="t5-tile${selc}" data-i="${i}" style="width:${w}px"><canvas data-i="${i}"></canvas>${del}</div>`;
    }).join('')}</div>`).join('');
    box.querySelectorAll('canvas').forEach(cv => drawPiece(cv, pcs[+cv.dataset.i]));
    box.querySelectorAll('.t5-del').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      if (!confirm('이 사진을 뺄까요?')) return;
      await patchEntry({ photos: pcs.filter((_, i) => i !== +b.dataset.i) }, true);
    });
    if (cur.swap) box.querySelectorAll('.t5-tile').forEach(t => t.onclick = async () => {
      const i = +t.dataset.i;
      if (cur.swapSel == null) { cur.swapSel = i; layoutMosaic(pcs, d); return; }
      if (cur.swapSel === i) { cur.swapSel = null; layoutMosaic(pcs, d); return; }
      const next = pcs.slice(), j = cur.swapSel; [next[i], next[j]] = [next[j], next[i]];
      cur.swapSel = null;
      await patchEntry({ photos: next }, true);
    });
  }
  let relayT = null;
  window.addEventListener('resize', () => { clearTimeout(relayT); relayT = setTimeout(() => { if (document.getElementById('t5-mosaic') && cur && !cur.mode) render(); }, 200); });

  /* ---------- 기존 도면 코드에 연결 ---------- */
  function hook() {
    // 통로 번호 클릭: Top 500 자료가 있는 지점이면 Top 500 팝업 (H마트 진열 레퍼런스는 팝업 안 버튼으로)
    const origAisle = window.openPlanogramForAisle;
    window.openPlanogramForAisle = async function (zoneId, aisleNum, ev) {
      ev && ev.stopPropagation && ev.stopPropagation();
      const d = await loadData(store());
      if (!d) return origAisle(zoneId, aisleNum, ev);
      openFor('A:' + aisleNum, '통로 ' + aisleNum, () => origAisle(zoneId, aisleNum, null));
    };
    // 도면을 다시 그릴 때마다 표시 갱신
    const origLoad = window.loadZones;
    window.loadZones = function () { const r = origLoad.apply(this, arguments); setTimeout(decorate, 0); return r; };
    // 속성 패널: 선택한 박스의 Top 500 버튼
    const props = document.getElementById('props');
    if (props && !document.getElementById('t5-props-btn')) {
      const b = document.createElement('button');
      b.id = 't5-props-btn';
      b.textContent = '⭐ Top 500 상품 보기 / 정하기';
      b.style.cssText = 'width:100%;background:linear-gradient(135deg,#F39C12,#C8102E);color:#fff;border:0;padding:10px;border-radius:8px;font-weight:800;font-size:.95em;cursor:pointer;margin-bottom:12px';
      b.onclick = () => { const z = window.selected || selected; if (!z) return; if (z.type === 'aisle') { alert('통로는 도면에서 번호(예: 11, 12)를 눌러 주세요.'); return; } openFor(zoneKey(z), titleOf(z)); };
      props.insertBefore(b, props.firstChild);
    }
    decorate();
  }

  const css = document.createElement('style');
  css.textContent = `
  .t5-badge{position:absolute;right:1px;top:1px;z-index:6;border:0;border-radius:7px;padding:0 4px;font:800 9px/1.5 system-ui,sans-serif;background:rgba(200,16,46,.85);color:#fff;cursor:pointer;white-space:nowrap}
  .t5-badge.empty{display:none;background:#fff;color:#C8102E;border:1px dashed #C8102E}
  .zone.selected .t5-badge.empty{display:block}
  .t5-badge.sz,.t5-badge.sz.empty{display:block;background:none;border:0;color:#fff;font-size:13px;font-weight:900;left:50%;right:auto;top:50%;transform:translate(-50%,-50%);z-index:8;padding:2px 4px;text-shadow:0 0 2px rgba(0,0,0,.35)}
  .t5-szone>.zone-num,.t5-szone>.zone-label,.t5-szone>.zone-sub{visibility:hidden}
  .t5-badge.sz.has{text-decoration:underline;text-underline-offset:2px}
  [data-t5n]::after{content:"⭐" attr(data-t5n);margin-left:2px;font-size:8px;color:#C8102E}
  #t5-modal{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100000;display:none;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(3px)}
  .t5-box{background:#fff;border-radius:12px;width:100%;max-width:1050px;height:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,'Malgun Gothic',sans-serif}
  .t5-head{background:#C8102E;color:#fff;padding:10px 14px;display:flex;gap:8px;align-items:center}
  .t5-title{font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t5-sub{font-size:12px;opacity:.92;margin-top:2px}
  .t5-btn{border:0;border-radius:7px;padding:7px 12px;font-weight:800;font-size:13px;cursor:pointer;background:rgba(255,255,255,.22);color:#fff;white-space:nowrap}
  .t5-foot .t5-btn{background:#e5e7eb;color:#111}.t5-btn.gold{background:#F5B700;color:#111}.t5-btn.red{background:#111}.t5-btn.green{background:#16a34a!important;color:#fff!important}
  .t5-tools{padding:8px 12px 0}.t5-row{display:flex;gap:6px;margin-top:6px}
  .t5-q{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #ccc;border-radius:8px;font-size:14px}
  .t5-chips{display:flex;flex-wrap:wrap;gap:5px}.t5-chip{border:1px solid #ccc;background:#fff;border-radius:14px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer}
  .t5-chip.on{background:#C8102E;color:#fff;border-color:#C8102E}.t5-chip small{opacity:.7}
  .t5-body{flex:1;overflow:auto;padding:10px 12px}
  .t5-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .t5-card{border:1px solid #e5e7eb;border-radius:9px;padding:6px;cursor:default;background:#fff}
  .t5-card.on,.t5-card.off{cursor:pointer}.t5-card.on{border:2px solid #16a34a;background:#f0fdf4}.t5-card.off{opacity:.75}
  .t5-ph{position:relative;height:110px;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:6px;overflow:hidden}
  .t5-ph img{max-width:100%;max-height:100%;object-fit:contain}.t5-noph{color:#aaa;font-size:12px}
  .t5-rank{position:absolute;left:4px;top:4px;background:#111;color:#fff;font-size:11px;font-weight:800;border-radius:6px;padding:1px 5px}
  .t5-chk{position:absolute;right:4px;top:4px;width:22px;height:22px;border-radius:50%;background:#16a34a;color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center}
  .t5-card.off .t5-chk{background:#9ca3af}
  .t5-nm{font-size:12px;font-weight:800;margin-top:5px;line-height:1.25}.t5-meta{font-size:10.5px;color:#777;margin-top:2px}.t5-note{font-size:10.5px;color:#D35400;margin-top:2px}
  .t5-mosaic{margin-bottom:12px}
  .t5-mrow{display:flex;gap:6px;margin-bottom:6px}
  .t5-tile{position:relative;flex:none;height:100%;border-radius:6px;overflow:hidden;background:#111}
  .t5-tile canvas{width:100%;height:100%;display:block}
  .t5-tile.prod{background:#fff;border:1px solid #e5e7eb}
  .t5-tile.prod img{width:100%;height:100%;object-fit:contain;display:block}
  .t5-cap{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);color:#fff;font-size:10px;font-weight:700;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t5-tile.swap{cursor:pointer;outline:2px dashed #F5B700;outline-offset:-2px}
  .t5-tile.sel{outline:4px solid #16a34a;outline-offset:-4px}
  .t5-pieces{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-bottom:12px;align-items:start}
  .t5-piece{position:relative;background:#111;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .t5-piece.prod{background:none;display:block}
  .t5-piece canvas{max-width:100%;max-height:60vh;display:block}
  .t5-del{position:absolute;right:6px;top:6px;z-index:3;width:30px;height:30px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;font-weight:900;cursor:pointer}
  .t5-sec{font-weight:800;margin:6px 0 8px;color:#C8102E}
  .t5-split{display:flex;flex-direction:column;gap:10px;height:100%}
  .t5-pane{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;border:1px solid #e5e7eb;border-radius:10px;padding:8px}
  .t5-ph2{font-weight:900;color:#C8102E;font-size:14px}
  .t5-scroll{flex:1;min-height:120px;overflow:auto}
  .t5-pane .t5-chips{max-height:62px;overflow:auto}
  .t5-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px}
  .t5-pth{border:0;padding:0;background:#eee;border-radius:8px;overflow:hidden;aspect-ratio:3/4;cursor:pointer}
  .t5-pth img{width:100%;height:100%;object-fit:cover}
  .t5-cropwrap{height:100%;min-height:300px;display:flex;align-items:center;justify-content:center;background:#222;border-radius:8px}
  .t5-cropwrap canvas{touch-action:none;cursor:crosshair;display:block}
  .t5-btn.dark{background:#374151}.t5-btn:disabled{opacity:.45;cursor:default}
  .t5-empty{padding:40px 10px;text-align:center;color:#555;font-size:15px}
  .t5-foot{padding:10px 12px;border-top:1px solid #eee;gap:8px;align-items:center}`;
  document.head.appendChild(css);

  // switchStore 는 loadZones 를 부르므로 따로 안 걸어도 됨. KM 모듈(km-firebase) 준비 후 시작.
  function start() { if (window.KM && window.KM.safeFetch) hook(); else setTimeout(start, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.T5Shelf = { openFor, decorate };
})();
