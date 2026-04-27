// Shared left nav sidebar — injects into any page
// Usage: <script src="./nav-sidebar.js" defer></script>
(function(){
  if (window.__navSideInjected) return;
  window.__navSideInjected = true;

  const LINKS = [
    { sec: { ko:'대시보드', en:'Dashboard', es:'Panel' } },
    { ic: '🏠', lbl: { ko:'HUB',         en:'HUB',         es:'HUB' },         href: './hub.html' },
    { ic: '📅', lbl: { ko:'스케줄',       en:'Schedule',    es:'Horario' },     href: './shifts.html' },
    { ic: '💵', lbl: { ko:'급여 (현금)', en:'Payroll (Cash)', es:'Nómina (Efectivo)' }, href: './payroll.html?type=cash' },
    { ic: '📊', lbl: { ko:'급여 (CPA)',  en:'Payroll (CPA)',  es:'Nómina (CPA)' },      href: './payroll.html?type=cpa' },

    { sec: { ko:'커뮤니케이션', en:'Communication', es:'Comunicación' } },
    { ic: '💬', lbl: { ko:'채팅',         en:'Chat',           es:'Chat' },              href: './chat.html' },
    { ic: '📢', lbl: { ko:'공지 / Updates', en:'Announcements', es:'Anuncios' },         href: './updates.html' },
    { ic: '📨', lbl: { ko:'업무 지시',     en:'Tasks',          es:'Tareas' },           href: './tasks.html', highlight: true },

    { sec: { ko:'매장 운영', en:'Operations', es:'Operaciones' } },
    { ic: '🏪', lbl: { ko:'주문 센터',     en:'Order Center',  es:'Centro de Pedidos' }, href: './vendor-order-center.html' },
    { ic: '🔎', lbl: { ko:'상품 조회',     en:'Product Lookup', es:'Buscar Producto' }, href: 'https://specialmasterdj-sketch.github.io/kfood-guide/lookup.html', target: '_blank' },
    { ic: '📋', lbl: { ko:'일일 평가',     en:'Daily Review',   es:'Evaluación Diaria' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-opening-control/', target: '_blank' },
    { ic: '📄', lbl: { ko:'인보이스',       en:'Invoices',       es:'Facturas' },         href: './invoice-to-excel.html' },

    { sec: { ko:'트레이닝', en:'Training', es:'Capacitación' } },
    { ic: '🥩', lbl: { ko:'정육 트레이닝',  en:'Meat Training',     es:'Capacitación de Carne' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-meat-training/', target: '_blank' },
    { ic: '🍱', lbl: { ko:'K-Food 가이드',  en:'K-Food Guide',     es:'Guía K-Food' },          href: 'https://specialmasterdj-sketch.github.io/kfood-guide/', target: '_blank' },

    { sec: { ko:'기타', en:'Other', es:'Otros' } },
    { ic: '🚚', lbl: { ko:'물류',          en:'Logistics', es:'Logística' }, href: 'https://specialmasterdj-sketch.github.io/kimchi-logistics/', target: '_blank' },
    { ic: '🛒', lbl: { ko:'쇼핑',          en:'Shopping',  es:'Compras' },   href: 'https://specialmasterdj-sketch.github.io/kimchi-shop/', target: '_blank' },
    { ic: '⊞',  lbl: { ko:'모든 앱',       en:'All Apps',  es:'Todas Apps' }, href: './apps.html' },
  ];

  const W = 200;
  const css = `
    body { margin-left: ${W}px !important; }
    .km-navside { position: fixed; top: 0; left: 0; bottom: 0; width: ${W}px; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow-y: auto; padding: 8px 0; z-index: 1000; font-family: 'Segoe UI','Malgun Gothic',Arial,sans-serif; }
    .km-navside .km-brand { display:flex; align-items:center; gap:8px; padding: 10px 14px 14px; border-bottom: 1px solid #f3f4f6; margin-bottom: 4px; }
    .km-navside .km-brand .logo { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,#1a5c3a,#2e7d32); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:.95em; }
    .km-navside .km-brand .nm { font-weight:800; color:#1a5c3a; font-size:.95em; }
    .km-navside .km-sec { padding: 10px 14px 4px; font-size: .7em; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .05em; }
    .km-navside a { display: flex; align-items: center; gap: 10px; padding: 8px 14px; color: #374151; text-decoration: none; font-size: .88em; font-weight: 500; border-left: 3px solid transparent; transition: .1s; }
    .km-navside a:hover { background: #f4f6f9; color: #1a5c3a; }
    .km-navside a.active { background: #f0fdf4; color: #1a5c3a; border-left-color: #1a5c3a; font-weight: 700; }
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

  // Pick the active language — try all keys other pages use, fall back to nav language
  const LANG_KEYS = ['tasks.lang','kimchi_lang','hub.lang'];
  function currentLang(){
    for (const k of LANG_KEYS) {
      const v = localStorage.getItem(k);
      if (v && ['ko','en','es'].includes(v)) return v;
    }
    const nav = (navigator.language || 'ko').slice(0,2).toLowerCase();
    return ['ko','en','es'].includes(nav) ? nav : 'ko';
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
    let html = `<div class="km-brand"><div class="logo">K</div><div class="nm">${pickLbl({ ko:'김치마트', en:'Kimchi Mart', es:'Kimchi Mart' })}</div></div>`;
    for (const it of LINKS) {
      if (it.sec) { html += `<div class="km-sec">${pickLbl(it.sec)}</div>`; continue; }
      const hrefFile = (it.href || '').split('/').pop().split('?')[0].toLowerCase();
      const isActive = hrefFile && here === hrefFile;
      const tgt = it.target ? ` target="${it.target}"` : '';
      const hl = it.highlight ? ' style="font-weight:800;color:#1a5c3a"' : '';
      html += `<a href="${it.href}"${tgt}${hl}${isActive ? ' class="active"' : ''}><span class="ic">${it.ic}</span><span class="lbl">${pickLbl(it.lbl)}</span></a>`;
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

  // Re-render when language changes — listen to all known keys + a custom event
  window.addEventListener('storage', e => { if (LANG_KEYS.includes(e.key)) renderInner(); });
  window.addEventListener('km-lang-changed', renderInner);

  function mount(){
    document.body.appendChild(aside);
    document.body.appendChild(toggle);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
