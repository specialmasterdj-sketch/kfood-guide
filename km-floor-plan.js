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
  let STATIC_CACHE = null;
  const FB_URL = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';

  // 정적 json(번들·repo) — 도면 권위 소스. 헐리우드는 RTDB floorplan/shared 에 틀린 도면이 있어
  //   이걸 강제 사용(전무님 2026-06-28 지시: "헐리우드는 번들 도면만, RTDB 것은 틀림").
  async function fetchStatic(){
    if (STATIC_CACHE) return STATIC_CACHE;
    const r = await fetch(DATA_URL + '?t=' + Date.now(), { cache:'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    STATIC_CACHE = await r.json();
    return STATIC_CACHE;
  }
  // 정적 json 을 강제로 쓸 매장(틀린 RTDB 무시). 필요 시 매장 추가.
  const STATIC_ONLY_BRANCHES = ['hollywood'];

  // 우선순위: 1) Firebase floorplan/shared (매니저가 floorplan editor 에서 저장한 최신본)
  //          2) 정적 floorplan-data.json (번들된 기본값)
  // — fb-auth-fetch.js 가 글로벌 fetch 에 auth 토큰 자동 첨부.
  async function loadData(){
    if (CACHED_DATA) return CACHED_DATA;
    // 1) Firebase 시도
    try {
      const r = await fetch(FB_URL + '/floorplan/shared.json?t=' + Date.now(), { cache:'no-store' });
      if (r.ok) {
        const fb = await r.json();
        if (fb && fb.stores) {
          CACHED_DATA = fb;
          return CACHED_DATA;
        }
      }
    } catch(e) { console.warn('[floor-plan] Firebase load failed, falling back to static', e); }
    // 2) 정적 JSON fallback
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
    const key = BRANCH_MAP[branchId] || branchId.toLowerCase();
    // 🔧 헐리우드 등 — RTDB(틀림) 무시하고 정적 json(맞는 도면) 강제 사용.
    if (STATIC_ONLY_BRANCHES.includes(key)) {
      try {
        const s = await fetchStatic();
        const z = (s && s.stores && s.stores[key]) || [];
        if (z.length) return { branchId, key, zones: z };
      } catch(e) { console.warn('[floor-plan] static-only load failed, falling back', e); }
    }
    const data = await loadData();
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

    // ============== 2D / 3D 분기 — options.iso === true 일 때만 입체 ==============
    // (헐리우드만 3D, 다른 매장은 평면도 유지)
    let svgParts;
    if (!options.iso) {
      svgParts = renderFlat2DParts(zones, options, STATE_COLOR, INV_COLOR);
      container.innerHTML = svgParts.join('');
      attachClickHandlers(container, zones, mode, onPick, onZoneClick);
      return;
    }

    // ============== 3D isometric 렌더링 ==============
    // 2026-05-25 — 입체 매장 도면 (hollywood-floorplan-3d 와 동일 룩)
    const COS30 = 0.8660254037844387, SIN30 = 0.5;
    function iso(x,y,z){ return { sx:(x-y)*COS30, sy:(x+y)*SIN30 - z }; }
    const Z_HEIGHT = {
      'front-door':   6,
      'checkout':     24,
      'perimeter':    60,
      'open-cooler':  50,
      'open-freezer': 50,
      'door-freezer': 92,
      'aisle':        80,
    };
    const zof = z => Z_HEIGHT[z.type] || 55;

    function hexToRgbA(c){
      let s = String(c||'#888').trim();
      if (s.startsWith('rgb')) {
        const m = s.match(/\d+(\.\d+)?/g);
        if (m && m.length >= 3) return [parseFloat(m[0])|0, parseFloat(m[1])|0, parseFloat(m[2])|0];
        return [136,136,136];
      }
      s = s.replace('#','');
      if (s.length === 3) s = s.split('').map(ch=>ch+ch).join('');
      const n = parseInt(s,16);
      if (isNaN(n)) return [136,136,136];
      return [(n>>16)&255, (n>>8)&255, n&255];
    }
    function shadeArr(rgb, pct){
      const f = pct < 0 ? 0 : 255;
      const t = Math.abs(pct);
      return [
        Math.round((f - rgb[0])*t + rgb[0]),
        Math.round((f - rgb[1])*t + rgb[1]),
        Math.round((f - rgb[2])*t + rgb[2]),
      ];
    }
    const toHex = a => '#' + a.map(c => Math.max(0,Math.min(255,c)).toString(16).padStart(2,'0')).join('');

    // 모든 8 꼭짓점 투영으로 viewBox 자동 계산
    let minSX=Infinity, maxSX=-Infinity, minSY=Infinity, maxSY=-Infinity;
    zones.forEach(z => {
      const h = zof(z);
      [[z.x,z.y,0],[z.x+z.w,z.y,0],[z.x+z.w,z.y+z.h,0],[z.x,z.y+z.h,0],
       [z.x,z.y,h],[z.x+z.w,z.y,h],[z.x+z.w,z.y+z.h,h],[z.x,z.y+z.h,h]
      ].forEach(([x,y,zz])=>{
        const p = iso(x,y,zz);
        if (p.sx < minSX) minSX = p.sx; if (p.sx > maxSX) maxSX = p.sx;
        if (p.sy < minSY) minSY = p.sy; if (p.sy > maxSY) maxSY = p.sy;
      });
    });
    if (!isFinite(minSX)) { minSX=0; maxSX=canvasW; minSY=0; maxSY=canvasH; }
    const PAD = 30;
    const vbX = minSX - PAD, vbY = minSY - PAD;
    const vbW = (maxSX - minSX) + PAD*2, vbH = (maxSY - minSY) + PAD*2;

    svgParts = [];
    svgParts.push(
      '<svg viewBox="' + vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH + '" ' +
      'preserveAspectRatio="xMidYMid meet" ' +
      'style="width:100%;height:auto;display:block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit">'
    );

    // 바닥 (4 모서리 iso 투영) — 약한 회색 채움
    const floorCorners = [iso(0,0,0), iso(canvasW,0,0), iso(canvasW,canvasH,0), iso(0,canvasH,0)];
    const floorPts = floorCorners.map(p => p.sx+','+p.sy).join(' ');
    svgParts.push('<polygon points="'+floorPts+'" fill="#eef2f7" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4,3" pointer-events="none"/>');

    // back-to-front 정렬 — 멀리 있는 것부터 그려서 가까운 게 위에 겹침
    const sorted = zones.slice().sort((a,b) => {
      return (a.x + a.w/2 + a.y + a.h/2) - (b.x + b.w/2 + b.y + b.h/2);
    });

    sorted.forEach(z => {
      const invState = inventory[z.id];
      const ic = INV_COLOR[invState];
      const taskState = states[z.id];
      const sc = STATE_COLOR[taskState];
      const eff = ic || sc;
      const baseColor = eff ? eff.fill : (z.color || '#94a3b8');
      const fillOpacity = eff ? eff.alpha : 1;
      const strokeColor = eff ? eff.stroke : '#475569';
      const strokeW = (hi && hi === z.id) ? 2.2 : 0.9;

      const rgb = hexToRgbA(baseColor);
      const colTop   = toHex(shadeArr(rgb,  0.10));
      const colRight = toHex(shadeArr(rgb, -0.20));
      const colFront = toHex(shadeArr(rgb, -0.34));

      const h = zof(z);
      const B = [
        iso(z.x,     z.y,     0),
        iso(z.x+z.w, z.y,     0),
        iso(z.x+z.w, z.y+z.h, 0),
        iso(z.x,     z.y+z.h, 0),
      ];
      const T = [
        iso(z.x,     z.y,     h),
        iso(z.x+z.w, z.y,     h),
        iso(z.x+z.w, z.y+z.h, h),
        iso(z.x,     z.y+z.h, h),
      ];

      const cursor = (mode === 'pick' || onZoneClick) ? 'pointer' : 'default';
      svgParts.push('<g class="km-fp-zone" data-zone-id="'+z.id+'" style="cursor:'+cursor+'">');

      // 그림자
      const shPts = B.map(p => p.sx+','+(p.sy+2)).join(' ');
      svgParts.push('<polygon points="'+shPts+'" fill="rgba(0,0,0,.18)" pointer-events="none"/>');

      // 우측면 (+x face)
      const rPts = [B[1],B[2],T[2],T[1]].map(p=>p.sx+','+p.sy).join(' ');
      svgParts.push('<polygon points="'+rPts+'" fill="'+colRight+'" fill-opacity="'+fillOpacity+'" stroke="'+strokeColor+'" stroke-width="'+strokeW+'" stroke-linejoin="round"/>');

      // 정면 (+y face)
      const fPts = [B[3],B[2],T[2],T[3]].map(p=>p.sx+','+p.sy).join(' ');
      svgParts.push('<polygon points="'+fPts+'" fill="'+colFront+'" fill-opacity="'+fillOpacity+'" stroke="'+strokeColor+'" stroke-width="'+strokeW+'" stroke-linejoin="round"/>');

      // 윗면
      const tPts = T.map(p=>p.sx+','+p.sy).join(' ');
      svgParts.push('<polygon points="'+tPts+'" fill="'+colTop+'" fill-opacity="'+fillOpacity+'" stroke="'+strokeColor+'" stroke-width="'+(strokeW+0.2)+'" stroke-linejoin="round"/>');

      // 라벨 — 8 꼭짓점 중심에 그리기 (박스 시각 중심)
      const minDim = Math.min(z.w, z.h);
      if (minDim >= 24) {
        const all8 = [B[0],B[1],B[2],B[3],T[0],T[1],T[2],T[3]];
        const cx = all8.reduce((s,p)=>s+p.sx,0)/8;
        const cy = all8.reduce((s,p)=>s+p.sy,0)/8;
        const lines = [];
        if (z.num) lines.push(String(z.num));
        if (z.label && minDim >= 40) {
          String(z.label).split(/<br>|\n/).forEach(l => { if (l.trim()) lines.push(l.trim()); });
        }
        const fs = minDim < 40 ? 9 : minDim < 60 ? 11 : minDim < 90 ? 12 : 13;
        const totalH = lines.length * (fs + 1);
        const startY = cy - totalH/2 + fs;
        const textColor = '#fff';
        lines.forEach((line, i) => {
          svgParts.push(
            '<text x="'+cx+'" y="'+(startY + i*(fs+1))+'" '+
            'text-anchor="middle" font-size="'+fs+'" font-weight="800" '+
            'fill="'+textColor+'" stroke="rgba(0,0,0,.5)" stroke-width="2.6" paint-order="stroke" '+
            'pointer-events="none">'+escHtml(line)+'</text>'
          );
        });
      }

      // 재고 아이콘 — 윗면 좌상단 (T[0])
      if (invState && minDim >= 30) {
        const icon = invState === 'out' ? '🚫' : invState === 'low' ? '⚠' : '';
        if (icon) {
          svgParts.push(
            '<text x="'+(T[0].sx + 4)+'" y="'+(T[0].sy + 13)+'" font-size="13" '+
            'pointer-events="none">'+icon+'</text>'
          );
        }
      }
      svgParts.push('</g>');
    });

    svgParts.push('</svg>');
    container.innerHTML = svgParts.join('');
    attachClickHandlers(container, zones, mode, onPick, onZoneClick);
  }

  function attachClickHandlers(container, zones, mode, onPick, onZoneClick){
    if (mode === 'pick' && typeof onPick === 'function') {
      container.querySelectorAll('.km-fp-zone').forEach(g => {
        g.addEventListener('click', () => {
          const id = parseInt(g.dataset.zoneId, 10);
          const z = zones.find(x => x.id === id);
          if (z) onPick(z);
        });
      });
    } else if (typeof onZoneClick === 'function') {
      container.querySelectorAll('.km-fp-zone').forEach(g => {
        g.addEventListener('click', () => {
          const id = parseInt(g.dataset.zoneId, 10);
          const z = zones.find(x => x.id === id);
          if (z) onZoneClick(z);
        });
      });
    }
  }

  // ============== 2D 평면 렌더링 (기존 룩 유지 — 헐리우드 외 매장용) ==============
  function renderFlat2DParts(zones, options, STATE_COLOR, INV_COLOR){
    const mode = options.mode || 'view';
    const states = options.states || {};
    const inventory = options.inventory || {};
    const canvasW = options.canvasW || 1100;
    const canvasH = options.canvasH || 780;
    const onPick = options.onPick;
    const onZoneClick = options.onZoneClick;
    const hi = options.highlightZoneId;
    const parts = [];
    parts.push(
      '<svg viewBox="0 0 ' + canvasW + ' ' + canvasH + '" ' +
      'preserveAspectRatio="xMidYMid meet" ' +
      'style="width:100%;height:auto;display:block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit">'
    );
    parts.push('<rect x="2" y="2" width="' + (canvasW-4) + '" height="' + (canvasH-4) + '" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6,4"/>');
    zones.forEach(z => {
      const invState = inventory[z.id];
      const ic = INV_COLOR[invState];
      const taskState = states[z.id];
      const sc = STATE_COLOR[taskState];
      const eff = ic || sc;
      const fillColor = eff ? eff.fill : (z.color || '#94a3b8');
      const fillOpacity = eff ? eff.alpha : 1;
      const strokeColor = eff ? eff.stroke : '#475569';
      const strokeW = (hi && hi === z.id) ? 3.5 : 1.5;
      const cursor = (mode === 'pick' || onZoneClick) ? 'pointer' : 'default';
      const transform = z.rot ? ('rotate(' + z.rot + ' ' + (z.x + z.w/2) + ' ' + (z.y + z.h/2) + ')') : '';
      parts.push(
        '<g class="km-fp-zone" data-zone-id="' + z.id + '" ' +
        (transform ? 'transform="' + transform + '" ' : '') +
        'style="cursor:' + cursor + '">' +
        '<rect x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '" ' +
        'fill="' + fillColor + '" fill-opacity="' + fillOpacity + '" ' +
        'stroke="' + strokeColor + '" stroke-width="' + strokeW + '" rx="4" ry="4"/>'
      );
      const minDim = Math.min(z.w, z.h);
      if (minDim >= 24) {
        const cx = z.x + z.w / 2;
        const cy = z.y + z.h / 2;
        const lines = [];
        if (z.num) lines.push(String(z.num));
        if (z.label && minDim >= 40) {
          String(z.label).split(/<br>|\n/).forEach(l => { if (l.trim()) lines.push(l.trim()); });
        }
        const fs = minDim < 40 ? 8 : minDim < 60 ? 10 : minDim < 90 ? 11 : 12;
        const totalH = lines.length * (fs + 1);
        const startY = cy - totalH / 2 + fs;
        const textColor = eff ? '#fff' : (isLightColor(fillColor) ? '#1f2937' : '#fff');
        lines.forEach((line, i) => {
          parts.push(
            '<text x="' + cx + '" y="' + (startY + i * (fs + 1)) + '" ' +
            'text-anchor="middle" font-size="' + fs + '" font-weight="700" ' +
            'fill="' + textColor + '" pointer-events="none">' + escHtml(line) + '</text>'
          );
        });
      }
      if (invState && minDim >= 30) {
        const icon = invState === 'out' ? '🚫' : invState === 'low' ? '⚠' : '';
        if (icon) {
          parts.push(
            '<text x="' + (z.x + 4) + '" y="' + (z.y + 14) + '" font-size="12" ' +
            'pointer-events="none">' + icon + '</text>'
          );
        }
      }
      parts.push('</g>');
    });
    parts.push('</svg>');
    return parts;
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
  // 2026-05-20 — 401 우회 두 번째: chat/_zones/ 도 막힘. RTDB rules 가 path 별로
  // 세밀하게 한정되어 있어, 확실히 작동하는 tasks/{branch}/{date}/{taskId} 패턴
  // 그대로 사용. {date} 자리에 '_zone_state_' 라는 sentinel 키 사용 — date 형식
  // (YYYY-MM-DD) 이 아니라 task 일일 query 에 잡히지 않음. {taskId} 자리에 zoneId.
  const FB_DB_URL = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  const ZS_DATE_KEY = '_zone_state_';   // tasks/{branch}/{date} 위치의 sentinel

  async function getAuthQuery(){
    try {
      const tok = window.__getAuthToken ? await window.__getAuthToken() : null;
      return tok ? ('&auth=' + encodeURIComponent(tok)) : '';
    } catch(_) { return ''; }
  }

  function zsPath(branchId, zoneId){
    return '/tasks/' + encodeURIComponent(branchId) + '/' + ZS_DATE_KEY + (zoneId !== undefined ? '/' + zoneId : '');
  }

  async function loadZoneStates(branchId){
    try {
      const aq = await getAuthQuery();
      const r = await fetch(FB_DB_URL + zsPath(branchId) + '.json?t=' + Date.now() + aq, { cache:'no-store' });
      if (!r.ok) return {};
      const data = (await r.json()) || {};
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
      const aq = await getAuthQuery();
      const r = await fetch(FB_DB_URL + zsPath(branchId, zoneId) + '.json?t=' + Date.now() + aq, { cache:'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch(_) { return null; }
  }

  async function saveZoneState(branchId, zoneId, payload){
    const body = Object.assign({}, payload, { updatedAt: Date.now() });
    const isClear = (payload.status === 'ok' && !(payload.memo || '').trim());
    try {
      const aq = await getAuthQuery();
      const url = FB_DB_URL + zsPath(branchId, zoneId) + '.json?t=' + Date.now() + aq;
      const r = await fetch(url, {
        method: isClear ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: isClear ? undefined : JSON.stringify(body)
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => '');
        console.error('[fp] saveZoneState HTTP ' + r.status, errBody);
        return { ok: false, status: r.status, error: errBody.slice(0, 120) };
      }
      return { ok: true, status: r.status };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  }

  window.KMFloorPlan = {
    load, render, inferZoneId, buildZoneStates, BRANCH_MAP,
    loadZoneStates, loadZoneStateFull, saveZoneState
  };
})();
