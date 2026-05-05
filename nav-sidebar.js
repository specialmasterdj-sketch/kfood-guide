// Shared left nav sidebar — injects into any page
// Usage: <script src="./nav-sidebar.js" defer></script>
(function(){
  if (window.__navSideInjected) return;
  window.__navSideInjected = true;

  // Manager-or-above tokens (mirrors payroll.html access gate)
  const MGR_TOKENS = ['OWNER','BOSS','오너','사장','대표','DUEÑO','DUENO','PROPIETARIO','MANAGER','GERENTE','매니저','점장','부매니저','GERENTE ASISTENTE','ASSISTANT MANAGER','ASST MANAGER','ASST. MANAGER'];
  function isManager(){
    let me = null;
    try { me = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){}
    if (!me || !me.role) return false;
    const r = String(me.role).toUpperCase();
    return MGR_TOKENS.some(t => r.includes(t.toUpperCase()));
  }

  const LINKS = [
    { sec: { ko:'대시보드', en:'Dashboard', es:'Panel' } },
    { ic: '🏠', lbl: { ko:'HUB',         en:'HUB',         es:'HUB' },         href: './hub.html' },
    { ic: '📅', lbl: { ko:'스케줄',       en:'Schedule',    es:'Horario' },     href: './shifts.html' },
    { ic: '💵', lbl: { ko:'급여 (현금)', en:'Payroll (Cash)', es:'Nómina (Efectivo)' }, href: './payroll.html?type=cash', mgr: true },
    { ic: '📊', lbl: { ko:'급여 (CPA)',  en:'Payroll (CPA)',  es:'Nómina (CPA)' },      href: './payroll.html?type=cpa',  mgr: true },

    { sec: { ko:'커뮤니케이션', en:'Communication', es:'Comunicación' } },
    { ic: '💬', lbl: { ko:'채팅',         en:'Chat',           es:'Chat' },              href: './chat.html', primary: true, badge: 'chat' },
    { ic: '📨', lbl: { ko:'HR 건의',      en:'HR Inquiry',     es:'Consulta RH' },        href: './chat.html?openHR=1' },
    { ic: '📢', lbl: { ko:'공지 / Updates', en:'Announcements', es:'Anuncios' },         href: './updates.html', badge: 'updates' },
    { ic: '📨', lbl: { ko:'업무 지시',     en:'Tasks',          es:'Tareas' },           href: './tasks.html', highlight: true },
    { ic: '📅', lbl: { ko:'유통기한 관리',  en:'Expiry tracker', es:'Caducidad' },        href: './expiry.html', highlight: true },
    { ic: '🌡', lbl: { ko:'온도 관리',       en:'Temp tracker',   es:'Temperatura' },     href: './temp.html', highlight: true },
    { ic: '📦', lbl: { ko:'입고 스캔',       en:'Receiving scan', es:'Escaneo entrada' }, href: './receiving-scan.html', highlight: true },
    { ic: '👥', lbl: { ko:'직원 승인',       en:'Approvals',      es:'Aprobaciones' },    href: './approve.html', mgr: true },

    { sec: { ko:'매장 운영', en:'Operations', es:'Operaciones' } },
    { ic: '🏪', lbl: { ko:'주문 센터',     en:'Order Center',  es:'Centro de Pedidos' }, href: './vendor-order-center.html' },
    { ic: '🔎', lbl: { ko:'상품 조회',     en:'Product Lookup', es:'Buscar Producto' }, href: './lookup.html' },
    { ic: '📋', lbl: { ko:'일일 평가',     en:'Daily Review',   es:'Evaluación Diaria' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-opening-control/' },
    { ic: '📄', lbl: { ko:'인보이스',       en:'Invoices',       es:'Facturas' },         href: './invoice-to-excel.html' },
    { ic: '💸', lbl: { ko:'지점 지출',      en:'Branch Expenses', es:'Gastos de Sucursal' }, href: './expense-log.html', mgr: true },

    { sec: { ko:'고객 멤버십', en:'Customer Rewards', es:'Lealtad' } },
    { ic: '💎', lbl: { ko:'멤버십 앱',     en:'Rewards App',  es:'App de Lealtad' },     href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/login.html', target: '_blank' },
    { ic: '🔄', lbl: { ko:'POS 동기화',    en:'POS Sync',     es:'Sincronización POS' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/pos-import.html', target: '_blank', mgr: true },
    { ic: '🎁', lbl: { ko:'주간 특가 등록', en:'Weekly Deals', es:'Ofertas Semanales' },  href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-deals.html', target: '_blank', mgr: true },
    { ic: '📢', lbl: { ko:'손님 알림 발송', en:'Notify Members', es:'Notificar Clientes' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-notify.html', target: '_blank', mgr: true },
    { ic: '📊', lbl: { ko:'추천 통계',     en:'Referral Stats',es:'Estadísticas Referidos' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/admin-referrals.html', target: '_blank', mgr: true },
    { ic: '🧾', lbl: { ko:'카운터 도구',   en:'Counter Tool',  es:'Herramienta de Caja' },     href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/counter.html' },
    { ic: '💔', lbl: { ko:'휴면 캠페인',    en:'Win-Back',      es:'Recuperación' },             href: 'https://specialmasterdj-sketch.github.io/kimchi-rewards/dormant-campaign.html', target: '_blank', mgr: true },

    { sec: { ko:'트레이닝', en:'Training', es:'Capacitación' } },
    { ic: '🥩', lbl: { ko:'정육 트레이닝',  en:'Meat Training',     es:'Capacitación de Carne' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-meat-training/' },
    { ic: '🍱', lbl: { ko:'K-Food 가이드',  en:'K-Food Guide',     es:'Guía K-Food' },          href: 'https://specialmasterdj-sketch.github.io/kfood-guide/' },

    { sec: { ko:'기타', en:'Other', es:'Otros' } },
    { ic: '🚚', lbl: { ko:'물류',          en:'Logistics', es:'Logística' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-logistics/' },
    { ic: '🛒', lbl: { ko:'쇼핑',          en:'Shopping',  es:'Compras' },   href: 'https://specialmasterdj-sketch.github.io/kimchi-shop/' },
    { ic: '⊞',  lbl: { ko:'모든 앱',       en:'All Apps',  es:'Todas Apps' }, href: './apps.html' },
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
    // Pre-filter so sections with no visible items don't render an orphan header
    const visible = LINKS.filter(it => it.sec || !it.mgr || mgr);
    const lang = currentLang();
    const backLbl = lang==='ko' ? '← 뒤로' : lang==='es' ? '← Volver' : '← Back';
    const backHtml = (here !== 'apps.html')
      ? `<a class="km-backbtn" href="./apps.html" onclick="event.preventDefault();if(history.length>1)history.back();else location.href='./apps.html'">${backLbl}</a>`
      : '';
    const homeTitle = pickLbl({ ko:'첫 화면으로', en:'Go to home', es:'Ir al inicio' });
    let html = `<a class="km-brand" href="./apps.html" title="${homeTitle}" aria-label="${pickLbl({ ko:'김치마트', en:'Kimchi Mart', es:'Kimchi Mart' })}"><img class="km-brand-logo" src="./pwa-assets/kimchi-mart-full-logo.png?v=2" alt="KIMCHI MART"></a>${backHtml}`;
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
      const res = await fetch(FB_DB + '/updates.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      if (!d) { setBadge('updates', 0); return; }
      let lastSeenTs = 0;
      try { lastSeenTs = parseInt(localStorage.getItem('updates.lastSeenTs') || '0', 10) || 0; } catch(e){}
      let me = null;
      try { me = JSON.parse(localStorage.getItem('chat.me') || 'null'); } catch(e){}
      let count = 0;
      Object.values(d).forEach(u => {
        if (!u || !u.ts || u.ts <= lastSeenTs) return;
        // 본인이 작성한 글은 제외 (이미 본 거니까)
        if (me && u.author === me.name && u.authorBranch === me.branch) return;
        // audience 필터 — 'all' 또는 본인 지점 매치
        if (u.audience && u.audience !== 'all' && me && u.audience !== me.branch) return;
        count++;
      });
      setBadge('updates', count);
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
  const EXEC_NAMES = ['B.H.K','BHK','B H K','비에이치케이'];
  const MGR_TOKENS_CHAT = ['OWNER','BOSS','MANAGER','매니저','점장','대표','사장','오너','GERENTE'];
  function isExecName(me){
    if (!me || !me.name) return false;
    const nm = String(me.name).replace(/\s+/g,'').toUpperCase();
    return EXEC_NAMES.some(n => n.replace(/\s+/g,'').toUpperCase() === nm);
  }
  function isManagerLevel(me){
    if (!me) return false;
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

      // 방 목록
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

      // 각 방 메시지 shallow GET → ts 추출 → lastVisit 이후 카운트
      const counts = await Promise.all(ids.map(async id => {
        const r = rooms[id] || {};
        // 본인이 못 보는 방은 제외
        if (r.executiveOnly && !exec) return 0;
        if (r.managersOnly && !mgr) return 0;
        const last = lv[id] || 0;
        try {
          const res = await fetch(FB_DB + '/chat/messages/' + id + '.json?shallow=true');
          if (!res.ok) return 0;
          const obj = await res.json();
          if (!obj) return 0;
          let count = 0;
          for (const k of Object.keys(obj)) {
            if (!k || k[0] !== 'm') continue;
            const ts = parseInt(k.slice(1, 14), 10);
            if (isFinite(ts) && ts > last) count++;
          }
          return count;
        } catch(e) { return 0; }
      }));
      const total = counts.reduce((a,b) => a + b, 0);
      setBadge('chat', total);
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startUpdatesPolling(); startChatPolling(); });
  } else {
    startUpdatesPolling();
    startChatPolling();
  }
})();
