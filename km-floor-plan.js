// ============================================================
// km-floor-plan.js — 김치마트 매장 도면 컴포넌트
// ============================================================
// 2026-05-20 — 매장 도면을 tasks.html 같은 다른 페이지에서 재사용.
//   1) Manager View: 히트맵 (zone 별 업무 완료 상태)
//   2) Assign Modal: zone picker (클릭으로 위치 지정)
//
// 데이터: floorplan/floorplan-data.json (stores.{branch} 배열)
// 사용:
//   <script src="./km-floor-plan.js?v=1"></script>
//   const fp = await window.KMFloorPlan.load('LASOLAS');
//   window.KMFloorPlan.render(container, fp.zones, { mode:'heatmap', states:{...} });
// ============================================================

(function(){
  'use strict';
  const DATA_URL = './floorplan/floorplan-data.json';
  // 매장 ID 매핑 — tasks.html / chat.html 의 branchId 형식 → JSON 키
  const BRANCH_MAP = {
    'LASOLAS': 'lasolas',
    'CORAL_SPRINGS': 'coral',
    'HOLLYWOOD': 'hollywood',
    'PEMBROKE_PINES': 'pembroke',
    'WEST_PALM': 'westpalm',
    'MIAMI': 'miami',
  };

  let CACHED_DATA = null;
  async function loadData(){
    if (CACHED_DATA) return CACHED_DATA;
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now(), { cache:'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      CACHED_DATA = await r.json();
      return CACHED_DATA;
    } catch(e) {
      console.warn('[floor-plan] load failed', e);
      throw e;
    }
  }

  async function load(branchId){
    const data = await loadData();
    const key = BRANCH_MAP[branchId] || branchId.toLowerCase();
    const zones = (data.stores && data.stores[key]) || [];
    return { branchId, key, zones };
  }

  // ============== Rendering ==============
  function escHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // zone 의 표시용 본문 — 숫자(num) + 라벨 + 부제(sub) 조합
  function zoneTitle(z){
    const parts = [];
    if (z.num) parts.push(z.num);
    if (z.label) parts.push(z.label.replace(/<br>/g, ' '));
    return parts.join(' · ');
  }

  // 컨테이너에 SVG 로 도면 렌더링.
  // options:
  //   mode: 'view' | 'heatmap' | 'pick'
  //   states: { [zoneId]: 'done' | 'progress' | 'pending' | 'idle' }   (heatmap 만)
  //   inventory: { [zoneId]: 'ok' | 'low' | 'out' }   (재고 상태 overlay — task state 위에 우선 적용)
  //   onPick / onZoneClick: function(zone) { ... }   (클릭 핸들러)
  //   canvasW, canvasH: 도면 캔버스 크기 (기본 1100x780)
  //   highlightZoneId: 강조 표시할 zone (선택)
  function render(container, zones, options){
    options = options || {};
    const mode = options.mode || 'view';
    const states = options.states || {};
    const inventory = options.inventory || {};
    const canvasW = options.canvasW || 1100;
    const canvasH = options.canvasH || 780;
    const onPick = options.onPick;
    const onZoneClick = options.onZoneClick;
    const hi = options.highlightZoneId;

    // 색상 매핑 — heatmap 모드용
    const STATE_COLOR = {
      done:     { fill:'#16a34a', stroke:'#15803d', alpha:0.78 },
      progress: { fill:'#f59e0b', stroke:'#d97706', alpha:0.78 },
      pending:  { fill:'#dc2626', stroke:'#b91c1c', alpha:0.78 },
      idle:     null,
    };
    // 재고 상태 색상 — task state 보다 우선 적용 (매장 운영에 더 critical)
    const INV_COLOR = {
      out:      { fill:'#dc2626', stroke:'#7f1d1d', alpha:0.92 },   // 진한 빨강
      low:      { fill:'#f59e0b', stroke:'#92400e', alpha:0.85 },   // 진한 주황
      ok:       { fill:'#16a34a', stroke:'#15803d', alpha:0.65 },   // 약한 녹색 (덜 강조)
    };

    const svgParts = [];
    svgParts.push(
      '<svg viewBox="0 0 ' + canvasW + ' ' + canvasH + '" ' +
      'preserveAspectRatio="xMidYMid meet" ' +
      'style="width:100%;height:auto;display:block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit">'
    );
    // 외곽 매장 테두리 (선택적)
    svgParts.push('<rect x="2" y="2" width="' + (canvasW-4) + '" height="' + (canvasH-4) + '" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6,4"/>');

    zones.forEach(z => {
      // 재고(inventory) 가 task state 보다 우선 — 매장 운영 critical.
      const invState = inventory[z.id];
      const ic = INV_COLOR[invState];
      const taskState = states[z.id];
      const sc = STATE_COLOR[taskState];
      // priority: inventory > task state > zone default color
      const eff = ic || sc;
      const fillColor = eff ? eff.fill : (z.color || '#94a3b8');
      const fillOpacity = eff ? eff.alpha : 1;
      const strokeColor = eff ? eff.stroke : '#475569';
      const strokeW = (hi && hi === z.id) ? 3.5 : 1.5;
      const cursor = (mode === 'pick' || onZoneClick) ? 'pointer' : 'default';
      const transform = z.rot ? ('rotate(' + z.rot + ' ' + (z.x + z.w/2) + ' ' + (z.y + z.h/2) + ')') : '';
      // 클릭 핸들러용 데이터 속성
      svgParts.push(
        '<g class="km-fp-zone" data-zone-id="' + z.id + '" ' +
        (transform ? 'transform="' + transform + '" ' : '') +
        'style="cursor:' + cursor + '">' +
        '<rect x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '" ' +
        'fill="' + fillColor + '" fill-opacity="' + fillOpacity + '" ' +
        'stroke="' + strokeColor + '" stroke-width="' + strokeW + '" rx="4" ry="4"/>'
      );
      // 라벨 — num + label (HTML <br> 을 줄바꿈으로). 작은 zone 은 글자 생략.
      const minDim = Math.min(z.w, z.h);
      if (minDim >= 24) {
        const cx = z.x + z.w / 2;
        const cy = z.y + z.h / 2;
        const lines = [];
        if (z.num) lines.push(String(z.num));
        if (z.label && minDim >= 40) {
          String(z.label).split(/<br>|\n/).forEach(l => { if (l.trim()) lines.push(l.trim()); });
        }
        // 폰트 사이즈 자동 — 작은 zone 은 더 작게
        const fs = minDim < 40 ? 8 : minDim < 60 ? 10 : minDim < 90 ? 11 : 12;
        const totalH = lines.length * (fs + 1);
        const startY = cy - totalH / 2 + fs;
        const textColor = eff ? '#fff' : (isLightColor(fillColor) ? '#1f2937' : '#fff');
        lines.forEach((line, i) => {
          svgParts.push(
            '<text x="' + cx + '" y="' + (startY + i * (fs + 1)) + '" ' +
            'text-anchor="middle" font-size="' + fs + '" font-weight="700" ' +
            'fill="' + textColor + '" pointer-events="none">' + escHtml(line) + '</text>'
          );
        });
      }
      // 🆕 재고 상태 아이콘 (좌상단) — 한눈에 인지
      if (invState && minDim >= 30) {
        const icon = invState === 'out' ? '🚫' : invState === 'low' ? '⚠' : '';
        if (icon) {
          svgParts.push(
            '<text x="' + (z.x + 4) + '" y="' + (z.y + 14) + '" font-size="12" ' +
            'pointer-events="none">' + icon + '</text>'
          );
        }
      }
      svgParts.push('</g>');
    });

    svgParts.push('</svg>');
    container.innerHTML = svgParts.join('');

    // pick 모드 — 클릭 핸들러 등록
    if (mode === 'pick' && typeof onPick === 'function') {
      container.querySelectorAll('.km-fp-zone').forEach(g => {
        g.addEventListener('click', (e) => {
          const id = parseInt(g.dataset.zoneId, 10);
          const z = zones.find(x => x.id === id);
          if (z) onPick(z);
        });
      });
    }
    // 일반 view/heatmap 에서도 onZoneClick 받으면 클릭 활성
    else if (typeof onZoneClick === 'function') {
      container.querySelectorAll('.km-fp-zone').forEach(g => {
        g.addEventListener('click', (e) => {
          const id = parseInt(g.dataset.zoneId, 10);
          const z = zones.find(x => x.id === id);
          if (z) onZoneClick(z);
        });
      });
    }
  }

  // 밝은 색인지 판별 — 텍스트 가독성용
  function isLightColor(c){
    if (!c) return false;
    let r=128, g=128, b=128;
    if (c.startsWith('#')) {
      const hex = c.slice(1);
      if (hex.length === 6) {
        r = parseInt(hex.slice(0,2), 16);
        g = parseInt(hex.slice(2,4), 16);
        b = parseInt(hex.slice(4,6), 16);
      }
    } else if (c.startsWith('rgba(') || c.startsWith('rgb(')) {
      const m = c.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) {
        r = parseFloat(m[0]); g = parseFloat(m[1]); b = parseFloat(m[2]);
      }
    }
    // 휘도 공식 (Y = 0.299R + 0.587G + 0.114B)
    return (0.299*r + 0.587*g + 0.114*b) > 160;
  }

  // ============== task → zone 매핑 ==============
  // task.zoneId 가 명시되어 있으면 우선 사용. 없으면 task.place / task.name
  // 텍스트에서 통로 번호 ("5번", "Aisle 5", "5,6") 추출해 zone.num 과 매칭.
  function inferZoneId(task, zones){
    if (!task || !zones) return null;
    if (typeof task.zoneId === 'number') return task.zoneId;
    const haystack = ((task.place || '') + ' ' + (task.name || '')).toLowerCase();
    // 통로 번호 추출 — "5번", "aisle 5", "통로 5", "5,6", "[5번]" 등
    const aisleMatch = haystack.match(/(?:aisle|통로|aisle\s*#?\s*|#\s*)\s*(\d+)|(\d+)\s*번\s*통로|\[(\d+)/);
    let aisleNum = null;
    if (aisleMatch) {
      aisleNum = parseInt(aisleMatch[1] || aisleMatch[2] || aisleMatch[3], 10);
    }
    if (aisleNum) {
      // zone.num 이 "5,6" 같은 형태 → 그 안에 aisleNum 있는지
      for (const z of zones) {
        if (z.type === 'aisle' && z.num) {
          const nums = String(z.num).split(/[,\s]+/).map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x));
          if (nums.includes(aisleNum)) return z.id;
        }
      }
    }
    // 키워드 매칭 — label/sub 에 task 키워드 포함되면 매치
    const keywords = haystack.match(/[가-힣]{2,}|[a-z]{4,}/g) || [];
    if (keywords.length === 0) return null;
    let bestZone = null, bestScore = 0;
    for (const z of zones) {
      const zText = ((z.label || '') + ' ' + (z.sub || '')).toLowerCase().replace(/<br>|\n/g, ' ');
      let score = 0;
      for (const k of keywords) {
        if (zText.includes(k)) score++;
      }
      if (score > bestScore) { bestScore = score; bestZone = z; }
    }
    return bestZone ? bestZone.id : null;
  }

  // task 배열에서 zone 별 상태 집계 (heatmap 용)
  function buildZoneStates(tasks, zones){
    const states = {};
    for (const t of (tasks || [])) {
      const zid = inferZoneId(t, zones);
      if (!zid) continue;
      const cur = states[zid];
      // priority: done > progress > pending (don't downgrade)
      const newState = t.completedAt ? 'done' : t.startedAt ? 'progress' : 'pending';
      const priority = { done: 3, progress: 2, pending: 1 };
      if (!cur || priority[newState] > priority[cur]) {
        states[zid] = newState;
      }
    }
    return states;
  }

  // ============== Zone Inventory State (Phase 1) ==============
  // Firebase RTDB path: zoneState/{branch}/{zoneId}
  //   { status: 'ok' | 'low' | 'out', memo, updatedBy, updatedAt }
  // 'ok' 는 자주 안 쓰니까 기본값 (저장 안 함 = 정상으로 간주).
  // 'low' / 'out' 만 명시적으로 저장.
  const FB_DB_URL = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';

  async function loadZoneStates(branchId){
    try {
      const r = await fetch(FB_DB_URL + '/zoneState/' + encodeURIComponent(branchId) + '.json?t=' + Date.now(), { cache:'no-store' });
      if (!r.ok) return {};
      const data = (await r.json()) || {};
      // { zoneId: { status, memo, updatedBy, updatedAt } } → { zoneId: 'low'/'out'/'ok' }
      const result = {};
      Object.entries(data).forEach(([zid, v]) => {
        if (v && typeof v === 'object' && v.status) result[parseInt(zid, 10)] = v.status;
      });
      return result;
    } catch(e) {
      console.warn('[fp] loadZoneStates failed', e);
      return {};
    }
  }

  async function loadZoneStateFull(branchId, zoneId){
    try {
      const r = await fetch(FB_DB_URL + '/zoneState/' + encodeURIComponent(branchId) + '/' + zoneId + '.json?t=' + Date.now(), { cache:'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch(_) { return null; }
  }

  async function saveZoneState(branchId, zoneId, payload){
    // payload: { status, memo, updatedBy }
    const body = Object.assign({}, payload, { updatedAt: Date.now() });
    // 'ok' + 빈 메모면 noise 없게 삭제 (null).
    const isClear = (payload.status === 'ok' && !(payload.memo || '').trim());
    try {
      const url = FB_DB_URL + '/zoneState/' + encodeURIComponent(branchId) + '/' + zoneId + '.json';
      const r = await fetch(url, {
        method: isClear ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: isClear ? undefined : JSON.stringify(body)
      });
      return { ok: r.ok, status: r.status };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  }

  window.KMFloorPlan = {
    load, render, inferZoneId, buildZoneStates, BRANCH_MAP,
    loadZoneStates, loadZoneStateFull, saveZoneState
  };
})();
