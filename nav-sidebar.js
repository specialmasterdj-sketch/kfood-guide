// Shared left nav sidebar — injects into any page
// Usage: <script src="./nav-sidebar.js" defer></script>
(function(){
  if (window.__navSideInjected) return;
  window.__navSideInjected = true;

  // Manager-or-above tokens — 일반 매니저 권한 메뉴 (직원 승인, 지점 지출 등).
  // SUPERVISOR / 부매니저 도 포함 — 매장 운영 관리 자체는 가능해야 함.
  const MGR_TOKENS = ['OWNER','BOSS','오너','사장','대표','DUEÑO','DUENO','PROPIETARIO','MANAGER','GERENTE','매니저','점장','부매니저','GERENTE ASISTENTE','ASSISTANT MANAGER','ASST MANAGER','ASST. MANAGER','EXECUTIVE','전무','VICE PRESIDENT','VP','SUPERVISOR','SUPERVISORA','감독'];
  // 🔒 급여 화이트리스트 — Firebase /config/payrollAccess 배열로 관리 (이름 정규화)
  // 정규화 규칙: 대문자 + 점/괄호/공백 제거 → 'H.Kim' → 'HKIM', 'Sun Kim' → 'SUNKIM'
  const _PW_DEFAULT = ['BHK','DJ','SUNKIM','HKIM'];
  let _payrollWhitelist = _PW_DEFAULT.slice();
  try { const c = JSON.parse(localStorage.getItem('km.payrollWhitelist')||'null'); if(Array.isArray(c)&&c.length) _payrollWhitelist=c; } catch(e){}

  function _loadMe(){ try { return JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){ return null; }}
  function _normName(n){ return String(n||'').toUpperCase().replace(/\([^)]*\)/g,'').replace(/\./g,'').replace(/\s+/g,''); }
  function _isExecName(name){ const n = _normName(name); return n === 'BHK' || n === 'DJ' || n === 'SUNKIM'; }

  function isManager(){
    const me = _loadMe();
    if (!me) return false;
    if (me.isManager === true) return true;
    if (!me.role) return false;
    const r = String(me.role).toUpperCase();
    return MGR_TOKENS.some(t => r.includes(t.toUpperCase()));
  }
  // 🔒 급여 — 화이트리스트 인원 OR 매니저급 role.
  // 2026-05-15: H.Kim 케이스 — 이름 정규화 매치 실패해도 RTDB users/{uid}/role
  // 이 MANAGER 이상이면 보임. 이름 변형 (Hyojoo Kim, Hojin Kim 등) 매번 추가
  // 하는 대신 role-based 가드로 대체.
  function canSeePayroll(){
    const me = _loadMe();
    if (!me) return false;
    // 1순위: 화이트리스트 정확 매치
    if (_payrollWhitelist.includes(_normName(me.name))) return true;
    // 2순위: MANAGER/SUPERVISOR/OWNER/EXECUTIVE/ASSISTANT — RTDB role 매치
    if (me.role) {
      const r = String(me.role).toUpperCase();
      const MGR_PAYROLL = ['OWNER','EXECUTIVE','MANAGER','GERENTE','매니저','점장','부매니저','ASSISTANT MANAGER','ASST MANAGER','SUPERVISOR','SUPERVISORA','감독'];
      if (MGR_PAYROLL.some(t => r.includes(t))) return true;
    }
    return false;
  }

  // 🔒 2026-07-14 사장님 지시: 오너(DJ·Sun Kim)+전무(김병호 B.H.K) 전용 링크 (own:true).
  //   사이드바에서만 숨김 — 진짜 차단은 해당 페이지(leaderboard.html) 자체 게이트가 담당.
  function isOwnerExec(){
    const me = _loadMe();
    if (!me) return false;
    const r = String(me.role || '').toUpperCase();
    if (/OWNER|EXECUTIVE|오너|사장|대표|전무/.test(r)) return true;
    const n = String(me.name || '').replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
    return ['DJ','BHK','SUNKIM','김병호'].includes(n);
  }

  const LINKS = [
    { sec: { ko:'대시보드', en:'Dashboard', es:'Panel' } },
    { ic: '⊞',  lbl: { ko:'모든 앱',      en:'All Apps',    es:'Todas Apps' },  href: './apps.html', highlight: true },
    { ic: '🏠', lbl: { ko:'HUB',         en:'HUB',         es:'HUB' },         href: './hub.html' },
    { ic: '📅', lbl: { ko:'스케줄',       en:'Schedule',    es:'Horario' },     href: './shifts.html' },
    // 🔒 2026-05-27 전무님 지시: 급여 메뉴는 매니저앱 사이드바에서 완전 제거.
    // 별도 앱으로 분리 운영 — 매니저는 직접 URL 북마크로 접근.
    // (./payroll.html?type=cash · ./payroll.html?type=cpa)

    { sec: { ko:'커뮤니케이션', en:'Communication', es:'Comunicación' } },
    { ic: '💬', lbl: { ko:'채팅',         en:'Chat',           es:'Chat' },              href: './chat.html', primary: true, badge: 'chat' },
    { ic: '📨', lbl: { ko:'HR 건의',      en:'HR Inquiry',     es:'Consulta RH' },        href: './chat.html?room=hr_inquiries' },
    { ic: '📢', lbl: { ko:'공지 / Updates', en:'Announcements', es:'Anuncios' },         href: './updates.html', badge: 'updates' },
    { ic: '📨', lbl: { ko:'업무 지시',     en:'Tasks',          es:'Tareas' },           href: './tasks.html', highlight: true },
    { ic: '📅', lbl: { ko:'유통기한 관리',  en:'Expiry tracker', es:'Caducidad' },        href: './expiry.html', highlight: true },
    { ic: '🌡', lbl: { ko:'온도 관리',       en:'Temp tracker',   es:'Temperatura' },     href: './temp.html', highlight: true },
    { ic: '📦', lbl: { ko:'입고 스캔',       en:'Receiving scan', es:'Escaneo entrada' }, href: './receiving-scan.html', highlight: true },
    { ic: '👥', lbl: { ko:'직원 승인',       en:'Approvals',      es:'Aprobaciones' },    href: './approve.html', mgr: true },
    { ic: '📇', lbl: { ko:'직원 디렉토리',   en:'Staff Directory', es:'Directorio' },      href: './hub.html#directory', mgr: true },
    { ic: '🏆', lbl: { ko:'활동 순위',       en:'Leaderboard',    es:'Clasificación' },   href: './leaderboard.html', own: true },

    { sec: { ko:'매장 운영', en:'Operations', es:'Operaciones' } },
    { ic: '🏆', lbl: { ko:'Top 500 재고',  en:'Top 500 Stock', es:'Top 500 Inventario' }, href: './top500.html', highlight: true },
    { ic: '🏪', lbl: { ko:'주문 센터',     en:'Order Center',  es:'Centro de Pedidos' }, href: './vendor-order-center.html' },
    { ic: '🔎', lbl: { ko:'상품 조회',     en:'Product Lookup', es:'Buscar Producto' }, href: './lookup.html' },
    // 🛡 2026-07-15 사장님 사건 — 별도 앱인데 같은 창에서 열려 매니저앱을 통째로 뺏어가고,
    //    그 앱이 뒤로가기를 가로채 복귀 불가였음. 외부 앱은 반드시 새 창(_blank).
    { ic: '📋', lbl: { ko:'일일 평가',     en:'Daily Review',   es:'Evaluación Diaria' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-opening-control/', target: '_blank' },
    { ic: '📄', lbl: { ko:'인보이스',       en:'Invoices',       es:'Facturas' },         href: './invoice-to-excel.html' },
    { ic: '💸', lbl: { ko:'지점 지출',      en:'Branch Expenses', es:'Gastos de Sucursal' }, href: './expense-log.html', mgr: true },

    { sec: { ko:'고객 멤버십', en:'Customer Rewards', es:'Lealtad' } },
    { ic: '💎', lbl: { ko:'멤버십 앱',     en:'Rewards App',  es:'App de Lealtad' },     href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/login.html', target: '_blank' },
    { ic: '🔄', lbl: { ko:'POS 동기화',    en:'POS Sync',     es:'Sincronización POS' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/pos-import.html', target: '_blank', mgr: true },
    { ic: '🎁', lbl: { ko:'주간 특가 등록', en:'Weekly Deals', es:'Ofertas Semanales' },  href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-deals.html', target: '_blank', mgr: true },
    { ic: '📢', lbl: { ko:'손님 알림 발송', en:'Notify Members', es:'Notificar Clientes' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-notify.html', target: '_blank', mgr: true },
    { ic: '📊', lbl: { ko:'추천 통계',     en:'Referral Stats',es:'Estadísticas Referidos' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-referrals.html', target: '_blank', mgr: true },
    { ic: '🧾', lbl: { ko:'카운터 도구',   en:'Counter Tool',  es:'Herramienta de Caja' },     href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/counter.html', target: '_blank' },
    { ic: '💔', lbl: { ko:'휴면 캠페인',    en:'Win-Back',      es:'Recuperación' },             href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/dormant-campaign.html', target: '_blank', mgr: true },
    { ic: '📖', lbl: { ko:'관리자 가이드',  en:'Admin Guide',   es:'Guía de Admin' },             href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-guide.html', target: '_blank', mgr: true },
    { ic: '🆕', lbl: { ko:'신규 가입자',     en:'New Members',   es:'Nuevos Miembros' },          href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-new-members.html', target: '_blank', mgr: true },
    { ic: '📲', lbl: { ko:'QR 포스터',       en:'QR Poster',     es:'Poster QR' },                href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-poster.html', target: '_blank', mgr: true },
    { ic: '📈', lbl: { ko:'앱 사용 통계',     en:'App Stats',     es:'Estadísticas' },             href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-stats.html', target: '_blank', mgr: true },

    { sec: { ko:'트레이닝', en:'Training', es:'Capacitación' } },
    { ic: '🥩', lbl: { ko:'정육 트레이닝',  en:'Meat Training',     es:'Capacitación de Carne' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-meat-training/', target: '_blank' },
    { ic: '🍱', lbl: { ko:'K-Food 가이드',  en:'K-Food Guide',     es:'Guía K-Food' },          href: 'https://specialmasterdj-sketch.github.io/kfood-guide/', target: '_blank' },

    { sec: { ko:'기타', en:'Other', es:'Otros' } },
    { ic: '🚚', lbl: { ko:'물류 (채팅으로 이전)', en:'Logistics → Chat', es:'Logística → Chat' }, href: './chat.html#need_overstock' },
    { ic: '🛒', lbl: { ko:'쇼핑',          en:'Shopping',  es:'Compras' },   href: 'https://specialmasterdj-sketch.github.io/kimchi-shop/', target: '_blank' },
    { ic: '📋', lbl: { ko:'플래노그램',    en:'Planogram', es:'Planograma' }, href: './planogram.html' },
    { ic: '🏪', lbl: { ko:'Floor Plan',    en:'Floor Plan', es:'Plano de Tienda' }, href: './floorplan/' },
  ];

  const W = 200;
  const css = `
    body { margin-left: ${W}px !important; }
    .km-navside { position: fixed; top: 0; left: 0; bottom: 0; width: ${W}px; background: linear-gradient(180deg,#ffffff 0%,#fafbfc 100%); border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow-y: auto; padding: 8px 0; z-index: 1000; font-family: 'Inter','Pretendard','Segoe UI','Malgun Gothic',-apple-system,BlinkMacSystemFont,Arial,sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; letter-spacing: -.01em; }
    .km-navside .km-brand { display:flex; align-items:center; justify-content:flex-start; gap:0; padding: 14px 16px; border-bottom: 1px solid #f3f4f6; margin-bottom: 0; text-decoration:none; color:inherit; cursor:pointer; transition: background .15s; border-radius:0; }
    .km-navside .km-brand:hover { background:#f0fdf4; }
    .km-navside .km-brand:hover .km-brand-logo { transform:scale(1.04); transition:transform .25s cubic-bezier(.2,.8,.2,1); }
    .km-navside .km-brand-logo { height:42px; width:auto; max-width:170px; object-fit:contain; display:block; transition: transform .25s cubic-bezier(.2,.8,.2,1); }
    /* legacy fallback if HTML still uses .logo / .nm */
    .km-navside .km-brand .logo { width:32px; height:32px; border-radius:9px; background:linear-gradient(135deg,#1a5c3a,#2e7d32); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:.92em; box-shadow: 0 2px 6px rgba(26,92,58,.25); transition: transform .2s; flex-shrink:0; }
    .km-navside .km-brand .nm { font-weight:800; color:#1a5c3a; font-size:.92em; letter-spacing:-.01em; margin-left:10px; }
    .km-navside .km-backbtn { display:flex; align-items:center; gap:7px; padding:10px 14px; color:#1a5c3a; font-size:.92em; font-weight:700; cursor:pointer; border:none; background:none; width:100%; text-align:left; border-bottom:1px solid #f3f4f6; font-family:inherit; text-decoration:none; margin-bottom:4px; letter-spacing:-.01em; }
    .km-navside .km-backbtn:hover { background:#f0fdf4; }
    .km-navside .km-sec { padding: 14px 14px 6px; font-size: .92em; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: -.01em; }
    .km-navside a { display: flex; align-items: center; gap: 12px; padding: 9px 14px; color: #1f2937; text-decoration: none; font-size: .92em; font-weight: 600; border-left: 3px solid transparent; transition: all .15s ease; letter-spacing: -.01em; }
    .km-navside a:hover { background: #f0fdf4; color: #1a5c3a; transform: translateX(2px); }
    .km-navside a.active { background: #dcfce7; color: #1a5c3a; border-left-color: #1a5c3a; font-weight: 800; }
    /* 50% 강도 — 옅은 민트 그라디언트 + 진한 텍스트 (강조 톤 다운) */
    .km-navside a.primary { background: linear-gradient(135deg,#86efac,#6ee7b7); color:#14532d !important; font-weight: 800; font-size: .92em; margin: 6px 8px; border-radius: 10px; border-left: 0; padding: 9px 14px; box-shadow: 0 1px 4px rgba(26,92,58,.18); }
    .km-navside a.primary:hover { background: linear-gradient(135deg,#6ee7b7,#4ade80); color:#14532d !important; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(26,92,58,.25); }
    .km-navside a.primary .ic { font-size: 1.05em; }
    .km-navside a .ic { font-size: 1.05em; width: 22px; text-align: center; flex-shrink: 0; }
    .km-navside a .lbl { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .km-navside a .badge { background:#dc2626; color:#fff; border-radius:10px; font-size:.7em; padding:1px 7px; font-weight:800; margin-left:auto; flex-shrink:0; min-width:18px; text-align:center; box-shadow:0 1px 3px rgba(220,38,38,.4); }
    .km-navside a.primary .badge { background:#dc2626; color:#fff; box-shadow:0 1px 3px rgba(220,38,38,.45) }
    .km-navtoggle {
      display: none;
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      left: calc(env(safe-area-inset-left, 0px) + 8px);
      z-index: 2147483647;
      background: #1a5c3a;
      color: #fff;
      border: 0;
      border-radius: 10px;
      width: 42px;
      height: 42px;
      font-size: 1.35em;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 2px rgba(255,255,255,.7);
      -webkit-tap-highlight-color: rgba(255,255,255,.25);
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
      touch-action: manipulation;
      pointer-events: auto;
      padding: 0;
      font-family: inherit;
      font-weight: 700;
    }
    .km-navtoggle:active { transform: scale(0.94); background: #15803d; }
    .km-navlang {
      display: none;
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      right: calc(env(safe-area-inset-right, 0px) + 8px);
      z-index: 2147483647;
      background: rgba(255,255,255,.95);
      border-radius: 21px;
      box-shadow: 0 2px 8px rgba(0,0,0,.3), 0 0 0 2px rgba(26,92,58,.3);
      padding: 3px;
      gap: 2px;
      align-items: center;
    }
    .km-navlang button {
      background: transparent;
      border: 0;
      color: #1a5c3a;
      font-weight: 700;
      font-size: .78em;
      padding: 6px 10px;
      border-radius: 18px;
      cursor: pointer;
      font-family: inherit;
      -webkit-tap-highlight-color: rgba(26,92,58,.2);
      touch-action: manipulation;
      min-width: 34px;
      letter-spacing: .02em;
    }
    .km-navlang button.active {
      background: #1a5c3a;
      color: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,.2);
    }
    .km-navbackdrop {
      display: none;
      position: fixed; inset: 0;
      background: rgba(0,0,0,.45);
      z-index: 2147483645;
      -webkit-tap-highlight-color: transparent;
    }
    .km-navbackdrop.show { display: block; }
    @media (max-width: 760px) {
      body { margin-left: 0 !important; padding-top: 60px !important; }
      .km-navside { transform: translateX(-100%); transition: transform .25s ease; box-shadow: 2px 0 18px rgba(0,0,0,.25); z-index: 2147483646; }
      .km-navside.open { transform: translateX(0); }
      .km-navtoggle { display: flex; align-items: center; justify-content: center; }
      .km-navlang { display: flex; }
    }
    @media print { .km-navside, .km-navtoggle, .km-navlang, .km-navbackdrop { display: none !important; } body { margin-left: 0 !important; padding-top: 0 !important; } }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // kimchi_lang is the primary key — all pages must set it; tasks.lang is checked last
  const LANG_KEYS = ['kimchi_lang','hub.lang','tasks.lang'];
  function currentLang(){
    for (const k of LANG_KEYS) {
      const v = localStorage.getItem(k);
      if (v && ['ko','en','es'].includes(v)) return v;
    }
    return 'en';
  }
  function pickLbl(v){
    if (!v) return '';
    if (typeof v === 'string') return v;       // legacy single-string label
    return v[currentLang()] || v.ko || v.en || v.es || '';
  }

  const here = location.pathname.split('/').pop().toLowerCase() || 'index.html';

  const aside = document.createElement('aside');
  aside.className = 'km-navside';

  function renderInner(){
    const mgr = isManager();
    const payrollOk = canSeePayroll();
    // Pre-filter so sections with no visible items don't render an orphan header.
    // 🔒 payroll 메뉴는 별도 strict 체크 — SUPERVISOR / STAFF 차단.
    const visible = LINKS.filter(it => {
      if (it.sec) return true;
      if (it.payroll && !payrollOk) return false;
      if (it.mgr && !mgr) return false;
      if (it.own && !isOwnerExec()) return false;   // 🔒 오너·전무 전용 (2026-07-14)
      return true;
    });
    const lang = currentLang();
    const backLbl = lang==='ko' ? '← 뒤로' : lang==='es' ? '← Volver' : '← Back';
    const backHtml = (here !== 'apps.html')
      ? `<a class="km-backbtn" href="./apps.html" onclick="event.preventDefault();if(history.length>1)history.back();else location.href='./apps.html'">${backLbl}</a>`
      : '';
    const homeTitle = pickLbl({ ko:'첫 화면으로', en:'Go to home', es:'Ir al inicio' });
    let html = `<a class="km-brand" href="./apps.html" title="${homeTitle}" aria-label="${pickLbl({ ko:'김치마트', en:'Kimchi Mart', es:'Kimchi Mart' })}"><img class="km-brand-logo" src="./pwa-assets/kimchi-text-logo.png?v=2" alt="KIMCHI"></a>${backHtml}`;
    for (let i = 0; i < visible.length; i++) {
      const it = visible[i];
      if (it.sec) {
        // Skip a section header if the next thing is another section or end-of-list
        const next = visible[i+1];
        if (!next || next.sec) continue;
        html += `<div class="km-sec">${pickLbl(it.sec)}</div>`;
        continue;
      }
      const hrefFile = (it.href || '').split('/').pop().split('?')[0].toLowerCase();
      const isActive = hrefFile && here === hrefFile;
      const tgt = it.target ? ` target="${it.target}"` : '';
      const hl = it.highlight ? ' style="font-weight:800;color:#1a5c3a"' : '';
      const cls = [];
      if (isActive) cls.push('active');
      if (it.primary) cls.push('primary');
      const clsAttr = cls.length ? ` class="${cls.join(' ')}"` : '';
      const badgeAttr = it.badge ? ` data-badge-key="${it.badge}"` : '';
      html += `<a href="${it.href}"${tgt}${hl}${clsAttr}${badgeAttr}><span class="ic">${it.ic}</span><span class="lbl">${pickLbl(it.lbl)}</span></a>`;
    }
    aside.innerHTML = html;
    // Click pre-clears unread badges so users don't see stale counts even
    // when the destination page fails to mark-as-seen (network glitch,
    // localStorage quota, etc). The destination page's own logic still
    // runs as the canonical 'seen' marker.
    aside.querySelectorAll('a[data-badge-key]').forEach(a => {
      a.addEventListener('click', () => {
        const key = a.getAttribute('data-badge-key');
        try {
          if (key === 'updates') {
            localStorage.setItem('updates.lastSeenTs', String(Date.now()));
            window.dispatchEvent(new Event('km-updates-seen'));
          } else if (key === 'chat') {
            // chat lastVisit per-room is updated when user enters each
            // room — at the sidebar level we just hide the badge.
            setBadge('chat', 0);
          }
        } catch (_) {}
        setBadge(key, 0);
      });
    });
  }
  renderInner();

  const toggle = document.createElement('button');
  toggle.className = 'km-navtoggle';
  toggle.type = 'button';
  toggle.innerHTML = '☰';
  toggle.setAttribute('aria-label', 'Menu');

  const backdrop = document.createElement('div');
  backdrop.className = 'km-navbackdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  function openSide(){
    aside.classList.add('open');
    backdrop.classList.add('show');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeSide(){
    aside.classList.remove('open');
    backdrop.classList.remove('show');
    toggle.setAttribute('aria-expanded', 'false');
  }
  function toggleSide(e){
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (aside.classList.contains('open')) closeSide();
    else openSide();
  }
  // Use both click and touchend so iOS doesn't drop the tap when other handlers exist
  toggle.addEventListener('click', toggleSide);
  toggle.addEventListener('touchend', toggleSide, { passive: false });
  backdrop.addEventListener('click', closeSide);
  backdrop.addEventListener('touchend', closeSide, { passive: true });
  // close on link tap (mobile)
  aside.addEventListener('click', e => {
    if (e.target.closest('a') && window.innerWidth <= 760) closeSide();
  });
  // close on Esc
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSide(); });

  // Re-render when language OR identity changes
  window.addEventListener('storage', e => { if (LANG_KEYS.includes(e.key) || e.key === 'chat.me') renderInner(); });
  window.addEventListener('km-lang-changed', renderInner);
  window.addEventListener('km-identity-changed', renderInner);
  // Re-render after page's own inline scripts have run (they set kimchi_lang before DOMContentLoaded)
  document.addEventListener('DOMContentLoaded', renderInner);

  // ============ FLOATING LANG SWITCHER (mobile) ============
  // Suppress floating switcher when the host page already provides one
  // (avoid duplicate ko/en/es buttons in the upper area)
  function pageAlreadyHasLangSwitcher(){
    const sels = [
      '[data-lang="ko"]', '[data-lang="en"]', '[data-lang="es"]',
      '[onclick*="setLang"]', '[onclick*="changeLang"]', '[onclick*="applyLang"]',
      '.lang-btn', '.lang-pill button', '.langSwitcher button'
    ];
    for (const sel of sels) {
      const list = document.querySelectorAll(sel);
      for (const el of list) {
        // skip our own (km-navlang) elements
        if (el.closest && el.closest('.km-navlang')) continue;
        return true;
      }
    }
    return false;
  }

  const langBar = document.createElement('div');
  langBar.className = 'km-navlang';
  langBar.setAttribute('role', 'group');
  langBar.setAttribute('aria-label', 'Language');
  function renderLangBar(){
    const cur = currentLang();
    langBar.innerHTML =
      ['ko','en','es'].map(L =>
        `<button type="button" data-lang="${L}" class="${cur===L?'active':''}">${L.toUpperCase()}</button>`
      ).join('');
  }
  function setLangAll(L){
    if (!['ko','en','es'].includes(L)) return;
    // Write all known lang keys so every page in the suite picks it up
    try {
      localStorage.setItem('kimchi_lang', L);
      localStorage.setItem('hub.lang', L);
      localStorage.setItem('tasks.lang', L);
      localStorage.setItem('km-lang', L);
      localStorage.setItem('lang', L);
      localStorage.setItem('chat.lang', L);
    } catch(e) {}
    renderInner();
    renderLangBar();
    // Notify the hosting page (some pages listen for this to retranslate)
    try { window.dispatchEvent(new CustomEvent('km-lang-changed', { detail:{ lang:L } })); } catch(e) {}
    // Many pages set a data-lang attr or have applyLang() — try common entry points
    if (typeof window.setLang === 'function')   { try { window.setLang(L); } catch(e){} }
    if (typeof window.applyLang === 'function') { try { window.applyLang(L); } catch(e){} }
    if (typeof window.changeLang === 'function'){ try { window.changeLang(L); } catch(e){} }
  }
  renderLangBar();
  langBar.addEventListener('click', e => {
    const b = e.target.closest('button[data-lang]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    setLangAll(b.dataset.lang);
  });
  langBar.addEventListener('touchend', e => {
    const b = e.target.closest('button[data-lang]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    setLangAll(b.dataset.lang);
  }, { passive: false });
  window.addEventListener('storage', e => { if (LANG_KEYS.includes(e.key)) renderLangBar(); });
  window.addEventListener('km-lang-changed', renderLangBar);

  function mount(){
    document.body.appendChild(aside);
    document.body.appendChild(backdrop);
    document.body.appendChild(toggle);
    if (!pageAlreadyHasLangSwitcher()) {
      document.body.appendChild(langBar);
    }
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  // ============ 안 읽은 항목 배지 (공지/Updates) ============
  const FB_DB = 'https://kimchi-mart-order-default-rtdb.firebaseio.com';
  function setBadge(key, count){
    const el = aside.querySelector('a[data-badge-key="' + key + '"]');
    if (!el) return;
    let badge = el.querySelector('.badge');
    if (!count || count <= 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      el.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
  }
  let __updatesPollTimer = null;
  async function refreshUpdatesBadge(){
    try {
      // 현재 페이지가 updates.html 이면 배지 항상 0
      if (here === 'updates.html') { setBadge('updates', 0); return; }
      // 🚀 2026-07-18 — 전체 노드 통째(글 누적 시 payload 증가) → 최근 60개만.
      //   배지 카운트는 lastSeenTs 이후 새 글만 세므로 최근 60개면 충분.
      const res = await fetch(FB_DB + '/updates.json?orderBy=' + encodeURIComponent('"$key"') + '&limitToLast=60&t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      if (!d) { setBadge('updates', 0); return; }
      let lastSeenTs = 0;
      try { lastSeenTs = parseInt(localStorage.getItem('updates.lastSeenTs') || '0', 10) || 0; } catch(e){}
      let me = null;
      try { me = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){}
      const isMgr = !!(me && me.isManager);
      const unread = [];
      Object.entries(d).forEach(([id, u]) => {
        if (!u || !u.ts || u.ts <= lastSeenTs) return;
        // 본인이 작성한 글은 제외 (이미 본 거니까)
        if (me && u.author === me.name && u.authorBranch === me.branch) return;
        // audience 가시성 — updates.html 의 visibleUpdates() 와 일치시킴
        if (u.audience === 'managers' && !isMgr) return;
        if (u.audience && u.audience !== 'all' && u.audience !== 'managers' && me && u.audience !== me.branch) {
          // 다른 지점 전용 글 — 매니저 외엔 카운트하지 않음
          if (!isMgr) return;
        }
        unread.push(Object.assign({ __id: id }, u));
      });
      setBadge('updates', unread.length);
      maybeShowAnnouncePopup(unread);
      updateAnnounceBanner(unread);
      maybeNotifyAnnounce(unread);
    } catch(e){}
  }
  // 📢 메인 페이지 상단 플래시 배너 — 헤더 아래·타일 위 "#ANNOUNCEMENT# 반드시 읽을 것"
  //   (2026-08-08 사장님 결재 레이아웃: 데스크탑 한 줄, 모바일 두 줄. 클릭 → 공지.
  //    본인이 읽으면 사라짐 → 전 직원이 읽으면 자연히 아무 화면에도 안 남음)
  function updateAnnounceBanner(unread){
    try {
      let bar = document.getElementById('kmAnnBanner');
      const qs = document.querySelector('.quick-stats');   // 메인(apps.html)에서만 존재
      const on = unread && unread.length > 0 && !!qs;
      if (!on) { if (bar) bar.remove(); return; }
      const L = currentLang();
      const top = unread.slice().sort((a,b) => (b.ts||0) - (a.ts||0))[0];
      const must = ({ko:'#ANNOUNCEMENT# 반드시 읽을 것', en:'#ANNOUNCEMENT# MUST READ', es:'#ANUNCIO# LECTURA OBLIGATORIA'})[L];
      const go = ({ko:'읽으러 가기 →', en:'Read now →', es:'Leer ahora →'})[L];
      if (!bar) {
        bar = document.createElement('a');
        bar.id = 'kmAnnBanner';
        bar.href = './updates.html';
        if (!document.getElementById('kmAnnBannerCss')) {
          const st = document.createElement('style');
          st.id = 'kmAnnBannerCss';
          st.textContent = '@keyframes kmAnnFlash{0%,100%{background:#dc2626}50%{background:#7f1d1d}}'
            + '#kmAnnBanner{display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:14px 20px;border-radius:14px;color:#fff;background:#dc2626;font-weight:900;font-size:1.05em;line-height:1.4;text-decoration:none;box-shadow:0 6px 18px rgba(220,38,38,.4);animation:kmAnnFlash 1.1s infinite}'
            + '#kmAnnBanner .t{flex:1;min-width:0}'
            + '#kmAnnBanner .go{background:#fff;color:#dc2626;border-radius:999px;padding:5px 14px;font-size:.85em;white-space:nowrap}'
            + '@media(max-width:760px){#kmAnnBanner{font-size:.95em;padding:12px 14px;gap:8px}#kmAnnBanner .t b{display:block}}';
          document.head.appendChild(st);
        }
        qs.parentNode.insertBefore(bar, qs);
      }
      const esc2 = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      bar.innerHTML = '<span style="font-size:1.35em">🚨</span>'
        + '<span class="t"><b>' + must + '</b> <u>' + esc2(String(top.title || top.body || '').slice(0, 60)) + '</u></span>'
        + '<span class="go">' + go + '</span>';
    } catch(e){}
  }
  // 🔔 안 읽은 공지 → 기기 알림 (앱이 열려있는 기기 — 채팅 알림과 같은 방식)
  function maybeNotifyAnnounce(unread){
    try {
      if (!unread || !unread.length) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const maxTs = unread.reduce((m,u) => Math.max(m, u.ts||0), 0);
      const last = parseInt(localStorage.getItem('updates.lastNotifTs') || '0', 10) || 0;
      if (maxTs <= last) return;
      localStorage.setItem('updates.lastNotifTs', String(maxTs));
      const L = currentLang();
      const top = unread.slice().sort((a,b)=>(b.ts||0)-(a.ts||0))[0];
      const title = ({ko:'📢 새 공지 — 반드시 확인', en:'📢 New announcement — must read', es:'📢 Nuevo anuncio — lectura obligatoria'})[L];
      const n = new Notification(title, { body: (top.title || top.body || '').slice(0, 80), tag:'km-announce', icon:'pwa-assets/icon-192.png' });
      n.onclick = () => { try { window.focus(); location.href = './updates.html'; } catch(e){} };
    } catch(e){}
  }
  // 📢 2026-08-08 사장님 지시: 공지는 모든 직원에게 최대 노출 — 안 읽은 공지가 있으면
  //   어느 페이지에서든 전면 팝업으로 표시. [확인했습니다] 를 눌러야 닫히며 읽음 처리
  //   (updates.lastSeenTs 갱신) + 누가 읽었는지 updates/{id}/reads/{이름} 에 기록.
  let __annShownMaxTs = 0;
  function maybeShowAnnouncePopup(unread){
    try {
      if (!unread || !unread.length) return;
      if (here === 'updates.html' || here === 'auth.html') return;
      if (document.getElementById('kmAnnOverlay')) return;
      const items = unread.slice().sort((a,b) => (b.ts||0) - (a.ts||0));
      const maxTs = items[0].ts || 0;
      if (maxTs <= __annShownMaxTs) return;   // 이번 세션에서 이미 보여준 공지
      __annShownMaxTs = maxTs;
      const L = currentLang();
      const T = {
        title: {ko:'📢 새 공지', en:'📢 New Announcement', es:'📢 Nuevo anuncio'},
        more:  {ko:'개의 공지가 더 있습니다 — 전체 공지에서 확인하세요', en:' more — see all announcements', es:' más — ver todos los anuncios'},
        btn:   {ko:'✅ 확인했습니다', en:'✅ Got it', es:'✅ Entendido'},
        open:  {ko:'전체 공지 보기', en:'View all', es:'Ver todos'},
      };
      const t = k => T[k][L] || T[k].ko;
      const top = items[0];
      const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const dstr = top.ts ? new Date(top.ts).toLocaleDateString() : '';
      const ov = document.createElement('div');
      ov.id = 'kmAnnOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:99998;display:flex;align-items:center;justify-content:center;padding:18px';
      ov.innerHTML = '<div style="background:#fff;border-radius:18px;max-width:520px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden">'
        + '<div style="background:#1a5c3a;color:#fff;padding:14px 18px;font-weight:900;font-size:1.05em">' + t('title') + (dstr ? ' <span style="font-weight:600;font-size:.8em;opacity:.8">· ' + dstr + '</span>' : '') + '</div>'
        + '<div style="padding:16px 18px;overflow:auto">'
        +   (top.title ? '<div style="font-weight:900;font-size:1.1em;margin-bottom:8px">' + esc(top.title) + '</div>' : '')
        +   '<div style="white-space:pre-wrap;line-height:1.6;color:#1f2937">' + esc(top.body||'') + '</div>'
        +   (top.author ? '<div style="margin-top:10px;font-size:.8em;color:#6b7280">— ' + esc(top.author) + '</div>' : '')
        +   (items.length > 1 ? '<div style="margin-top:12px;font-size:.85em;color:#b45309;font-weight:700">+' + (items.length-1) + t('more') + '</div>' : '')
        + '</div>'
        + '<div style="padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;gap:10px;align-items:center">'
        +   '<a href="./updates.html" style="font-size:.85em;color:#1a5c3a;font-weight:700;text-decoration:none">' + t('open') + ' →</a>'
        +   '<button id="kmAnnOkBtn" style="margin-left:auto;background:#1a5c3a;color:#fff;border:0;border-radius:12px;padding:11px 22px;font-weight:900;font-size:1em;cursor:pointer">' + t('btn') + '</button>'
        + '</div></div>';
      document.body.appendChild(ov);
      document.getElementById('kmAnnOkBtn').onclick = () => {
        try { localStorage.setItem('updates.lastSeenTs', String(maxTs)); } catch(e){}
        try {
          const me2 = JSON.parse(localStorage.getItem('chat.me') || 'null');
          if (me2 && me2.name) {
            const slug = String(me2.name).toUpperCase().replace(/[^A-Z0-9가-힣]/g, '_');
            items.forEach(u => {
              if (!u.__id) return;
              fetch(FB_DB + '/updates/' + u.__id + '/reads/' + slug + '.json', {
                method:'PUT', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ ts: Date.now(), branch: me2.branch || '' })
              }).catch(() => {});
            });
          }
        } catch(e){}
        ov.remove();
        setBadge('updates', 0);
      };
    } catch(e){}
  }
  function startUpdatesPolling(){
    refreshUpdatesBadge();
    if (__updatesPollTimer) clearInterval(__updatesPollTimer);
    __updatesPollTimer = setInterval(refreshUpdatesBadge, 30000);  // 30s
  }
  // 페이지에서 updates 다 봤다는 신호 받으면 즉시 배지 0
  window.addEventListener('km-updates-seen', () => setBadge('updates', 0));
  window.addEventListener('storage', e => { if (e.key === 'updates.lastSeenTs') refreshUpdatesBadge(); });

  // ============ 안 읽은 채팅 메시지 배지 ============
  // chat.html 의 lastVisit 맵을 읽어 각 방의 메시지 키 timestamp 와 비교
  const EXEC_NAMES = ['B.H.K','BHK','B H K','비에이치케이','SUN KIM','SUNKIM'];
  // EXECUTIVE / 전무 / SUPERVISOR 추가 — chat 배지에서도 manager-only 방 (manager_only 등)
  // 카운트가 정상 작동하도록.
  const MGR_TOKENS_CHAT = ['OWNER','BOSS','MANAGER','매니저','점장','대표','사장','오너','GERENTE','EXECUTIVE','전무','VICE PRESIDENT','VP','SUPERVISOR','감독','ASSISTANT MANAGER','부매니저'];
  function isExecName(me){
    if (!me || !me.name) return false;
    const nm = String(me.name).replace(/\s+/g,'').toUpperCase();
    return EXEC_NAMES.some(n => n.replace(/\s+/g,'').toUpperCase() === nm);
  }
  function isManagerLevel(me){
    if (!me) return false;
    if (me.isManager === true) return true; // auth.html 가 명시적으로 true 세팅
    if (isExecName(me)) return true;
    const r = String(me.role || '').toUpperCase();
    return MGR_TOKENS_CHAT.some(t => r.includes(t));
  }
  let __chatPollTimer = null;
  async function refreshChatBadge(){
    try {
      if (here === 'chat.html') { setBadge('chat', 0); return; }
      let me = null;
      try { me = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){}
      if (!me) { setBadge('chat', 0); return; }

      // 🚀 PERF (2026-05-28): 방 목록 1회 fetch 만으로 unread 방 개수 계산.
      // 이전: 모든 방 마다 /chat/messages/{id}.json shallow fetch (100+ requests).
      // 현재: /chat/rooms.json 한 번 + 각 방의 lastTs 비교.
      // 정확한 메시지 개수 대신 안 읽은 방 개수 표시. chat.html line 1548 등에서
      // 메시지 보낼 때 lastTs 자동 PATCH 되므로 신뢰 가능.
      const rRes = await fetch(FB_DB + '/chat/rooms.json?t=' + Date.now(), { cache: 'no-store' });
      if (!rRes.ok) return;
      const rooms = await rRes.json() || {};

      // lastVisit 맵
      let lv = {};
      try { lv = JSON.parse(localStorage.getItem('chat.lastVisit') || '{}'); } catch(e){}

      // 신규 방은 현재 시각으로 초기화 (역사적 메시지 안 읽음 표시 안 함)
      const now = Date.now();
      const ids = Object.keys(rooms);
      let lvChanged = false;
      ids.forEach(id => {
        if (lv[id] === undefined) { lv[id] = now; lvChanged = true; }
      });
      if (lvChanged) {
        try { localStorage.setItem('chat.lastVisit', JSON.stringify(lv)); } catch(e){}
      }

      const exec = isExecName(me);
      const mgr  = isManagerLevel(me);

      let unreadRooms = 0;
      for (const id of ids) {
        const r = rooms[id] || {};
        if (r.executiveOnly && !exec) continue;
        if (r.managersOnly && !mgr) continue;
        const last = lv[id] || 0;
        const roomLastTs = r.lastTs || 0;
        if (roomLastTs > last) unreadRooms++;
      }
      setBadge('chat', unreadRooms);
    } catch(e){}
  }
  function startChatPolling(){
    refreshChatBadge();
    if (__chatPollTimer) clearInterval(__chatPollTimer);
    __chatPollTimer = setInterval(refreshChatBadge, 30000);  // 30s
  }
  // chat.html 에서 방 진입 시 lastVisit 갱신 → storage event 로 즉시 반영
  window.addEventListener('storage', e => {
    if (e.key === 'chat.lastVisit' || e.key === 'chat.me') refreshChatBadge();
  });

  // 초기 + 페이지 다시 보이면 두 배지 모두 새로고침
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshUpdatesBadge();
      refreshChatBadge();
    }
  });
  // ============ 급여 화이트리스트 Firebase 동기화 ============
  async function _syncPayrollWhitelist(){
    try {
      const res = await fetch(FB_DB + '/config/payrollAccess.json?t=' + Date.now(), { cache:'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        _payrollWhitelist = [...new Set([..._PW_DEFAULT, ...data.map(n => _normName(n))])];
      } else {
        _payrollWhitelist = _PW_DEFAULT.slice();
      }
      localStorage.setItem('km.payrollWhitelist', JSON.stringify(_payrollWhitelist));
      renderInner();
    } catch(e){}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startUpdatesPolling(); startChatPolling(); _syncPayrollWhitelist(); });
  } else {
    startUpdatesPolling();
    startChatPolling();
    _syncPayrollWhitelist();
  }
})();
