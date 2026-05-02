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
    { ic: '💬', lbl: { ko:'채팅',         en:'Chat',           es:'Chat' },              href: './chat.html', primary: true },
    { ic: '📢', lbl: { ko:'공지 / Updates', en:'Announcements', es:'Anuncios' },         href: './updates.html' },
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
    .km-navside .km-brand { display:flex; align-items:center; gap:10px; padding: 12px 14px 12px; border-bottom: 1px solid #f3f4f6; margin-bottom: 0; }
    .km-navside .km-brand .logo { width:32px; height:32px; border-radius:9px; background:linear-gradient(135deg,#1a5c3a,#2e7d32); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:1em; box-shadow: 0 2px 6px rgba(26,92,58,.25); }
    .km-navside .km-brand .nm { font-weight:800; color:#1a5c3a; font-size:1em; letter-spacing:-.02em; }
    .km-navside .km-backbtn { display:flex; align-items:center; gap:7px; padding:10px 14px; color:#1a5c3a; font-size:.85em; font-weight:700; cursor:pointer; border:none; background:none; width:100%; text-align:left; border-bottom:1px solid #f3f4f6; font-family:inherit; text-decoration:none; margin-bottom:4px; }
    .km-navside .km-backbtn:hover { background:#f0fdf4; }
    .km-navside .km-sec { padding: 14px 14px 6px; font-size: .68em; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: .12em; }
    .km-navside a { display: flex; align-items: center; gap: 12px; padding: 9px 14px; color: #1f2937; text-decoration: none; font-size: .92em; font-weight: 600; border-left: 3px solid transparent; transition: all .15s ease; letter-spacing: -.01em; }
    .km-navside a:hover { background: #f0fdf4; color: #1a5c3a; transform: translateX(2px); }
    .km-navside a.active { background: #dcfce7; color: #1a5c3a; border-left-color: #1a5c3a; font-weight: 800; }
    .km-navside a.primary { background: linear-gradient(135deg,#1a5c3a,#2e7d32); color:#fff !important; font-weight: 800; font-size: .92em; margin: 6px 8px; border-radius: 10px; border-left: 0; padding: 9px 14px; box-shadow: 0 2px 8px rgba(26,92,58,.25); }
    .km-navside a.primary:hover { background: linear-gradient(135deg,#15803d,#166534); color:#fff !important; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(26,92,58,.35); }
    .km-navside a.primary .ic { font-size: 1.05em; }
    .km-navside a .ic { font-size: 1.05em; width: 22px; text-align: center; flex-shrink: 0; }
    .km-navside a .lbl { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .km-navtoggle { display: none; position: fixed; top: 8px; left: 8px; z-index: 1001; background: #1a5c3a; color: #fff; border: 0; border-radius: 8px; width: 38px; height: 38px; font-size: 1.3em; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    @media (max-width: 760px) {
      body { margin-left: 0 !important; }
      .km-navside { transform: translateX(-100%); transition: transform .2s; box-shadow: 2px 0 12px rgba(0,0,0,.15); }
      .km-navside.open { transform: translateX(0); }
      .km-navtoggle { display: block; }
    }
    @media print { .km-navside, .km-navtoggle { display: none !important; } body { margin-left: 0 !important; } }
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
    let html = `<div class="km-brand"><div class="logo">K</div><div class="nm">${pickLbl({ ko:'김치마트', en:'Kimchi Mart', es:'Kimchi Mart' })}</div></div>${backHtml}`;
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
      html += `<a href="${it.href}"${tgt}${hl}${clsAttr}><span class="ic">${it.ic}</span><span class="lbl">${pickLbl(it.lbl)}</span></a>`;
    }
    aside.innerHTML = html;
  }
  renderInner();

  const toggle = document.createElement('button');
  toggle.className = 'km-navtoggle';
  toggle.type = 'button';
  toggle.innerHTML = '☰';
  toggle.setAttribute('aria-label', '메뉴');
  toggle.onclick = () => aside.classList.toggle('open');
  // close on link tap (mobile)
  aside.addEventListener('click', e => {
    if (e.target.closest('a') && window.innerWidth <= 760) aside.classList.remove('open');
  });

  // Re-render when language OR identity changes
  window.addEventListener('storage', e => { if (LANG_KEYS.includes(e.key) || e.key === 'chat.me') renderInner(); });
  window.addEventListener('km-lang-changed', renderInner);
  window.addEventListener('km-identity-changed', renderInner);
  // Re-render after page's own inline scripts have run (they set kimchi_lang before DOMContentLoaded)
  document.addEventListener('DOMContentLoaded', renderInner);

  function mount(){
    document.body.appendChild(aside);
    document.body.appendChild(toggle);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
