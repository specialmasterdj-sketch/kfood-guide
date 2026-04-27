// Shared left nav sidebar — injects into any page
// Usage: <script src="./nav-sidebar.js" defer></script>
(function(){
  if (window.__navSideInjected) return;
  window.__navSideInjected = true;

  const LINKS = [
    { sec: '대시보드' },
    { ic: '🏠', lbl: 'HUB',           href: './hub.html' },
    { ic: '📅', lbl: '스케줄',         href: './shifts.html' },
    { ic: '💵', lbl: '급여',           href: './payroll.html?type=cpa' },

    { sec: '커뮤니케이션' },
    { ic: '💬', lbl: '채팅',           href: './chat.html' },
    { ic: '📢', lbl: '공지 / Updates', href: './updates.html' },
    { ic: '📨', lbl: '업무 지시',      href: './tasks.html' },

    { sec: '매장 운영' },
    { ic: '🏪', lbl: '주문 센터',      href: './vendor-order-center.html' },
    { ic: '🔎', lbl: '상품 조회',      href: 'https://specialmasterdj-sketch.github.io/kfood-guide/lookup.html', target: '_blank' },
    { ic: '📋', lbl: '일일 평가',      href: 'https://specialmasterdj-sketch.github.io/kimchi-opening-control/', target: '_blank' },
    { ic: '📄', lbl: '인보이스',       href: './invoice-to-excel.html' },

    { sec: '트레이닝' },
    { ic: '🥩', lbl: '정육 트레이닝',  href: 'https://specialmasterdj-sketch.github.io/kimchi-meat-training/', target: '_blank' },
    { ic: '🍱', lbl: 'K-Food 가이드',  href: 'https://specialmasterdj-sketch.github.io/kfood-guide/', target: '_blank' },

    { sec: '기타' },
    { ic: '🚚', lbl: '물류',           href: 'https://specialmasterdj-sketch.github.io/kimchi-logistics/', target: '_blank' },
    { ic: '🛒', lbl: '쇼핑',           href: 'https://specialmasterdj-sketch.github.io/kimchi-shop/', target: '_blank' },
    { ic: '⊞',  lbl: '모든 앱',        href: './apps.html' },
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

  // Determine active link from current path
  const here = location.pathname.split('/').pop().toLowerCase() || 'index.html';

  const aside = document.createElement('aside');
  aside.className = 'km-navside';
  let html = `<div class="km-brand"><div class="logo">K</div><div class="nm">김치마트</div></div>`;
  for (const it of LINKS) {
    if (it.sec) { html += `<div class="km-sec">${it.sec}</div>`; continue; }
    const hrefFile = (it.href || '').split('/').pop().split('?')[0].toLowerCase();
    const isActive = hrefFile && here === hrefFile;
    const tgt = it.target ? ` target="${it.target}"` : '';
    html += `<a href="${it.href}"${tgt}${isActive ? ' class="active"' : ''}><span class="ic">${it.ic}</span><span class="lbl">${it.lbl}</span></a>`;
  }
  aside.innerHTML = html;

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

  function mount(){
    document.body.appendChild(aside);
    document.body.appendChild(toggle);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
