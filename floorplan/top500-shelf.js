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

  /* SZ 영문 순서: 도면 위→아래(40px 줄), 왼→오. 사장님이 이름을 정해 저장하면 그 이름 우선. */
  const SZNAME = {}; // zoneKey -> 'SZ-A'
  function letter(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
  function nameSZ(map) {
    Object.keys(SZNAME).forEach(k => delete SZNAME[k]);
    const list = (window.zones || zones).filter(isSZ).sort((a, b) => (Math.round(a.y / 40) - Math.round(b.y / 40)) || (a.x - b.x));
    const used = new Set();
    list.forEach(z => { const e = map[zoneKey(z)]; if (e && e.name) { SZNAME[zoneKey(z)] = e.name; used.add(e.name); } });
    let i = 0;
    list.forEach(z => { const k = zoneKey(z); if (SZNAME[k]) return; let n; do { n = 'SZ-' + letter(i++); } while (used.has(n)); SZNAME[k] = n; used.add(n); });
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
          const cnt = itemsOf(d, e).length;
          if (cnt) sp.setAttribute('data-t5n', cnt);
        });
        return;
      }
      const e = map[zoneKey(z)];
      const cnt = itemsOf(d, e).length;
      const show = isSZ(z) || cnt > 0 || (edit && ( (PICKABLE.test(z.ftype || z.type) && !SKIP_LABEL.test(z.label || ''))));
      if (!show) return;
      const b = document.createElement('button');
      b.className = 't5-badge' + (cnt ? '' : ' empty') + (isSZ(z) ? ' sz' : '');
      b.textContent = isSZ(z) ? (SZNAME[zoneKey(z)] + (cnt ? ' ⭐' + cnt : '')) : (cnt ? '⭐' + cnt : '＋⭐');
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
        <button id="t5-edit" class="t5-btn gold" style="display:none">✏️ 편집</button>
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
    cur = { key, title, editing: false, refCb, q: '', chip: '' };
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
    const st = store(), d = DATA[BRANCH_OF[st]], map = MAP[st] || {};
    const e = cur.editing ? cur.draft : (map[cur.key] || null);
    const list = itemsOf(d, e);
    const $ = id => document.getElementById(id);
    $('t5-title').textContent = '⭐ ' + cur.title;
    const shelfTxt = (e && e.shelves && e.shelves.length) ? e.shelves.map(k => d.shelfName[k] || k).join(' · ') : '';
    $('t5-sub').textContent = cur.editing
      ? '편집 중 — 매대 묶음을 누르거나, 아래에서 상품을 하나씩 눌러 넣고 빼세요. 선택 ' + list.length + '개'
      : (list.length ? 'Top 500 ' + list.length + '개' + (shelfTxt ? ' · ' + shelfTxt : '') + (e && e.by ? ' · 정한 사람 ' + e.by : '') : '아직 정해지지 않음');
    $('t5-edit').style.display = canEdit() && !cur.editing ? '' : 'none';
    $('t5-edit').onclick = () => { cur.editing = true; cur.draft = { shelves: [...((map[cur.key] || {}).shelves || [])], codes: [...((map[cur.key] || {}).codes || [])], name: (map[cur.key] || {}).name || SZNAME[cur.key] || '' }; render(); };
    $('t5-ref').style.display = cur.refCb && !cur.editing ? '' : 'none';
    $('t5-ref').onclick = () => { const cb = cur.refCb; close(); cb && cb(); };
    const tools = $('t5-tools'), body = $('t5-body'), foot = $('t5-foot');
    if (!cur.editing) {
      tools.innerHTML = list.length > 12 ? `<input id="t5-q" class="t5-q" placeholder="🔍 이름·바코드 검색" value="${esc(cur.q)}">` : '';
      const q = cur.q.trim().toUpperCase();
      const shown = q ? list.filter(x => x.name.toUpperCase().includes(q) || x.code.includes(q)) : list;
      body.innerHTML = list.length
        ? `<div class="t5-grid">${shown.map(x => card(x)).join('')}</div>`
        : `<div class="t5-empty">${canEdit() ? '오른쪽 위 <b>✏️ 편집</b>을 눌러 이 자리에 올 Top 500 상품을 정해 주세요.' : '사장님이 아직 이 자리의 Top 500 상품을 정하지 않았습니다.'}</div>`;
      foot.style.display = 'none';
      const qi = $('t5-q'); if (qi) { qi.oninput = () => { cur.q = qi.value; const p = qi.selectionStart; render(); const n = $('t5-q'); n.focus(); n.setSelectionRange(p, p); }; }
      return;
    }
    // 편집 화면: 매대 묶음 칩 + 전체 Top 500 (선택/해제)
    const dr = cur.draft, onShelf = new Set(dr.shelves), sel = new Set(list.map(x => x.code));
    const isSzKey = cur.title.startsWith('세일존');
    tools.innerHTML = (isSzKey ? `<div class="t5-row" style="margin:0 0 6px"><b style="align-self:center;white-space:nowrap">이름</b><input id="t5-name" class="t5-q" style="max-width:160px" value="${esc(dr.name || '')}" placeholder="SZ-A"></div>` : '') + `<div class="t5-chips">${d.shelves.map(s => `<button class="t5-chip${onShelf.has(s.key) ? ' on' : ''}" data-shelf="${s.key}">${esc(s.ko)} <small>${s.count}</small></button>`).join('')}</div>
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
    const val = (dr.shelves.length || dr.codes.length || (isSzKey && dr.name))
      ? { shelves: dr.shelves, codes: dr.codes, name: isSzKey ? (dr.name || SZNAME[cur.key] || '') : '', label: isSzKey ? '세일존 ' + (dr.name || SZNAME[cur.key]) : cur.title, by: (m && m.name) || '', ts: Date.now() }
      : null;
    const btn = document.getElementById('t5-save'); if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    let ok = false;
    try { const r = await window.KM.safeSave('floorplan/top500Map/' + st + '/' + cur.key, val, { silent: true }); ok = !!(r && r.ok); } catch (_) {}
    if (!ok) { alert('저장 실패 — 인터넷·로그인 확인 후 다시 눌러 주세요.'); if (btn) { btn.disabled = false; btn.textContent = '💾 저장'; } return; }
    MAP[st] = MAP[st] || {}; if (val) MAP[st][cur.key] = val; else delete MAP[st][cur.key];
    if (isSzKey && dr.name) { SZNAME[cur.key] = dr.name; cur.title = '세일존 ' + dr.name; }
    cur.editing = false; render(); decorate();
  }

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
  .t5-badge{position:absolute;right:2px;top:2px;z-index:6;border:0;border-radius:9px;padding:1px 6px;font:800 10px/1.4 system-ui,sans-serif;background:#C8102E;color:#fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.35);white-space:nowrap}
  .t5-badge.empty{background:rgba(255,255,255,.9);color:#C8102E;border:1px dashed #C8102E}
  .t5-badge.sz{background:#0D47A1;font-size:11px;left:50%;right:auto;top:50%;transform:translate(-50%,-50%);z-index:8}
  .t5-szone>.zone-num,.t5-szone>.zone-label,.t5-szone>.zone-sub{visibility:hidden}.t5-badge.sz.empty{background:#fff;color:#0D47A1;border-color:#0D47A1}
  [data-t5n]::after{content:"⭐" attr(data-t5n);margin-left:3px;font-size:9px;color:#C8102E}
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
  .t5-empty{padding:40px 10px;text-align:center;color:#555;font-size:15px}
  .t5-foot{padding:10px 12px;border-top:1px solid #eee;gap:8px;align-items:center}`;
  document.head.appendChild(css);

  // switchStore 는 loadZones 를 부르므로 따로 안 걸어도 됨. KM 모듈(km-firebase) 준비 후 시작.
  function start() { if (window.KM && window.KM.safeFetch) hook(); else setTimeout(start, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.T5Shelf = { openFor, decorate };
})();
